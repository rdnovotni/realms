import { Ajv } from 'ajv';
import type pg from 'pg';
import { checksum,type Json } from '../foundation/json.js';
import { DomainError } from '../foundation/errors.js';
import type { ContentEntity } from './content.js';
import type { MechanicsSource } from './character-mechanics.js';
import type { ActiveRoundEffect } from './tactical-effects.js';
export type RemovalMethod='CLEANSE'|'DISPEL'|'CURE';
export type RemovalSpec={method:RemovalMethod|'NONE';difficulty:number};
export type CleanseSpec={version:1;minimumNativeLevel:number;method:RemovalMethod;tags:string[];strength:number;manaCost:number;range:number;targetSide:'ALLY'|'ENEMY'};
export type CleanseAbility={id:string;sourceRevision:number;sourceInstanceIds:string[];spec:CleanseSpec};
export type CleansingEvent={ownerId:string;actorId:string;abilityId:string;abilityRevision:number;abilityInstanceIds:string[];method:RemovalMethod;strength:number;difficulty:number;manaCost:number;removed:ActiveRoundEffect};
const tag={type:'string',pattern:'^[a-z][a-z0-9_.-]{0,63}$'};
const validate=new Ajv({strict:true}).compile({type:'object',additionalProperties:false,required:['version','minimumNativeLevel','method','tags','strength','manaCost','range','targetSide'],properties:{version:{const:1},minimumNativeLevel:{type:'integer',minimum:0,maximum:999},method:{enum:['CLEANSE','DISPEL','CURE']},tags:{type:'array',minItems:1,maxItems:16,uniqueItems:true,items:tag},strength:{type:'integer',minimum:1,maximum:1000},manaCost:{type:'integer',minimum:1,maximum:1000000},range:{type:'integer',minimum:0,maximum:31},targetSide:{enum:['ALLY','ENEMY']}}});
export function validateCleanseSpec(value:unknown):asserts value is CleanseSpec {
 if(!validate(value)||((value as CleanseSpec).method!=='DISPEL'&&(value as CleanseSpec).targetSide!=='ALLY'))throw new DomainError(400,'INVALID_TACTICAL_CLEANSING');
}
export function validateCleansingContent(entity:ContentEntity) {
 const m=entity.definition.mechanics;if(m?.tacticalCleansing===undefined)return;validateCleanseSpec(m.tacticalCleansing);const s=m.tacticalCleansing;
 const native=entity.kind==='CLASS'&&m.classProgression!==undefined,template=['NPC','MONSTER'].includes(entity.kind)&&m.tacticalUnit!==undefined;
 const selected=(entity.kind==='ABILITY'&&(m.feat!==undefined||m.subclass!==undefined))||(entity.kind==='ITEM'&&m.equipment!==undefined);
 if(!(template||((native||selected)&&m.combatModifiers!==undefined))||(!native&&s.minimumNativeLevel!==0)||(native&&(s.minimumNativeLevel<1||s.minimumNativeLevel>(m.classProgression as {maximumNativeLevel:number}).maximumNativeLevel)))throw new DomainError(400,'INVALID_TACTICAL_CLEANSING_SOURCE');
}
/** Duplicate equipped copies grant one identical ability, retaining every source
 * instance identity; they cannot silently add strength or lower resource costs. */
export function normalizeCleanseAbilities(input:CleanseAbility[]) {
 const map=new Map<string,CleanseAbility>();
 for(const value of input){validateCleanseSpec(value.spec);
  if(!/^[a-z][a-z0-9_.-]{2,119}$/.test(value.id)||!Number.isInteger(value.sourceRevision)||value.sourceRevision<1||!Array.isArray(value.sourceInstanceIds)||value.sourceInstanceIds.some(id=>!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)))throw new DomainError(409,'INVALID_TACTICAL_CLEANSING_ABILITY');
  const prior=map.get(value.id);
  if(prior){if(prior.sourceRevision!==value.sourceRevision||checksum(prior.spec as unknown as Json)!==checksum(value.spec as unknown as Json))throw new DomainError(409,'CONFLICTING_TACTICAL_CLEANSING_ABILITY');prior.sourceInstanceIds=[...new Set([...prior.sourceInstanceIds,...value.sourceInstanceIds])].sort();}
  else map.set(value.id,{...structuredClone(value),sourceInstanceIds:[...new Set(value.sourceInstanceIds)].sort()});
 }
 if(map.size>32)throw new DomainError(409,'TOO_MANY_TACTICAL_CLEANSING_ABILITIES');return [...map.values()].sort((a,b)=>a.id<b.id?-1:1);
}
export async function loadCleanseAbilities(client:pg.PoolClient,sources:Pick<MechanicsSource,'entityId'|'revision'|'nativeLevel'|'instanceId'>[]) {
 const abilities:CleanseAbility[]=[];
 for(const source of sources){const value=(await client.query("SELECT definition->'mechanics'->'tacticalCleansing' AS spec FROM content_versions WHERE entity_id=$1 AND revision=$2",[source.entityId,source.revision])).rows[0]?.spec;if(!value)continue;validateCleanseSpec(value);if(source.nativeLevel<value.minimumNativeLevel)continue;abilities.push({id:source.entityId,sourceRevision:source.revision,sourceInstanceIds:source.instanceId?[source.instanceId]:[],spec:value});}
 return normalizeCleanseAbilities(abilities);
}
export function cleansingEligible(ability:CleanseAbility,effect:ActiveRoundEffect) {
 const removal=effect.effect.version===3?effect.effect.removal:undefined;
 return Boolean(removal&&removal.method===ability.spec.method&&removal.difficulty<=ability.spec.strength&&ability.spec.tags.some(t=>effect.effect.tags.includes(t))&&(ability.spec.method==='DISPEL'||['HARMFUL','MIXED'].includes(effect.effect.polarity)));
}
export function removeRoundEffect(actor:{id:string;mana?:number;cleansingAbilities?:CleanseAbility[]},target:{id:string;effects?:ActiveRoundEffect[]},abilityId:string,effectId:string):CleansingEvent {
 const ability=actor.cleansingAbilities?.find(a=>a.id===abilityId),effect=target.effects?.find(e=>e.effectId===effectId);
 if(!ability||!effect||!cleansingEligible(ability,effect)||(actor.mana??0)<ability.spec.manaCost)throw new DomainError(409,'ILLEGAL_TACTICAL_CLEANSING');
 actor.mana=(actor.mana??0)-ability.spec.manaCost;target.effects!.splice(target.effects!.indexOf(effect),1);
 return {ownerId:target.id,actorId:actor.id,abilityId,abilityRevision:ability.sourceRevision,abilityInstanceIds:[...ability.sourceInstanceIds],method:ability.spec.method,strength:ability.spec.strength,difficulty:effect.effect.version===3?effect.effect.removal.difficulty:0,manaCost:ability.spec.manaCost,removed:structuredClone(effect)};
}
