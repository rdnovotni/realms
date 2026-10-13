import { Ajv } from 'ajv';
import type { ContentEntity } from './content.js';
import { attributes } from './build-content.js';
import { validateBuildRules } from './build-content.js';
import { validateProgressionCurve } from './progression-rules.js';
import { DomainError } from '../foundation/errors.js';
export const proficiencyRanks=['UNTRAINED','NOVICE','TRAINED','EXPERT','MASTER','LEGENDARY'] as const;
export type SkillSpec={version:1;family:'PHYSICAL'|'SUBTERFUGE'|'KNOWLEDGE'|'SURVIVAL'|'SOCIAL'|'CARE'|'FORTUNE';defaultAttribute:typeof attributes[number];maximumRank:number;access:'DISCOVERED'};
export type ProficiencyRules={version:1;ruleset:'PROFICIENCY_CHOICES_V1';buildRulesId:string;skillIds:string[];milestones:number[]};
const ajv=new Ajv({strict:true,allErrors:true}),id={type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'};
const skill=ajv.compile({type:'object',additionalProperties:false,required:['version','family','defaultAttribute','maximumRank','access'],properties:{version:{type:'integer',const:1},family:{type:'string',enum:['PHYSICAL','SUBTERFUGE','KNOWLEDGE','SURVIVAL','SOCIAL','CARE','FORTUNE']},defaultAttribute:{type:'string',enum:attributes},maximumRank:{type:'integer',minimum:1,maximum:5},access:{type:'string',const:'DISCOVERED'}}});
const rules=ajv.compile({type:'object',additionalProperties:false,required:['version','ruleset','buildRulesId','skillIds','milestones'],properties:{version:{type:'integer',const:1},ruleset:{type:'string',const:'PROFICIENCY_CHOICES_V1'},buildRulesId:id,skillIds:{type:'array',minItems:1,maxItems:64,uniqueItems:true,items:id},milestones:{type:'array',minItems:1,maxItems:128,uniqueItems:true,items:{type:'integer',minimum:1,maximum:999}}}});
export function validateSkill(value:unknown):asserts value is SkillSpec {
  if(!skill(value))throw new DomainError(400,'INVALID_SKILL');
  const s=value as SkillSpec;if((s.defaultAttribute==='luck')!==(s.family==='FORTUNE'))throw new DomainError(400,'INVALID_SKILL_LUCK_PAIRING');
}
export function validateProficiencyRules(value:unknown):asserts value is ProficiencyRules {
  if(!rules(value))throw new DomainError(400,'INVALID_PROFICIENCY_RULES');
  if((value as ProficiencyRules).milestones.some((n,i,a)=>i>0 && n<=a[i-1]!))throw new DomainError(400,'INVALID_PROFICIENCY_RULES');
}
export function validateProficiencyContent(entities:Map<string,ContentEntity>){
  for(const e of entities.values()){
    const s=e.definition.mechanics?.skill,r=e.definition.mechanics?.proficiencyRules;
    if(e.kind==='SKILL' || s!==undefined){if(e.kind!=='SKILL')throw new DomainError(400,'INVALID_SKILL_KIND');validateSkill(s);}
    if(r!==undefined){
      if(e.kind!=='TUNING')throw new DomainError(400,'INVALID_PROFICIENCY_RULES_KIND');validateProficiencyRules(r);
      const b=entities.get(r.buildRulesId);if(b?.kind!=='TUNING' || !e.definition.dependencies.includes(b.id))throw new DomainError(400,'INVALID_PROFICIENCY_BUILD_RULES');
      validateBuildRules(b.definition.mechanics?.buildRules);const c=entities.get(b.definition.mechanics.buildRules.curveId);validateProgressionCurve(c?.definition.mechanics?.xpCurve);
      if(r.milestones.at(-1)!>(c!.definition.mechanics!.xpCurve as {thresholds:string[]}).thresholds.length)throw new DomainError(400,'UNREACHABLE_PROFICIENCY_MILESTONE');
      let capacity=0;for(const id of r.skillIds){const s=entities.get(id);if(s?.kind!=='SKILL' || !e.definition.dependencies.includes(id))throw new DomainError(400,'INVALID_PROFICIENCY_SKILL_REFERENCE');validateSkill(s.definition.mechanics?.skill);capacity+=s.definition.mechanics.skill.maximumRank;}
      if(capacity<r.milestones.length)throw new DomainError(400,'INSUFFICIENT_PROFICIENCY_CAPACITY');
    }
  }
}
