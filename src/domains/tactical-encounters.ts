import { loadEffectGrants } from './tactical-effects.js';
import { loadDamageProfile } from './tactical-damage.js';
import type { ActionContext } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';
import type { TacticalKit } from './tactical-content.js';
import type { Json } from '../foundation/json.js';
import { beginAuthoredEncounter } from './loot.js';
import { beginEncounter,encounterCheckpoint,drawEncounter,saveEncounterCheckpoint } from './encounters.js';
import { readCharacterSnapshot } from './character-snapshots.js';
import { startTactical,stepTactical,type TacticalRules,type TacticalState,type TacticalUnit,type TacticalIntent } from './tactical-engine.js';

export type TacticalCommand={actorId:string;kind:'END'|'GUARD'|'RETREAT'}|{actorId:string;kind:'MOVE';zone:string}|{actorId:string;kind:'ATTACK'|'HEAL';targetId:string};
export type TacticalCheckpoint={engine:'TACTICAL_TRANSITION_V1';rules:TacticalRules;state:TacticalState;controlledIds:string[]};
const json=(value:unknown)=>value as Record<string,Json>;
/** Internal only: the authored encounter loader must authorize discovery, party
 * composition and tuning. Never accept rules, allies or enemies from a request. */
export async function beginTacticalEncounter(c:ActionContext,definitionId:string,rules:TacticalRules,
  player:{id:string;zone:string;health?:number;mana?:number;loadKit?:boolean},otherUnits:TacticalUnit[],controlledIds:string[],authoredLoot=false) {
  if(!controlledIds.includes(player.id)||new Set(controlledIds).size!==controlledIds.length)throw new DomainError(409,'INVALID_TACTICAL_CONTROL');
  const started=await (authoredLoot?beginAuthoredEncounter:beginEncounter)(c,definitionId,{});
  const snapshot=await readCharacterSnapshot(c.client,started.instanceId,c.run.id);
  const stats=snapshot.derived.stats;
  let canHeal=false,canGuard=false;
  if(player.loadKit)for(const source of snapshot.inputs.sources){
    const row=(await c.client.query("SELECT definition->'mechanics'->'tacticalKit' AS kit FROM content_versions WHERE entity_id=$1 AND revision=$2",[source.entityId,source.revision])).rows[0];
    const kit=row?.kit as TacticalKit|undefined;
    if(kit&&source.nativeLevel>=kit.minimumNativeLevel){canHeal ||=kit.heal;canGuard ||=kit.guard;}
  }
  const state=startTactical(rules,[{id:player.id,zone:player.zone,side:'PARTY',stats,health:Math.min(player.health??stats.maxHealth,stats.maxHealth),mana:Math.min(player.mana??stats.maxMana,stats.maxMana),canHeal:player.loadKit?canHeal:true,canGuard,strikes:0,state:'ACTIVE',...(rules.roundEffects?{onHitEffects:await loadEffectGrants(c.client,c.run.content_release_id,snapshot.inputs.sources)}:{}),...(rules.typedDamage?{damageProfile:await loadDamageProfile(c.client,rules.typedDamage,snapshot.inputs.sources)}:{})},...otherUnits]);
  if(controlledIds.some(id=>!state.units.some(u=>u.id===id&&u.side==='PARTY')))throw new DomainError(409,'INVALID_TACTICAL_CONTROL');
  const checkpoint:TacticalCheckpoint={engine:'TACTICAL_TRANSITION_V1',rules:structuredClone(rules),state,controlledIds:[...controlledIds]};
  // Encounter revision includes initialization; engine revision counts intents.
  const saved=await saveEncounterCheckpoint(c,started.instanceId,0,json(checkpoint));
  return {...saved,state:structuredClone(state)};
}
/** Called inside executeAction. Returning evidence in that handler's result pins
 * it in the immutable action receipt. Invalid actions roll back draws and saves.
 * Server actors pass serverControlled=true; public wrappers must never expose it.
 */
export async function executeTacticalCommand(c:ActionContext,instanceId:string,expectedEncounterRevision:number,
  expectedTacticalRevision:number,command:TacticalCommand,serverControlled=false) {
  const record=await encounterCheckpoint(c,instanceId);
  if(record.revision!==expectedEncounterRevision)throw new DomainError(409,'STALE_ENCOUNTER_REVISION');
  const checkpoint=record.checkpoint as unknown as TacticalCheckpoint;
  if(checkpoint.engine!=='TACTICAL_TRANSITION_V1')throw new DomainError(409,'NOT_TACTICAL_ENCOUNTER');
  if(checkpoint.state.revision!==expectedTacticalRevision)throw new DomainError(409,'STALE_TACTICAL_REVISION');
  const actor=checkpoint.state.units.find(u=>u.id===command.actorId);
  if(!actor || (serverControlled?actor.side!=='ENEMY':!checkpoint.controlledIds.includes(actor.id)))throw new DomainError(403,'TACTICAL_ACTOR_NOT_CONTROLLED');
  let intent:TacticalIntent;
  if(command.kind==='ATTACK') {
    const prefix=`action.${expectedTacticalRevision}`;
    const roll=1+await drawEncounter(c,instanceId,'tactical',`${prefix}.hit`,20);
    const rawDamage=actor.stats.attackMin+await drawEncounter(c,instanceId,'tactical',`${prefix}.damage`,actor.stats.attackMax-actor.stats.attackMin+1);
    intent={...command,kind:'ATTACK',roll,rawDamage};
  }else if(command.kind==='RETREAT') {
    intent={actorId:command.actorId,kind:'RETREAT',roll:1+await drawEncounter(c,instanceId,'tactical',`action.${expectedTacticalRevision}.retreat`,20)};
  }else intent=command as TacticalIntent;
  const result=stepTactical(checkpoint.rules,checkpoint.state,expectedTacticalRevision,intent);
  const saved=await saveEncounterCheckpoint(c,instanceId,expectedEncounterRevision,json({...checkpoint,state:result.state}));
  if((await c.client.query('SELECT 1 FROM tactical_encounter_origins WHERE instance_id=$1',[instanceId])).rows.length)
    await c.client.query('INSERT INTO tactical_steps(instance_id,revision,action_id,control,intent,evidence,state) VALUES($1,$2,$3,$4,$5,$6,$7)',[instanceId,result.state.revision,c.actionId,serverControlled?'SERVER':'PLAYER',result.evidence.intent,result.evidence,result.state]);
  // Terminal checkpoints remain open until an authored settlement handler resolves
  // loot, failure costs and recovery atomically. No implicit empty settlement.
  return {...saved,...result};
}
