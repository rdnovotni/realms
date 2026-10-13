import { Ajv } from 'ajv';
import type { ContentEntity } from './content.js';
import { validateBuildRules,validateNativeClass } from './build-content.js';
import { validateProgressionCurve } from './progression-rules.js';
import { DomainError } from '../foundation/errors.js';
export type FeatRules={version:1;ruleset:'FEAT_CHOICES_V1';buildRulesId:string;milestones:number[]};
export type FeatSpec={version:1;rulesId:string;access:'DISCOVERED';antiTaxReview:'PASS';prerequisites:{classes:{classId:string;nativeLevel:number}[];feats:string[]}};
const ajv=new Ajv({strict:true,allErrors:true}),id={type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'},level={type:'integer',minimum:1,maximum:999};
const rules=ajv.compile({type:'object',additionalProperties:false,required:['version','ruleset','buildRulesId','milestones'],properties:{version:{type:'integer',const:1},ruleset:{type:'string',const:'FEAT_CHOICES_V1'},buildRulesId:id,milestones:{type:'array',minItems:1,maxItems:32,uniqueItems:true,items:level}}});
const feat=ajv.compile({type:'object',additionalProperties:false,required:['version','rulesId','access','antiTaxReview','prerequisites'],properties:{version:{type:'integer',const:1},rulesId:id,access:{type:'string',const:'DISCOVERED'},antiTaxReview:{type:'string',const:'PASS'},prerequisites:{type:'object',additionalProperties:false,required:['classes','feats'],properties:{classes:{type:'array',maxItems:2,items:{type:'object',additionalProperties:false,required:['classId','nativeLevel'],properties:{classId:id,nativeLevel:level}}},feats:{type:'array',maxItems:8,uniqueItems:true,items:id}}}}});
export function validateFeatRules(value:unknown):asserts value is FeatRules {
  if(!rules(value))throw new DomainError(400,'INVALID_FEAT_RULES');
  const r=value as FeatRules;if(r.milestones.some((n,i)=>i>0 && n<=r.milestones[i-1]!))throw new DomainError(400,'INVALID_FEAT_RULES');
}
export function validateFeat(value:unknown):asserts value is FeatSpec {
  if(!feat(value))throw new DomainError(400,'INVALID_FEAT');
  const f=value as FeatSpec;if(new Set(f.prerequisites.classes.map(c=>c.classId)).size!==f.prerequisites.classes.length)throw new DomainError(400,'INVALID_FEAT');
}
export function validateFeatContent(entities:Map<string,ContentEntity>) {
  for(const entity of entities.values()) {
    const r=entity.definition.mechanics?.featRules,f=entity.definition.mechanics?.feat;
    if(r!==undefined) {
      if(entity.kind!=='TUNING')throw new DomainError(400,'INVALID_FEAT_RULES_KIND');validateFeatRules(r);
      const base=entities.get(r.buildRulesId);if(base?.kind!=='TUNING' || !entity.definition.dependencies.includes(base.id))throw new DomainError(400,'INVALID_FEAT_BUILD_RULES');
      validateBuildRules(base.definition.mechanics?.buildRules);const curve=entities.get(base.definition.mechanics.buildRules.curveId);validateProgressionCurve(curve?.definition.mechanics?.xpCurve);
      if(r.milestones.at(-1)!>(curve!.definition.mechanics!.xpCurve as {thresholds:string[]}).thresholds.length)throw new DomainError(400,'UNREACHABLE_FEAT_MILESTONE');
    }
    if(f!==undefined) {
      if(entity.kind!=='ABILITY' || entity.definition.mechanics?.subclass!==undefined)throw new DomainError(400,'INVALID_FEAT_KIND');validateFeat(f);
      const rule=entities.get(f.rulesId);if(rule?.kind!=='TUNING' || !entity.definition.dependencies.includes(rule.id))throw new DomainError(400,'INVALID_FEAT_RULES_REFERENCE');validateFeatRules(rule.definition.mechanics?.featRules);
      for(const c of f.prerequisites.classes) {
        const base=entities.get(c.classId);if(base?.kind!=='CLASS' || !entity.definition.dependencies.includes(base.id))throw new DomainError(400,'INVALID_FEAT_CLASS_REFERENCE');
        validateNativeClass(base.definition.mechanics?.classProgression);
        if(base.definition.mechanics.classProgression.maximumNativeLevel<c.nativeLevel || base.definition.mechanics.classProgression.rulesId!==rule.definition.mechanics.featRules.buildRulesId)throw new DomainError(400,'UNREACHABLE_FEAT_CLASS');
      }
      for(const prior of f.prerequisites.feats) {
        const p=entities.get(prior);if(p?.kind!=='ABILITY' || !entity.definition.dependencies.includes(prior))throw new DomainError(400,'INVALID_FEAT_PREREQUISITE');validateFeat(p.definition.mechanics?.feat);
        if(p.definition.mechanics.feat.rulesId!==f.rulesId)throw new DomainError(400,'INCOMPATIBLE_FEAT_RULES');
      }
    }
  }
  const visiting=new Set<string>(),depths=new Map<string,number>();
  const depth=(id:string):number=>{
    if(visiting.has(id))throw new DomainError(400,'CYCLIC_FEAT_PREREQUISITE');if(depths.has(id))return depths.get(id)!;
    visiting.add(id);const f=entities.get(id)!.definition.mechanics!.feat as FeatSpec;
    const d=f.prerequisites.feats.length?1+Math.max(...f.prerequisites.feats.map(depth)):0;visiting.delete(id);
    if(d>2)throw new DomainError(400,'EXCESSIVE_FEAT_CHAIN');depths.set(id,d);return d;
  };
  for(const e of entities.values())if(e.definition.mechanics?.feat!==undefined)depth(e.id);
  for(const e of entities.values())if(e.definition.mechanics?.feat!==undefined) {
    const family=new Set<string>(),classes=new Map<string,number>();
    const collect=(id:string)=>{if(family.has(id))return;family.add(id);const f=entities.get(id)!.definition.mechanics!.feat as FeatSpec;
      for(const c of f.prerequisites.classes)classes.set(c.classId,Math.max(classes.get(c.classId)??0,c.nativeLevel));
      for(const prior of f.prerequisites.feats)collect(prior);};collect(e.id);
    const f=e.definition.mechanics!.feat as FeatSpec,r=entities.get(f.rulesId)!.definition.mechanics!.featRules as FeatRules;
    const b=entities.get(r.buildRulesId)!.definition.mechanics!.buildRules as {curveId:string};
    const cap=(entities.get(b.curveId)!.definition.mechanics!.xpCurve as {thresholds:string[]}).thresholds.length;
    if(family.size>r.milestones.length || classes.size>2 || [...classes.values()].reduce((sum,n)=>sum+n,0)>cap)throw new DomainError(400,'UNREACHABLE_FEAT_PREREQUISITES');
  }
}
