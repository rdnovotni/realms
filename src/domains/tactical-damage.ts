import { Ajv } from 'ajv';
import type pg from 'pg';
import { DomainError } from '../foundation/errors.js';
import type { MechanicsSource } from './character-mechanics.js';

/** Authored vocabulary and stacking policy, scoped to a pinned encounter. */
export type TypedDamageRules={types:string[];defaultType:string;resistanceStacking:'SUM_CAPPED'}&({version:1}|{version:2;families:Record<string,string[]>}|{version:3;families:Record<string,string[]>;conditionalTags:string[]});
export type ConditionalResistance={type:string;ownerTag:string;resistanceBps:number};
export type DamageTraits={version:1|2;conditional?:ConditionalResistance[];minimumNativeLevel:number;attackType?:string;penetration?:number;resistances?:Record<string,number>};
export type DamageProfile={version:1|2;unconditional?:Record<string,number>;conditional?:ConditionalResistance[];attackType:string;penetration:number;resistances:Record<string,number>};
const identifier={type:'string',pattern:'^[a-z][a-z0-9_.-]{0,63}$'};
const vocabulary={type:'array',minItems:1,maxItems:32,uniqueItems:true,items:identifier};
export const typedDamageRulesShape={oneOf:[1,2,3].map(version=>({type:'object',additionalProperties:false,required:['version','types','defaultType','resistanceStacking',...(version>=2?['families',...(version===3?['conditionalTags']:[])]:[])],properties:{version:{const:version},types:vocabulary,defaultType:identifier,resistanceStacking:{const:'SUM_CAPPED'},...(version===3?{conditionalTags:vocabulary}:{}),...(version>=2?{families:{type:'object',minProperties:1,maxProperties:32,propertyNames:identifier,additionalProperties:vocabulary}}:{})}}))};
const validateRules=new Ajv({strict:true}).compile(typedDamageRulesShape);
export function validateTypedDamageRules(value:unknown):asserts value is TypedDamageRules {
 if(!validateRules(value))throw new DomainError(400,'INVALID_TACTICAL_DAMAGE_RULES');
 const r=value as TypedDamageRules;
 if(!r.types.includes(r.defaultType))throw new DomainError(400,'INVALID_TACTICAL_DAMAGE_TYPE');
 // Families contain concrete types only: no nesting, cycles or ambiguous names.
 if('families' in r&&Object.entries(r.families).some(([family,members])=>r.types.includes(family)||members.some(t=>!r.types.includes(t))))throw new DomainError(400,'INVALID_TACTICAL_DAMAGE_FAMILY');
}

const validate=new Ajv({strict:true}).compile({type:'object',additionalProperties:false,required:['version','minimumNativeLevel'],properties:{version:{enum:[1,2]},conditional:{type:'array',minItems:1,maxItems:8,items:{type:'object',additionalProperties:false,required:['type','ownerTag','resistanceBps'],properties:{type:identifier,ownerTag:identifier,resistanceBps:{type:'integer',minimum:-10000,maximum:10000}}}},minimumNativeLevel:{type:'integer',minimum:0,maximum:999},attackType:identifier,penetration:{type:'integer',minimum:0,maximum:1000000},resistances:{type:'object',minProperties:1,maxProperties:32,propertyNames:identifier,additionalProperties:{type:'integer',minimum:-10000,maximum:10000}}},minProperties:3});
export function validateDamageTraits(value:unknown):asserts value is DamageTraits {
 if(!validate(value)||((value as DamageTraits).version===2)!==((value as DamageTraits).conditional!==undefined))throw new DomainError(400,'INVALID_TACTICAL_DAMAGE_TRAITS');
}
export function validateDamageProfile(r:TypedDamageRules,p:DamageProfile) {
 if((p.version===1&&(p.conditional!==undefined||p.unconditional!==undefined))||Object.keys(p).some(k=>!['version','attackType','penetration','resistances',...(p.version===2?['unconditional','conditional']:[])].includes(k))||p.version!==(r.version===3?2:1)||!r.types.includes(p.attackType)||!Number.isInteger(p.penetration)||p.penetration<0||p.penetration>1000000||!p.resistances||Object.entries(p.resistances).some(([type,n])=>!r.types.includes(type)||!Number.isInteger(n)||n< -10000||n>10000))throw new DomainError(400,'INVALID_TACTICAL_DAMAGE_PROFILE');
 if(r.version===3&&(!p.unconditional||!Array.isArray(p.conditional)||p.conditional.length>1024||Object.entries(p.unconditional).some(([t,v])=>!r.types.includes(t)||!Number.isInteger(v)||Math.abs(v)>1280000||p.resistances[t]!==Math.max(-10000,Math.min(10000,v)))||p.conditional.some(c=>!r.types.includes(c.type)||!r.conditionalTags.includes(c.ownerTag)||!Number.isInteger(c.resistanceBps)||Math.abs(c.resistanceBps)>1280000)))throw new DomainError(400,'INVALID_TACTICAL_CONDITIONAL_PROFILE');
}
/** Selected native-class/ability/active-item contributions only. Conflicting
 * attack replacements reject rather than allowing source iteration to pick one.
 * Sum once, then cap each resistance; source ordering cannot change the result.
 */
export function deriveDamageProfile(r:TypedDamageRules,sources:{traits:DamageTraits;nativeLevel:number}[]):DamageProfile {
 validateTypedDamageRules(r);
 const p:DamageProfile={...(r.version===3?{unconditional:{},conditional:[]}:{}),version:r.version===3?2:1,attackType:r.defaultType,penetration:0,resistances:{}};
 const attacks=new Set<string>();
 for(const {traits,nativeLevel} of sources){
  validateDamageTraits(traits);
  // Validate vocabulary even for currently locked native-level contributions.
  if((traits.attackType&&!r.types.includes(traits.attackType))||Object.keys(traits.resistances??{}).some(t=>!r.types.includes(t)&&!('families' in r&&Object.hasOwn(r.families,t))))throw new DomainError(400,'UNKNOWN_TACTICAL_DAMAGE_TYPE');
  if(traits.version===2){if(r.version!==3)throw new DomainError(400,'TACTICAL_CONDITIONAL_RESISTANCE_DISABLED');if(traits.conditional!.some(c=>!r.types.includes(c.type)||!r.conditionalTags.includes(c.ownerTag)))throw new DomainError(400,'UNKNOWN_TACTICAL_CONDITIONAL_TAG');}
  if(nativeLevel<traits.minimumNativeLevel)continue;
  for(const c of traits.conditional??[]){const old=p.conditional!.find(v=>v.type===c.type&&v.ownerTag===c.ownerTag);if(old)old.resistanceBps+=c.resistanceBps;else p.conditional!.push(structuredClone(c));}
  if(traits.attackType)attacks.add(traits.attackType);
  p.penetration+=traits.penetration??0;
  for(const [key,bps] of Object.entries(traits.resistances??{})){
   const members='families' in r&&Object.hasOwn(r.families,key)?r.families[key]!:[key];
   for(const type of members)p.resistances[type]=(Object.hasOwn(p.resistances,type)?p.resistances[type]!:0)+bps;
  }
 }
 if(attacks.size>1)throw new DomainError(409,'CONFLICTING_TACTICAL_ATTACK_TYPES');
 p.attackType=[...attacks][0]??r.defaultType;
 if(r.version===3){p.unconditional=structuredClone(p.resistances);p.conditional!.sort((a,b)=>(a.type<b.type?-1:a.type>b.type?1:0)||(a.ownerTag<b.ownerTag?-1:a.ownerTag>b.ownerTag?1:0));}
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

export function resistanceFor(profile:DamageProfile|undefined,type:string,ownerTags:string[]=[]) {
 if(profile?.version===2)return Math.max(-10000,Math.min(10000,(profile.unconditional&&Object.hasOwn(profile.unconditional,type)?profile.unconditional[type]!:0)+(profile.conditional??[]).filter(c=>c.type===type&&ownerTags.includes(c.ownerTag)).reduce((sum,c)=>sum+c.resistanceBps,0)));
 return profile&&Object.hasOwn(profile.resistances,type)?profile.resistances[type]!:0;
}
