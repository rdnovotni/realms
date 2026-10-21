import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { executeAction,advanceRevision,type ActionContext,type Envelope } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';
import { resolveDomain } from './shared-rule-actions.js';
import { validateRuleAction,type RuleAction } from '../rules/content.js';
export type PlanInput={entityId:string;maxTurns:number;maxActions:number;minHealth:number;targetItemId?:string;targetQuantity?:number};
async function knownAction(c:ActionContext,id:string){
 const row=(await c.client.query(`SELECT v.definition->'mechanics'->'sharedAction' AS spec,v.definition->'mechanics'->'dailyAllowance' AS daily
  FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision JOIN discoveries d ON d.entity_id=e.entity_id AND d.account_id=$1 AND d.knowledge_level IN ('DISCOVERED','LEARNED','ADVANCED') WHERE e.release_id=$2 AND e.entity_id=$3`,[c.accountId,c.run.content_release_id,id])).rows[0];
 if(!row?.spec)throw new DomainError(409,'AUTOMATION_UNKNOWN_ACTIVITY');validateRuleAction(row.spec,row.daily!==null);
 const spec=row.spec as RuleAction;
 if(spec.domain!=='INTERACTION'||spec.check.visibility!=='KNOWN')throw new DomainError(409,'AUTOMATION_UNKNOWN_ACTIVITY');return spec;
}
export function createTurnPlan(pool:pg.Pool,accountId:string,envelope:Envelope,input:PlanInput){
 if(envelope.actionType!=='CREATE_TURN_PLAN'||!Number.isInteger(input.maxTurns)||input.maxTurns<0||input.maxTurns>1000||!Number.isInteger(input.maxActions)||input.maxActions<1||input.maxActions>1000||!Number.isInteger(input.minHealth)||input.minHealth<0||input.minHealth>1000000||
  (input.targetItemId===undefined)!==(input.targetQuantity===undefined)||(input.targetQuantity!==undefined&&(!Number.isInteger(input.targetQuantity)||input.targetQuantity<1||input.targetQuantity>1000000)))throw new DomainError(400,'INVALID_TURN_PLAN');
 return executeAction(pool,accountId,envelope,{...input},async c=>{
  const spec=await knownAction(c,input.entityId);if(spec.costs.turns>input.maxTurns)throw new DomainError(409,'TURN_PLAN_BUDGET_TOO_SMALL');
  if(Number((await c.client.query("SELECT count(*) FROM turn_plans WHERE run_id=$1 AND status='ACTIVE'",[c.run.id])).rows[0].count)>=10)throw new DomainError(409,'TURN_PLAN_LIMIT');
  if(input.targetItemId&&!(await c.client.query(`SELECT 1 FROM release_entries e JOIN content_entities t ON t.id=e.entity_id AND t.kind='ITEM' JOIN discoveries d ON d.entity_id=e.entity_id AND d.account_id=$1 AND d.knowledge_level IN ('DISCOVERED','LEARNED','ADVANCED') WHERE e.release_id=$2 AND e.entity_id=$3`,[accountId,c.run.content_release_id,input.targetItemId])).rowCount)throw new DomainError(409,'AUTOMATION_UNKNOWN_TARGET');
  const id=randomUUID();await c.client.query('INSERT INTO turn_plans(id,account_id,run_id,entity_id,max_turns,max_actions,min_health,target_item_id,target_quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,accountId,c.run.id,input.entityId,input.maxTurns,input.maxActions,input.minHealth,input.targetItemId??null,input.targetQuantity??null]);
  return {planId:id,revision:await advanceRevision(c)};
 });
}
export function stopTurnPlan(pool:pg.Pool,accountId:string,envelope:Envelope,planId:string){
 if(envelope.actionType!=='STOP_TURN_PLAN')throw new DomainError(400,'INVALID_TURN_PLAN');
 return executeAction(pool,accountId,envelope,{planId},async c=>{
  const row=await c.client.query("UPDATE turn_plans SET status='STOPPED',stop_reason='PLAYER_STOPPED' WHERE id=$1 AND account_id=$2 AND run_id=$3 RETURNING id",[planId,accountId,c.run.id]);
  if(!row.rowCount)throw new DomainError(404,'TURN_PLAN_NOT_FOUND');return {planId,revision:await advanceRevision(c)};
 });
}
export function stepTurnPlan(pool:pg.Pool,accountId:string,envelope:Envelope,planId:string){
 if(envelope.actionType!=='STEP_TURN_PLAN')throw new DomainError(400,'INVALID_TURN_PLAN');
 return executeAction(pool,accountId,{...envelope,authorizationSource:'AUTOMATION'},{planId},async c=>{
  const plan=(await c.client.query('SELECT * FROM turn_plans WHERE id=$1 AND account_id=$2 AND run_id=$3 FOR UPDATE',[planId,accountId,c.run.id])).rows[0];
  if(!plan)throw new DomainError(404,'TURN_PLAN_NOT_FOUND');
  const stop=async(reason:string)=>{await c.client.query("UPDATE turn_plans SET status='STOPPED',stop_reason=$2 WHERE id=$1",[planId,reason]);return {planId,stopped:true,reason,revision:await advanceRevision(c)};};
  if(plan.status!=='ACTIVE')return {planId,stopped:true,reason:plan.stop_reason,revision:c.run.revision};
  if(plan.completed>=plan.max_actions)return stop('ACTION_LIMIT');
  if((await c.client.query("SELECT 1 FROM instances i JOIN instance_participants p ON p.instance_id=i.id WHERE p.run_id=$1 AND i.lifecycle='ACTIVE' LIMIT 1",[c.run.id])).rowCount)return stop('ENCOUNTER_REQUIRES_ATTENTION');
  if(plan.min_health){const health=(await c.client.query(`SELECT min(health) AS health FROM (SELECT health FROM tactical_run_state WHERE run_id=$1 UNION ALL SELECT health FROM combat_run_state WHERE run_id=$1) h`,[c.run.id])).rows[0]?.health;if(health===null||health===undefined||health<=plan.min_health)return stop('HEALTH_THRESHOLD');}
  if(plan.target_item_id){const quantity=(await c.client.query(`SELECT coalesce(sum(i.quantity),0)::text AS quantity FROM inventory_items i JOIN inventory_containers b ON b.id=i.container_id AND b.kind='CARRIED' JOIN state_scopes s ON s.id=b.scope_id WHERE s.run_id=$1 AND i.definition_id=$2`,[c.run.id,plan.target_item_id])).rows[0].quantity;if(BigInt(quantity)>=BigInt(plan.target_quantity))return stop('QUANTITY_REACHED');}
  await c.client.query('SAVEPOINT automation_step');
  try{
   const spec=await knownAction(c,plan.entity_id),reserve=(await c.client.query('SELECT reserve FROM turn_preferences WHERE account_id=$1',[accountId])).rows[0]?.reserve??0;
   if(spec.costs.turns>plan.max_turns-plan.spent)return stop('TURN_BUDGET');
   if(c.run.turns-spec.costs.turns<reserve)return stop('PROTECTED_RESERVE');
   c.automation={maxTurnDebit:plan.max_turns-plan.spent};
   const result=await resolveDomain(c,plan.entity_id,'INTERACTION','AUTOMATION');
   const spent=Number((await c.client.query('SELECT coalesce(-sum(least(delta,0)),0) AS spent FROM turn_ledger WHERE run_id=$1 AND request_id=$2',[c.run.id,c.requestId])).rows[0].spent);
   const reason=plan.completed+1>=plan.max_actions?'ACTION_LIMIT':String(result.degree).includes('FAILURE')?'FAILED_CHECK':spec.costs.turns>0&&plan.spent+spent>=plan.max_turns?'TURN_BUDGET':null;
   await c.client.query('UPDATE turn_plans SET spent=spent+$2,completed=completed+1,status=$3,stop_reason=$4 WHERE id=$1',[planId,spent,reason?'STOPPED':'ACTIVE',reason]);
   return {...result,planId,stopped:reason!==null,reason};
  }catch(error){
   await c.client.query('ROLLBACK TO SAVEPOINT automation_step');
   if(!(error instanceof DomainError))throw error;
   return stop(error.message);
  }
 });
}
