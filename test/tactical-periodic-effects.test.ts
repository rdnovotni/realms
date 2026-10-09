import test from 'node:test';
import assert from 'node:assert/strict';
import { startTactical,stepTactical,type TacticalRules,type TacticalUnit } from '../src/domains/tactical-engine.js';
import { validateRoundEffect,type RoundEffect,type EffectGrant,pulseRoundEffects } from '../src/domains/tactical-effects.js';
const rules:TacticalRules={damage:{version:1,ruleset:'TACTICAL_DAMAGE_V1',check:{version:1,ruleset:'D20_CHECK_V1',attributeDivisor:2,attributeBaseline:10,proficiencyPerRank:2,natural20:'SUCCESS',natural1:'NORMAL'},criticalOn20:false,criticalMultiplierBps:20000,minimumConnectedDamage:1},zones:['floor'],edges:[],attackRange:0,healRange:0,healAmount:2,healManaCost:1,roundLimit:5,roundEffects:{version:2},typedDamage:{version:1,types:['fire','slashing'],defaultType:'slashing',resistanceStacking:'SUM_CAPPED'}};
function effect(kind:'DAMAGE'|'HEAL',amount=4,rounds=2):RoundEffect {return {version:2,clock:'ROUNDS',tick:'OWNER_END',family:kind==='DAMAGE'?'burning':'regeneration',stacking:'REFRESH',rounds,polarity:kind==='DAMAGE'?'HARMFUL':'BENEFICIAL',tags:['condition'],modifiers:[],periodic:kind==='DAMAGE'?{kind,timing:'OWNER_END',amount,damageType:'fire',armor:'BYPASS',penetration:0}:{kind,timing:'OWNER_START',amount}};}
function grant(kind:'DAMAGE'|'HEAL',amount=4,rounds=2):EffectGrant {return {effectId:kind==='DAMAGE'?'effect.burning':'effect.regeneration',effectRevision:1,sourceId:'class.one',sourceRevision:1,effect:effect(kind,amount,rounds)};}
function unit(id:string,side:TacticalUnit['side'],initiative:number):TacticalUnit {return {id,side,zone:'floor',health:20,strikes:0,state:'ACTIVE',canHeal:true,stats:{maxHealth:20,maxMana:10,accuracy:20,evasion:10,armor:2,initiative,attackMin:3,attackMax:3}};}
function initial(amount=4,rounds=2){const hero=unit('hero','PARTY',3);hero.onHitEffects=[grant('DAMAGE',amount,rounds)];hero.onHealEffects=[grant('HEAL')];return startTactical(rules,[hero,unit('ally','PARTY',2),unit('enemy','ENEMY',1)]);}
const end=(s:ReturnType<typeof initial>,actorId:string)=>stepTactical(rules,s,s.revision,{actorId,kind:'END'});
const hit=(s:ReturnType<typeof initial>)=>stepTactical(rules,s,s.revision,{actorId:'hero',kind:'ATTACK',targetId:'enemy',roll:20,rawDamage:3});
test('DoT pulses at owner END before duration expires and records original source without extra rolls',()=>{
 let s=hit(initial(4,1)).state;assert.equal(s.units[2]!.health,19);assert.deepEqual(s.units[2]!.effects![0]!.effect.periodic,effect('DAMAGE',4,1).periodic);
 s=end(s,'hero').state;s=end(s,'ally').state;const result=end(s,'enemy');assert.equal(result.state.units[2]!.health,15);assert.deepEqual(result.state.units[2]!.effects,[]);
 assert.equal(result.evidence.periodicEvents![0]!.sourceUnitId,'hero');assert.equal(result.evidence.periodicEvents![0]!.sourceId,'class.one');assert.equal(result.evidence.periodicEvents![0]!.appliedRevision,1);assert.equal(result.evidence.periodicEvents![0]!.amount,4);assert.equal(result.evidence.effectEvents![0]!.kind,'EXPIRED');assert.equal(result.evidence.attack,null);
});
test('HoT starts on the next actual owner turn, caps health and does not tick on actions or reads',()=>{
 let s=initial();s.units[1]!.health=4;
 const applied=stepTactical(rules,s,0,{actorId:'hero',kind:'HEAL',targetId:'ally'});assert.equal(applied.state.units[1]!.health,6);assert.deepEqual(applied.evidence.periodicEvents,[]);
 const next=end(applied.state,'hero');assert.equal(next.state.units[1]!.health,10);assert.equal(next.evidence.periodicEvents![0]!.timing,'OWNER_START');assert.equal(next.state.units[1]!.effects![0]!.remaining,2);
 s=next.state;s.units[1]!.health=19;const events=pulseRoundEffects(s.units[1]!,'OWNER_START');assert.equal(s.units[1]!.health,20);assert.equal(events[0]!.healthAfter-events[0]!.healthBefore,1);
 s.units[1]!.state='DOWNED';s.units[1]!.health=0;assert.deepEqual(pulseRoundEffects(s.units[1]!,'OWNER_START'),[]);assert.equal(s.units[1]!.health,0);
});
test('periodic damage honors explicit armor/penetration then resistance, vulnerability and immunity without minimum chip or guarding',()=>{
 for(const [armorMode,penetration,resistance,expected] of [['APPLY',1,5000,2],['APPLY',0,10000,0],['BYPASS',0,-10000,10],['APPLY',0,0,3]] as const){
  let s=initial(5),g=s.units[0]!.onHitEffects![0]!;g.effect=effect('DAMAGE',5);if(g.effect.periodic?.kind==='DAMAGE'){g.effect.periodic.armor=armorMode;g.effect.periodic.penetration=penetration;}
  s=hit(s).state;s.units[2]!.damageProfile={version:1,attackType:'fire',penetration:0,resistances:{fire:resistance}};s.units[2]!.guardReady=true;s.units[2]!.canGuard=true;
  s=end(s,'hero').state;s=end(s,'ally').state;const result=end(s,'enemy');assert.equal(result.evidence.periodicEvents![0]!.amount,expected);assert.equal(result.state.budgets.enemy!.reaction,1);assert.equal(result.state.units[2]!.guardReady,true);
 }
 const s=hit(initial(1)).state,g=s.units[2]!.effects![0]!;if(g.effect.periodic?.kind==='DAMAGE')g.effect.periodic.armor='APPLY';assert.equal(pulseRoundEffects(s.units[2]!,'OWNER_END')[0]!.amount,0);
});
test('a lethal DoT resolves victory/Downed before turn advance and stops later pulses on an incapacitated owner',()=>{
 let s=hit(initial(100)).state;s=end(s,'hero').state;s=end(s,'ally').state;const victory=end(s,'enemy');assert.equal(victory.state.outcome,'VICTORY');assert.equal(victory.state.cursor,2);assert.equal(victory.state.units[2]!.state,'DEFEATED');assert.equal(victory.evidence.periodicEvents!.length,1);
 s=initial();const target=s.units[0]!;target.effects=[{...grant('DAMAGE',100),sourceUnitId:'enemy',appliedRevision:0,remaining:2},{...grant('DAMAGE',100),effectId:'effect.other',sourceUnitId:'enemy',appliedRevision:0,remaining:2}];const result=end(s,'hero');assert.equal(result.state.units[0]!.state,'DOWNED');assert.equal(result.state.order[result.state.cursor],'ally');assert.equal(result.evidence.periodicEvents!.length,1);assert.equal(result.state.units[0]!.effects![0]!.remaining,1);
});
test('refresh snapshots original periodic strength; replace changes it and rejected actions preserve both pulse and duration state',()=>{
 let s=hit(initial()).state;s.units[1]!.onHitEffects=[grant('DAMAGE',9)];s=end(s,'hero').state;
 const refreshed=stepTactical(rules,s,s.revision,{actorId:'ally',kind:'ATTACK',targetId:'enemy',roll:20,rawDamage:3});assert.equal(refreshed.state.units[2]!.effects![0]!.effect.periodic!.amount,4);assert.equal(refreshed.state.units[2]!.effects![0]!.sourceUnitId,'hero');
 const before=structuredClone(refreshed.state);assert.throws(()=>stepTactical(rules,refreshed.state,0,{actorId:'ally',kind:'END'}),/STALE/);assert.throws(()=>stepTactical(rules,refreshed.state,refreshed.state.revision,{actorId:'hero',kind:'END'}),/NOT_TACTICAL_TURN/);assert.deepEqual(refreshed.state,before);
 s=initial();s.units[0]!.onHitEffects![0]!.effect.stacking='REPLACE';s=hit(s).state;s=end(s,'hero').state;s.units[1]!.onHitEffects=[grant('DAMAGE',9)];s.units[1]!.onHitEffects![0]!.effect.stacking='REPLACE';const replaced=stepTactical(rules,s,s.revision,{actorId:'ally',kind:'ATTACK',targetId:'enemy',roll:20,rawDamage:3});assert.equal(replaced.state.units[2]!.effects![0]!.effect.periodic!.amount,9);assert.equal(replaced.state.units[2]!.effects![0]!.sourceUnitId,'ally');
});
test('invalid periodic definitions, unknown damage types and version-one opt-ins reject',()=>{
 for(const patch of [{version:1},{periodic:{kind:'DAMAGE',timing:'OWNER_START',amount:4,damageType:'fire',armor:'BYPASS',penetration:0}},{periodic:{kind:'DAMAGE',timing:'OWNER_END',amount:4,damageType:'fire',armor:'BYPASS',penetration:1}},{periodic:{kind:'HEAL',timing:'OWNER_START',amount:0}},{periodic:{kind:'HEAL',timing:'OWNER_START',amount:4,revive:true}}])assert.throws(()=>validateRoundEffect({...effect('DAMAGE'),...patch}),/INVALID/);
 const hero=unit('hero','PARTY',2);hero.onHitEffects=[grant('DAMAGE')];assert.throws(()=>startTactical({...rules,roundEffects:{version:1}},[hero,unit('enemy','ENEMY',1)]),/DISABLED/);assert.throws(()=>startTactical({...rules,typedDamage:undefined},[hero,unit('enemy','ENEMY',1)]),/INVALID_TACTICAL_PERIODIC_DAMAGE/);
});
