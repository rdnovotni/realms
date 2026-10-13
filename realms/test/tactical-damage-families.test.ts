import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveDamageProfile,validateTypedDamageRules,type TypedDamageRules,type DamageTraits } from '../src/domains/tactical-damage.js';
import { startTactical,stepTactical,type TacticalRules,type TacticalUnit } from '../src/domains/tactical-engine.js';
import { pulseRoundEffects } from '../src/domains/tactical-effects.js';
const vocabulary:TypedDamageRules={version:2,types:['slashing','piercing','fire','cold','force'],defaultType:'slashing',resistanceStacking:'SUM_CAPPED',families:{physical:['slashing','piercing'],elemental:['fire','cold'],magic:['fire','cold','force']}};
const contribution=(resistances:Record<string,number>,minimumNativeLevel=0,nativeLevel=0)=>({traits:{version:1,minimumNativeLevel,resistances} as DamageTraits,nativeLevel});
const rules:TacticalRules={damage:{version:1,ruleset:'TACTICAL_DAMAGE_V1',check:{version:1,ruleset:'D20_CHECK_V1',attributeDivisor:2,attributeBaseline:10,proficiencyPerRank:2,natural20:'SUCCESS',natural1:'NORMAL'},criticalOn20:false,criticalMultiplierBps:20000,minimumConnectedDamage:1},zones:['floor'],edges:[],attackRange:0,healRange:0,healAmount:2,roundLimit:5,typedDamage:vocabulary};
const unit=(id:string,side:TacticalUnit['side'],initiative:number):TacticalUnit=>({id,side,zone:'floor',health:30,strikes:0,state:'ACTIVE',stats:{maxHealth:30,maxMana:6,accuracy:20,evasion:10,armor:2,initiative,attackMin:10,attackMax:10}});
test('families expand into concrete defenses; overlapping families and direct traits sum once before capping',()=>{
 const sources=[contribution({elemental:8000,fire:-4000}),contribution({magic:5000,cold:-2000}),contribution({physical:-10000})],p=deriveDamageProfile(vocabulary,sources);
 assert.deepEqual(p.resistances,{fire:9000,cold:10000,force:5000,slashing:-10000,piercing:-10000});assert.deepEqual(deriveDamageProfile(vocabulary,[...sources].reverse()),p);
 assert.ok(!Object.hasOwn(p.resistances,'elemental'));assert.equal(p.attackType,'slashing');
});
test('locked family traits grant nothing but still validate their vocabulary; families cannot be attack types',()=>{
 assert.deepEqual(deriveDamageProfile(vocabulary,[contribution({physical:10000},5,4)]).resistances,{});
 assert.throws(()=>deriveDamageProfile(vocabulary,[contribution({unknown:10000},5,4)]),/UNKNOWN/);
 assert.throws(()=>deriveDamageProfile(vocabulary,[{traits:{version:1,minimumNativeLevel:0,attackType:'physical'},nativeLevel:0}]),/UNKNOWN/);
});
test('strict version-two memberships reject nesting, collisions, unknown/duplicate members, missing/empty families and unsafe names',()=>{
 for(const families of [{physical:['unknown']},{physical:['elemental'],elemental:['fire']},{fire:['fire']},{physical:['slashing','slashing']},{physical:[]},{}, {'Bad Name':['fire']}])assert.throws(()=>validateTypedDamageRules({...vocabulary,families}));
 const {families,...rest}=vocabulary as Extract<TypedDamageRules,{version:2}>;assert.throws(()=>validateTypedDamageRules(rest));assert.throws(()=>validateTypedDamageRules({...vocabulary,version:1}));
 assert.throws(()=>validateTypedDamageRules({...vocabulary,families:{physical:['slashing']},defaultType:'physical'}));
});
test('basic and selected attacks use resolved family defenses after guard armor/penetration; family immunity beats chip',()=>{
 for(const [resistance,expected] of [[5000,4],[10000,0],[-10000,16]] as const){
  const hero=unit('hero','PARTY',2),enemy=unit('enemy','ENEMY',1);enemy.damageProfile=deriveDamageProfile(vocabulary,[contribution({physical:resistance})]);
  const s=startTactical(rules,[hero,enemy]),result=stepTactical(rules,s,0,{actorId:'hero',kind:'ATTACK',targetId:'enemy',roll:20,rawDamage:10});assert.equal(result.evidence.attack!.damage,expected);
 }
 const hero=unit('hero','PARTY',2),enemy=unit('enemy','ENEMY',1);hero.attackAbilities=[{id:'class.strike',sourceRevision:1,sourceInstanceIds:[],spec:{version:1,minimumNativeLevel:1,range:0,manaCost:2,accuracyModifier:0,damage:{type:'piercing',min:10,max:10,penetration:3}}}];enemy.canGuard=true;enemy.damageProfile=deriveDamageProfile(vocabulary,[contribution({physical:5000})]);const r={...rules,abilities:{version:1 as const},guardArmorBonus:3},s=startTactical(r,[hero,enemy]);s.units[1]!.guardReady=true;
 const result=stepTactical(r,s,0,{actorId:'hero',kind:'USE_ABILITY',targetId:'enemy',abilityId:'class.strike',roll:20,rawDamage:10});assert.equal(result.evidence.attack!.effectiveArmor,2);assert.equal(result.evidence.attack!.damage,4);assert.equal(result.state.units[0]!.mana,4);
});
test('periodic damage consumes the same expanded family resistance without preventing the harmful condition',()=>{
 const owner=unit('enemy','ENEMY',1);owner.damageProfile=deriveDamageProfile(vocabulary,[contribution({elemental:10000})]);owner.effects=[{effectId:'effect.burning',effectRevision:1,sourceId:'class.one',sourceRevision:1,sourceUnitId:'hero',appliedRevision:1,remaining:2,effect:{version:2,clock:'ROUNDS',tick:'OWNER_END',family:'burning',stacking:'REFRESH',rounds:2,polarity:'HARMFUL',tags:['burning'],modifiers:[],periodic:{kind:'DAMAGE',timing:'OWNER_END',amount:5,damageType:'fire',armor:'BYPASS',penetration:0}}}];
 const events=pulseRoundEffects(owner,'OWNER_END');assert.equal(events[0]!.amount,0);assert.equal(events[0]!.resistanceBps,10000);assert.equal(owner.health,30);assert.equal(owner.effects.length,1);
});
test('version-one concrete derivation retains exact profiles and rejects family vocabulary',()=>{
 const old:TypedDamageRules={version:1,types:vocabulary.types,defaultType:'slashing',resistanceStacking:'SUM_CAPPED'};
 assert.deepEqual(deriveDamageProfile(old,[contribution({fire:5000,slashing:-1000})]),{version:1,attackType:'slashing',penetration:0,resistances:{fire:5000,slashing:-1000}});assert.throws(()=>deriveDamageProfile(old,[contribution({physical:5000})]),/UNKNOWN/);
});
