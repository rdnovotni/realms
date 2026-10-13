import { Ajv } from 'ajv';
import type { ContentEntity } from './content.js';
import { validateSkill,validateProficiencyRules,type ProficiencyRules } from './proficiency-content.js';
import { validateFeat,validateFeatRules,type FeatSpec,type FeatRules } from './feat-content.js';
import { DomainError } from '../foundation/errors.js';
export type ProficiencyRequirements={version:1;skills:{skillId:string;minimumRank:number}[]};
const validate=new Ajv({strict:true}).compile({type:'object',additionalProperties:false,required:['version','skills'],properties:{version:{type:'integer',const:1},skills:{type:'array',minItems:1,maxItems:8,items:{type:'object',additionalProperties:false,required:['skillId','minimumRank'],properties:{skillId:{type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'},minimumRank:{type:'integer',minimum:1,maximum:5}}}}}});
export function proficiencyRequirements(value:unknown):ProficiencyRequirements {
  if(!validate(value))throw new DomainError(400,'INVALID_PROFICIENCY_REQUIREMENTS');const r=value as ProficiencyRequirements;
  if(new Set(r.skills.map(s=>s.skillId)).size!==r.skills.length)throw new DomainError(400,'INVALID_PROFICIENCY_REQUIREMENTS');return r;
}
export function validateProficiencyRequirements(entities:Map<string,ContentEntity>){
  const profiles=[...entities.values()].filter(e=>e.definition.mechanics?.proficiencyRules!==undefined).map(e=>{validateProficiencyRules(e.definition.mechanics!.proficiencyRules);return e.definition.mechanics!.proficiencyRules as ProficiencyRules;});
  for(const e of entities.values()){
    const value=e.definition.mechanics?.proficiencyRequirements,isFeat=e.kind==='ABILITY' && e.definition.mechanics?.feat!==undefined;if(value===undefined && !isFeat)continue;
    if(!((e.kind==='ABILITY' && e.definition.mechanics?.feat!==undefined)||(e.kind==='ITEM' && e.definition.mechanics?.equipment!==undefined)))throw new DomainError(400,'INVALID_PROFICIENCY_REQUIREMENTS_KIND');
    const req=value===undefined?{skills:[]}:proficiencyRequirements(value),family=new Map<string,number>();
    for(const r of req.skills){const s=entities.get(r.skillId);if(s?.kind!=='SKILL' || !e.definition.dependencies.includes(r.skillId))throw new DomainError(400,'INVALID_PROFICIENCY_REQUIREMENT_REFERENCE');validateSkill(s.definition.mechanics?.skill);if(r.minimumRank>s.definition.mechanics.skill.maximumRank)throw new DomainError(400,'UNREACHABLE_PROFICIENCY_REQUIREMENT');family.set(r.skillId,r.minimumRank);}
    let buildRulesId:string|undefined;
    if(e.kind==='ABILITY'){
      validateFeat(e.definition.mechanics!.feat);const f=e.definition.mechanics!.feat as FeatSpec,r=entities.get(f.rulesId);validateFeatRules(r?.definition.mechanics?.featRules);buildRulesId=(r!.definition.mechanics!.featRules as FeatRules).buildRulesId;
      const seen=new Set<string>();const collect=(id:string)=>{if(seen.has(id))return;seen.add(id);const p=entities.get(id)!;const prior=p.definition.mechanics?.proficiencyRequirements;if(prior!==undefined)for(const s of proficiencyRequirements(prior).skills)family.set(s.skillId,Math.max(family.get(s.skillId)??0,s.minimumRank));for(const id of (p.definition.mechanics!.feat as FeatSpec).prerequisites.feats)collect(id);};collect(e.id);
    }
    if(family.size===0)continue;
    if(!profiles.some(p=>(buildRulesId===undefined || p.buildRulesId===buildRulesId) && [...family.keys()].every(id=>p.skillIds.includes(id)) && p.milestones.length>=[...family.values()].reduce((a,b)=>a+b,0)))throw new DomainError(400,'UNREACHABLE_PROFICIENCY_REQUIREMENT');
  }
}
