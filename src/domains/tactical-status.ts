import { Ajv } from 'ajv';
import type pg from 'pg';
import { DomainError } from '../foundation/errors.js';
import type { ContentEntity } from './content.js';
import type { MechanicsSource } from './character-mechanics.js';
import type { EffectGrant } from './tactical-effects.js';
export type StatusRules={version:1;tags:string[]};
export type StatusTraits={version:1;minimumNativeLevel:number;immuneTags:string[]};
export type StatusProfile={version:1;immuneTags:string[]};
export type StatusEvent={kind:'IMMUNE';ownerId:string;sourceUnitId:string;matchedTags:string[];blocked:EffectGrant};
export const statusTagShape={type:'string',pattern:'^[a-z][a-z0-9_.-]{0,63}$'};
const tags={type:'array',minItems:1,maxItems:32,uniqueItems:true,items:statusTagShape};
const validate=new Ajv({strict:true}).compile({type:'object',additionalProperties:false,required:['version','minimumNativeLevel','immuneTags'],properties:{version:{const:1},minimumNativeLevel:{type:'integer',minimum:0,maximum:999},immuneTags:tags}});
const profile=new Ajv({strict:true}).compile({type:'object',additionalProperties:false,required:['version','immuneTags'],properties:{version:{const:1},immuneTags:{...tags,minItems:0}}});
export function validateStatusTraits(value:unknown):asserts value is StatusTraits {if(!validate(value))throw new DomainError(400,'INVALID_TACTICAL_STATUS_TRAITS');}
export function validateStatusProfile(r:StatusRules,value:unknown):asserts value is StatusProfile {
 if(!profile(value)||(value as StatusProfile).immuneTags.some(t=>!r.tags.includes(t)))throw new DomainError(400,'INVALID_TACTICAL_STATUS_PROFILE');
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
 const immuneTags=new Set<string>();for(const {traits,nativeLevel} of sources){validateStatusTraits(traits);if(traits.immuneTags.some(t=>!r.tags.includes(t)))throw new DomainError(400,'UNKNOWN_TACTICAL_STATUS_TAG');if(nativeLevel>=traits.minimumNativeLevel)for(const tag of traits.immuneTags)immuneTags.add(tag);}
 const p:StatusProfile={version:1,immuneTags:[...immuneTags].sort()};validateStatusProfile(r,p);return p;
}
export async function loadStatusProfile(client:pg.PoolClient,r:StatusRules,sources:Pick<MechanicsSource,'entityId'|'revision'|'nativeLevel'>[]){
 const values:{traits:StatusTraits;nativeLevel:number}[]=[];for(const s of sources){const traits=(await client.query("SELECT definition->'mechanics'->'tacticalStatusTraits' AS traits FROM content_versions WHERE entity_id=$1 AND revision=$2",[s.entityId,s.revision])).rows[0]?.traits;if(traits)values.push({traits,nativeLevel:s.nativeLevel});}return deriveStatusProfile(r,values);
}
export function immuneStatus(profile:StatusProfile|undefined,grant:EffectGrant){
 return ['HARMFUL','MIXED'].includes(grant.effect.polarity)?grant.effect.tags.filter(t=>profile?.immuneTags.includes(t)).sort():[];
}
