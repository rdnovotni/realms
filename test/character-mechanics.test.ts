import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveCharacterStats,resolveCheck,checkSuccessChance,resolveAttack,validateDamageRules,validateCombatModifiers,validateCharacterMechanics,validateCheckRules,type CharacterStats,type MechanicsSource,type CheckRules,type DamageRules } from '../src/domains/character-mechanics.js';
import { validateContent,type ContentEntity } from '../src/domains/content.js';
const base:CharacterStats={maxHealth:100,maxMana:20,accuracy:5,evasion:12,armor:2,initiative:3,attackMin:4,attackMax:8};
const source=(entityId:string,stat:'armor'|'maxHealth'='armor',amount=2):MechanicsSource=>({entityId,revision:1,nativeLevel:1,spec:{version:1,modifiers:[{stat,amount,minimumNativeLevel:0}]}});
const rules:CheckRules={version:1,ruleset:'D20_CHECK_V1',attributeDivisor:2,attributeBaseline:10,proficiencyPerRank:2,natural20:'NORMAL',natural1:'NORMAL'};
test('derived stats add selected sources with revision evidence without mutating inputs',()=>{
  const inputs=[source('feat.health','maxHealth',20),source('item.mail')],before=structuredClone(inputs);
  const result=deriveCharacterStats(base,inputs);
  assert.equal(result.stats.maxHealth,120);assert.equal(result.stats.armor,4);
  assert.deepEqual(inputs,before);assert.equal(base.maxHealth,100);
  assert.deepEqual(result,deriveCharacterStats(base,[...inputs].reverse()));
  assert.deepEqual(result.sources[0],{entityId:'feat.health',revision:1,stat:'maxHealth',amount:20});
});
test('class modifiers unlock only at their authored native level',()=>{
  const classSource=source('class.guard');classSource.spec.modifiers[0]!.minimumNativeLevel=3;
  assert.equal(deriveCharacterStats(base,[classSource]).stats.armor,2);
  classSource.nativeLevel=3;assert.equal(deriveCharacterStats(base,[classSource]).stats.armor,4);
});
test('two item instances may contribute but a shared two-handed item cannot be counted twice',()=>{
  const a={...source('item.ring'),instanceId:'00000000-0000-0000-0000-000000000001'},b={...a,instanceId:'00000000-0000-0000-0000-000000000002'};
  assert.equal(deriveCharacterStats(base,[a,b]).stats.armor,6);
  assert.throws(()=>deriveCharacterStats(base,[a,a]),{code:'DUPLICATE_MECHANICS_SOURCE'});
  assert.throws(()=>deriveCharacterStats(base,[a,{...a,entityId:'item.other'}]),{code:'DUPLICATE_MECHANICS_SOURCE'});
  assert.throws(()=>deriveCharacterStats(base,[source('feat.guard'),source('feat.guard')]),{code:'DUPLICATE_MECHANICS_SOURCE'});
});
test('unsafe derived totals and invalid source identities reject without clamping',()=>{
  for(const invalid of [{...base,maxHealth:0},{...base,attackMin:9},{...base,maxMana:-1},{...base,accuracy:NaN}])assert.throws(()=>deriveCharacterStats(invalid,[]));
  assert.throws(()=>deriveCharacterStats(base,[source('feat.health','maxHealth',-100)]),{code:'INVALID_DERIVED_STATS'});
  assert.throws(()=>deriveCharacterStats(base,[source('feat.health','maxHealth',1000000)]),{code:'INVALID_DERIVED_STATS'});
  for(const invalid of [{...source('feat.guard'),revision:0},{...source('feat.guard'),nativeLevel:1.5},{...source('feat.guard'),instanceId:'bad'}])assert.throws(()=>deriveCharacterStats(base,[invalid]),{code:'INVALID_MECHANICS_SOURCE'});
});
test('modifier schemas reject unknown stats, fractional values and arbitrary properties',()=>{
  for(const invalid of [null,{version:2,modifiers:[]},{version:1,modifiers:[]},{version:1,modifiers:[{stat:'gold',amount:1,minimumNativeLevel:0}]},
    {version:1,modifiers:[{stat:'armor',amount:1.1,minimumNativeLevel:0}]},{...source('feat.guard').spec,extra:true}])assert.throws(()=>validateCombatModifiers(invalid));
});
test('publication rejects unsupported modifier sources and check rules on non-tuning entities',()=>{
  const entity:ContentEntity={id:'npc.guard',kind:'NPC',revision:1,schemaVersion:1,definition:{name:'Guard',dependencies:[],public:{},mechanics:{combatModifiers:source('feat.guard').spec}}};
  assert.throws(()=>validateContent({version:'mechanics-test',engineVersion:'1',entities:[entity]}),{code:'INVALID_COMBAT_MODIFIER_SOURCE'});
  entity.definition.mechanics={checkRules:rules};
  assert.throws(()=>validateContent({version:'mechanics-test',engineVersion:'1',entities:[entity]}),{code:'INVALID_CHECK_RULES_KIND'});
  entity.kind='TUNING';validateContent({version:'mechanics-test',engineVersion:'1',entities:[entity]});
});
test('only class sources may gate a modifier on native level and unreachable gates reject',()=>{
  const entity:ContentEntity={id:'class.guard',kind:'CLASS',revision:1,schemaVersion:1,definition:{name:'Guard',dependencies:[],public:{},mechanics:{classProgression:{maximumNativeLevel:2},combatModifiers:{version:1,modifiers:[{stat:'armor',amount:1,minimumNativeLevel:3}]}}}};
  assert.throws(()=>validateCharacterMechanics(entity),{code:'UNREACHABLE_COMBAT_MODIFIER'});
  entity.kind='ABILITY';entity.definition.mechanics!.feat={};
  assert.throws(()=>validateCharacterMechanics(entity),{code:'INVALID_COMBAT_MODIFIER_LEVEL'});
});
test('checks expose exact contributions and success at the DC boundary',()=>{
  const result=resolveCheck(rules,{roll:10,attributeScore:14,proficiencyRank:2,situationalModifier:-1,difficulty:15});
  assert.deepEqual(result,{roll:10,attribute:2,proficiency:4,situationalModifier:-1,total:15,difficulty:15,margin:0,override:null,success:true});
  assert.equal(resolveCheck(rules,{roll:10,attributeScore:9,proficiencyRank:0,situationalModifier:0,difficulty:10}).attribute,-1);
});
test('natural one is not a universal miss and natural twenty is not an implicit success',()=>{
  assert.equal(resolveCheck(rules,{roll:1,attributeScore:30,proficiencyRank:5,situationalModifier:0,difficulty:10}).success,true);
  assert.equal(resolveCheck(rules,{roll:20,attributeScore:10,proficiencyRank:0,situationalModifier:0,difficulty:30}).success,false);
  assert.equal(resolveCheck({...rules,natural20:'SUCCESS'},{roll:20,attributeScore:10,proficiencyRank:0,situationalModifier:0,difficulty:30}).override,'SUCCESS');
  assert.equal(resolveCheck({...rules,natural1:'FAILURE'},{roll:1,attributeScore:30,proficiencyRank:5,situationalModifier:0,difficulty:10}).success,false);
});
test('checks reject malformed tuning, impossible ranks, rolls and nonfinite modifiers',()=>{
  for(const invalid of [{...rules,attributeDivisor:0},{...rules,proficiencyPerRank:1.2},{...rules,expression:'execute()'}])assert.throws(()=>validateCheckRules(invalid));
  const input={roll:10,attributeScore:10,proficiencyRank:0,situationalModifier:0,difficulty:10};
  for(const patch of [{roll:0},{roll:21},{roll:1.5},{attributeScore:0},{proficiencyRank:6},{situationalModifier:Infinity},{difficulty:NaN}])assert.throws(()=>resolveCheck(rules,{...input,...patch}),{code:'INVALID_CHECK_INPUT'});
});
test('displayed hit chance exactly enumerates the rules including natural overrides',()=>{
  const input={attributeScore:10,proficiencyRank:0,situationalModifier:0,difficulty:11};
  assert.deepEqual(checkSuccessChance(rules,input),{numerator:10,denominator:20});
  assert.deepEqual(checkSuccessChance(rules,{...input,difficulty:21}),{numerator:0,denominator:20});
  assert.deepEqual(checkSuccessChance({...rules,natural20:'SUCCESS'},{...input,difficulty:21}),{numerator:1,denominator:20});
  assert.deepEqual(checkSuccessChance({...rules,natural1:'FAILURE'},{...input,difficulty:0}),{numerator:19,denominator:20});
});
const damage:DamageRules={version:1,ruleset:'TACTICAL_DAMAGE_V1',check:rules,criticalOn20:true,criticalMultiplierBps:20000,minimumConnectedDamage:0};
const attack={check:{roll:15,attributeScore:10,proficiencyRank:0,situationalModifier:0,difficulty:10},rawDamage:20,armor:8,penetration:3,resistanceBps:5000};
test('attack resolution applies connection then armor penetration then typed resistance',()=>{
  const result=resolveAttack(damage,attack);
  assert.equal(result.effectiveArmor,5);assert.equal(result.afterArmor,15);assert.equal(result.afterResistance,7);assert.equal(result.damage,7);
  assert.equal(resolveAttack(damage,{...attack,resistanceBps:-5000}).damage,22);
  assert.equal(resolveAttack(damage,{...attack,penetration:100}).effectiveArmor,0);
});
test('crits require a connected attack and obey authored multipliers',()=>{
  const critical=resolveAttack(damage,{...attack,check:{...attack.check,roll:20}});
  assert.equal(critical.critical,true);assert.equal(critical.rawDamage,40);assert.equal(critical.damage,17);
  const miss=resolveAttack(damage,{...attack,check:{...attack.check,roll:20,difficulty:100}});
  assert.equal(miss.critical,false);assert.equal(miss.damage,0);
  assert.equal(resolveAttack({...damage,criticalOn20:false},{...attack,check:{...attack.check,roll:20}}).rawDamage,20);
});
test('full immunity overrides minimum damage and misses never produce chip damage',()=>{
  assert.equal(resolveAttack({...damage,minimumConnectedDamage:1},{...attack,resistanceBps:10000}).damage,0);
  assert.equal(resolveAttack({...damage,minimumConnectedDamage:1},{...attack,armor:100}).damage,1);
  assert.equal(resolveAttack(damage,{...attack,armor:100}).damage,0);
  assert.equal(resolveAttack({...damage,minimumConnectedDamage:1},{...attack,check:{...attack.check,roll:1}}).damage,0);
});
test('attack contracts reject invalid tuning and out of range damage parameters',()=>{
  for(const invalid of [{...damage,criticalMultiplierBps:9999},{...damage,check:{...rules,attributeDivisor:0}},{...damage,minimumConnectedDamage:2},{...damage,extra:true}])assert.throws(()=>validateDamageRules(invalid));
  for(const patch of [{rawDamage:-1},{armor:Infinity},{penetration:0.1},{resistanceBps:10001},{resistanceBps:-10001}])assert.throws(()=>resolveAttack(damage,{...attack,...patch}),{code:'INVALID_ATTACK_INPUT'});
});
