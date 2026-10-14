import { Ajv } from 'ajv';
import { DomainError } from '../foundation/errors.js';
import type { ContentEntity } from './content.js';

export type EncumbranceState='COMFORTABLE'|'BURDENED'|'ENCUMBERED'|'OVERLOADED'|'UNMEASURED';
export type CarryPenalties={initiative:number;stealth:number;mobility:number};
export type CarryRules={version:1;baseWeight:number;weightPerStrength:number;baseBulk:number;bulkPerStrength:number;comfortableBps:number;burdenedBps:number;encumberedBps:number;burdened:CarryPenalties;encumbered:CarryPenalties;stealthSkills:string[];mobilitySkills:string[]};
export type CapacityBonus={version:1;weight:number;bulk:number;minimumNativeLevel:number};
const integer={type:'integer',minimum:0,maximum:1000000000};
const penalties={type:'object',additionalProperties:false,required:['initiative','stealth','mobility'],properties:Object.fromEntries(['initiative','stealth','mobility'].map(key=>[key,{type:'integer',minimum:-100,maximum:0}]))};
const validateRules=new Ajv({strict:true}).compile({type:'object',additionalProperties:false,required:['version','baseWeight','weightPerStrength','baseBulk','bulkPerStrength','comfortableBps','burdenedBps','encumberedBps','burdened','encumbered','stealthSkills','mobilitySkills'],properties:{version:{const:1,type:'integer'},baseWeight:{...integer,minimum:1},weightPerStrength:integer,baseBulk:{...integer,minimum:1},bulkPerStrength:integer,comfortableBps:{type:'integer',minimum:1,maximum:100000},burdenedBps:{type:'integer',minimum:2,maximum:100000},encumberedBps:{type:'integer',minimum:3,maximum:100000},burdened:penalties,encumbered:penalties,stealthSkills:{type:'array',uniqueItems:true,maxItems:32,items:{type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'}},mobilitySkills:{type:'array',uniqueItems:true,maxItems:32,items:{type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'}}}});
const validateBonus=new Ajv({strict:true}).compile({type:'object',additionalProperties:false,required:['version','weight','bulk','minimumNativeLevel'],properties:{version:{type:'integer',const:1},weight:integer,bulk:integer,minimumNativeLevel:{type:'integer',minimum:0,maximum:999}}});
export function validateCarryRules(value:unknown):asserts value is CarryRules {
 if(!validateRules(value))throw new DomainError(400,'INVALID_CARRY_RULES');
 const r=value as CarryRules;
 if(r.comfortableBps>=r.burdenedBps||r.burdenedBps>=r.encumberedBps||(['initiative','stealth','mobility'] as const).some(k=>r.encumbered[k]>r.burdened[k])||r.stealthSkills.some(s=>r.mobilitySkills.includes(s)))throw new DomainError(400,'INVALID_CARRY_RULES');
}
export function validateInventoryContent(entities:Map<string,ContentEntity>) {
 let profiles=0;
 for(const entity of entities.values()) {
  const rules=entity.definition.mechanics?.inventoryRules,bonus=entity.definition.mechanics?.inventoryCapacity;
  if(rules!==undefined) {
   if(entity.kind!=='TUNING'||++profiles>1)throw new DomainError(400,'AMBIGUOUS_CARRY_RULES');
   validateCarryRules(rules);
   for(const id of [...rules.stealthSkills,...rules.mobilitySkills])if(entities.get(id)?.kind!=='SKILL'||!entity.definition.dependencies.includes(id))throw new DomainError(400,'INVALID_CARRY_SKILL');
  }
  if(bonus!==undefined) {
   if(!validateBonus(bonus))throw new DomainError(400,'INVALID_CAPACITY_BONUS');
   const b=bonus as CapacityBonus,m=entity.definition.mechanics!;
   if(entity.kind==='CLASS'&&m.classProgression!==undefined) {
    if(b.minimumNativeLevel<1||b.minimumNativeLevel>(m.classProgression as {maximumNativeLevel:number}).maximumNativeLevel)throw new DomainError(400,'INVALID_CAPACITY_BONUS');
   }else if(!((entity.kind==='ITEM'&&m.equipment!==undefined)||(entity.kind==='ABILITY'&&(m.feat!==undefined||m.subclass!==undefined)))||b.minimumNativeLevel!==0)throw new DomainError(400,'INVALID_CAPACITY_SOURCE');
  }
 }
}
export type CarrySource={name:string;id:string;revision:number;itemId?:string;weight:string;bulk:string};
export type CarryLoad={quantityWatermark:string;movementWatermark:string;enabled:boolean;rulesId?:string;rulesRevision?:number;rules?:CarryRules;strength:number|null;weight:string;bulk:string;weightCapacity:string|null;bulkCapacity:string|null;unmeasuredItems:number;state:EncumbranceState|'UNCONFIGURED';penalties:CarryPenalties;sources:CarrySource[]};
const none:CarryPenalties={initiative:0,stealth:0,mobility:0};
/** Integer cross-products preserve exact boundaries even for int64 stack quantities. */
export function encumbrance(rules:CarryRules,weight:bigint,bulk:bigint,weightCapacity:bigint,bulkCapacity:bigint,unmeasured=0):{state:EncumbranceState;penalties:CarryPenalties} {
 validateCarryRules(rules);
 if(weight<0n||bulk<0n||weightCapacity<1n||bulkCapacity<1n||!Number.isSafeInteger(unmeasured)||unmeasured<0)throw new DomainError(409,'INVALID_CARRY_LOAD');
 if(unmeasured)return {state:'UNMEASURED',penalties:{...none}};
 const exceeds=(bps:number)=>weight*10000n>weightCapacity*BigInt(bps)||bulk*10000n>bulkCapacity*BigInt(bps);
 const state=exceeds(rules.encumberedBps)?'OVERLOADED':exceeds(rules.burdenedBps)?'ENCUMBERED':exceeds(rules.comfortableBps)?'BURDENED':'COMFORTABLE';
 return {state,penalties:{...(state==='BURDENED'?rules.burdened:state==='ENCUMBERED'||state==='OVERLOADED'?rules.encumbered:none)}};
}
export function carryCheckPenalty(load:CarryLoad,skill:string|null) {
 const id=skill?.replace(/^skill\./,'');
 if(!load.enabled||!load.rules||!id)return [];
 const amount=load.rules.stealthSkills.includes(id)?load.penalties.stealth:load.rules.mobilitySkills.includes(id)?load.penalties.mobility:0;
 return amount?[{source:`encumbrance:${load.state.toLowerCase()}`,amount}]:[];
}
