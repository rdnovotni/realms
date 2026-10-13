import test from 'node:test';
import assert from 'node:assert/strict';
import { startTactical,stepTactical,type TacticalRules,type TacticalUnit } from '../src/domains/tactical-engine.js';
import { normalizeEffectGrants,validateRoundEffect,effectStats,type RoundEffect,type EffectGrant } from '../src/domains/tactical-effects.js';
const rules:TacticalRules={damage:{version:1,ruleset:'TACTICAL_DAMAGE_V1',check:{version:1,ruleset:'D20_CHECK_V1',attributeDivisor:2,attributeBaseline:10,proficiencyPerRank:2,natural20:'SUCCESS',natural1:'NORMAL'},criticalOn20:false,criticalMultiplierBps:20000,minimumConnectedDamage:1},zones:['floor','balcony'],edges:[['floor','balcony']],attackRange:1,healRange:1,healAmount:5,roundLimit:10,roundEffects:{version:1}};
export const effect=(patch:Partial<Extract<RoundEffect,{version:1}>>={}):RoundEffect=>({version:1,clock:'ROUNDS',tick:'OWNER_END',family:'exposed',stacking:'REFRESH',rounds:2,polarity:'HARMFUL',tags:['condition','physical'],modifiers:[{stat:'armor',amount:-4}],...patch});
const grant=(sourceId='item.sword',patch:Partial<Extract<RoundEffect,{version:1}>>={}):EffectGrant=>({effectId:'effect.exposed',effectRevision:1,sourceId,sourceRevision:1,effect:effect(patch)});
const unit=(id:string,side:TacticalUnit['side'],initiative:number):TacticalUnit=>({id,side,zone:'floor',health:100,strikes:0,state:'ACTIVE',stats:{maxHealth:100,maxMana:5,accuracy:20,evasion:10,armor:6,initiative,attackMin:8,attackMax:8}});
function initial(g=grant()) {const hero=unit('hero','PARTY',3);hero.onHitEffects=[g];return startTactical(rules,[hero,unit('ally','PARTY',2),unit('enemy','ENEMY',1)]);}
const attack=(s:ReturnType<typeof initial>,actorId='hero',roll=20)=>stepTactical(rules,s,s.revision,{actorId,kind:'ATTACK',targetId:'enemy',roll,rawDamage:8});
const end=(s:ReturnType<typeof initial>,actorId:string)=>stepTactical(rules,s,s.revision,{actorId,kind:'END'});
test('round condition changes the next attack, preserves base stats and ticks only at owner END',()=>{
 const original=initial(),first=attack(original);assert.equal(first.evidence.attack!.damage,2);assert.equal(first.state.units[2]!.effects![0]!.remaining,2);assert.deepEqual(original.units[2]!.effects,[]);
 let s=end(first.state,'hero').state;assert.equal(s.units[2]!.effects![0]!.remaining,2);
 const follow=attack(s,'ally');assert.equal(follow.evidence.attack!.effectiveArmor,2);assert.equal(follow.evidence.attack!.damage,6);assert.equal(follow.state.units[2]!.stats.armor,6);
 s=end(follow.state,'ally').state;
 s=stepTactical(rules,s,s.revision,{actorId:'enemy',kind:'MOVE',zone:'balcony'}).state;assert.equal(s.units[2]!.effects![0]!.remaining,2);
 const tick=end(s,'enemy');assert.equal(tick.state.units[2]!.effects![0]!.remaining,1);assert.equal(tick.evidence.effectEvents![0]!.kind,'TICKED');
 s=end(tick.state,'hero').state;s=end(s,'ally').state;const expired=end(s,'enemy');assert.deepEqual(expired.state.units[2]!.effects,[]);assert.equal(expired.evidence.effectEvents![0]!.kind,'EXPIRED');assert.equal(effectStats(expired.state.units[2]!).armor,6);
});
test('REFRESH keeps original magnitude and source; REPLACE swaps to the new application snapshot',()=>{
 for(const stacking of ['REFRESH','REPLACE'] as const){
  let s=initial(grant('class.one',{stacking}));s.units[1]!.onHitEffects=[grant('feat.vigor',{stacking,rounds:3,modifiers:[{stat:'armor',amount:-1}]})];
  s=attack(s).state;s=end(s,'hero').state;const result=attack(s,'ally'),active=result.state.units[2]!.effects![0]!;
  assert.equal(result.state.units[2]!.effects!.length,1);assert.equal(active.remaining,3);
  assert.equal(active.sourceId,stacking==='REFRESH'?'class.one':'feat.vigor');assert.equal(active.sourceUnitId,stacking==='REFRESH'?'hero':'ally');assert.equal(active.effect.modifiers[0]!.amount,stacking==='REFRESH'?-4:-1);
  assert.equal(result.evidence.effectEvents![0]!.kind,stacking==='REFRESH'?'REFRESHED':'REPLACED');assert.equal(active.appliedRevision,stacking==='REFRESH'?1:3);
  assert.equal(active.refreshedRevision,stacking==='REFRESH'?3:undefined);
 }
});
test('misses and incapacitating hits do not apply conditions; connected immunity uses the declared on-hit trigger',()=>{
 const s=initial();s.units[0]!.stats.accuracy=0;const missed=attack(s,'hero',1);assert.deepEqual(missed.state.units[2]!.effects,[]);assert.deepEqual(missed.evidence.effectEvents,[]);
 s.units[2]!.health=1;const killed=attack(s);assert.equal(killed.state.outcome,'VICTORY');assert.deepEqual(killed.state.units[2]!.effects,[]);
 const typed={...rules,typedDamage:{version:1 as const,types:['fire'],defaultType:'fire',resistanceStacking:'SUM_CAPPED' as const}},hero=unit('hero','PARTY',2),enemy=unit('enemy','ENEMY',1);hero.onHitEffects=[grant()];enemy.damageProfile={version:1,attackType:'fire',penetration:0,resistances:{fire:10000}};
 const result=stepTactical(typed,startTactical(typed,[hero,enemy]),0,{actorId:'hero',kind:'ATTACK',targetId:'enemy',roll:20,rawDamage:8});assert.equal(result.evidence.attack!.damage,0);assert.equal(result.state.units[1]!.effects!.length,1);
});
test('conditions affect accuracy, evasion, retreat and guarded armor with bounded effective values',()=>{
 const g=grant('class.one',{modifiers:[{stat:'accuracy',amount:-5},{stat:'evasion',amount:-2},{stat:'armor',amount:-1000}]}),s=attack(initial(g)).state;
 assert.equal(effectStats(s.units[2]!).armor,0);assert.equal(effectStats(s.units[2]!).accuracy,15);assert.equal(effectStats(s.units[2]!).evasion,8);
 s.cursor=2;const hit=stepTactical(rules,s,s.revision,{actorId:'enemy',kind:'ATTACK',targetId:'hero',roll:1,rawDamage:8});assert.equal(hit.evidence.attack!.check.situationalModifier,15);
 const hero=s.units[0]!;hero.effects=structuredClone(s.units[2]!.effects);hero.stats.accuracy=10;s.cursor=0;s.budgets.hero!.main=1;
 const retreat=stepTactical({...rules,retreatDifficulty:15},s,s.revision,{actorId:'hero',kind:'RETREAT',roll:9});assert.equal(retreat.state.outcome,null);
 hero.stats.evasion=1000000;hero.effects![0]!.effect.modifiers=[{stat:'evasion',amount:1000}];assert.equal(effectStats(hero).evasion,1000000);
});
test('unsupported effect hooks, clocks, implicit stacking and duplicate families reject',()=>{
 for(const patch of [{clock:'WORLD_TIME'},{stacking:'INDEPENDENT'},{rounds:0},{tick:'ROUND_END'},{control:'STUN'},{modifiers:[{stat:'maxHealth',amount:1}]},{modifiers:[{stat:'armor',amount:0}]},{modifiers:[{stat:'armor',amount:1},{stat:'armor',amount:-1}]}])assert.throws(()=>validateRoundEffect({...effect(),...patch}),/INVALID/);
 assert.throws(()=>normalizeEffectGrants([grant(),grant('class.one')]),/CONFLICTING/);
 assert.throws(()=>startTactical({...rules,roundEffects:undefined},[Object.assign(unit('hero','PARTY',2),{onHitEffects:[grant()]}),unit('enemy','ENEMY',1)]),/DISABLED/);
});
test('rejected actions preserve effect duration and unopted history retains the original shape',()=>{
 const s=attack(initial()).state,before=structuredClone(s);
 assert.throws(()=>attack(s),/MAIN_SPENT/);assert.throws(()=>stepTactical(rules,s,0,{actorId:'hero',kind:'END'}),/STALE/);assert.deepEqual(s,before);
 const r={...rules};delete r.roundEffects;const old=startTactical(r,[unit('hero','PARTY',2),unit('enemy','ENEMY',1)]);
 assert.ok(!Object.hasOwn(old.units[0]!,'effects'));assert.ok(!Object.hasOwn(old.units[0]!,'onHitEffects'));assert.ok(!Object.hasOwn(stepTactical(r,old,0,{actorId:'hero',kind:'END'}).evidence,'effectEvents'));
});
