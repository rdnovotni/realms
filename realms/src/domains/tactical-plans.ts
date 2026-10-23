import type pg from 'pg';
import { executeAction,advanceRevision,type Envelope } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';
import { encounterCheckpoint } from './encounters.js';
import { performTacticalAction } from './tactical-combat.js';
import { tacticalOptions } from './tactical-options.js';
import { opportunityAbilities } from './tactical-techniques.js';
import type { TacticalCheckpoint,TacticalCommand } from './tactical-encounters.js';
import type { TacticalSpec } from './tactical-content.js';
function explicit(e:Envelope,type:string){if(e.actionType!==type||!['MANUAL_UI','API'].includes(e.authorizationSource??'MANUAL_UI'))throw new DomainError(400,'INVALID_COMBAT_PLAN');}
export function createCombatPlan(pool:pg.Pool,accountId:string,e:Envelope,parameters:{instanceId:string;maxActions:number;maxMana:number;minHealth:number;healBelow:number}){
 explicit(e,'CREATE_COMBAT_PLAN');const p=parameters;
 if(!Number.isInteger(p.maxActions)||p.maxActions<1||p.maxActions>100||!Number.isInteger(p.maxMana)||p.maxMana<0||p.maxMana>1000000||!Number.isInteger(p.minHealth)||p.minHealth<0||p.minHealth>99||!Number.isInteger(p.healBelow)||p.healBelow<0||p.healBelow>100)throw new DomainError(400,'INVALID_COMBAT_PLAN');
 return executeAction(pool,accountId,e,p,async c=>{const own=(await c.client.query('SELECT e.outcome FROM tactical_encounter_origins o JOIN encounter_records e ON e.instance_id=o.instance_id WHERE o.instance_id=$1 AND o.run_id=$2',[p.instanceId,c.run.id])).rows[0];if(!own)throw new DomainError(404,'TACTICAL_NOT_FOUND');if(own.outcome)throw new DomainError(409,'TACTICAL_RESOLVED');if((await c.client.query("SELECT 1 FROM tactical_plans WHERE instance_id=$1 AND status='ACTIVE'",[p.instanceId])).rowCount)throw new DomainError(409,'COMBAT_PLAN_ACTIVE');const row=(await c.client.query('INSERT INTO tactical_plans(run_id,instance_id,max_actions,max_mana,min_health,heal_below) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[c.run.id,p.instanceId,p.maxActions,p.maxMana,p.minHealth,p.healBelow])).rows[0];return {planId:row.id,revision:await advanceRevision(c)};});
}
export function stepCombatPlan(pool:pg.Pool,accountId:string,e:Envelope,planId:string){
 if(e.actionType!=='STEP_COMBAT_PLAN')throw new DomainError(400,'INVALID_COMBAT_PLAN');
 return executeAction(pool,accountId,{...e,authorizationSource:'AUTOMATION'},{planId},async c=>{
  const p=(await c.client.query('SELECT * FROM tactical_plans WHERE id=$1 AND run_id=$2 FOR UPDATE',[planId,c.run.id])).rows[0];if(!p)throw new DomainError(404,'COMBAT_PLAN_NOT_FOUND');
  if(p.status!=='ACTIVE')return {planId,stopped:true,reason:p.stop_reason,revision:c.run.revision};
  const stop=async(reason:string)=>{await c.client.query("UPDATE tactical_plans SET status='STOPPED',stop_reason=$2 WHERE id=$1",[planId,reason]);return {planId,stopped:true,reason,revision:await advanceRevision(c)};};
  const row=(await c.client.query('SELECT checkpoint,revision FROM encounter_records WHERE instance_id=$1 AND run_id=$2 FOR UPDATE',[p.instance_id,c.run.id])).rows[0],cp=row.checkpoint as unknown as TacticalCheckpoint,s=cp.state,r=cp.rules;
  if(s.outcome)return stop('COMPLETE');if(p.completed>=p.max_actions)return stop('ACTION_LIMIT');
  const spec=(await c.client.query('SELECT spec FROM tactical_encounter_origins WHERE instance_id=$1',[p.instance_id])).rows[0].spec as TacticalSpec;
  if(!r.battlefield||!['TRIVIAL','STANDARD'].includes(r.battlefield.danger)||!!r.battlefield.bosses?.length)return stop('IMPORTANT_ENCOUNTER');
  if(r.battlefield.zones.some(z=>z.hazard)||r.battlefield.interactions.some(i=>s.battlefield!.uses[i.id]!>0))return stop('BATTLEFIELD_REQUIRES_ATTENTION');
  for(const enemy of spec.enemies){const known=(await c.client.query("SELECT 1 FROM tactical_all_origins o JOIN encounter_records e ON e.instance_id=o.instance_id JOIN runs r ON r.id=o.run_id JOIN characters ch ON ch.id=r.character_id WHERE ch.account_id=$1 AND e.outcome IS NOT NULL AND o.instance_id<>$2 AND EXISTS(SELECT 1 FROM jsonb_array_elements(o.spec->'enemies') x WHERE x->>'definitionId'=$3) LIMIT 1",[accountId,p.instance_id,enemy.definitionId])).rowCount;if(!known)return stop('UNKNOWN_MONSTER');}
  const actor=s.units.find(u=>u.id===s.order[s.cursor])!,party=s.units.filter(u=>u.side==='PARTY');if(party.some(u=>u.state!=='ACTIVE'||u.health*100/u.stats.maxHealth<=p.min_health))return stop('HEALTH_THRESHOLD');
  const beforeMana=party.reduce((n,u)=>n+(u.mana??0),0);let command:TacticalCommand|{actorId:'hero';kind:'CONTINUE'};
  if(actor.side==='ENEMY'||cp.serverControlledIds?.includes(actor.id))command={actorId:'hero',kind:'CONTINUE'};
  else {
   const options=tacticalOptions(r,s,actor.id).filter(o=>o.available),heal=options.find(o=>(o.command.kind==='HEAL'||o.command.kind==='USE_HEALING_ABILITY')&&party.some(u=>'targetId'in o.command&&u.id===o.command.targetId&&u.health*100/u.stats.maxHealth<p.heal_below)&&p.spent_mana+o.mana<=p.max_mana),attack=options.find(o=>o.command.kind==='ATTACK');
   command=heal?.command??attack?.command??{actorId:actor.id,kind:'END'};
   if(!heal&&!attack&&s.budgets[actor.id]!.main===1){const move=options.find(o=>o.command.kind==='MOVE');if(move&&move.command.kind==='MOVE'){if(opportunityAbilities(r,s,actor,move.command.zone).length)return stop('REACTION_REQUIRES_ATTENTION');command=move.command;}}
  }
  const runBefore={...c.run};await c.client.query('SAVEPOINT combat_plan_step');
  const result=await performTacticalAction(c,p.instance_id,row.revision,s.revision,command),after=(await c.client.query('SELECT checkpoint FROM encounter_records WHERE instance_id=$1',[p.instance_id])).rows[0].checkpoint as TacticalCheckpoint,spent=Math.max(0,beforeMana-after.state.units.filter(u=>u.side==='PARTY').reduce((n,u)=>n+(u.mana??0),0)),finished=after.state.outcome!==null||p.completed+1>=p.max_actions;
  if(p.spent_mana+spent>p.max_mana){await c.client.query('ROLLBACK TO SAVEPOINT combat_plan_step');await c.client.query('RELEASE SAVEPOINT combat_plan_step');Object.assign(c.run,runBefore);return stop('MANA_BUDGET');}
  await c.client.query('RELEASE SAVEPOINT combat_plan_step');
  await c.client.query("UPDATE tactical_plans SET completed=completed+1,spent_mana=spent_mana+$2,status=$3,stop_reason=$4 WHERE id=$1",[planId,spent,finished?'STOPPED':'ACTIVE',finished?after.state.outcome?'COMPLETE':'ACTION_LIMIT':null]);
  return {...result,revision:result.revision as number,planId,stopped:finished,reason:finished?after.state.outcome?'COMPLETE':'ACTION_LIMIT':null};
 });
}
export function stopCombatPlan(pool:pg.Pool,accountId:string,e:Envelope,planId:string){explicit(e,'STOP_COMBAT_PLAN');return executeAction(pool,accountId,e,{planId},async c=>{if(!(await c.client.query("UPDATE tactical_plans SET status='STOPPED',stop_reason='PLAYER_STOPPED' WHERE id=$1 AND run_id=$2 RETURNING id",[planId,c.run.id])).rowCount)throw new DomainError(404,'COMBAT_PLAN_NOT_FOUND');return {planId,revision:await advanceRevision(c)};});}
