import { loadHealingAbilities } from './tactical-healing-abilities.js';
import { loadAttackAbilities } from './tactical-abilities.js';
import { loadStatusProfile } from './tactical-status.js';
import { loadCleanseAbilities,cleansingEligible } from './tactical-cleansing.js';
import { loadEffectGrants } from './tactical-effects.js';
import { tacticalCampaignPrerequisites,completeTacticalCampaign } from './tactical-campaign.js';
import { deriveDamageProfile } from './tactical-damage.js';
import type pg from 'pg';
import { executeAction,advanceRevision,type ActionContext,type Envelope } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';
import type { Json } from '../foundation/json.js';
import { encounterCheckpoint,finishEncounter } from './encounters.js';
import { settleAuthoredVictory } from './loot.js';
import { beginTacticalEncounter,executeTacticalCommand,type TacticalCommand,type TacticalCheckpoint } from './tactical-encounters.js';
import { validateTacticalSpec,validateTacticalTemplate,type TacticalSpec,type TacticalTemplate } from './tactical-content.js';
import { tacticalDistance,type TacticalState,type TacticalUnit } from './tactical-engine.js';

export type TacticalPlayerCommand=TacticalCommand|{actorId:'hero';kind:'CONTINUE'};

async function authored(c:ActionContext,id:string) {
 const row=(await c.client.query(`SELECT v.definition->'mechanics'->'tacticalCombat' AS spec FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=$1 AND e.entity_id=$2`,[c.run.content_release_id,id])).rows[0];
 validateTacticalSpec(row?.spec);return row!.spec as TacticalSpec;
}
async function spawned(c:ActionContext,spec:TacticalSpec) {
 const units:TacticalUnit[]=[];
 for(const u of [...spec.allies.map(u=>({...u,side:'PARTY' as const})),...spec.enemies.map(u=>({...u,side:'ENEMY' as const}))]){
  const row=(await c.client.query(`SELECT e.revision,v.definition->'mechanics'->'tacticalUnit' AS spec FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=$1 AND e.entity_id=$2`,[c.run.content_release_id,u.definitionId])).rows[0];
  validateTacticalTemplate(row?.spec);const t=row!.spec as TacticalTemplate;
  units.push({id:u.id,side:u.side,zone:u.zone,stats:t.stats,health:t.stats.maxHealth,strikes:0,state:'ACTIVE',canHeal:t.canHeal,canGuard:t.canGuard,...(spec.rules.roundEffects?{onHitEffects:await loadEffectGrants(c.client,c.run.content_release_id,[{entityId:u.definitionId,revision:row!.revision as number,nativeLevel:0}])}:{}),...((spec.rules.roundEffects?.version??0)>=2?{onHealEffects:await loadEffectGrants(c.client,c.run.content_release_id,[{entityId:u.definitionId,revision:row!.revision as number,nativeLevel:0}],'HEAL')}:{}),...(spec.rules.roundEffects?.version===3?{cleansingAbilities:await loadCleanseAbilities(c.client,[{entityId:u.definitionId,revision:row!.revision as number,nativeLevel:0}])}:{}),...(spec.rules.healingAbilities?{healingAbilities:await loadHealingAbilities(c.client,[{entityId:u.definitionId,revision:row!.revision as number,nativeLevel:0}])}:{}),...(spec.rules.abilities?{attackAbilities:await loadAttackAbilities(c.client,spec.rules.typedDamage!,[{entityId:u.definitionId,revision:row!.revision as number,nativeLevel:0}])}:{}),...(spec.rules.statusDefense?{statusProfile:await loadStatusProfile(c.client,spec.rules.statusDefense,[{entityId:u.definitionId,revision:row!.revision as number,nativeLevel:0}])}:{}),...(spec.rules.typedDamage?{damageProfile:deriveDamageProfile(spec.rules.typedDamage,t.damageTraits?[{traits:t.damageTraits,nativeLevel:0}]:[])}:{})});
 }
 return units;
}
export function tacticalPublic(state:TacticalState,encounterRevision:number,spec:TacticalSpec) {
 return {encounterRevision,tacticalRevision:state.revision,round:state.round,currentActor:state.outcome===null?state.order[state.cursor]!:null,order:state.order,outcome:state.outcome,
  units:state.units.map(u=>({id:u.id,side:u.side,zone:u.zone,health:u.health,maxHealth:u.stats.maxHealth,mana:u.mana??0,maxMana:u.stats.maxMana,state:u.state,strikes:u.strikes,guardReady:u.guardReady??false,...(spec.rules.roundEffects?{effects:(u.effects??[]).map(e=>({effectId:e.effectId,family:e.effect.family,polarity:e.effect.polarity,tags:e.effect.tags,clock:e.effect.clock,tick:e.effect.tick,stacking:e.effect.stacking,remaining:e.remaining,modifiers:e.effect.modifiers,sourceUnitId:e.sourceUnitId,...(e.effect.version===3?{removal:e.effect.removal}:{}),...(e.effect.periodic?{periodic:e.effect.periodic}:{})}))}:{})})),budgets:state.budgets,
  actionRules:{attackRange:spec.rules.attackRange,healRange:spec.rules.healRange,healAmount:spec.rules.healAmount,healManaCost:spec.rules.healManaCost!,guardArmorBonus:spec.rules.guardArmorBonus!},
  partyCapabilities:state.units.filter(u=>u.side==='PARTY').map(u=>({id:u.id,heal:u.canHeal??false,guard:u.canGuard??false,...(spec.rules.roundEffects?{onHitEffects:(u.onHitEffects??[]).map(g=>({effectId:g.effectId,family:g.effect.family,rounds:g.effect.rounds,clock:g.effect.clock,tick:g.effect.tick,stacking:g.effect.stacking,polarity:g.effect.polarity,tags:g.effect.tags,modifiers:g.effect.modifiers,...(g.effect.periodic?{periodic:g.effect.periodic}:{})}))}:{}),...((spec.rules.roundEffects?.version??0)>=2?{onHealEffects:(u.onHealEffects??[]).map(g=>({effectId:g.effectId,family:g.effect.family,rounds:g.effect.rounds,clock:g.effect.clock,tick:g.effect.tick,stacking:g.effect.stacking,polarity:g.effect.polarity,tags:g.effect.tags,modifiers:g.effect.modifiers,...(g.effect.periodic?{periodic:g.effect.periodic}:{})}))}:{}),...(spec.rules.roundEffects?.version===3?{cleansingAbilities:(u.cleansingAbilities??[]).map(a=>({abilityId:a.id,method:a.spec.method,tags:a.spec.tags,strength:a.spec.strength,manaCost:a.spec.manaCost,range:a.spec.range,targetSide:a.spec.targetSide}))}:{}),...(spec.rules.healingAbilities?{healingAbilities:(u.healingAbilities??[]).map(a=>({abilityId:a.id,range:a.spec.range,manaCost:a.spec.manaCost,min:a.spec.min,max:a.spec.max}))}:{}),...(spec.rules.abilities?{attackAbilities:(u.attackAbilities??[]).map(a=>({abilityId:a.id,range:a.spec.range,manaCost:a.spec.manaCost,accuracyModifier:a.spec.accuracyModifier,damage:a.spec.damage}))}:{}),...(spec.rules.statusDefense?{statusImmunities:u.statusProfile!.immuneTags}:{}),...(u.damageProfile?{damageProfile:u.damageProfile}:{})})),
  battlefield:{zones:spec.rules.zones,edges:spec.rules.edges},failureContract:spec.failure,...(spec.campaignId?{campaignCompleted:state.outcome==='VICTORY'}:{})};
}
export function enemyCommand(checkpoint:TacticalCheckpoint):TacticalCommand {
 const s=checkpoint.state,actor=s.units.find(u=>u.id===s.order[s.cursor])!;
 if(actor.side!=='ENEMY'||actor.state!=='ACTIVE')throw new DomainError(409,'NOT_ENEMY_TURN');
 if(checkpoint.rules.roundEffects?.version===3&&s.budgets[actor.id]!.main===1){
  for(const ability of actor.cleansingAbilities??[])if(ability.spec.targetSide==='ALLY'&&(actor.mana??0)>=ability.spec.manaCost){
   const effect=actor.effects?.find(e=>cleansingEligible(ability,e));if(effect)return {actorId:actor.id,kind:'CLEANSE',targetId:actor.id,abilityId:ability.id,effectId:effect.effectId};
  }
 }
 if(checkpoint.rules.healingAbilities&&s.budgets[actor.id]!.main===1&&actor.health<actor.stats.maxHealth){const ability=actor.healingAbilities?.find(a=>(actor.mana??0)>=a.spec.manaCost);if(ability)return {actorId:actor.id,kind:'USE_HEALING_ABILITY',targetId:actor.id,abilityId:ability.id};}
 const target=s.units.filter(u=>u.side==='PARTY'&&u.state==='ACTIVE').sort((a,b)=>a.health-b.health||(a.id<b.id?-1:1))[0];
 if(!target||s.budgets[actor.id]!.main===0)return {actorId:actor.id,kind:'END'};
 const distance=tacticalDistance(checkpoint.rules,actor.zone,target.zone);
 if(checkpoint.rules.abilities){const ability=actor.attackAbilities?.find(a=>distance<=a.spec.range&&(actor.mana??0)>=a.spec.manaCost);if(ability)return {actorId:actor.id,kind:'USE_ABILITY',targetId:target.id,abilityId:ability.id};}
 if(distance<=checkpoint.rules.attackRange)return {actorId:actor.id,kind:'ATTACK',targetId:target.id};
 if(s.budgets[actor.id]!.quick===1){
  const candidates=checkpoint.rules.edges.flatMap(([a,b])=>a===actor.zone?[b]:b===actor.zone?[a]:[]).sort();
  const zone=candidates.find(z=>tacticalDistance(checkpoint.rules,z,target.zone)<distance);
  if(zone)return {actorId:actor.id,kind:'MOVE',zone};
 }
 return {actorId:actor.id,kind:'END'};
}
async function settle(c:ActionContext,id:string,spec:TacticalSpec,state:TacticalState,encounterRevision:number) {
 if(state.outcome===null)return encounterRevision;
 const hero=state.units.find(u=>u.id==='hero')!;
 const failure=state.outcome==='DEFEAT'||state.outcome==='FAILED_FORWARD';
 const health=hero.health>0?hero.health:Math.min(hero.stats.maxHealth,spec.failure.recoveryHealth),mana=hero.mana??0;
 const turnCost=failure?Math.min(c.run.turns,spec.failure.turnCost):0;
 const destination=failure?'HOME':'FIELD';
 const recovery=async()=>{
  await c.client.query('INSERT INTO tactical_recoveries(instance_id,action_id,health,mana,turn_cost,destination) VALUES($1,$2,$3,$4,$5,$6)',[id,c.actionId,health,mana,turnCost,destination]);
  if(failure){await c.client.query('UPDATE runs SET turns=turns-$2 WHERE id=$1',[c.run.id,turnCost]);c.run.turns-=turnCost;
   await c.client.query("INSERT INTO turn_ledger(run_id,request_id,delta,reason) VALUES($1,$2,$3,'TACTICAL_RECOVERY')",[c.run.id,c.requestId,-turnCost]);}
  await c.client.query('UPDATE tactical_run_state SET health=$2,mana=$3,last_instance_id=$4 WHERE run_id=$1',[c.run.id,health,mana,id]);
  return {destination,health,mana,turnCost};
 };
 if(state.outcome==='VICTORY')await settleAuthoredVictory(c,id,encounterRevision,async()=>{
  const result=await recovery();
  if(spec.campaignId){await completeTacticalCampaign(c,id,spec.campaignId);return {...result,campaignCompleted:true};}
  return result;
 });
 else await finishEncounter(c,id,encounterRevision,state.outcome,recovery);
 return encounterRevision+1;
}
async function advanceEnemies(c:ActionContext,id:string) {
 // At most one segment of enemy turns, ending when control returns to a party unit.
 for(let n=0;n<64;n++){
  const record=await encounterCheckpoint(c,id),checkpoint=record.checkpoint as unknown as TacticalCheckpoint;
  if(checkpoint.state.outcome!==null||checkpoint.state.units.find(u=>u.id===checkpoint.state.order[checkpoint.state.cursor])!.side==='PARTY')return record;
  await executeTacticalCommand(c,id,record.revision,checkpoint.state.revision,enemyCommand(checkpoint),true);
 }
 throw new DomainError(409,'TACTICAL_AI_LIMIT');
}
async function recoveryView(c:ActionContext,id:string) {
 const row=(await c.client.query('SELECT health,mana,turn_cost,destination FROM tactical_recoveries WHERE instance_id=$1',[id])).rows[0];
 return row?{health:row.health as number,mana:row.mana as number,turnCost:row.turn_cost as number,destination:row.destination as string}:null;
}
export function startTacticalCombat(pool:pg.Pool,accountId:string,envelope:Envelope,definitionId:string) {
 return executeAction(pool,accountId,envelope,{definitionId},async c=>{
  if(!(await c.client.query('SELECT 1 FROM discoveries WHERE account_id=$1 AND entity_id=$2',[accountId,definitionId])).rows.length)throw new DomainError(404,'TACTICAL_NOT_DISCOVERED');
  const spec=await authored(c,definitionId);
  if(spec.campaignId)await tacticalCampaignPrerequisites(c,definitionId,spec.campaignId);
  const units=await spawned(c,spec);
  const prior=(await c.client.query('SELECT health,mana,last_instance_id FROM tactical_run_state WHERE run_id=$1 FOR UPDATE',[c.run.id])).rows[0];
  const started=await beginTacticalEncounter(c,definitionId,spec.rules,{id:'hero',zone:spec.playerZone,loadKit:true,...(prior?{health:prior.health as number,mana:prior.mana as number}:{})},units,['hero',...spec.allies.map(u=>u.id)],true);
  if(c.run.status==='ACTIVE')await c.client.query("UPDATE runs SET completion_policy='CAMPAIGN' WHERE id=$1",[c.run.id]);
  const record=await encounterCheckpoint(c,started.instanceId);
  await c.client.query('INSERT INTO tactical_encounter_origins(instance_id,run_id,spec,initial_checkpoint,previous_instance_id) VALUES($1,$2,$3,$4,$5)',[started.instanceId,c.run.id,spec,record.checkpoint,prior?.last_instance_id??null]);
  const hero=started.state.units[0]!;
  await c.client.query('INSERT INTO tactical_run_state(run_id,health,mana,last_instance_id) VALUES($1,$2,$3,$4) ON CONFLICT(run_id) DO UPDATE SET health=EXCLUDED.health,mana=EXCLUDED.mana,last_instance_id=EXCLUDED.last_instance_id',[c.run.id,hero.health,hero.mana,started.instanceId]);
  // A separate action advances enemy-first fights: start and recovery each retain
  // their own unique Turn-ledger request instead of sharing one request ID.
  const state=started.state,revision=started.encounterRevision;
  return {instanceId:started.instanceId,...tacticalPublic(state,revision,spec),recovery:null,revision:await advanceRevision(c)} as unknown as Record<string,Json>;
 });
}
export function takeTacticalAction(pool:pg.Pool,accountId:string,envelope:Envelope,id:string,expectedEncounterRevision:number,expectedTacticalRevision:number,command:TacticalPlayerCommand) {
 return executeAction(pool,accountId,envelope,{id,expectedEncounterRevision,expectedTacticalRevision,command},async c=>{
  // Require a managed authored origin; generic internal fixtures are not public fights.
  const origin=(await c.client.query('SELECT spec FROM tactical_encounter_origins WHERE instance_id=$1 AND run_id=$2',[id,c.run.id])).rows[0];
  if(!origin)throw new DomainError(404,'TACTICAL_NOT_FOUND');
  if(command.kind==='CONTINUE'){
   const record=await encounterCheckpoint(c,id),checkpoint=record.checkpoint as unknown as TacticalCheckpoint;
   if(record.revision!==expectedEncounterRevision||checkpoint.state.revision!==expectedTacticalRevision)throw new DomainError(409,'STALE_TACTICAL_REVISION');
   if(command.actorId!=='hero'||checkpoint.state.units.find(u=>u.id===checkpoint.state.order[checkpoint.state.cursor])?.side!=='ENEMY')throw new DomainError(409,'NOT_ENEMY_TURN');
  }else await executeTacticalCommand(c,id,expectedEncounterRevision,expectedTacticalRevision,command);
  const advanced=await advanceEnemies(c,id),state=(advanced.checkpoint as unknown as TacticalCheckpoint).state,spec=origin.spec as TacticalSpec;
  const revision=await settle(c,id,spec,state,advanced.revision);
  return {instanceId:id,...tacticalPublic(state,revision,spec),recovery:await recoveryView(c,id),revision:await advanceRevision(c)} as unknown as Record<string,Json>;
 });
}
export async function tacticalView(pool:pg.Pool,accountId:string,id:string) {
 const row=(await pool.query(`SELECT e.checkpoint,e.revision,r.revision AS run_revision,o.spec,recovery.health,recovery.mana,recovery.turn_cost,recovery.destination FROM tactical_encounter_origins o JOIN encounter_records e ON e.instance_id=o.instance_id JOIN runs r ON r.id=o.run_id JOIN characters c ON c.id=r.character_id LEFT JOIN tactical_recoveries recovery ON recovery.instance_id=o.instance_id WHERE o.instance_id=$1 AND c.account_id=$2`,[id,accountId])).rows[0];
 if(!row)throw new DomainError(404,'TACTICAL_NOT_FOUND');
 return {instanceId:id,revision:row.run_revision as number,...tacticalPublic((row.checkpoint as TacticalCheckpoint).state,row.revision as number,row.spec as TacticalSpec),recovery:row.health!==null?{health:row.health,mana:row.mana,turnCost:row.turn_cost,destination:row.destination}:null};
}
