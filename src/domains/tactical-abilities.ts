import { Ajv } from 'ajv';
import type pg from 'pg';
import { DomainError } from '../foundation/errors.js';
import { checksum,type Json } from '../foundation/json.js';
import type { MechanicsSource } from './character-mechanics.js';
import type { ContentEntity } from './content.js';
import type { TypedDamageRules } from './tactical-damage.js';
export type AttackAbilitySpec={version:1;minimumNativeLevel:number;range:number;manaCost:number;accuracyModifier:number;damage:{type:string;min:number;max:number;penetration:number}};
export type AttackAbility={id:string;sourceRevision:number;sourceInstanceIds:string[];spec:AttackAbilitySpec};
export type AbilityEvent={actorId:string;targetId:string;abilityId:string;sourceRevision:number;sourceInstanceIds:string[];manaCost:number};
const validate=new Ajv({strict:true}).compile({type:'object',additionalProperties:false,required:['version','minimumNativeLevel','range','manaCost','accuracyModifier','damage'],properties:{version:{const:1},minimumNativeLevel:{type:'integer',minimum:0,maximum:999},range:{type:'integer',minimum:0,maximum:31},manaCost:{type:'integer',minimum:1,maximum:1000000},accuracyModifier:{type:'integer',minimum:-1000,maximum:1000},damage:{type:'object',additionalProperties:false,required:['type','min','max','penetration'],properties:{type:{type:'string',pattern:'^[a-z][a-z0-9_.-]{0,63}$'},min:{type:'integer',minimum:1,maximum:1000000},max:{type:'integer',minimum:1,maximum:1000000},penetration:{type:'integer',minimum:0,maximum:1000000}}}}});
export function validateAttackAbility(value:unknown):asserts value is AttackAbilitySpec {if(!validate(value)||(value as AttackAbilitySpec).damage.max<(value as AttackAbilitySpec).damage.min)throw new DomainError(400,'INVALID_TACTICAL_ATTACK_ABILITY');}
export function validateAbilityContent(entity:ContentEntity){
 const m=entity.definition.mechanics;if(m?.tacticalAttackAbility===undefined)return;validateAttackAbility(m.tacticalAttackAbility);const a=m.tacticalAttackAbility;
 const native=entity.kind==='CLASS'&&m.classProgression!==undefined,template=['NPC','MONSTER'].includes(entity.kind)&&m.tacticalUnit!==undefined;
 const selected=(entity.kind==='ABILITY'&&(m.feat!==undefined||m.subclass!==undefined))||(entity.kind==='ITEM'&&m.equipment!==undefined);
 if(!(template||((native||selected)&&m.combatModifiers!==undefined))||(!native&&a.minimumNativeLevel!==0)||(native&&(a.minimumNativeLevel<1||a.minimumNativeLevel>(m.classProgression as {maximumNativeLevel:number}).maximumNativeLevel)))throw new DomainError(400,'INVALID_TACTICAL_ABILITY_SOURCE');
}
export function normalizeAttackAbilities(input:AttackAbility[],rules:TypedDamageRules){
 const map=new Map<string,AttackAbility>();for(const a of input){validateAttackAbility(a.spec);
  if(!/^[a-z][a-z0-9_.-]{2,119}$/.test(a.id)||!Number.isInteger(a.sourceRevision)||a.sourceRevision<1||!Array.isArray(a.sourceInstanceIds)||a.sourceInstanceIds.some(id=>!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)))throw new DomainError(409,'INVALID_TACTICAL_ABILITY');
  if(!rules.types.includes(a.spec.damage.type))throw new DomainError(400,'UNKNOWN_TACTICAL_ABILITY_DAMAGE_TYPE');
  const prior=map.get(a.id);if(prior){if(prior.sourceRevision!==a.sourceRevision||checksum(prior.spec as unknown as Json)!==checksum(a.spec as unknown as Json))throw new DomainError(409,'CONFLICTING_TACTICAL_ABILITY');prior.sourceInstanceIds=[...new Set([...prior.sourceInstanceIds,...a.sourceInstanceIds])].sort();}else map.set(a.id,{...structuredClone(a),sourceInstanceIds:[...new Set(a.sourceInstanceIds)].sort()});
 }if(map.size>32)throw new DomainError(409,'TOO_MANY_TACTICAL_ABILITIES');return [...map.values()].sort((a,b)=>a.id<b.id?-1:1);
}
export async function loadAttackAbilities(client:pg.PoolClient,rules:TypedDamageRules,sources:Pick<MechanicsSource,'entityId'|'revision'|'nativeLevel'|'instanceId'>[]){
 const input:AttackAbility[]=[];for(const s of sources){const spec=(await client.query("SELECT definition->'mechanics'->'tacticalAttackAbility' AS spec FROM content_versions WHERE entity_id=$1 AND revision=$2",[s.entityId,s.revision])).rows[0]?.spec;if(!spec)continue;validateAttackAbility(spec);if(!rules.types.includes(spec.damage.type))throw new DomainError(400,'UNKNOWN_TACTICAL_ABILITY_DAMAGE_TYPE');if(s.nativeLevel>=spec.minimumNativeLevel)input.push({id:s.entityId,sourceRevision:s.revision,sourceInstanceIds:s.instanceId?[s.instanceId]:[],spec});}return normalizeAttackAbilities(input,rules);
}
