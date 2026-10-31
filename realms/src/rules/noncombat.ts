import { checksum } from '../foundation/json.js';
import { DomainError } from '../foundation/errors.js';
import type { ContentEntity } from '../domains/content.js';
import { validateCosts,validateRewards,type Costs,type Reward } from './settlement.js';
import { validateSharedCheck,type SharedCheck,type CheckActor } from './checks.js';
import { validateRuleAction,type RuleAction } from './content.js';
export const noncombatIntents=['OBSERVE','INTERACT','SKILL_CHECK','CONTESTED_CHECK','ITEM_USE','ABILITY_USE','OBSTACLE_STEP'] as const;
export type NoncombatIntent=typeof noncombatIntents[number];
export type Approach={id:string;actionId:string;intent:NoncombatIntent;itemId:string|null;ability:null|{id:string;classId:string;minimumLevel:number};contest:null|{targetId:string;check:SharedCheck;actor:CheckActor};assistance:{companionId:string;bonus:number}[]};
export type ObstacleSpec={version:1;steps:{id:string;name:string;approaches:Approach[];failure:{advance:boolean;alert:number;flag:string;costs:Costs;effects:string[];text:string}}[];rewards:Reward[]};
const id=(x:unknown):x is string=>typeof x==='string'&&/^[a-z][a-z0-9_.-]{2,119}$/.test(x);
const keys=(v:object,s:string)=>Object.keys(v).sort().join(',')===s.split(',').sort().join(',');
export function validateObstacle(value:unknown):asserts value is ObstacleSpec{
 const v=value as ObstacleSpec;
 if(!v||!keys(v,'version,steps,rewards')||v.version!==1||!Array.isArray(v.steps)||v.steps.length<1||v.steps.length>8)throw new DomainError(400,'INVALID_OBSTACLE');
 validateRewards(v.rewards);const seen=new Set<string>();
 for(const s of v.steps){if(!s||!keys(s,'id,name,approaches,failure')||!id(s.id)||seen.has(s.id)||typeof s.name!=='string'||s.name.length<1||s.name.length>120||!Array.isArray(s.approaches)||!s.approaches.length||s.approaches.length>8)throw new DomainError(400,'INVALID_OBSTACLE_STEP');seen.add(s.id);
 const f=s.failure;if(!f||!keys(f,'advance,alert,flag,costs,effects,text')||typeof f.advance!=='boolean'||!Number.isInteger(f.alert)||f.alert<0||f.alert>10||!id(f.flag)||!Array.isArray(f.effects)||f.effects.length>8||f.effects.some(e=>!id(e))||typeof f.text!=='string'||f.text.length<1||f.text.length>500)throw new DomainError(400,'INVALID_OBSTACLE_FAILURE');validateCosts(f.costs);if(f.costs.rest!=='NONE')throw new DomainError(400,'OBSTACLE_REST_FORBIDDEN');
 const ids=new Set<string>();for(const a of s.approaches){if(!a||!keys(a,'id,actionId,intent,itemId,ability,contest,assistance')||!id(a.id)||ids.has(a.id)||!id(a.actionId)||!noncombatIntents.includes(a.intent)||!Array.isArray(a.assistance)||a.assistance.length>4||new Set(a.assistance.map(x=>x.companionId)).size!==a.assistance.length||a.assistance.some(x=>!keys(x,'companionId,bonus')||!id(x.companionId)||!Number.isInteger(x.bonus)||x.bonus<1||x.bonus>5))throw new DomainError(400,'INVALID_OBSTACLE_APPROACH');ids.add(a.id);
 if((a.intent==='ITEM_USE')!==(a.itemId!==null)||a.itemId!==null&&!id(a.itemId))throw new DomainError(400,'INVALID_OBSTACLE_ITEM');
 if((a.intent==='ABILITY_USE')!==(a.ability!==null)||a.ability!==null&&(!keys(a.ability,'id,classId,minimumLevel')||!id(a.ability.id)||!id(a.ability.classId)||!Number.isInteger(a.ability.minimumLevel)||a.ability.minimumLevel<1||a.ability.minimumLevel>100))throw new DomainError(400,'INVALID_OBSTACLE_ABILITY');
 if((a.intent==='CONTESTED_CHECK')!==(a.contest!==null))throw new DomainError(400,'INVALID_OBSTACLE_CONTEST');if(a.contest){if(!keys(a.contest,'targetId,check,actor')||!id(a.contest.targetId)||!keys(a.contest.actor,'attributeScore,rank,modifiers,canAttempt')||a.contest.actor.canAttempt!==true||!Array.isArray(a.contest.actor.modifiers))throw new DomainError(400,'INVALID_OBSTACLE_CONTEST');validateSharedCheck(a.contest.check);if(a.contest.check.possibility!=='ROLL'||a.contest.check.mode!=='ACTIVE'||a.contest.check.visibility!=='KNOWN'||!Number.isInteger(a.contest.actor.attributeScore)||a.contest.actor.attributeScore<1||a.contest.actor.attributeScore>9999||!Number.isInteger(a.contest.actor.rank)||a.contest.actor.rank<a.contest.check.minimumRank||a.contest.actor.rank>5||a.contest.actor.modifiers.length)throw new DomainError(400,'INVALID_OBSTACLE_CONTEST');}
 }
 }
}
export function validateNoncombatContent(entities:Map<string,ContentEntity>){
 const assigned=new Map<string,string>();
 const ref=(owner:ContentEntity,target:string,kind?:string)=>{const e=entities.get(target);if(!e||!owner.definition.dependencies.includes(target)||kind&&e.kind!==kind)throw new DomainError(400,'INVALID_OBSTACLE_REFERENCE');return e;};
 for(const e of entities.values()){const spec=e.definition.mechanics?.noncombatObstacle;if(spec===undefined)continue;validateObstacle(spec);if(e.kind!=='ACTIVITY'||e.definition.mechanics?.sharedAction!==undefined)throw new DomainError(400,'INVALID_OBSTACLE_OWNER');
 for(const r of spec.rewards)if(r.kind!=='GOLD')ref(e,r.id,r.kind==='ITEM'?'ITEM':undefined);
 for(const s of spec.steps){for(const effect of s.failure.effects){const target=ref(e,effect,'EFFECT');if(!target.definition.mechanics?.sharedEffect)throw new DomainError(400,'INVALID_OBSTACLE_EFFECT');}
 for(const a of s.approaches){const target=ref(e,a.actionId,'ACTIVITY');validateRuleAction(target.definition.mechanics?.sharedAction);const action=target.definition.mechanics!.sharedAction as unknown as RuleAction;
 if(assigned.has(a.actionId)||action.domain!=='INTERACTION'||action.rewards.length||action.costs.rest!=='NONE'||target.definition.mechanics?.dailyAllowance!==undefined||checksum(target.definition.mechanics?.noncombatApproach??null)!==checksum({version:1,obstacleId:e.id}))throw new DomainError(400,'INVALID_OBSTACLE_ACTION_OWNER');assigned.set(a.actionId,e.id);
 if(a.intent==='OBSERVE'&&action.check.mode!=='PASSIVE'||a.intent==='SKILL_CHECK'&&action.check.skill===null||a.contest&&(action.check.possibility!=='ROLL'||action.check.mode!=='ACTIVE'||action.check.naturalShift||a.contest.check.naturalShift))throw new DomainError(400,'INVALID_OBSTACLE_CHECK');
 if(a.itemId)ref(e,a.itemId,'ITEM');if(a.ability){const ability=ref(e,a.ability.id,'ABILITY');ref(e,a.ability.classId,'CLASS');const owned=ability.definition.mechanics?.noncombatAbility as any;if(!owned||owned.version!==1||owned.classId!==a.ability.classId||owned.minimumNativeLevel!==a.ability.minimumLevel||!ability.definition.dependencies.includes(a.ability.classId))throw new DomainError(400,'INVALID_NONCOMBAT_ABILITY_SOURCE');}if(a.contest)ref(e,a.contest.targetId,'NPC');for(const assist of a.assistance){const npc=ref(e,assist.companionId,'NPC');if(!npc.definition.mechanics?.companion)throw new DomainError(400,'INVALID_OBSTACLE_COMPANION');}
 }
 }
 }
 for(const e of entities.values())if(e.definition.mechanics?.noncombatApproach!==undefined&&!assigned.has(e.id))throw new DomainError(400,'ORPHAN_OBSTACLE_APPROACH');
}
