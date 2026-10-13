import test from 'node:test';
import assert from 'node:assert/strict';
import {startTactical,stepTactical,type TacticalRules,type TacticalUnit} from '../src/domains/tactical-engine.js';
const rules:TacticalRules={damage:{version:1,ruleset:'TACTICAL_DAMAGE_V1',check:{version:1,ruleset:'D20_CHECK_V1',attributeDivisor:2,attributeBaseline:10,proficiencyPerRank:2,natural20:'SUCCESS',natural1:'NORMAL'},criticalOn20:false,criticalMultiplierBps:20000,minimumConnectedDamage:1},zones:['floor','balcony','altar'],edges:[['floor','balcony'],['balcony','altar']],attackRange:0,healRange:1,healAmount:5,roundLimit:3};
function unit(id:string,side:TacticalUnit['side'],initiative:number):TacticalUnit{return {id,side,zone:'floor',health:10,strikes:0,state:'ACTIVE',stats:{maxHealth:10,maxMana:0,accuracy:5,evasion:10,armor:0,initiative,attackMin:10,attackMax:10}};}
const initial=()=>startTactical(rules,[unit('hero','PARTY',3),unit('healer','PARTY',2),unit('enemy','ENEMY',1)]);
test('initiative and budget renewal are deterministic; inputs remain untouched',()=>{
 const s=initial();assert.deepEqual(s.order,['hero','healer','enemy']);
 const moved=stepTactical(rules,s,0,{actorId:'hero',kind:'MOVE',zone:'balcony'}).state;
 assert.equal(s.units[0]!.zone,'floor');assert.equal(moved.budgets.hero!.quick,0);
 assert.throws(()=>stepTactical(rules,moved,1,{actorId:'hero',kind:'MOVE',zone:'floor'}),/ILLEGAL_TACTICAL_MOVE/);
 let next=stepTactical(rules,moved,1,{actorId:'hero',kind:'END'}).state;
 next=stepTactical(rules,next,2,{actorId:'healer',kind:'END'}).state;
 next=stepTactical(rules,next,3,{actorId:'enemy',kind:'END'}).state;
 assert.equal(next.round,2);assert.equal(next.budgets.hero!.quick,1);
});
test('wrong actor, stale revision and disconnected movement reject without mutation',()=>{
 const s=initial(),copy=structuredClone(s);
 assert.throws(()=>stepTactical(rules,s,1,{actorId:'hero',kind:'END'}),/STALE/);
 assert.throws(()=>stepTactical(rules,s,0,{actorId:'enemy',kind:'END'}),/NOT_TACTICAL_TURN/);
 assert.throws(()=>stepTactical(rules,s,0,{actorId:'hero',kind:'MOVE',zone:'altar'}),/ILLEGAL/);
 assert.deepEqual(s,copy);
});
test('victory is terminal and returned evidence reproduces the transition',()=>{
 const s=initial(),intent={actorId:'hero',kind:'ATTACK' as const,targetId:'enemy',roll:20,rawDamage:10};
 const result=stepTactical(rules,s,0,intent);assert.equal(result.state.outcome,'VICTORY');
 assert.deepEqual(stepTactical(rules,s,0,result.evidence.intent),result);
 assert.throws(()=>stepTactical(rules,result.state,1,{actorId:'hero',kind:'END'}),/RESOLVED/);
});
test('enemy uses same budgets; downed ally skips turn and can be healed',()=>{
 let s=initial();s=stepTactical(rules,s,0,{actorId:'hero',kind:'END'}).state;
 s=stepTactical(rules,s,1,{actorId:'healer',kind:'END'}).state;
 s=stepTactical(rules,s,2,{actorId:'enemy',kind:'ATTACK',targetId:'hero',roll:20,rawDamage:10}).state;
 assert.equal(s.units[0]!.state,'DOWNED');assert.equal(s.units[0]!.strikes,0);
 assert.throws(()=>stepTactical(rules,s,3,{actorId:'enemy',kind:'ATTACK',targetId:'healer',roll:20,rawDamage:10}),/MAIN_SPENT/);
 s=stepTactical(rules,s,3,{actorId:'enemy',kind:'END'}).state;assert.equal(s.order[s.cursor],'healer');
 s=stepTactical(rules,s,4,{actorId:'healer',kind:'HEAL',targetId:'hero'}).state;
 assert.equal(s.units[0]!.state,'ACTIVE');assert.equal(s.units[0]!.health,5);
});
test('ordinary healing cannot revive defeated targets; two separate connected strikes defeat',()=>{
 let s=initial();s.units[0]!.health=0;s.units[0]!.state='DOWNED';s.cursor=2;
 for(let hit=0;hit<2;hit++){
 s=stepTactical(rules,s,s.revision,{actorId:'enemy',kind:'ATTACK',targetId:'hero',roll:20,rawDamage:10}).state;
 if(hit===0){s=stepTactical(rules,s,s.revision,{actorId:'enemy',kind:'END'}).state;s=stepTactical(rules,s,s.revision,{actorId:'healer',kind:'END'}).state;}
 }
 assert.equal(s.units[0]!.state,'DEFEATED');s=stepTactical(rules,s,s.revision,{actorId:'enemy',kind:'END'}).state;
 assert.throws(()=>stepTactical(rules,s,s.revision,{actorId:'healer',kind:'HEAL',targetId:'hero'}),/INVALID_TACTICAL_TARGET/);
});
test('round limit terminates stalled encounters',()=>{
 let s=initial();while(s.outcome===null)s=stepTactical(rules,s,s.revision,{actorId:s.order[s.cursor]!,kind:'END'}).state;
 assert.equal(s.outcome,'FAILED_FORWARD');assert.equal(s.round,4);
});
test('healing requires an authored capability and sufficient mana, without partial mutation',()=>{
 const r={...rules,healManaCost:2},s=initial();s.units[0]!.canHeal=false;
 assert.throws(()=>stepTactical(r,s,0,{actorId:'hero',kind:'HEAL',targetId:'healer'}),/ILLEGAL_TACTICAL_HEAL/);
 s.units[0]!.canHeal=true;s.units[0]!.mana=1;const before=structuredClone(s);
 assert.throws(()=>stepTactical(r,s,0,{actorId:'hero',kind:'HEAL',targetId:'healer'}),/ILLEGAL_TACTICAL_HEAL/);assert.deepEqual(s,before);
});
test('incapacitated targets cannot spend defensive reactions',()=>{
 const r={...rules,guardArmorBonus:10},s=initial();s.cursor=2;s.units[0]!.health=0;s.units[0]!.state='DOWNED';s.units[0]!.canGuard=true;s.units[0]!.guardReady=true;
 const result=stepTactical(r,s,0,{actorId:'enemy',kind:'ATTACK',targetId:'hero',roll:20,rawDamage:10});
 assert.equal(result.evidence.attack!.effectiveArmor,0);assert.equal(result.state.budgets.hero!.reaction,1);assert.equal(result.state.units[0]!.strikes,1);
});

import { deriveDamageProfile,validateDamageTraits } from '../src/domains/tactical-damage.js';
const typed={...rules,typedDamage:{version:1 as const,types:['slashing','fire','cold'],defaultType:'slashing',resistanceStacking:'SUM_CAPPED' as const}};
const damageTraits=(value:Record<string,unknown>)=>({version:1 as const,minimumNativeLevel:0,...value});
test('typed armor penetration precedes matching resistance; misses, immunity and vulnerability retain exact integer rules',()=>{
 for(const [resistance,roll,expected] of [[5000,20,3],[10000,20,0],[-10000,20,12],[5000,1,0]]){
  const hero=unit('hero','PARTY',2),enemy=unit('enemy','ENEMY',1);enemy.stats.armor=6;
  hero.damageProfile=deriveDamageProfile(typed.typedDamage,[{traits:damageTraits({attackType:'fire',penetration:2}),nativeLevel:0}]);
  enemy.damageProfile=deriveDamageProfile(typed.typedDamage,[{traits:damageTraits({resistances:{fire:resistance,cold:10000}}),nativeLevel:0}]);
  const result=stepTactical(typed,startTactical(typed,[hero,enemy]),0,{actorId:'hero',kind:'ATTACK',targetId:'enemy',roll:roll!,rawDamage:10});
  assert.equal(result.evidence.attack!.damage,expected);assert.equal(result.evidence.damageType,'fire');assert.equal(result.evidence.attack!.effectiveArmor,4);
 }
});
test('typed resistance sums before capping, applies native gates and rejects ambiguous offense/overflow',()=>{
 const contributions=[damageTraits({resistances:{fire:9000}}),damageTraits({resistances:{fire:9000}}),damageTraits({resistances:{fire:-9000}})].map(traits=>({traits,nativeLevel:0}));
 const result=deriveDamageProfile(typed.typedDamage,contributions);
 assert.equal(result.resistances.fire,9000);assert.deepEqual(deriveDamageProfile(typed.typedDamage,contributions.reverse()),result);
 assert.equal(deriveDamageProfile(typed.typedDamage,[{traits:{...damageTraits({penetration:5}),minimumNativeLevel:5},nativeLevel:4}]).penetration,0);
 assert.equal(deriveDamageProfile(typed.typedDamage,[{traits:damageTraits({resistances:{fire:10000}}),nativeLevel:0},{traits:damageTraits({resistances:{fire:10000}}),nativeLevel:0}]).resistances.fire,10000);
 assert.throws(()=>deriveDamageProfile(typed.typedDamage,['fire','cold'].map(attackType=>({traits:damageTraits({attackType}),nativeLevel:0}))),/CONFLICTING/);
 assert.throws(()=>deriveDamageProfile(typed.typedDamage,[0,1].map(()=>({traits:damageTraits({penetration:1000000}),nativeLevel:0}))),/INVALID_TACTICAL_DAMAGE_PROFILE/);
});
test('damage vocabularies, numeric bounds, profile opt-in and unknown trait fields are validated',()=>{
 for(const bad of [{},damageTraits({resistances:{fire:10001}}),damageTraits({penetration:-1}),damageTraits({attackType:'fire',clientDamage:9})])assert.throws(()=>validateDamageTraits(bad));
 assert.throws(()=>deriveDamageProfile(typed.typedDamage,[{traits:damageTraits({attackType:'psychic'}),nativeLevel:0}]),/UNKNOWN/);
 const hero=unit('hero','PARTY',2);hero.damageProfile=deriveDamageProfile(typed.typedDamage,[]);
 assert.throws(()=>startTactical(rules,[hero,unit('enemy','ENEMY',1)]),/UNTYPED/);
 assert.throws(()=>startTactical({...typed,typedDamage:{...typed.typedDamage,defaultType:'psychic'}},[hero,unit('enemy','ENEMY',1)]),/INVALID_TACTICAL_DAMAGE_TYPE/);
});
test('guard mitigation and enemy attacks use the same typed pipeline; unrelated immunity gives no protection',()=>{
 const r={...typed,guardArmorBonus:5},hero=unit('hero','PARTY',1),enemy=unit('enemy','ENEMY',2);
 hero.canGuard=true;hero.guardReady=true;hero.stats.armor=3;
 hero.damageProfile=deriveDamageProfile(r.typedDamage,[{traits:damageTraits({resistances:{cold:10000,fire:5000}}),nativeLevel:0}]);
 enemy.damageProfile=deriveDamageProfile(r.typedDamage,[{traits:damageTraits({attackType:'fire',penetration:4}),nativeLevel:0}]);
 const s=startTactical(r,[hero,enemy]);s.units[0]!.guardReady=true;
 const result=stepTactical(r,s,0,{actorId:'enemy',kind:'ATTACK',targetId:'hero',roll:20,rawDamage:10});
 assert.equal(result.evidence.attack!.effectiveArmor,4);assert.equal(result.evidence.attack!.damage,3);assert.equal(result.state.budgets.hero!.reaction,0);
});
