import { Ajv } from 'ajv';
import type { ContentEntity } from './content.js';
import { DomainError } from '../foundation/errors.js';
import { validateProgressionCurve } from './progression-rules.js';
export const attributes=['strength','dexterity','constitution','intelligence','wisdom','charisma','luck'] as const;
export type StartingAttributes=Record<typeof attributes[number],number>;
export type BuildRules={version:1;ruleset:'CLASS_LEVELS_V1';curveId:string;maximumClasses:2;startingLuck:number;presets:{key:string;attributes:StartingAttributes}[]};
export type NativeClass={version:1;rulesId:string;access:'DISCOVERED';maximumNativeLevel:number};
const ajv=new Ajv({strict:true,allErrors:true}),id={type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'},integer=(min:number,max:number)=>({type:'integer',minimum:min,maximum:max});
const native=ajv.compile({type:'object',additionalProperties:false,required:['version','rulesId','access','maximumNativeLevel'],properties:{version:{type:'integer',const:1},rulesId:id,access:{type:'string',const:'DISCOVERED'},maximumNativeLevel:integer(1,999)}});
const rules=ajv.compile({type:'object',additionalProperties:false,required:['version','ruleset','curveId','maximumClasses','startingLuck','presets'],properties:{
  version:{type:'integer',const:1},ruleset:{type:'string',const:'CLASS_LEVELS_V1'},curveId:id,maximumClasses:{type:'integer',const:2},startingLuck:integer(1,30),
  presets:{type:'array',minItems:1,maxItems:16,items:{type:'object',additionalProperties:false,required:['key','attributes'],properties:{key:{type:'string',pattern:'^[a-z][a-z0-9_-]{0,39}$'},attributes:{type:'object',additionalProperties:false,required:attributes,properties:Object.fromEntries(attributes.map(key=>[key,integer(1,30)]))}}}}
}});
export function validateBuildRules(value:unknown):asserts value is BuildRules {
  if(!rules(value)) throw new DomainError(400,'INVALID_BUILD_RULES');
  const spec=value as BuildRules;
  if(new Set(spec.presets.map(p=>p.key)).size!==spec.presets.length || spec.presets.some(p=>p.attributes.luck!==spec.startingLuck)) throw new DomainError(400,'INVALID_BUILD_RULES');
}
export function validateNativeClass(value:unknown):asserts value is NativeClass {if(!native(value)) throw new DomainError(400,'INVALID_NATIVE_CLASS');}
export function validateBuildReferences(entity:ContentEntity,entities:Map<string,ContentEntity>) {
  const mechanics=entity.definition.mechanics;
  if(mechanics?.buildRules!==undefined) {
    if(entity.kind!=='TUNING') throw new DomainError(400,'INVALID_BUILD_RULES_KIND');
    validateBuildRules(mechanics.buildRules);const curve=entities.get(mechanics.buildRules.curveId);
    if(curve?.kind!=='TUNING' || !entity.definition.dependencies.includes(curve.id)) throw new DomainError(400,'INVALID_BUILD_CURVE_REFERENCE');
    validateProgressionCurve(curve.definition.mechanics?.xpCurve);
  }
  if(mechanics?.classProgression!==undefined) {
    if(entity.kind!=='CLASS') throw new DomainError(400,'INVALID_NATIVE_CLASS_KIND');
    validateNativeClass(mechanics.classProgression);const rules=entities.get(mechanics.classProgression.rulesId);
    if(rules?.kind!=='TUNING' || !entity.definition.dependencies.includes(rules.id)) throw new DomainError(400,'INVALID_CLASS_RULES_REFERENCE');
    validateBuildRules(rules.definition.mechanics?.buildRules);
  }
}
