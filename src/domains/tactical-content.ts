import { validateCleanseSpec,type CleanseAbility } from './tactical-cleansing.js';
import { validateRoundEffect,validateOnHitEffects,validatePeriodicGrants,normalizeEffectGrants,type EffectGrant,type OnHitEffects } from './tactical-effects.js';
import { validateDamageTraits,deriveDamageProfile,type DamageTraits } from './tactical-damage.js';
import { Ajv } from 'ajv';
import { DomainError } from '../foundation/errors.js';
import type { ContentEntity } from './content.js';
import { validateStats,type CharacterStats } from './character-mechanics.js';
import { startTactical,validateTacticalRules,type TacticalRules } from './tactical-engine.js';

export type TacticalSpec={version:1;ruleset:'TACTICAL_ENCOUNTER_V1';rules:TacticalRules;playerZone:string;allies:{id:string;definitionId:string;zone:string}[];enemies:{id:string;definitionId:string;zone:string}[];failure:{destination:'HOME';turnCost:number;recoveryHealth:number};campaignId?:string};
export type TacticalTemplate={version:1;stats:CharacterStats;canHeal:boolean;canGuard:boolean;damageTraits?:DamageTraits};
export type TacticalKit={version:1;minimumNativeLevel:number;heal:boolean;guard:boolean};
const ajv=new Ajv({strict:true});
const spawn={type:'object',additionalProperties:false,required:['id','definitionId','zone'],properties:{id:{type:'string',pattern:'^[a-z][a-z0-9_.-]{0,63}$'},definitionId:{type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'},zone:{type:'string'}}};
const encounter=ajv.compile({type:'object',additionalProperties:false,required:['version','ruleset','rules','playerZone','allies','enemies','failure'],properties:{version:{type:'integer',const:1},ruleset:{type:'string',const:'TACTICAL_ENCOUNTER_V1'},campaignId:{type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'},rules:{type:'object'},playerZone:{type:'string'},allies:{type:'array',maxItems:7,items:spawn},enemies:{type:'array',minItems:1,maxItems:8,items:spawn},failure:{type:'object',additionalProperties:false,required:['destination','turnCost','recoveryHealth'],properties:{destination:{type:'string',const:'HOME'},turnCost:{type:'integer',minimum:1,maximum:3},recoveryHealth:{type:'integer',minimum:1,maximum:1000000}}}}});
const template=ajv.compile({type:'object',additionalProperties:false,required:['version','stats','canHeal','canGuard'],properties:{version:{type:'integer',const:1},stats:{type:'object'},canHeal:{type:'boolean'},canGuard:{type:'boolean'},damageTraits:{type:'object'}}});
const kit=ajv.compile({type:'object',additionalProperties:false,required:['version','minimumNativeLevel','heal','guard'],properties:{version:{type:'integer',const:1},minimumNativeLevel:{type:'integer',minimum:0,maximum:999},heal:{type:'boolean'},guard:{type:'boolean'}}});
export function validateTacticalSpec(value:unknown):asserts value is TacticalSpec {
 if(!encounter(value))throw new DomainError(400,'INVALID_TACTICAL_SPEC');
 const s=value as TacticalSpec;validateTacticalRules(s.rules);
 if(s.rules.healManaCost===undefined||s.rules.guardArmorBonus===undefined||s.rules.retreatDifficulty===undefined||!s.rules.zones.includes(s.playerZone)||[...s.allies,...s.enemies].some(u=>!s.rules.zones.includes(u.zone))||new Set(['hero',...s.allies.map(u=>u.id),...s.enemies.map(u=>u.id)]).size!==1+s.allies.length+s.enemies.length)throw new DomainError(400,'INVALID_TACTICAL_SPEC');
}
export function validateTacticalTemplate(value:unknown):asserts value is TacticalTemplate {
 if(!template(value))throw new DomainError(400,'INVALID_TACTICAL_TEMPLATE');validateStats((value as TacticalTemplate).stats);
 const traits=(value as TacticalTemplate).damageTraits;if(traits){validateDamageTraits(traits);if(traits.minimumNativeLevel!==0)throw new DomainError(400,'INVALID_TACTICAL_TEMPLATE_DAMAGE_GATE');}
}
export function validateTacticalContent(entity:ContentEntity,entities:Map<string,ContentEntity>) {
 const m=entity.definition.mechanics;
 if(m?.tacticalDamageTraits!==undefined){
  validateDamageTraits(m.tacticalDamageTraits);const traits=m.tacticalDamageTraits;
  const isClass=entity.kind==='CLASS'&&m.classProgression!==undefined;
  if(m.combatModifiers===undefined||!(isClass||(entity.kind==='ABILITY'&&(m.feat!==undefined||m.subclass!==undefined))||(entity.kind==='ITEM'&&m.equipment!==undefined))||(!isClass&&traits.minimumNativeLevel!==0)||(isClass&&(traits.minimumNativeLevel<1||traits.minimumNativeLevel>(m.classProgression as {maximumNativeLevel:number}).maximumNativeLevel)))throw new DomainError(400,'INVALID_TACTICAL_DAMAGE_SOURCE');
 }
 if(m?.tacticalKit!==undefined){
  if(!kit(m.tacticalKit)||m.combatModifiers===undefined)throw new DomainError(400,'INVALID_TACTICAL_KIT');
  const k=m.tacticalKit as unknown as TacticalKit;
  const isClass=entity.kind==='CLASS'&&m.classProgression!==undefined;
  if(!(isClass||(entity.kind==='ABILITY'&&(m.feat!==undefined||m.subclass!==undefined))||(entity.kind==='ITEM'&&m.equipment!==undefined))||(!isClass&&k.minimumNativeLevel!==0)||(isClass&&(k.minimumNativeLevel<1||k.minimumNativeLevel>(m.classProgression as {maximumNativeLevel:number}).maximumNativeLevel)))throw new DomainError(400,'INVALID_TACTICAL_KIT_SOURCE');
 }
 if(m?.tacticalUnit!==undefined){if(!['NPC','MONSTER'].includes(entity.kind))throw new DomainError(400,'INVALID_TACTICAL_TEMPLATE_KIND');validateTacticalTemplate(m.tacticalUnit);}
 if(m?.tacticalCombat===undefined)return;
 if(entity.kind!=='ENCOUNTER'||m.combat!==undefined||typeof m.characterProfileId!=='string'||(m.encounter as {version?:number})?.version!==2)throw new DomainError(400,'INVALID_TACTICAL_ENCOUNTER');
 validateTacticalSpec(m.tacticalCombat);const s=m.tacticalCombat;
 const profile=entities.get(m.characterProfileId)?.definition.mechanics?.characterProfile as unknown as {base:CharacterStats};
 if(!profile||s.failure.recoveryHealth>profile.base.maxHealth)throw new DomainError(400,'INVALID_TACTICAL_RECOVERY');
 const units=[...s.allies.map(u=>({...u,side:'PARTY' as const})),...s.enemies.map(u=>({...u,side:'ENEMY' as const}))].map(u=>{
  const source=entities.get(u.definitionId);
  if(!source||source.kind!==(u.side==='PARTY'?'NPC':'MONSTER')||!entity.definition.dependencies.includes(source.id))throw new DomainError(400,'INVALID_TACTICAL_UNIT_REFERENCE');
  validateTacticalTemplate(source.definition.mechanics?.tacticalUnit);
  const t=source.definition.mechanics!.tacticalUnit as unknown as TacticalTemplate;
  const effectGrants=(field:'tacticalOnHitEffects'|'tacticalOnHealEffects')=>{
   const spec=source.definition.mechanics?.[field] as OnHitEffects|undefined;if(spec!==undefined)validateOnHitEffects(spec);
   return normalizeEffectGrants((spec?.effectIds??[]).map(effectId=>{
    const e=entities.get(effectId);validateRoundEffect(e?.definition.mechanics?.tacticalRoundEffect);
    return {effectId,effectRevision:e!.revision,sourceId:source.id,sourceRevision:source.revision,effect:e!.definition.mechanics!.tacticalRoundEffect} as EffectGrant;
   }));
  };
  const onHitEffects=s.rules.roundEffects?effectGrants('tacticalOnHitEffects'):undefined,onHealEffects=(s.rules.roundEffects?.version??0)>=2?effectGrants('tacticalOnHealEffects'):undefined;
  if(onHitEffects)validatePeriodicGrants(onHitEffects,s.rules.roundEffects!.version,s.rules.typedDamage?.types);
  if(onHealEffects)validatePeriodicGrants(onHealEffects,s.rules.roundEffects!.version,s.rules.typedDamage?.types);
  const cleansing=source.definition.mechanics?.tacticalCleansing;
  if(cleansing!==undefined)validateCleanseSpec(cleansing);
  const cleansingAbilities:CleanseAbility[]|undefined=s.rules.roundEffects?.version===3?(cleansing?[{id:source.id,sourceRevision:source.revision,sourceInstanceIds:[],spec:cleansing}]:[]):undefined;
  return {id:u.id,side:u.side,zone:u.zone,stats:t.stats,health:t.stats.maxHealth,strikes:0,state:'ACTIVE' as const,canHeal:t.canHeal,canGuard:t.canGuard,...(cleansingAbilities?{cleansingAbilities}:{}),...(onHitEffects?{onHitEffects}:{}),...(onHealEffects?{onHealEffects}:{}),...(s.rules.typedDamage?{damageProfile:deriveDamageProfile(s.rules.typedDamage,t.damageTraits?[{traits:t.damageTraits,nativeLevel:0}]:[])}:{})};
 });
 // Validate the full initial party and reject unbounded/invalid derived stats now.
 startTactical(s.rules,[{id:'hero',side:'PARTY',zone:s.playerZone,stats:profile.base,health:profile.base.maxHealth,strikes:0,state:'ACTIVE'},...units]);
}
