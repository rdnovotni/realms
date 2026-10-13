import { Ajv } from 'ajv';
import type pg from 'pg';
import { DomainError } from '../foundation/errors.js';
import { checksum,type Json } from '../foundation/json.js';
import type { MechanicsSource } from './character-mechanics.js';
import type { ContentEntity } from './content.js';
export type HealingAbilitySpec={version:1;minimumNativeLevel:number;range:number;manaCost:number;min:number;max:number};
export type HealingAbility={id:string;sourceRevision:number;sourceInstanceIds:string[];spec:HealingAbilitySpec};
export type HealingAbilityEvent={actorId:string;targetId:string;abilityId:string;sourceRevision:number;sourceInstanceIds:string[];manaCost:number;amount:number;healthBefore:number;healthAfter:number;stateBefore:string;stateAfter:string;strikesBefore:number;strikesAfter:number};
const validate=new Ajv({strict:true}).compile({type:'object',additionalProperties:false,required:['version','minimumNativeLevel','range','manaCost','min','max'],properties:{version:{const:1},minimumNativeLevel:{type:'integer',minimum:0,maximum:999},range:{type:'integer',minimum:0,maximum:31},manaCost:{type:'integer',minimum:1,maximum:1000000},min:{type:'integer',minimum:1,maximum:1000000},max:{type:'integer',minimum:1,maximum:1000000}}});
export function validateHealingAbility(value:unknown):asserts value is HealingAbilitySpec {if(!validate(value)||(value as HealingAbilitySpec).max<(value as HealingAbilitySpec).min)throw new DomainError(400,'INVALID_TACTICAL_HEALING_ABILITY');}
export function validateHealingAbilityContent(entity:ContentEntity){
 const m=entity.definition.mechanics;if(m?.tacticalHealingAbility===undefined)return;validateHealingAbility(m.tacticalHealingAbility);const a=m.tacticalHealingAbility;
 const native=entity.kind==='CLASS'&&m.classProgression!==undefined,template=['NPC','MONSTER'].includes(entity.kind)&&m.tacticalUnit!==undefined;
 const selected=(entity.kind==='ABILITY'&&(m.feat!==undefined||m.subclass!==undefined))||(entity.kind==='ITEM'&&m.equipment!==undefined);
 if(!(template||((native||selected)&&m.combatModifiers!==undefined))||(!native&&a.minimumNativeLevel!==0)||(native&&(a.minimumNativeLevel<1||a.minimumNativeLevel>(m.classProgression as {maximumNativeLevel:number}).maximumNativeLevel)))throw new DomainError(400,'INVALID_TACTICAL_HEALING_ABILITY_SOURCE');
}
export function normalizeHealingAbilities(input:HealingAbility[]){
 const map=new Map<string,HealingAbility>();for(const a of input){validateHealingAbility(a.spec);
  if(!/^[a-z][a-z0-9_.-]{2,119}$/.test(a.id)||!Number.isInteger(a.sourceRevision)||a.sourceRevision<1||!Array.isArray(a.sourceInstanceIds)||a.sourceInstanceIds.some(id=>!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)))throw new DomainError(409,'INVALID_TACTICAL_HEALING_ABILITY');
  const prior=map.get(a.id);if(prior){if(prior.sourceRevision!==a.sourceRevision||checksum(prior.spec as unknown as Json)!==checksum(a.spec as unknown as Json))throw new DomainError(409,'CONFLICTING_TACTICAL_HEALING_ABILITY');prior.sourceInstanceIds=[...new Set([...prior.sourceInstanceIds,...a.sourceInstanceIds])].sort();}else map.set(a.id,{...structuredClone(a),sourceInstanceIds:[...new Set(a.sourceInstanceIds)].sort()});
 }if(map.size>32)throw new DomainError(409,'TOO_MANY_TACTICAL_HEALING_ABILITIES');return [...map.values()].sort((a,b)=>a.id<b.id?-1:1);
}
export async function loadHealingAbilities(client:pg.PoolClient,sources:Pick<MechanicsSource,'entityId'|'revision'|'nativeLevel'|'instanceId'>[]){
 const input:HealingAbility[]=[];for(const s of sources){const spec=(await client.query("SELECT definition->'mechanics'->'tacticalHealingAbility' AS spec FROM content_versions WHERE entity_id=$1 AND revision=$2",[s.entityId,s.revision])).rows[0]?.spec;if(!spec)continue;validateHealingAbility(spec);if(s.nativeLevel>=spec.minimumNativeLevel)input.push({id:s.entityId,sourceRevision:s.revision,sourceInstanceIds:s.instanceId?[s.instanceId]:[],spec});}return normalizeHealingAbilities(input);
}
