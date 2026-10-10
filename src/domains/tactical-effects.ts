import { immuneStatus,type StatusProfile,type StatusEvent } from './tactical-status.js';
import type { RemovalSpec } from './tactical-cleansing.js';
import { Ajv } from 'ajv';
import type pg from 'pg';
import { DomainError } from '../foundation/errors.js';
import { resistanceFor,type DamageProfile } from './tactical-damage.js';
import type { ContentEntity } from './content.js';
import type { MechanicsSource,CharacterStats } from './character-mechanics.js';

/** Pinned encounter-local effects. Version 1 numeric history stays frozen. */
export type PeriodicEffect={kind:'DAMAGE';timing:'OWNER_END';amount:number;damageType:string;armor:'APPLY'|'BYPASS';penetration:number}|{kind:'HEAL';timing:'OWNER_START';amount:number};
type RoundEffectBase={clock:'ROUNDS'|'ENCOUNTERS'|'ADVENTURE_TURNS'|'UNTIL_CLEANSED'|'RUN';tick:'OWNER_END'|'ENCOUNTER_END'|'TURN_SPEND'|'NONE';family:string;stacking:'REPLACE'|'REFRESH';rounds:number;polarity:'BENEFICIAL'|'HARMFUL'|'MIXED'|'NEUTRAL';tags:string[];modifiers:{stat:'accuracy'|'evasion'|'armor';amount:number}[]};
export type ControlKind='ROOT'|'DISARM'|'SILENCE'|'REACTION_LOCK'|'STUN'|'DAZED';
export type RoundEffect=RoundEffectBase&({version:1;periodic?:never;removal?:never}|{version:2;periodic:PeriodicEffect;removal?:never}|{version:3;periodic?:PeriodicEffect;removal:RemovalSpec}|{version:4;periodic?:PeriodicEffect;removal:RemovalSpec;control?:ControlKind;buildup?:{amount:number;threshold:number;decay:number;repeatedThresholdStep:number}});
export type OnHitEffects={version:1;minimumNativeLevel:number;effectIds:string[]};
export type EffectGrant={effectId:string;effectRevision:number;sourceId:string;sourceRevision:number;sourceInstanceId?:string;effect:RoundEffect};
export type ActiveRoundEffect=EffectGrant&{concentrationId?:string;sourceUnitId:string;appliedRevision:number;refreshedRevision?:number;remaining:number};
export type BuildupState={value:number;breaks:number;decay:number;threshold:number};
export type EffectEvent={buildup?:number;threshold?:number;controlBefore?:ControlKind;controlAfter?:ControlKind;kind:'CONVERTED'|'BUILT_UP'|'APPLIED'|'REPLACED'|'REFRESHED'|'TICKED'|'EXPIRED';ownerId:string;effectId:string;sourceUnitId:string;sourceId:string;sourceRevision:number;effectRevision:number;remaining:number};
const id={type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'},tag={type:'string',pattern:'^[a-z][a-z0-9_.-]{0,63}$'};
const ajv=new Ajv({strict:true});
const effectValidator=ajv.compile({type:'object',additionalProperties:false,required:['version','clock','tick','family','stacking','rounds','polarity','tags','modifiers'],properties:{version:{enum:[1,2,3,4]},buildup:{type:'object',additionalProperties:false,required:['amount','threshold','decay','repeatedThresholdStep'],properties:{amount:{type:'integer',minimum:1,maximum:1000},threshold:{type:'integer',minimum:1,maximum:1000},decay:{type:'integer',minimum:0,maximum:1000},repeatedThresholdStep:{type:'integer',minimum:0,maximum:1000}}},control:{enum:['ROOT','DISARM','SILENCE','REACTION_LOCK','STUN','DAZED']},clock:{enum:['ROUNDS','ENCOUNTERS','ADVENTURE_TURNS','UNTIL_CLEANSED','RUN']},tick:{enum:['OWNER_END','ENCOUNTER_END','TURN_SPEND','NONE']},family:tag,stacking:{enum:['REPLACE','REFRESH']},rounds:{type:'integer',minimum:1,maximum:100},polarity:{enum:['BENEFICIAL','HARMFUL','MIXED','NEUTRAL']},tags:{type:'array',minItems:1,maxItems:16,uniqueItems:true,items:tag},removal:{type:'object',additionalProperties:false,required:['method','difficulty'],properties:{method:{enum:['CLEANSE','DISPEL','CURE','REMOVE_CURSE','NONE']},difficulty:{type:'integer',minimum:0,maximum:1000}}},modifiers:{type:'array',maxItems:3,items:{type:'object',additionalProperties:false,required:['stat','amount'],properties:{stat:{enum:['accuracy','evasion','armor']},amount:{type:'integer',minimum:-1000,maximum:1000}}}},periodic:{oneOf:[{type:'object',additionalProperties:false,required:['kind','timing','amount','damageType','armor','penetration'],properties:{kind:{const:'DAMAGE'},timing:{const:'OWNER_END'},amount:{type:'integer',minimum:1,maximum:1000000},damageType:tag,armor:{enum:['APPLY','BYPASS']},penetration:{type:'integer',minimum:0,maximum:1000000}}},{type:'object',additionalProperties:false,required:['kind','timing','amount'],properties:{kind:{const:'HEAL'},timing:{const:'OWNER_START'},amount:{type:'integer',minimum:1,maximum:1000000}}}]}}});
const grantsValidator=ajv.compile({type:'object',additionalProperties:false,required:['version','minimumNativeLevel','effectIds'],properties:{version:{const:1},minimumNativeLevel:{type:'integer',minimum:0,maximum:999},effectIds:{type:'array',minItems:1,maxItems:8,uniqueItems:true,items:id}}});
export function validateRoundEffect(value:unknown):asserts value is RoundEffect {
 if(!effectValidator(value)||((value as RoundEffect).version===1?((value as RoundEffect).periodic!==undefined||(value as RoundEffect).modifiers.length===0):(value as RoundEffect).version===2?!(value as RoundEffect).periodic:(!(value as RoundEffect).removal||(!(value as RoundEffect).periodic&&(value as RoundEffect).modifiers.length===0&&!(value as {control?:ControlKind}).control)))||((value as RoundEffect).version<3&&(value as RoundEffect).removal!==undefined)||new Set((value as RoundEffect).modifiers.map(m=>m.stat)).size!==(value as RoundEffect).modifiers.length||(value as RoundEffect).modifiers.some(m=>m.amount===0))throw new DomainError(400,'INVALID_TACTICAL_ROUND_EFFECT');
 const e=value as RoundEffect;const expectedTick={ROUNDS:'OWNER_END',ENCOUNTERS:'ENCOUNTER_END',ADVENTURE_TURNS:'TURN_SPEND',UNTIL_CLEANSED:'NONE',RUN:'NONE'}[e.clock];if(e.tick!==expectedTick||(e.version<4&&e.clock!=='ROUNDS')||(e.version===4&&e.clock!=='ROUNDS'&&(e.buildup||e.control==='STUN'||e.control==='DAZED')))throw new DomainError(400,'INVALID_TACTICAL_EFFECT_CLOCK');if((e.version!==4&&((value as {control?:ControlKind}).control!==undefined||(value as {buildup?:unknown}).buildup!==undefined))||(e.version===4&&e.buildup&&!e.control)||(e.version===4&&e.control&&(e.polarity!=='HARMFUL'||(['STUN','DAZED'].includes(e.control)&&e.rounds>2))))throw new DomainError(400,'INVALID_TACTICAL_CONTROL_EFFECT');
 const removal=(value as RoundEffect).removal;if((e.version<4&&removal?.method==='REMOVE_CURSE')||(removal&&(removal.method==='NONE'?removal.difficulty!==0:removal.difficulty===0)))throw new DomainError(400,'INVALID_TACTICAL_REMOVAL');
 const p=(value as RoundEffect).periodic;if(p?.kind==='DAMAGE'&&p.armor==='BYPASS'&&p.penetration!==0)throw new DomainError(400,'INVALID_TACTICAL_PERIODIC_DAMAGE');
}
export function validateOnHitEffects(value:unknown):asserts value is OnHitEffects {
 if(!grantsValidator(value))throw new DomainError(400,'INVALID_TACTICAL_ON_HIT_EFFECTS');
}
export function validateEffectFamilies(entities:Map<string,ContentEntity>) {
 const policies=new Map<string,string>(),families=new Map<string,string>();
 for(const e of entities.values()){
  const value=e.definition.mechanics?.tacticalRoundEffect;if(value===undefined)continue;
  validateRoundEffect(value);
  const prior=policies.get(value.family);
  if(prior&&prior!==value.stacking)throw new DomainError(400,'CONFLICTING_TACTICAL_EFFECT_STACKING');
  policies.set(value.family,value.stacking);
  const kind=value.periodic?.kind??'NUMERIC',previous=families.get(value.family);
  if(previous&&previous!==kind)throw new DomainError(400,'CONFLICTING_TACTICAL_EFFECT_FAMILY');families.set(value.family,kind);
 }
}
export function validateEffectContent(entity:ContentEntity,entities:Map<string,ContentEntity>) {
 const m=entity.definition.mechanics;
 if(m?.tacticalRoundEffect!==undefined){
  if(entity.kind!=='EFFECT')throw new DomainError(400,'INVALID_TACTICAL_EFFECT_KIND');
  validateRoundEffect(m.tacticalRoundEffect);

 }
 for(const field of ['tacticalOnHitEffects','tacticalOnHealEffects'] as const){
 if(m?.[field]===undefined)continue;
 validateOnHitEffects(m[field]);const grant=m[field];
 const native=entity.kind==='CLASS'&&m.classProgression!==undefined;
 const template=['NPC','MONSTER'].includes(entity.kind)&&m.tacticalUnit!==undefined;
 const selected=(entity.kind==='ABILITY'&&(m.feat!==undefined||m.subclass!==undefined))||(entity.kind==='ITEM'&&m.equipment!==undefined);
 if(!(template||((native||selected)&&m.combatModifiers!==undefined))||(!native&&grant.minimumNativeLevel!==0)||(native&&(grant.minimumNativeLevel<1||grant.minimumNativeLevel>(m.classProgression as {maximumNativeLevel:number}).maximumNativeLevel)))throw new DomainError(400,'INVALID_TACTICAL_EFFECT_SOURCE');
 const families=new Set<string>();
 for(const effectId of grant.effectIds){
  const e=entities.get(effectId);
  if(!e||e.kind!=='EFFECT'||!entity.definition.dependencies.includes(effectId))throw new DomainError(400,'INVALID_TACTICAL_EFFECT_REFERENCE');
  validateRoundEffect(e.definition.mechanics?.tacticalRoundEffect);
  const effect=e.definition.mechanics!.tacticalRoundEffect;
  if(effect.periodic&&(field==='tacticalOnHitEffects'?effect.periodic.kind!=='DAMAGE':effect.periodic.kind!=='HEAL'))throw new DomainError(400,'INVALID_TACTICAL_PERIODIC_TRIGGER');
  const family=effect.family;
  if(families.has(family))throw new DomainError(400,'CONFLICTING_TACTICAL_EFFECT_GRANTS');families.add(family);
 }
 }
}
/** Uses the encounter's release and immutable selected source revisions. */
export async function loadEffectGrants(client:pg.PoolClient,releaseId:string|null,sources:Pick<MechanicsSource,'entityId'|'revision'|'nativeLevel'|'instanceId'>[],trigger:'HIT'|'HEAL'='HIT'):Promise<EffectGrant[]> {
 const grants:EffectGrant[]=[];
 for(const source of sources){
  const value=(await client.query("SELECT definition->'mechanics'->$3::text AS spec FROM content_versions WHERE entity_id=$1 AND revision=$2",[source.entityId,source.revision,trigger==='HIT'?'tacticalOnHitEffects':'tacticalOnHealEffects'])).rows[0]?.spec;
  if(!value)continue;validateOnHitEffects(value);if(source.nativeLevel<value.minimumNativeLevel)continue;
  for(const effectId of value.effectIds){
   const row=(await client.query("SELECT e.revision,v.definition->'mechanics'->'tacticalRoundEffect' AS effect FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=$1 AND e.entity_id=$2",[releaseId,effectId])).rows[0];
   validateRoundEffect(row?.effect);
   grants.push({effectId,effectRevision:row!.revision as number,sourceId:source.entityId,sourceRevision:source.revision,...(source.instanceId?{sourceInstanceId:source.instanceId}:{}),effect:row!.effect as RoundEffect});
  }
 }
 return normalizeEffectGrants(grants);
}
export function normalizeEffectGrants(grants:EffectGrant[]) {
 if(grants.length>32)throw new DomainError(409,'TOO_MANY_TACTICAL_EFFECT_GRANTS');
 const families=new Set<string>();
 for(const g of grants){
  validateRoundEffect(g.effect);
  if(!/^[a-z][a-z0-9_.-]{2,119}$/.test(g.effectId)||!/^[a-z][a-z0-9_.-]{2,119}$/.test(g.sourceId)||!Number.isInteger(g.effectRevision)||g.effectRevision<1||!Number.isInteger(g.sourceRevision)||g.sourceRevision<1)throw new DomainError(409,'INVALID_TACTICAL_EFFECT_GRANT');
  // Reject ambiguous owned contributions instead of choosing by source iteration.
  if(families.has(g.effect.family))throw new DomainError(409,'CONFLICTING_TACTICAL_EFFECT_GRANTS');families.add(g.effect.family);
 }
 return structuredClone(grants).sort((a,b)=>a.effect.family<b.effect.family?-1:1);
}
function event(kind:EffectEvent['kind'],ownerId:string,e:ActiveRoundEffect):EffectEvent {
 return {kind,ownerId,effectId:e.effectId,sourceUnitId:e.sourceUnitId,sourceId:e.sourceId,sourceRevision:e.sourceRevision,effectRevision:e.effectRevision,remaining:e.remaining};
}
function applyEffects(owner:{id:string;effects?:ActiveRoundEffect[];statusProfile?:StatusProfile;buildups?:Record<string,BuildupState>},sourceId:string,grants:EffectGrant[],revision:number,statusEvents?:StatusEvent[]) {
 const events:EffectEvent[]=[];
 for(const original of grants){
  const matchedTags=statusEvents?immuneStatus(owner.statusProfile,original):[];
  if(matchedTags.length){statusEvents!.push({kind:'IMMUNE',ownerId:owner.id,sourceUnitId:sourceId,matchedTags,blocked:structuredClone(original)});continue;}
  const grant=structuredClone(original);const reduction=['HARMFUL','MIXED'].includes(grant.effect.polarity)&&owner.statusProfile?.version===2?Math.max(0,...grant.effect.tags.map(t=>owner.statusProfile?.version===2?Object.hasOwn(owner.statusProfile.durationReductionBps,t)?owner.statusProfile.durationReductionBps[t]!:0:0)):0;
  if(reduction&&!(grant.effect.version===4&&grant.effect.buildup)){const before=grant.effect.rounds;grant.effect.rounds=Math.max(1,Math.floor(before*(10000-reduction)/10000));if(statusEvents)statusEvents.push({kind:'RESISTED',ownerId:owner.id,sourceUnitId:sourceId,matchedTags:grant.effect.tags.filter(t=>owner.statusProfile?.version===2&&(Object.hasOwn(owner.statusProfile.durationReductionBps,t)?owner.statusProfile.durationReductionBps[t]!:0)>0),roundsBefore:before,roundsAfter:grant.effect.rounds,blocked:structuredClone(original)});}
  if(grant.effect.version===4&&grant.effect.buildup){const b=grant.effect.buildup;owner.buildups??={};const state=(Object.hasOwn(owner.buildups,grant.effect.family)?owner.buildups[grant.effect.family]:undefined)??{value:0,breaks:0,decay:b.decay,threshold:b.threshold};owner.buildups[grant.effect.family]=state;state.value=Math.min(1000000,state.value+Math.max(1,Math.floor(b.amount*(10000-reduction)/10000)));state.threshold=Math.min(1000000,b.threshold+state.breaks*b.repeatedThresholdStep);state.decay=b.decay;events.push({kind:'BUILT_UP',ownerId:owner.id,effectId:grant.effectId,sourceUnitId:sourceId,sourceId:grant.sourceId,sourceRevision:grant.sourceRevision,effectRevision:grant.effectRevision,remaining:0,buildup:state.value,threshold:state.threshold});if(state.value<state.threshold)continue;state.value=0;state.breaks++;}
  let converted=false;if(grant.effect.version===4&&grant.effect.control==='STUN'){owner.buildups??={};const family=grant.effect.family;const b=(Object.hasOwn(owner.buildups,family)?owner.buildups[family]:undefined)??{value:0,breaks:0,decay:0,threshold:1};owner.buildups[family]=b;const previous=grant.effect.buildup?b.breaks-1:b.breaks;if(!grant.effect.buildup)b.breaks++;if(previous>0){converted=true;grant.effect.control='DAZED';events.push({kind:'CONVERTED',ownerId:owner.id,effectId:grant.effectId,sourceUnitId:sourceId,sourceId:grant.sourceId,sourceRevision:grant.sourceRevision,effectRevision:grant.effectRevision,remaining:grant.effect.rounds,controlBefore:'STUN',controlAfter:'DAZED'});}}
  const effects=owner.effects!,old=effects.find(e=>e.effect.family===grant.effect.family);
  if(old&&old.effect.stacking!==grant.effect.stacking)throw new DomainError(409,'CONFLICTING_TACTICAL_EFFECT_STACKING');
  if(old&&grant.effect.stacking==='REFRESH'&&!converted){
   old.remaining=Math.max(old.remaining,grant.effect.rounds);old.refreshedRevision=revision;
   events.push(event('REFRESHED',owner.id,old));
  }else{
   const next:ActiveRoundEffect={...structuredClone(grant),sourceUnitId:sourceId,appliedRevision:revision,remaining:grant.effect.rounds};
   if(old)effects.splice(effects.indexOf(old),1,next);else {if(effects.length>=32)throw new DomainError(409,'TOO_MANY_TACTICAL_EFFECTS');effects.push(next);}
   effects.sort((a,b)=>a.effect.family<b.effect.family?-1:1);
   events.push(event(old?'REPLACED':'APPLIED',owner.id,next));
  }
 }
 return events;
}
export function applyOnHitEffects(owner:{id:string;effects?:ActiveRoundEffect[];statusProfile?:StatusProfile;buildups?:Record<string,BuildupState>},source:{id:string;onHitEffects?:EffectGrant[]},revision:number,statusEvents?:StatusEvent[]) {return applyEffects(owner,source.id,source.onHitEffects??[],revision,statusEvents);}
export function applyOnHealEffects(owner:{id:string;effects?:ActiveRoundEffect[];statusProfile?:StatusProfile;buildups?:Record<string,BuildupState>},source:{id:string;onHealEffects?:EffectGrant[]},revision:number,statusEvents?:StatusEvent[]) {return applyEffects(owner,source.id,source.onHealEffects??[],revision,statusEvents);}
export function validatePeriodicGrants(grants:EffectGrant[],version:1|2|3|4,types:string[]|undefined) {
 for(const g of grants){
  if(g.effect.version>=3&&version<g.effect.version)throw new DomainError(409,'TACTICAL_CLEANSING_EFFECTS_DISABLED');
  if(!g.effect.periodic)continue;
  if(version===1)throw new DomainError(409,'TACTICAL_PERIODIC_EFFECTS_DISABLED');
  const p=g.effect.periodic;
  if(p.kind==='DAMAGE'&&(!types?.includes(p.damageType)||(p.armor==='BYPASS'&&p.penetration!==0)))throw new DomainError(400,'INVALID_TACTICAL_PERIODIC_DAMAGE');
 }
}
export type PeriodicEvent={kind:'DAMAGE'|'HEAL';timing:'OWNER_START'|'OWNER_END';ownerId:string;effectId:string;effectRevision:number;sourceId:string;sourceRevision:number;sourceUnitId:string;appliedRevision:number;healthBefore:number;healthAfter:number;amount:number;damageType?:string;effectiveArmor?:number;resistanceBps?:number;afterArmor?:number};
/** Application strength is pinned; current target mitigation is evaluated per pulse.
 * No attack/critical roll, defensive reaction, implicit minimum damage or revival. */
export function pulseRoundEffects(owner:{id:string;side:'PARTY'|'ENEMY';stats:CharacterStats;health:number;state:'ACTIVE'|'DOWNED'|'DEFEATED';guardReady?:boolean;damageProfile?:DamageProfile;effects?:ActiveRoundEffect[]},timing:'OWNER_START'|'OWNER_END') {
 const events:PeriodicEvent[]=[];
 for(const effect of owner.effects??[]){
  if(owner.state!=='ACTIVE')break;
  const p=effect.effect.periodic;if(!p||p.timing!==timing)continue;
  const healthBefore=owner.health;
  let amount=p.amount,mitigation:Pick<PeriodicEvent,'damageType'|'effectiveArmor'|'resistanceBps'|'afterArmor'>={};
  if(p.kind==='DAMAGE'){
   const effectiveArmor=p.armor==='APPLY'?Math.max(0,effectStats(owner).armor-p.penetration):0;
   const resistanceBps=resistanceFor(owner.damageProfile,p.damageType,owner.effects?.flatMap(e=>e.effect.tags)??[]),afterArmor=Math.max(0,p.amount-effectiveArmor);
   amount=Math.floor(afterArmor*(10000-resistanceBps)/10000);
   owner.health=Math.max(0,owner.health-amount);if(owner.health===0){owner.state=owner.side==='ENEMY'?'DEFEATED':'DOWNED';owner.guardReady=false;}
   mitigation={damageType:p.damageType,effectiveArmor,resistanceBps,afterArmor};
  }else owner.health=Math.min(owner.stats.maxHealth,owner.health+amount);
  events.push({kind:p.kind,timing,ownerId:owner.id,effectId:effect.effectId,effectRevision:effect.effectRevision,sourceId:effect.sourceId,sourceRevision:effect.sourceRevision,sourceUnitId:effect.sourceUnitId,appliedRevision:effect.appliedRevision,healthBefore,healthAfter:owner.health,amount,...mitigation});
 }
 return events;
}
export function decayBuildups(owner:{id:string;buildups?:Record<string,BuildupState>}){return Object.entries(owner.buildups??{}).map(([family,b])=>{const before=b.value;b.value=Math.max(0,b.value-b.decay);return {ownerId:owner.id,family,before,after:b.value,breaks:b.breaks};});}
export function tickRoundEffects(owner:{id:string;effects?:ActiveRoundEffect[]}) {
 const events:EffectEvent[]=[];
 for(const e of owner.effects??[]){if(e.effect.clock!=='ROUNDS')continue;e.remaining--;events.push(event(e.remaining===0?'EXPIRED':'TICKED',owner.id,e));}
 if(owner.effects)owner.effects=owner.effects.filter(e=>e.remaining>0);
 return events;
}
/** Saturate supported effective stats, preserving the immutable base stats. */
export function effectStats(unit:{stats:CharacterStats;effects?:ActiveRoundEffect[]}) {
 const stats={...unit.stats};
 for(const e of unit.effects??[])for(const m of e.effect.modifiers)stats[m.stat]+=m.amount;
 stats.accuracy=Math.max(-1000000,Math.min(1000000,stats.accuracy));
 stats.evasion=Math.max(-1000000,Math.min(1000000,stats.evasion));
 stats.armor=Math.max(0,Math.min(1000000,stats.armor));return stats;
}
