import type { ContentEntity } from '../domains/content.js';
import { DomainError } from '../foundation/errors.js';
import { validatePrerequisite,prerequisiteKeys,type Prerequisite } from './prerequisites.js';
import { validateSharedCheck,type SharedCheck } from './checks.js';
import { validateEffectGraph,type EffectDefinition } from './effects.js';
import { validateCosts,validateRewards,type Costs,type Reward } from './settlement.js';
export type RuleAction={version:1;domain:'COMBAT'|'INTERACTION';prerequisite:Prerequisite;check:SharedCheck;costs:Costs;rewards:Reward[];effects:string[];retry:'NEVER'|'STATE_CHANGED'|'AFTER_TIME'|'PAID';retryTime:number;remove:null|{method:'CLEANSE'|'DISPEL'|'CURE'|'REMOVE_CURSE';power:number;tags:string[]}};
export function validateRuleAction(v:unknown):asserts v is RuleAction{
 const a=v as RuleAction;
 if(!a||Object.keys(a).sort().join(',')!=='check,costs,domain,effects,prerequisite,remove,retry,retryTime,rewards,version'||a.version!==1||!['COMBAT','INTERACTION'].includes(a.domain)||!['NEVER','STATE_CHANGED','AFTER_TIME','PAID'].includes(a.retry)||!Number.isInteger(a.retryTime)||a.retryTime<0||a.retryTime>100000||(a.retry==='AFTER_TIME')!==(a.retryTime>0)||!Array.isArray(a.effects)||a.effects.length>8||a.effects.some(id=>typeof id!=='string'||!/^[a-z][a-z0-9_.-]{2,119}$/.test(id))||new Set(a.effects).size!==a.effects.length)throw new DomainError(400,'INVALID_RULE_ACTION');
 validatePrerequisite(a.prerequisite);validateSharedCheck(a.check);validateCosts(a.costs);validateRewards(a.rewards);
 if(a.retry==='PAID'&&a.costs.turns===0&&a.costs.gold==='0'&&a.costs.resources.length===0)throw new DomainError(400,'FREE_RULE_RETRY');
 if(a.remove!==null&&(!a.remove||Object.keys(a.remove).sort().join(',')!=='method,power,tags'||!['CLEANSE','DISPEL','CURE','REMOVE_CURSE'].includes(a.remove.method)||!Number.isInteger(a.remove.power)||a.remove.power<1||a.remove.power>1000||!Array.isArray(a.remove.tags)||a.remove.tags.length<1||a.remove.tags.length>16||a.remove.tags.some(t=>typeof t!=='string'||!/^[a-z][a-z0-9_.-]{2,119}$/.test(t))))throw new DomainError(400,'INVALID_RULE_REMOVAL');
}
export function validateSharedContent(entities:Map<string,ContentEntity>){
 const definitions=new Map<string,EffectDefinition>();
 for(const e of entities.values())if(e.definition.mechanics?.sharedEffect!==undefined){if(e.kind!=='EFFECT'||e.definition.mechanics.tacticalRoundEffect!==undefined)throw new DomainError(400,'INVALID_SHARED_EFFECT_KIND');definitions.set(e.id,{id:e.id,revision:e.revision,spec:e.definition.mechanics.sharedEffect as unknown as EffectDefinition['spec']});}
 validateEffectGraph(definitions);
 for(const e of entities.values()){
  const m=e.definition.mechanics,p=m?.prerequisite;
  if(p!==undefined){if(!['CLASS','ITEM','RECIPE','NPC','ROUTE','QUEST','ACTIVITY','ENCOUNTER'].includes(e.kind))throw new DomainError(400,'INVALID_PREREQUISITE_KIND');validatePrerequisite(p);}
  const action=m?.sharedAction;if(action!==undefined){validateRuleAction(action);const a=action as unknown as RuleAction;
   if(a.domain==='COMBAT'?(e.kind!=='ENCOUNTER'||m?.tacticalCombat!==undefined||m?.combat!==undefined||a.costs.turns!==1||a.costs.rest!=='NONE'):!['ACTIVITY','NPC','ROUTE','QUEST','RECIPE'].includes(e.kind))throw new DomainError(400,'INVALID_RULE_DOMAIN');
   for(const id of [...a.effects,...a.rewards.filter(r=>r.kind!=='GOLD').map(r=>r.id),...(a.check.skill?[a.check.skill.slice(6)]:[])])if(!entities.has(id)||!e.definition.dependencies.includes(id))throw new DomainError(400,'INVALID_RULE_REFERENCE');
   for(const id of a.effects)if(!definitions.has(id))throw new DomainError(400,'INVALID_RULE_EFFECT');
   for(const r of a.rewards)if(r.kind==='ITEM'&&entities.get(r.id)?.kind!=='ITEM')throw new DomainError(400,'INVALID_RULE_REWARD_KIND');
  }
  for(const expression of [p,action?(action as unknown as RuleAction).prerequisite:undefined])if(expression){for(const key of prerequisiteKeys(expression as unknown as Prerequisite)){const prefix=key.split('.')[0];if(['class','skill','known','item','quest'].includes(prefix!)){const id=key.slice(prefix!.length+1),target=entities.get(id);if(!target||!e.definition.dependencies.includes(id)||(['class','skill','item','quest'].includes(prefix!)&&target.kind!==prefix!.toUpperCase()))throw new DomainError(400,'INVALID_PREREQUISITE_REFERENCE');}}}
  const effect=definitions.get(e.id);if(effect)for(const t of effect.spec.triggers)if(!e.definition.dependencies.includes(t.effectId))throw new DomainError(400,'INVALID_EFFECT_TRIGGER_REFERENCE');
 }
}
