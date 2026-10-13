import { Ajv } from 'ajv';
import type pg from 'pg';
import { DomainError } from '../foundation/errors.js';
import type { ContentEntity } from './content.js';
import type { MechanicsSource } from './character-mechanics.js';
import type { EffectGrant } from './tactical-effects.js';
export type StatusRules={version:1|2;tags:string[]};
export type StatusTraits={minimumNativeLevel:number;immuneTags:string[]}&({version:1}|{version:2;durationReductionBps:Record<string,number>});
export type StatusProfile={immuneTags:string[]}&({version:1}|{version:2;durationReductionBps:Record<string,number>});
export type StatusEvent={kind:'IMMUNE'|'RESISTED';roundsBefore?:number;roundsAfter?:number;ownerId:string;sourceUnitId:string;matchedTags:string[];blocked:EffectGrant};
export const statusTagShape={type:'string',pattern:'^[a-z][a-z0-9_.-]{0,63}$'};
const tags={type:'array',minItems:1,maxItems:32,uniqueItems:true,items:statusTagShape};
const validate=new Ajv({strict:true}).compile({type:'object',additionalProperties:false,required:['version','minimumNativeLevel','immuneTags'],properties:{version:{enum:[1,2]},durationReductionBps:{type:'object',maxProperties:32,propertyNames:statusTagShape,additionalProperties:{type:'integer',minimum:0,maximum:9000}},minimumNativeLevel:{type:'integer',minimum:0,maximum:999},immuneTags:{...tags,minItems:0}}});
const profile=new Ajv({strict:true}).compile({type:'object',additionalProperties:false,required:['version','immuneTags'],properties:{version:{enum:[1,2]},durationReductionBps:{type:'object',maxProperties:32,propertyNames:statusTagShape,additionalProperties:{type:'integer',minimum:0,maximum:9000}},immuneTags:{...tags,minItems:0}}});
export function validateStatusTraits(value:unknown):asserts value is StatusTraits {if(!validate(value)||((value as StatusTraits).version===1&&(value as StatusTraits).immuneTags.length===0)||((value as StatusTraits).version===2)!==('durationReductionBps' in (value as StatusTraits)))throw new DomainError(400,'INVALID_TACTICAL_STATUS_TRAITS');}
export function validateStatusProfile(r:StatusRules,value:unknown):asserts value is StatusProfile {
 if(!profile(value)||((value as StatusProfile).version===2)!==('durationReductionBps' in (value as StatusProfile))||(value as StatusProfile).version!==r.version||((value as StatusProfile).version===2&&Object.keys((value as Extract<StatusProfile,{version:2}>).durationReductionBps).some(t=>!r.tags.includes(t)))||(value as StatusProfile).immuneTags.some(t=>!r.tags.includes(t)))throw new DomainError(400,'INVALID_TACTICAL_STATUS_PROFILE');
}
export function validateStatusContent(entity:ContentEntity){
 const m=entity.definition.mechanics;if(m?.tacticalStatusTraits===undefined)return;validateStatusTraits(m.tacticalStatusTraits);const t=m.tacticalStatusTraits;
 const native=entity.kind==='CLASS'&&m.classProgression!==undefined,template=['NPC','MONSTER'].includes(entity.kind)&&m.tacticalUnit!==undefined;
 const selected=(entity.kind==='ABILITY'&&(m.feat!==undefined||m.subclass!==undefined))||(entity.kind==='ITEM'&&m.equipment!==undefined);
 if(!(template||((native||selected)&&m.combatModifiers!==undefined))||(!native&&t.minimumNativeLevel!==0)||(native&&(t.minimumNativeLevel<1||t.minimumNativeLevel>(m.classProgression as {maximumNativeLevel:number}).maximumNativeLevel)))throw new DomainError(400,'INVALID_TACTICAL_STATUS_SOURCE');
}
/** Explicit tag immunity only. Duplicate contributions union; no damage defense,
 * inferred tag inheritance, partial resistance or save is introduced. */
export function deriveStatusProfile(r:StatusRules,sources:{traits:StatusTraits;nativeLevel:number}[]):StatusProfile {
 const durationReductionBps:Record<string,number>={},immuneTags=new Set<string>();for(const {traits,nativeLevel} of sources){validateStatusTraits(traits);if(traits.immuneTags.some(t=>!r.tags.includes(t)))throw new DomainError(400,'UNKNOWN_TACTICAL_STATUS_TAG');if(traits.version===2){if(r.version!==2)throw new DomainError(400,'TACTICAL_PARTIAL_STATUS_DEFENSE_DISABLED');if(Object.keys(traits.durationReductionBps).some(t=>!r.tags.includes(t)))throw new DomainError(400,'UNKNOWN_TACTICAL_STATUS_TAG');if(nativeLevel>=traits.minimumNativeLevel)for(const [t,v] of Object.entries(traits.durationReductionBps))durationReductionBps[t]=Math.max(Object.hasOwn(durationReductionBps,t)?durationReductionBps[t]!:0,v);}if(nativeLevel>=traits.minimumNativeLevel)for(const tag of traits.immuneTags)immuneTags.add(tag);}
 const p:StatusProfile=r.version===1?{version:1,immuneTags:[...immuneTags].sort()}:{version:2,immuneTags:[...immuneTags].sort(),durationReductionBps};validateStatusProfile(r,p);return p;
}
export async function loadStatusProfile(client:pg.PoolClient,r:StatusRules,sources:Pick<MechanicsSource,'entityId'|'revision'|'nativeLevel'>[]){
 const values:{traits:StatusTraits;nativeLevel:number}[]=[];for(const s of sources){const traits=(await client.query("SELECT definition->'mechanics'->'tacticalStatusTraits' AS traits FROM content_versions WHERE entity_id=$1 AND revision=$2",[s.entityId,s.revision])).rows[0]?.traits;if(traits)values.push({traits,nativeLevel:s.nativeLevel});}return deriveStatusProfile(r,values);
}
export function immuneStatus(profile:StatusProfile|undefined,grant:EffectGrant){
 return ['HARMFUL','MIXED'].includes(grant.effect.polarity)?grant.effect.tags.filter(t=>profile?.immuneTags.includes(t)).sort():[];
}
