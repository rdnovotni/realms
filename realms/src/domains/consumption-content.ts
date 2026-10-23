import { Ajv } from 'ajv';
import { DomainError } from '../foundation/errors.js';
import type { ContentEntity } from './content.js';
export const capacityKeys=['fullness','drunkenness','tolerance'] as const;
export type Capacity=typeof capacityKeys[number];
export type Capacities=Record<Capacity,number>;
export type Consumable={version:1;family:'FOOD'|'BOOZE'|'TOLERANCE'|'MEDICINE';costs:Capacities;turns:number;quality:{reference:number;softness:number;maximumBonusBps:number};automatic:boolean;rare:boolean};
export const standardConsumptionPolicy={version:1,capacities:{fullness:20,drunkenness:15,tolerance:10},constitutionBonuses:[] as {minimum:number;fullness:number;drunkenness:number;tolerance:number}[],forbiddenFamilies:[] as string[],reset:{fullness:true,drunkenness:true,tolerance:true},allowNightcaps:true};
const integer=(minimum:number,maximum:number)=>({type:'integer',minimum,maximum});
const capacities={type:'object',additionalProperties:false,required:capacityKeys,properties:Object.fromEntries(capacityKeys.map(k=>[k,integer(0,1000)]))};
const ajv=new Ajv({strict:true});
const check=ajv.compile({type:'object',additionalProperties:false,required:['version','family','costs','turns','quality','automatic','rare'],properties:{version:{const:1},family:{enum:['FOOD','BOOZE','TOLERANCE','MEDICINE']},costs:capacities,turns:integer(0,1000),quality:{type:'object',additionalProperties:false,required:['reference','softness','maximumBonusBps'],properties:{reference:integer(1,1000000),softness:integer(1,1000000),maximumBonusBps:integer(0,2500)}},automatic:{type:'boolean'},rare:{type:'boolean'}}});
const checkPolicy=ajv.compile({type:'object',additionalProperties:false,required:Object.keys(standardConsumptionPolicy),properties:{version:{const:1},capacities,constitutionBonuses:{type:'array',maxItems:16,items:{type:'object',additionalProperties:false,required:['minimum',...capacityKeys],properties:{minimum:integer(1,1000000),...Object.fromEntries(capacityKeys.map(k=>[k,integer(0,4)]))}}},forbiddenFamilies:{type:'array',uniqueItems:true,maxItems:4,items:{enum:['FOOD','BOOZE','TOLERANCE','MEDICINE']}},reset:{type:'object',additionalProperties:false,required:capacityKeys,properties:Object.fromEntries(capacityKeys.map(k=>[k,{type:'boolean'}]))},allowNightcaps:{type:'boolean'}}});
export function validateConsumable(value:unknown):asserts value is Consumable{
 if(!check(value))throw new DomainError(400,'INVALID_CONSUMABLE');const s=value as Consumable;
 if((s.family==='FOOD'&&s.costs.fullness<1)||(s.family==='BOOZE'&&s.costs.drunkenness<1)||(s.family==='TOLERANCE'&&s.costs.tolerance<1)||(s.family==='MEDICINE'&&(s.turns>0||capacityKeys.some(k=>s.costs[k]>0))))throw new DomainError(400,'INVALID_CONSUMABLE');
}
export function validateConsumptionContent(entities:Map<string,ContentEntity>){
 let policies=0;
 for(const e of entities.values()){
  const p=e.definition.mechanics?.consumptionPolicy;if(p!==undefined){if(e.kind!=='TUNING'||!checkPolicy(p)||++policies>1)throw new DomainError(400,'INVALID_CONSUMPTION_POLICY');const b=(p as typeof standardConsumptionPolicy).constitutionBonuses;if(b.some((v,i)=>capacityKeys.reduce((sum,k)=>sum+v[k],0)>4||i>0&&(v.minimum<=b[i-1]!.minimum||capacityKeys.some(k=>v[k]<b[i-1]![k]))))throw new DomainError(400,'INVALID_CONSUMPTION_POLICY');}
  const use=e.definition.mechanics?.itemUse as {version?:number;kind?:string;rewards?:unknown[];consumption?:unknown}|undefined;if(use?.consumption===undefined)continue;
  validateConsumable(use.consumption);if(e.kind!=='ITEM'||use.version!==2||use.kind!=='USE'||use.rewards?.length)throw new DomainError(400,'INVALID_CONSUMABLE_ITEM_USE');
 }
}
/** Continuous quality receives a bounded, diminishing bonus, never a multiplier proportional to quality. */
export function consumableTurns(s:Consumable,quality:string|number){const q=Number(quality),extra=Math.max(0,q-s.quality.reference);return Math.floor(s.turns*(10000+Math.floor(s.quality.maximumBonusBps*extra/(s.quality.softness+extra)))/10000);}
