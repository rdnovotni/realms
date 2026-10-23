import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { executeAction,advanceRevision,type Envelope,type ActionContext } from '../foundation/action.js';
import { transaction } from '../foundation/transaction.js';
import { checksum,type Json } from '../foundation/json.js';
import { DomainError } from '../foundation/errors.js';
import { consumptionReadContext,consumptionBalance,consumptionPolicy,pendingConsumptionRollover } from './consumption.js';
import { usable,commitItemUse } from './inventory-services.js';
export type MealLine={definitionId:string;quantity:number;nightcap:boolean};
function explicit(e:Envelope,type:string){if(e.actionType!==type||!['MANUAL_UI','API'].includes(e.authorizationSource??'MANUAL_UI'))throw new DomainError(400,'INVALID_MEAL_PLAN_ACTION');}
function linesValid(lines:MealLine[]){if(!Array.isArray(lines)||lines.length<1||lines.length>20||lines.some(l=>!l||Object.keys(l).sort().join(',')!=='definitionId,nightcap,quantity'||!/^[a-z][a-z0-9_.-]{2,119}$/.test(l.definitionId)||!Number.isInteger(l.quantity)||l.quantity<1||l.quantity>20||typeof l.nightcap!=='boolean')||lines.reduce((sum,l)=>sum+l.quantity,0)>100||new Set(lines.map(l=>l.definitionId)).size!==lines.length||lines.some((l,i)=>l.nightcap&&(i!==lines.length-1||l.quantity!==1)))throw new DomainError(400,'INVALID_MEAL_PLAN');}
export function saveMealPlan(pool:pg.Pool,accountId:string,e:Envelope,name:string,lines:MealLine[]){
 explicit(e,'SAVE_MEAL_PLAN');linesValid(lines);if(typeof name!=='string'||name.trim().length<1||name.trim().length>80)throw new DomainError(400,'INVALID_MEAL_PLAN');name=name.trim();
 return executeAction(pool,accountId,e,{name,lines},async c=>{
  if(!(await c.client.query('SELECT 1 FROM meal_plans WHERE account_id=$1 AND name=$2 AND NOT deleted',[accountId,name])).rowCount&&Number((await c.client.query('SELECT count(*) FROM meal_plans WHERE account_id=$1 AND NOT deleted',[accountId])).rows[0].count)>=20)throw new DomainError(409,'MEAL_PLAN_LIMIT');
  for(const line of lines){const row=(await c.client.query(`SELECT v.definition->'mechanics'->'itemUse'->'consumption' AS spec FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision JOIN discoveries d ON d.account_id=$1 AND d.entity_id=e.entity_id AND d.knowledge_level IN('DISCOVERED','LEARNED','ADVANCED') WHERE e.release_id=$2 AND e.entity_id=$3`,[accountId,c.run.content_release_id,line.definitionId])).rows[0];if(!row?.spec)throw new DomainError(409,'MEAL_UNKNOWN_ITEM');if(line.nightcap&&row.spec.family!=='BOOZE')throw new DomainError(400,'INVALID_NIGHTCAP');}
  const plan=(await c.client.query('INSERT INTO meal_plans(account_id,name,lines) VALUES($1,$2,$3) ON CONFLICT(account_id,name) DO UPDATE SET lines=EXCLUDED.lines,revision=meal_plans.revision+1,deleted=false RETURNING id,revision',[accountId,name,JSON.stringify(lines)])).rows[0];return {planId:plan.id,planRevision:plan.revision,revision:await advanceRevision(c)};
 });
}
export function deleteMealPlan(pool:pg.Pool,accountId:string,e:Envelope,planId:string){explicit(e,'DELETE_MEAL_PLAN');return executeAction(pool,accountId,e,{planId},async c=>{if(!(await c.client.query('UPDATE meal_plans SET deleted=true,revision=revision+1 WHERE id=$1 AND account_id=$2 AND NOT deleted RETURNING id',[planId,accountId])).rowCount)throw new DomainError(404,'MEAL_PLAN_NOT_FOUND');return {planId,revision:await advanceRevision(c)};});}
async function candidates(c:ActionContext,definitionId:string){return (await c.client.query(`SELECT i.id,i.quantity::text FROM inventory_items i JOIN inventory_containers b ON b.id=i.container_id JOIN state_scopes s ON s.id=b.scope_id WHERE s.run_id=$1 AND b.kind='CARRIED' AND i.quantity>0 AND i.definition_id=$2 ORDER BY i.id LIMIT 101`,[c.run.id,definitionId])).rows as {id:string;quantity:string}[];}
async function preview(c:ActionContext,planId:string){
 const plan=(await c.client.query('SELECT * FROM meal_plans WHERE id=$1 AND account_id=$2 AND NOT deleted',[planId,c.accountId])).rows[0];if(!plan)throw new DomainError(404,'MEAL_PLAN_NOT_FOUND');
 const balance=await consumptionBalance(c.client,c.run.id),policy=await consumptionPolicy(c.client,c.run.id),projected={...balance};let projectedTurns:number|null=0;
 const lines=[];
 for(const line of plan.lines as MealLine[]){let remaining=line.quantity;const allocations=[];let turns:number|null=0;let name='Unavailable consumable';const issues:string[]=[];
  for(const candidate of await candidates(c,line.definitionId)){
   if(!remaining)break;
   const u=await usable(c,candidate.id);name=u.row.name;if(!u.consumption)throw new DomainError(409,'MEAL_UNKNOWN_ITEM');
   const quantity=Math.min(remaining,Number(BigInt(candidate.quantity)>100n?100n:BigInt(candidate.quantity)));remaining-=quantity;
   allocations.push({itemId:candidate.id,quantity,token:u.token});
   if(!line.nightcap)for(const k of ['fullness','drunkenness','tolerance'] as const)projected[k]+=u.consumption.spec.costs[k]*quantity;
   turns=turns===null||!u.consumption.known?null:turns+u.consumption.turns*quantity;
   if(Object.values(u.protection).some(Boolean)||!u.consumption.known||!u.consumption.spec.automatic||u.consumption.spec.rare)issues.push('Requires manual attention');
   issues.push(...u.consumption.reasons);
  }
  if(remaining)issues.push('Not enough carried items');
  if(!line.nightcap)projectedTurns=projectedTurns===null||turns===null?null:projectedTurns+turns;
  lines.push({...line,name,turns,missing:remaining,issues:[...new Set(issues)],allocations});
 }
 const fits=(['fullness','drunkenness','tolerance'] as const).every(k=>projected[k]<=policy.capacities[k]);
 const token=checksum({planId,planRevision:plan.revision,runId:c.run.id,revision:c.run.revision,balance,policy,lines} as Json);
 return {runId:c.run.id,revision:c.run.revision,planId,name:plan.name,planRevision:plan.revision,balance,projected,limits:policy.capacities,projectedTurns,fits,lines,token};
}
export function mealPlanPreview(pool:pg.Pool,accountId:string,revision:number,planId:string){return transaction(pool,async client=>preview(await consumptionReadContext(client,accountId,revision),planId));}
export function startMealPlan(pool:pg.Pool,accountId:string,e:Envelope,planId:string,token:string){
 explicit(e,'START_MEAL_PLAN');return executeAction(pool,accountId,e,{planId,token},async c=>{
  const p=await preview(c,planId);if(token!==p.token)throw new DomainError(409,'MEAL_PLAN_CHANGED');if(!p.fits)throw new DomainError(409,'MEAL_PLAN_CAPACITY_EXCEEDED');
  if(p.lines.some(l=>!l.nightcap&&l.issues.length))throw new DomainError(409,'MEAL_REQUIRES_MANUAL_ATTENTION');
  if((await c.client.query("SELECT 1 FROM meal_plan_runs WHERE run_id=$1 AND status='ACTIVE'",[c.run.id])).rowCount)throw new DomainError(409,'MEAL_ALREADY_RUNNING');
  const id=randomUUID(),queue=p.lines.flatMap<{itemId:string|null;nightcap:boolean}>(l=>l.nightcap?[{nightcap:true,itemId:null}]:l.allocations.flatMap(a=>Array.from({length:a.quantity},()=>({itemId:a.itemId,nightcap:false}))));
  await c.client.query('INSERT INTO meal_plan_runs(id,account_id,run_id,plan_id,plan_revision,lines,rollovers) VALUES($1,$2,$3,$4,$5,$6,(SELECT count(*) FROM run_rollovers WHERE run_id=$3))',[id,accountId,c.run.id,planId,p.planRevision,JSON.stringify(queue)]);
  return {executionId:id,revision:await advanceRevision(c)};
 });
}
export function stepMealPlan(pool:pg.Pool,accountId:string,e:Envelope,executionId:string){
 if(e.actionType!=='STEP_MEAL_PLAN')throw new DomainError(400,'INVALID_MEAL_PLAN_ACTION');
 return executeAction(pool,accountId,{...e,authorizationSource:'AUTOMATION'},{executionId},async c=>{
  const run=(await c.client.query('SELECT * FROM meal_plan_runs WHERE id=$1 AND account_id=$2 AND run_id=$3 FOR UPDATE',[executionId,accountId,c.run.id])).rows[0];if(!run)throw new DomainError(404,'MEAL_EXECUTION_NOT_FOUND');
  const stop=async(reason:string)=>{await c.client.query("UPDATE meal_plan_runs SET status='STOPPED',stop_reason=$2 WHERE id=$1",[executionId,reason]);return {executionId,stopped:true,reason,revision:await advanceRevision(c)};};
  if(run.status!=='ACTIVE')return {executionId,stopped:true,reason:run.stop_reason,revision:c.run.revision};
  if(await pendingConsumptionRollover(c.client,accountId)||Number((await c.client.query('SELECT count(*) FROM run_rollovers WHERE run_id=$1',[c.run.id])).rows[0].count)!==Number(run.rollovers))return stop('ROLLOVER_REVIEW_REQUIRED');
  if(!(await c.client.query('SELECT 1 FROM meal_plans WHERE id=$1 AND revision=$2 AND NOT deleted',[run.plan_id,run.plan_revision])).rowCount)return stop('MEAL_PLAN_CHANGED');
  const next=run.lines[run.completed];if(!next)return stop('COMPLETE');if(next.nightcap)return stop('NIGHTCAP_RESERVED');
  await c.client.query('SAVEPOINT meal_step');
  try{
   const item=await usable(c,next.itemId);if(item.protection.neverAuto||item.protection.nightcap)throw new DomainError(409,'MEAL_ITEM_RESERVED');
   const result=await commitItemUse(c,next.itemId,item.token,false,false,true),finished=run.completed+1>=run.lines.length;
   await c.client.query("UPDATE meal_plan_runs SET completed=completed+1,status=$2,stop_reason=$3 WHERE id=$1",[executionId,finished?'STOPPED':'ACTIVE',finished?'COMPLETE':null]);
   return {...result,executionId,stopped:finished,reason:finished?'COMPLETE':null};
  }catch(error){await c.client.query('ROLLBACK TO SAVEPOINT meal_step');if(!(error instanceof DomainError))throw error;return stop(error.message);}
 });
}
export function stopMealPlan(pool:pg.Pool,accountId:string,e:Envelope,executionId:string){explicit(e,'STOP_MEAL_PLAN');return executeAction(pool,accountId,e,{executionId},async c=>{if(!(await c.client.query("UPDATE meal_plan_runs SET status='STOPPED',stop_reason='PLAYER_STOPPED' WHERE id=$1 AND account_id=$2 AND run_id=$3 RETURNING id",[executionId,accountId,c.run.id])).rowCount)throw new DomainError(404,'MEAL_EXECUTION_NOT_FOUND');return {executionId,revision:await advanceRevision(c)};});}
export function setConsumablePreference(pool:pg.Pool,accountId:string,e:Envelope,itemId:string,neverAuto:boolean,nightcap:boolean){explicit(e,'SET_CONSUMABLE_PREFERENCE');if(typeof neverAuto!=='boolean'||typeof nightcap!=='boolean')throw new DomainError(400,'INVALID_CONSUMABLE_PREFERENCE');return executeAction(pool,accountId,e,{itemId,neverAuto,nightcap},async c=>{await usable(c,itemId);await c.client.query('INSERT INTO consumption_item_preferences(item_id,account_id,never_auto,nightcap) VALUES($1,$2,$3,$4) ON CONFLICT(item_id) DO UPDATE SET never_auto=EXCLUDED.never_auto,nightcap=EXCLUDED.nightcap',[itemId,accountId,neverAuto,nightcap]);return {itemId,revision:await advanceRevision(c)};});}
