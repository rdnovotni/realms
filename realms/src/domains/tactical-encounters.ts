import { loadTechniqueProfile,loadTechniqueSkills,techniqueTargets,opportunityAbilities,type TechniqueIntent } from './tactical-techniques.js';
import { loadCarryEffects,readCarryEffects } from './tactical-persistence.js';
import { loadHealingAbilities } from './tactical-healing-abilities.js';
import { loadAttackAbilities } from './tactical-abilities.js';
import { loadStatusProfile } from './tactical-status.js';
import { loadCleanseAbilities } from './tactical-cleansing.js';
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

export type TacticalCommand=Omit<TechniqueIntent,'draws'>|{actorId:string;kind:'USE_HEALING_ABILITY';targetId:string;abilityId:string}|{actorId:string;kind:'USE_ABILITY';targetId:string;abilityId:string}|{actorId:string;kind:'CLEANSE';targetId:string;abilityId:string;effectId:string}|{actorId:string;kind:'END'|'GUARD'|'RETREAT'|'DROP_CONCENTRATION'|'SURRENDER'}|{actorId:string;kind:'MOVE';zone:string}|{actorId:string;kind:'ATTACK'|'HEAL';targetId:string};
export type TacticalCheckpoint={engine:'TACTICAL_TRANSITION_V1';rules:TacticalRules;state:TacticalState;controlledIds:string[];serverControlledIds?:string[]};
const json=(value:unknown)=>value as Record<string,Json>;
/** Internal only: the authored encounter loader must authorize discovery, party
 * composition and tuning. Never accept rules, allies or enemies from a request. */
export async function beginTacticalEncounter(c:ActionContext,definitionId:string,rules:TacticalRules,
  player:{id:string;zone:string;health?:number;mana?:number;loadKit?:boolean},otherUnits:TacticalUnit[],controlledIds:string[],authoredLoot=false,serverControlledIds:string[]=[]) {
  if(!controlledIds.includes(player.id)||new Set(controlledIds).size!==controlledIds.length)throw new DomainError(409,'INVALID_TACTICAL_CONTROL');
  const started=await (authoredLoot?beginAuthoredEncounter:beginEncounter)(c,definitionId,{});
  const state=startTactical(rules,[await loadTacticalPlayer(c,started.instanceId,rules,player),...otherUnits]);
  if(controlledIds.some(id=>!state.units.some(u=>u.id===id&&u.side==='PARTY')))throw new DomainError(409,'INVALID_TACTICAL_CONTROL');
  const checkpoint:TacticalCheckpoint={engine:'TACTICAL_TRANSITION_V1',rules:structuredClone(rules),state,controlledIds:[...controlledIds],...(rules.partyOwnership?{serverControlledIds:[...serverControlledIds]}:{})};
  // Encounter revision includes initialization; engine revision counts intents.
  const saved=await saveEncounterCheckpoint(c,started.instanceId,0,json(checkpoint));
  return {...saved,state:structuredClone(state)};
}
export async function loadTacticalPlayer(c:ActionContext,instanceId:string,rules:TacticalRules,player:{id:string;zone:string;health?:number;mana?:number;loadKit?:boolean},previousInstanceId?:string|null):Promise<TacticalUnit>{
 const carryEffects=(previousInstanceId===undefined?await loadCarryEffects(c.client,c.run.id):await readCarryEffects(c.client,previousInstanceId)).map(e=>({...e,sourceUnitId:e.sourceUnitId==='hero'?player.id:e.sourceUnitId}));if(carryEffects.length&&rules.roundEffects?.version!==4)throw new DomainError(409,'TACTICAL_PERSISTENT_EFFECTS_DISABLED');
  const snapshot=await readCharacterSnapshot(c.client,instanceId,c.run.id);
  const stats=snapshot.derived.stats;
  let canHeal=false,canGuard=false;
  if(player.loadKit)for(const source of snapshot.inputs.sources){
    const row=(await c.client.query("SELECT definition->'mechanics'->'tacticalKit' AS kit FROM content_versions WHERE entity_id=$1 AND revision=$2",[source.entityId,source.revision])).rows[0];
    const kit=row?.kit as TacticalKit|undefined;
    if(kit&&source.nativeLevel>=kit.minimumNativeLevel){canHeal ||=kit.heal;canGuard ||=kit.guard;}
  }
 return {id:player.id,zone:player.zone,side:'PARTY',stats,health:Math.min(player.health??stats.maxHealth,stats.maxHealth),mana:Math.min(player.mana??stats.maxMana,stats.maxMana),canHeal:player.loadKit?canHeal:true,canGuard,strikes:0,state:'ACTIVE',...(rules.roundEffects?.version===4?{carryEffects}:{}),...(rules.techniques?{techniques:await loadTechniqueProfile(c.client,c.run.content_release_id!,snapshot.inputs.sources),checkAttributes:snapshot.inputs.attributes,checkSkills:await loadTechniqueSkills(c.client,c.run.id,(await c.client.query('SELECT created_at FROM instances WHERE id=$1',[instanceId])).rows[0].created_at)}:{}),...(rules.roundEffects?{onHitEffects:await loadEffectGrants(c.client,c.run.content_release_id,snapshot.inputs.sources)}:{}),...((rules.roundEffects?.version??0)>=2?{onHealEffects:await loadEffectGrants(c.client,c.run.content_release_id,snapshot.inputs.sources,'HEAL')}:{}),...((rules.roundEffects?.version??0)>=3?{cleansingAbilities:await loadCleanseAbilities(c.client,snapshot.inputs.sources)}:{}),...(rules.healingAbilities?{healingAbilities:await loadHealingAbilities(c.client,snapshot.inputs.sources)}:{}),...(rules.abilities?{attackAbilities:await loadAttackAbilities(c.client,rules.typedDamage!,snapshot.inputs.sources)}:{}),...(rules.statusDefense?{statusProfile:await loadStatusProfile(c.client,rules.statusDefense,snapshot.inputs.sources)}:{}),...(rules.typedDamage?{damageProfile:await loadDamageProfile(c.client,rules.typedDamage,snapshot.inputs.sources)}:{})};
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
  if(!actor || (serverControlled?actor.side!=='ENEMY'&&!checkpoint.serverControlledIds?.includes(actor.id):!checkpoint.controlledIds.includes(actor.id)))throw new DomainError(403,'TACTICAL_ACTOR_NOT_CONTROLLED');
  const intent=await resolveTacticalIntent(checkpoint,command,(key,bound)=>drawEncounter(c,instanceId,'tactical',key,bound));
  const result=stepTactical(checkpoint.rules,checkpoint.state,expectedTacticalRevision,intent);
  const saved=await saveEncounterCheckpoint(c,instanceId,expectedEncounterRevision,json({...checkpoint,state:result.state}));
  if((await c.client.query('SELECT 1 FROM tactical_encounter_origins WHERE instance_id=$1',[instanceId])).rows.length)
    await c.client.query('INSERT INTO tactical_steps(instance_id,revision,action_id,control,intent,evidence,state) VALUES($1,$2,$3,$4,$5,$6,$7)',[instanceId,result.state.revision,c.actionId,serverControlled?'SERVER':'PLAYER',result.evidence.intent,result.evidence,result.state]);
  // Terminal checkpoints remain open until an authored settlement handler resolves
  // loot, failure costs and recovery atomically. No implicit empty settlement.
  return {...saved,...result};
}
export async function resolveTacticalIntent(checkpoint:TacticalCheckpoint,command:TacticalCommand,draw:(key:string,bound:number)=>Promise<number>):Promise<TacticalIntent>{
 const actor=checkpoint.state.units.find(u=>u.id===command.actorId);if(!actor)throw new DomainError(403,'TACTICAL_ACTOR_NOT_CONTROLLED');
  let intent:TacticalIntent;
  if(command.kind==='MOVE'&&checkpoint.rules.techniques){const opportunities:TechniqueIntent[]=[];for(const [index,{actor:threat,ability:a}] of opportunityAbilities(checkpoint.rules,checkpoint.state,actor,command.zone).entries()){const prefix=`action.${checkpoint.state.revision}.opportunity.${index}`;if(a.effect.kind!=='DAMAGE')throw new DomainError(409,'INVALID_TACTICAL_OPPORTUNITY');opportunities.push({kind:'TECHNIQUE',actorId:threat.id,targetId:actor.id,abilityId:a.id,draws:[{targetId:actor.id,roll:1+await draw(`${prefix}.check`,20),amount:a.effect.min+await draw(`${prefix}.amount`,a.effect.max-a.effect.min+1)}]});}intent={...command,opportunities};
  }else if(command.kind==='TECHNIQUE'){
    const a=actor.techniques?.abilities.find(a=>a.id===command.abilityId);if(!checkpoint.rules.techniques||!a)throw new DomainError(409,'ILLEGAL_TACTICAL_TECHNIQUE');
    const draws=[];for(const [index,target] of techniqueTargets(checkpoint.rules,checkpoint.state,actor,a,command.targetId).entries()){const prefix=`action.${checkpoint.state.revision}.technique.${index}`;draws.push({targetId:target.id,...(a.check?{roll:1+await draw(`${prefix}.check`,20)}:{}),...('min' in a.effect?{amount:a.effect.min+await draw(`${prefix}.amount`,a.effect.max-a.effect.min+1)}:{})});}intent={...command,draws};
  }else if(command.kind==='ATTACK'||command.kind==='USE_ABILITY') {
    const ability=command.kind==='USE_ABILITY'?actor.attackAbilities?.find(a=>a.id===command.abilityId):undefined;
    if(command.kind==='USE_ABILITY'&&(!checkpoint.rules.abilities||!ability))throw new DomainError(409,'ILLEGAL_TACTICAL_ABILITY');
    const min=ability?.spec.damage.min??actor.stats.attackMin,max=ability?.spec.damage.max??actor.stats.attackMax;
    const prefix=`action.${checkpoint.state.revision}`;
    const roll=1+await draw(`${prefix}.hit`,20);
    const rawDamage=min+await draw(`${prefix}.damage`,max-min+1);
    intent={...command,roll,rawDamage};
  }else if(command.kind==='USE_HEALING_ABILITY'){
    const ability=actor.healingAbilities?.find(a=>a.id===command.abilityId);if(!checkpoint.rules.healingAbilities||!ability)throw new DomainError(409,'ILLEGAL_TACTICAL_HEALING_ABILITY');
    intent={...command,amount:ability.spec.min+await draw(`action.${checkpoint.state.revision}.healing`,ability.spec.max-ability.spec.min+1)};
  }else if(command.kind==='RETREAT') {
    intent={actorId:command.actorId,kind:'RETREAT',roll:1+await draw(`action.${checkpoint.state.revision}.retreat`,20)};
  }else intent=command as TacticalIntent;
 return intent;
}
