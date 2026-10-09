import { Ajv } from 'ajv';
import { DomainError } from '../foundation/errors.js';
import type { ContentEntity } from './content.js';
import { attributes,validateBuildRules,type StartingAttributes } from './build-content.js';

// This contract is independent of BASIC_DUEL_V1; its formulas remain frozen.
export const combatStats = ['maxHealth','maxMana','accuracy','evasion','armor','initiative','attackMin','attackMax'] as const;
export type CombatStat = typeof combatStats[number];
export type CharacterStats = Record<CombatStat,number>;
export type CombatModifiers = {version:1; modifiers:{stat:CombatStat;amount:number;minimumNativeLevel:number}[]};
export type MechanicsSource = {entityId:string;revision:number;instanceId?:string;nativeLevel:number;spec:CombatModifiers};
export type StatBreakdown = {stats:CharacterStats;sources:{entityId:string;revision:number;instanceId?:string;stat:CombatStat;amount:number}[]};
const validate = new Ajv({strict:true,allErrors:true}).compile({
  type:'object',additionalProperties:false,required:['version','modifiers'],properties:{
    version:{type:'integer',const:1},modifiers:{type:'array',minItems:1,maxItems:32,items:{
      type:'object',additionalProperties:false,required:['stat','amount','minimumNativeLevel'],properties:{
        stat:{type:'string',enum:combatStats},amount:{type:'integer',minimum:-1000000,maximum:1000000},
        minimumNativeLevel:{type:'integer',minimum:0,maximum:999}
      }
    }}
  }
});
export function validateCombatModifiers(value:unknown):asserts value is CombatModifiers {
  if(!validate(value))throw new DomainError(400,'INVALID_COMBAT_MODIFIERS');
}
export function validateCharacterMechanics(entity:ContentEntity) {
  const spec=entity.definition.mechanics?.combatModifiers;if(spec===undefined)return;
  validateCombatModifiers(spec);
  const m=entity.definition.mechanics!;
  // Only an owned class, selected feat/subclass, or equipped item may contribute.
  const classSource=entity.kind==='CLASS' && m.classProgression!==undefined;
  const abilitySource=entity.kind==='ABILITY' && (m.feat!==undefined || m.subclass!==undefined);
  const equipmentSource=entity.kind==='ITEM' && m.equipment!==undefined;
  if(!classSource && !abilitySource && !equipmentSource)throw new DomainError(400,'INVALID_COMBAT_MODIFIER_SOURCE');
  if(!classSource && spec.modifiers.some(x=>x.minimumNativeLevel!==0))throw new DomainError(400,'INVALID_COMBAT_MODIFIER_LEVEL');
  if(classSource && spec.modifiers.some(x=>x.minimumNativeLevel<1 || x.minimumNativeLevel>(m.classProgression as {maximumNativeLevel:number}).maximumNativeLevel))throw new DomainError(400,'UNREACHABLE_COMBAT_MODIFIER');
}
export function validateStats(stats:CharacterStats) {
  if(!stats || Object.keys(stats).length!==combatStats.length || combatStats.some(k=>!Number.isSafeInteger(stats[k]) || Math.abs(stats[k])>1000000) ||
    stats.maxHealth<1 || stats.maxMana<0 || stats.armor<0 || stats.attackMin<1 || stats.attackMax<stats.attackMin)
    throw new DomainError(409,'INVALID_DERIVED_STATS');
}

export type CharacterProfile={version:1;ruleset:'CHARACTER_STATS_V1';buildRulesId:string;base:CharacterStats;scaling:{attribute:typeof attributes[number];stat:CombatStat;baseline:number;divisor:number;amount:number}[]};
const profileValidator=new Ajv({strict:true}).compile({type:'object',additionalProperties:false,required:['version','ruleset','buildRulesId','base','scaling'],properties:{
  version:{type:'integer',const:1},ruleset:{type:'string',const:'CHARACTER_STATS_V1'},buildRulesId:{type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'},
  base:{type:'object',additionalProperties:false,required:combatStats,properties:Object.fromEntries(combatStats.map(s=>[s,{type:'integer',minimum:-1000000,maximum:1000000}]))},
  scaling:{type:'array',maxItems:32,items:{type:'object',additionalProperties:false,required:['attribute','stat','baseline','divisor','amount'],properties:{attribute:{type:'string',enum:attributes},stat:{type:'string',enum:combatStats},baseline:{type:'integer',minimum:0,maximum:9999},divisor:{type:'integer',minimum:1,maximum:9999},amount:{type:'integer',minimum:-1000,maximum:1000}}}}
}});
export function validateCharacterProfile(value:unknown):asserts value is CharacterProfile {
  if(!profileValidator(value))throw new DomainError(400,'INVALID_CHARACTER_PROFILE');validateStats((value as CharacterProfile).base);
}
export function validateCharacterProfileReferences(entity:ContentEntity,entities:Map<string,ContentEntity>) {
  const profile=entity.definition.mechanics?.characterProfile;
  if(profile!==undefined) {
    if(entity.kind!=='TUNING')throw new DomainError(400,'INVALID_CHARACTER_PROFILE_KIND');validateCharacterProfile(profile);
    const rules=entities.get(profile.buildRulesId);
    if(rules?.kind!=='TUNING' || !entity.definition.dependencies.includes(rules.id))throw new DomainError(400,'INVALID_CHARACTER_PROFILE_BUILD');
    validateBuildRules(rules.definition.mechanics?.buildRules);
  }
  const profileId=entity.definition.mechanics?.characterProfileId;
  if(profileId!==undefined) {
    if(entity.kind!=='ENCOUNTER' || typeof profileId!=='string' || !entity.definition.dependencies.includes(profileId))throw new DomainError(400,'INVALID_ENCOUNTER_CHARACTER_PROFILE');
    if(entity.definition.mechanics?.combat!==undefined)throw new DomainError(400,'BASIC_COMBAT_PROFILE_CONFLICT');
    const target=entities.get(profileId);if(target?.kind!=='TUNING')throw new DomainError(400,'INVALID_ENCOUNTER_CHARACTER_PROFILE');
    validateCharacterProfile(target.definition.mechanics?.characterProfile);
  }
}
export function deriveProfileStats(profile:CharacterProfile,scores:StartingAttributes,sources:MechanicsSource[]) {
  validateCharacterProfile(profile);
  if(!scores || Object.keys(scores).length!==attributes.length || attributes.some(a=>!Number.isInteger(scores[a]) || scores[a]<1 || scores[a]>9999))throw new DomainError(409,'INVALID_CHARACTER_ATTRIBUTES');
  const base={...profile.base},scaling=profile.scaling.map(rule=>{
    const contribution=Math.floor((scores[rule.attribute]-rule.baseline)/rule.divisor)*rule.amount;
    base[rule.stat]+=contribution;return {...rule,score:scores[rule.attribute],contribution};
  });
  return {...deriveCharacterStats(base,sources),scaling};
}
/** Sources must be selected by the authoritative run loader, never a client body.
 * Item instance IDs distinguish two copies; one two-handed item contributes once.
 * Do not clamp invalid builds: reject them before creating an encounter snapshot.
 */
export function deriveCharacterStats(base:CharacterStats,input:MechanicsSource[]):StatBreakdown {
  validateStats(base);
  if(input.length>128)throw new DomainError(409,'EXCESSIVE_MECHANICS_SOURCES');
  const stats={...base},sources:StatBreakdown['sources']=[],seen=new Set<string>(),instances=new Set<string>();
  const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
  for(const source of [...input].sort((a,b)=>compare(a.entityId,b.entityId) || compare(a.instanceId??'',b.instanceId??''))) {
    if(!/^[a-z][a-z0-9_.-]{2,119}$/.test(source.entityId) || !Number.isInteger(source.revision) || source.revision<1 || source.revision>2147483647 || !Number.isInteger(source.nativeLevel) || source.nativeLevel<0 || source.nativeLevel>999 ||
      (source.instanceId!==undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(source.instanceId)))throw new DomainError(409,'INVALID_MECHANICS_SOURCE');
    const key=JSON.stringify([source.entityId,source.instanceId??null]);
    if(seen.has(key))throw new DomainError(409,'DUPLICATE_MECHANICS_SOURCE');seen.add(key);
    if(source.instanceId!==undefined) {
      if(instances.has(source.instanceId))throw new DomainError(409,'DUPLICATE_MECHANICS_SOURCE');
      instances.add(source.instanceId);
    }
    validateCombatModifiers(source.spec);
    for(const modifier of source.spec.modifiers) {
      if(source.nativeLevel<modifier.minimumNativeLevel)continue;
      stats[modifier.stat]+=modifier.amount;
      sources.push({entityId:source.entityId,revision:source.revision,...(source.instanceId===undefined?{}:{instanceId:source.instanceId}),stat:modifier.stat,amount:modifier.amount});
    }
  }
  validateStats(stats);return {stats,sources};
}

export type CheckRules={version:1;ruleset:'D20_CHECK_V1';attributeDivisor:number;attributeBaseline:number;proficiencyPerRank:number;natural20:'NORMAL'|'SUCCESS';natural1:'NORMAL'|'FAILURE'};
export type CheckInput={roll:number;attributeScore:number;proficiencyRank:number;situationalModifier:number;difficulty:number};
const checkRules=new Ajv({strict:true}).compile({type:'object',additionalProperties:false,required:['version','ruleset','attributeDivisor','attributeBaseline','proficiencyPerRank','natural20','natural1'],properties:{
  version:{type:'integer',const:1},ruleset:{type:'string',const:'D20_CHECK_V1'},attributeDivisor:{type:'integer',minimum:1,maximum:9999},attributeBaseline:{type:'integer',minimum:0,maximum:9999},proficiencyPerRank:{type:'integer',minimum:0,maximum:100},natural20:{type:'string',enum:['NORMAL','SUCCESS']},natural1:{type:'string',enum:['NORMAL','FAILURE']}
}});
export function validateCheckRules(value:unknown):asserts value is CheckRules {
  if(!checkRules(value))throw new DomainError(400,'INVALID_CHECK_RULES');
}
export function resolveCheck(rules:CheckRules,input:CheckInput) {
  validateCheckRules(rules);
  const {roll,attributeScore,proficiencyRank,situationalModifier,difficulty}=input;
  if(!Number.isInteger(roll)||roll<1||roll>20 || !Number.isInteger(attributeScore)||attributeScore<1||attributeScore>9999 ||
    !Number.isInteger(proficiencyRank)||proficiencyRank<0||proficiencyRank>5 || !Number.isInteger(situationalModifier)||Math.abs(situationalModifier)>1000000 || !Number.isInteger(difficulty)||Math.abs(difficulty)>1000000)
    throw new DomainError(409,'INVALID_CHECK_INPUT');
  const attribute=Math.floor((attributeScore-rules.attributeBaseline)/rules.attributeDivisor),proficiency=proficiencyRank*rules.proficiencyPerRank;
  const total=roll+attribute+proficiency+situationalModifier,margin=total-difficulty;
  const override=roll===20 && rules.natural20==='SUCCESS'?'SUCCESS':roll===1 && rules.natural1==='FAILURE'?'FAILURE':null;
  return {roll,attribute,proficiency,situationalModifier,total,difficulty,margin,override,success:override===null?margin>=0:override==='SUCCESS'};
}

export function checkSuccessChance(rules:CheckRules,input:Omit<CheckInput,'roll'>) {
  let successes=0;
  for(let roll=1;roll<=20;roll++)if(resolveCheck(rules,{...input,roll}).success)successes++;
  return {numerator:successes,denominator:20};
}
export type DamageRules={version:1;ruleset:'TACTICAL_DAMAGE_V1';check:CheckRules;criticalOn20:boolean;criticalMultiplierBps:number;minimumConnectedDamage:0|1};
const damageRules=new Ajv({strict:true}).compile({type:'object',additionalProperties:false,required:['version','ruleset','check','criticalOn20','criticalMultiplierBps','minimumConnectedDamage'],properties:{
  version:{type:'integer',const:1},ruleset:{type:'string',const:'TACTICAL_DAMAGE_V1'},check:{type:'object'},criticalOn20:{type:'boolean'},criticalMultiplierBps:{type:'integer',minimum:10000,maximum:40000},minimumConnectedDamage:{type:'integer',enum:[0,1]}
}});
export function validateDamageRules(value:unknown):asserts value is DamageRules {
  if(!damageRules(value))throw new DomainError(400,'INVALID_DAMAGE_RULES');
  validateCheckRules((value as DamageRules).check);
}
export type AttackInput={check:CheckInput;rawDamage:number;armor:number;penetration:number;resistanceBps:number};
/** Raw damage and d20 rolls come from the encounter journal. Armor applies before
 * typed resistance; negative resistance expresses vulnerability. Full immunity
 * overrides a minimum connected damage rule. No status effects execute here.
 */
export function resolveAttack(rules:DamageRules,input:AttackInput) {
  validateDamageRules(rules);
  if([input.rawDamage,input.armor,input.penetration].some(n=>!Number.isInteger(n)||n<0||n>1000000) ||
    !Number.isInteger(input.resistanceBps)||input.resistanceBps<-10000||input.resistanceBps>10000)throw new DomainError(409,'INVALID_ATTACK_INPUT');
  const check=resolveCheck(rules.check,input.check),critical=check.success && rules.criticalOn20 && input.check.roll===20;
  const rawDamage=check.success?Math.floor(input.rawDamage*(critical?rules.criticalMultiplierBps:10000)/10000):0;
  const effectiveArmor=Math.max(0,input.armor-input.penetration),afterArmor=Math.max(0,rawDamage-effectiveArmor);
  const afterResistance=Math.floor(afterArmor*(10000-input.resistanceBps)/10000);
  const damage=check.success && input.resistanceBps<10000?Math.max(rules.minimumConnectedDamage,afterResistance):0;
  return {check,critical,rawDamage,effectiveArmor,afterArmor,afterResistance,damage};
}
