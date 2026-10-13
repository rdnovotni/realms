import { Ajv } from 'ajv';
import type { ContentEntity } from './content.js';
import { attributes,validateBuildRules,type StartingAttributes } from './build-content.js';
import { validateProgressionCurve } from './progression-rules.js';
import { DomainError } from '../foundation/errors.js';
export type AttributeRules={version:1;ruleset:'ATTRIBUTE_MILESTONES_V1';buildRulesId:string;maximumScores:StartingAttributes;milestones:{level:number;points:number;allowedAttributes:(typeof attributes[number])[]}[]};
export type AttributeAllocation=Partial<StartingAttributes>;
const ajv=new Ajv({strict:true,allErrors:true});
const validate=ajv.compile({type:'object',additionalProperties:false,required:['version','ruleset','buildRulesId','maximumScores','milestones'],properties:{version:{type:'integer',const:1},ruleset:{type:'string',const:'ATTRIBUTE_MILESTONES_V1'},buildRulesId:{type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'},maximumScores:{type:'object',additionalProperties:false,required:attributes,properties:Object.fromEntries(attributes.map(a=>[a,{type:'integer',minimum:1,maximum:9999}]))},milestones:{type:'array',minItems:1,maxItems:32,items:{type:'object',additionalProperties:false,required:['level','points','allowedAttributes'],properties:{level:{type:'integer',minimum:1,maximum:999},points:{type:'integer',minimum:1,maximum:30},allowedAttributes:{type:'array',minItems:1,maxItems:7,uniqueItems:true,items:{type:'string',enum:attributes}}}}}}});
export function validateAttributeRules(value:unknown):asserts value is AttributeRules {
  if(!validate(value))throw new DomainError(400,'INVALID_ATTRIBUTE_RULES');const r=value as AttributeRules;
  if(r.milestones.some((m,i)=>i>0 && m.level<=r.milestones[i-1]!.level))throw new DomainError(400,'INVALID_ATTRIBUTE_RULES');
}
// Seven attributes allow checking every capacity subset without a general flow solver.
export function attributeCapacity(r:AttributeRules,current:StartingAttributes,used:number[]=[]) {
  for(let mask=1;mask<128;mask++) {
    const group=attributes.filter((_,i)=>mask&(1<<i));
    const required=r.milestones.filter(m=>!used.includes(m.level) && m.allowedAttributes.every(a=>group.includes(a))).reduce((n,m)=>n+m.points,0);
    const available=group.reduce((n,a)=>n+Math.max(0,r.maximumScores[a]-current[a]),0);
    if(required>available)return false;
  }return true;
}
export function validateAttributeReferences(entity:ContentEntity,entities:Map<string,ContentEntity>) {
  const r=entity.definition.mechanics?.attributeRules;if(r===undefined)return;
  if(entity.kind!=='TUNING')throw new DomainError(400,'INVALID_ATTRIBUTE_RULES_KIND');validateAttributeRules(r);
  const base=entities.get(r.buildRulesId);if(base?.kind!=='TUNING' || !entity.definition.dependencies.includes(base.id))throw new DomainError(400,'INVALID_ATTRIBUTE_BUILD_RULES');
  validateBuildRules(base.definition.mechanics?.buildRules);const curve=entities.get(base.definition.mechanics.buildRules.curveId);validateProgressionCurve(curve?.definition.mechanics?.xpCurve);
  if(r.milestones.at(-1)!.level>(curve!.definition.mechanics!.xpCurve as {thresholds:string[]}).thresholds.length)throw new DomainError(400,'UNREACHABLE_ATTRIBUTE_MILESTONE');
  if(base.definition.mechanics.buildRules.presets.some(p=>attributes.some(a=>p.attributes[a]>r.maximumScores[a]) || !attributeCapacity(r,p.attributes)))throw new DomainError(400,'UNREACHABLE_ATTRIBUTE_BUDGET');
}
export function validateAllocation(value:AttributeAllocation) {
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).length===0 || Object.entries(value).some(([key,n])=>!attributes.includes(key as typeof attributes[number]) || !Number.isInteger(n) || n<1 || n>30))throw new DomainError(400,'INVALID_ATTRIBUTE_ALLOCATION');
}
