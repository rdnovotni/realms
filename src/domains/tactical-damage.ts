import { Ajv } from 'ajv';
import type pg from 'pg';
import { DomainError } from '../foundation/errors.js';
import type { MechanicsSource } from './character-mechanics.js';

/** Authored vocabulary and stacking policy, scoped to a pinned encounter. */
export type TypedDamageRules={types:string[];defaultType:string;resistanceStacking:'SUM_CAPPED'}&({version:1}|{version:2;families:Record<string,string[]>});
export type DamageTraits={version:1;minimumNativeLevel:number;attackType?:string;penetration?:number;resistances?:Record<string,number>};
export type DamageProfile={version:1;attackType:string;penetration:number;resistances:Record<string,number>};
const identifier={type:'string',pattern:'^[a-z][a-z0-9_.-]{0,63}$'};
const vocabulary={type:'array',minItems:1,maxItems:32,uniqueItems:true,items:identifier};
export const typedDamageRulesShape={oneOf:[1,2].map(version=>({type:'object',additionalProperties:false,required:['version','types','defaultType','resistanceStacking',...(version===2?['families']:[])],properties:{version:{const:version},types:vocabulary,defaultType:identifier,resistanceStacking:{const:'SUM_CAPPED'},...(version===2?{families:{type:'object',minProperties:1,maxProperties:32,propertyNames:identifier,additionalProperties:vocabulary}}:{})}}))};
const validateRules=new Ajv({strict:true}).compile(typedDamageRulesShape);
export function validateTypedDamageRules(value:unknown):asserts value is TypedDamageRules {
 if(!validateRules(value))throw new DomainError(400,'INVALID_TACTICAL_DAMAGE_RULES');
 const r=value as TypedDamageRules;
 if(!r.types.includes(r.defaultType))throw new DomainError(400,'INVALID_TACTICAL_DAMAGE_TYPE');
 // Families contain concrete types only: no nesting, cycles or ambiguous names.
 if(r.version===2&&Object.entries(r.families).some(([family,members])=>r.types.includes(family)||members.some(t=>!r.types.includes(t))))throw new DomainError(400,'INVALID_TACTICAL_DAMAGE_FAMILY');
}

const validate=new Ajv({strict:true}).compile({type:'object',additionalProperties:false,required:['version','minimumNativeLevel'],properties:{version:{const:1},minimumNativeLevel:{type:'integer',minimum:0,maximum:999},attackType:identifier,penetration:{type:'integer',minimum:0,maximum:1000000},resistances:{type:'object',minProperties:1,maxProperties:32,propertyNames:identifier,additionalProperties:{type:'integer',minimum:-10000,maximum:10000}}},minProperties:3});
export function validateDamageTraits(value:unknown):asserts value is DamageTraits {
 if(!validate(value))throw new DomainError(400,'INVALID_TACTICAL_DAMAGE_TRAITS');
}
export function validateDamageProfile(r:TypedDamageRules,p:DamageProfile) {
 if(p.version!==1||!r.types.includes(p.attackType)||!Number.isInteger(p.penetration)||p.penetration<0||p.penetration>1000000||!p.resistances||Object.entries(p.resistances).some(([type,n])=>!r.types.includes(type)||!Number.isInteger(n)||n< -10000||n>10000))throw new DomainError(400,'INVALID_TACTICAL_DAMAGE_PROFILE');
}
/** Selected native-class/ability/active-item contributions only. Conflicting
 * attack replacements reject rather than allowing source iteration to pick one.
 * Sum once, then cap each resistance; source ordering cannot change the result.
 */
export function deriveDamageProfile(r:TypedDamageRules,sources:{traits:DamageTraits;nativeLevel:number}[]):DamageProfile {
 validateTypedDamageRules(r);
 const p:DamageProfile={version:1,attackType:r.defaultType,penetration:0,resistances:{}};
 const attacks=new Set<string>();
 for(const {traits,nativeLevel} of sources){
  validateDamageTraits(traits);
  // Validate vocabulary even for currently locked native-level contributions.
  if((traits.attackType&&!r.types.includes(traits.attackType))||Object.keys(traits.resistances??{}).some(t=>!r.types.includes(t)&&!(r.version===2&&Object.hasOwn(r.families,t))))throw new DomainError(400,'UNKNOWN_TACTICAL_DAMAGE_TYPE');
  if(nativeLevel<traits.minimumNativeLevel)continue;
  if(traits.attackType)attacks.add(traits.attackType);
  p.penetration+=traits.penetration??0;
  for(const [key,bps] of Object.entries(traits.resistances??{})){
   const members=r.version===2&&Object.hasOwn(r.families,key)?r.families[key]!:[key];
   for(const type of members)p.resistances[type]=(Object.hasOwn(p.resistances,type)?p.resistances[type]!:0)+bps;
  }
 }
 if(attacks.size>1)throw new DomainError(409,'CONFLICTING_TACTICAL_ATTACK_TYPES');
 p.attackType=[...attacks][0]??r.defaultType;
 for(const type of Object.keys(p.resistances))p.resistances[type]=Math.max(-10000,Math.min(10000,p.resistances[type]!));
 validateDamageProfile(r,p);return p;
}
/** Immutable source revisions are already independently verified by the
 * character snapshot. No live equipment/progression projections enter here.
 */
export async function loadDamageProfile(client:pg.PoolClient,r:TypedDamageRules,sources:MechanicsSource[]) {
 const traits:{traits:DamageTraits;nativeLevel:number}[]=[];
 for(const source of sources){
  const value=(await client.query("SELECT definition->'mechanics'->'tacticalDamageTraits' AS traits FROM content_versions WHERE entity_id=$1 AND revision=$2",[source.entityId,source.revision])).rows[0]?.traits;
  if(value)traits.push({traits:value as DamageTraits,nativeLevel:source.nativeLevel});
 }
 return deriveDamageProfile(r,traits);
}

export function resistanceFor(profile:DamageProfile|undefined,type:string) {
 return profile&&Object.hasOwn(profile.resistances,type)?profile.resistances[type]!:0;
}
