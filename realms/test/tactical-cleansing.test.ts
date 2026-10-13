import test from 'node:test';
import assert from 'node:assert/strict';
import { startTactical,stepTactical,type TacticalRules,type TacticalUnit } from '../src/domains/tactical-engine.js';
import { normalizeCleanseAbilities,validateCleanseSpec,type CleanseAbility } from '../src/domains/tactical-cleansing.js';
import { validateRoundEffect,type ActiveRoundEffect,type RoundEffect } from '../src/domains/tactical-effects.js';
const rules:TacticalRules={damage:{version:1,ruleset:'TACTICAL_DAMAGE_V1',check:{version:1,ruleset:'D20_CHECK_V1',attributeDivisor:2,attributeBaseline:10,proficiencyPerRank:2,natural20:'SUCCESS',natural1:'NORMAL'},criticalOn20:false,criticalMultiplierBps:20000,minimumConnectedDamage:1},zones:['floor','tower'],edges:[],attackRange:0,healRange:0,healAmount:2,roundLimit:5,roundEffects:{version:3},typedDamage:{version:1,types:['fire'],defaultType:'fire',resistanceStacking:'SUM_CAPPED'}};
const ability=():CleanseAbility=>({id:'class.one',sourceRevision:1,sourceInstanceIds:[],spec:{version:1,minimumNativeLevel:1,method:'CURE',tags:['poison'],strength:4,manaCost:2,range:0,targetSide:'ALLY'}});
const effect=():RoundEffect=>({version:3,clock:'ROUNDS',tick:'OWNER_END',family:'poisoned',stacking:'REFRESH',rounds:3,polarity:'HARMFUL',tags:['poison','condition'],modifiers:[],periodic:{kind:'DAMAGE',timing:'OWNER_END',amount:5,damageType:'fire',armor:'BYPASS',penetration:0},removal:{method:'CURE',difficulty:4}});
const active=():ActiveRoundEffect=>({effectId:'effect.poisoned',effectRevision:2,sourceId:'monster.one',sourceRevision:3,sourceUnitId:'enemy',appliedRevision:0,remaining:3,effect:effect()});
const unit=(id:string,side:TacticalUnit['side'],initiative:number):TacticalUnit=>({id,side,zone:'floor',health:20,strikes:0,state:'ACTIVE',stats:{maxHealth:20,maxMana:6,accuracy:20,evasion:10,armor:0,initiative,attackMin:3,attackMax:3}});
function initial(){const hero=unit('hero','PARTY',2);hero.cleansingAbilities=[ability()];const s=startTactical(rules,[hero,unit('enemy','ENEMY',1)]);s.units[0]!.effects=[active()];return s;}
const cleanse=(s:ReturnType<typeof initial>,targetId='hero')=>stepTactical(rules,s,s.revision,{actorId:'hero',kind:'CLEANSE',targetId,abilityId:'class.one',effectId:'effect.poisoned'});
test('typed Cure at the strength boundary removes one selected effect, spends Main/mana and retains the full removed source',()=>{
 const s=initial(),copy=structuredClone(s),result=cleanse(s);assert.deepEqual(s,copy);assert.deepEqual(result.state.units[0]!.effects,[]);assert.equal(result.state.units[0]!.mana,4);assert.equal(result.state.budgets.hero!.main,0);assert.equal(result.state.units[0]!.health,20);
 const e=result.evidence.cleansingEvents![0]!;assert.equal(e.strength,e.difficulty);assert.deepEqual(e.removed,active());assert.equal(e.abilityRevision,1);assert.deepEqual(result.evidence.periodicEvents,[]);
 const end=stepTactical(rules,result.state,1,{actorId:'hero',kind:'END'});assert.equal(end.state.units[0]!.health,20);assert.deepEqual(end.evidence.periodicEvents,[]);assert.throws(()=>cleanse(result.state),/ILLEGAL/);
});
test('wrong channel/tags/strength, protected or old effects, absent abilities, range, side and mana reject without mutation',()=>{
 const mutations=[(s:ReturnType<typeof initial>)=>{s.units[0]!.cleansingAbilities![0]!.spec.method='CLEANSE';},(s:ReturnType<typeof initial>)=>{s.units[0]!.cleansingAbilities![0]!.spec.tags=['disease'];},(s:ReturnType<typeof initial>)=>{s.units[0]!.cleansingAbilities![0]!.spec.strength=3;},(s:ReturnType<typeof initial>)=>{const e=s.units[0]!.effects![0]!.effect;if(e.version===3)e.removal={method:'NONE',difficulty:0};},(s:ReturnType<typeof initial>)=>{s.units[0]!.mana=1;},(s:ReturnType<typeof initial>)=>{s.units[0]!.cleansingAbilities=[];},(s:ReturnType<typeof initial>)=>{s.units[0]!.effects![0]!.effect={version:2,clock:'ROUNDS',tick:'OWNER_END',family:'poisoned',stacking:'REFRESH',rounds:3,polarity:'HARMFUL',tags:['poison'],modifiers:[],periodic:{kind:'DAMAGE',timing:'OWNER_END',amount:5,damageType:'fire',armor:'BYPASS',penetration:0}};}];
 for(const mutate of mutations){const s=initial();mutate(s);const before=structuredClone(s);assert.throws(()=>cleanse(s),/ILLEGAL/);assert.deepEqual(s,before);}
 const s=initial();s.units[1]!.effects=[active()];assert.throws(()=>cleanse(s,'enemy'),/ILLEGAL/);s.units[0]!.cleansingAbilities![0]!.spec={...ability().spec,method:'DISPEL',targetSide:'ENEMY'};s.units[1]!.zone='tower';assert.throws(()=>cleanse(s,'enemy'),/ILLEGAL/);
});
test('Dispel removes an eligible enemy buff; cleansing an ally condition does not revive or erase Downed state',()=>{
 const s=initial();s.units[1]!.effects=[active()];const e=s.units[1]!.effects![0]!.effect;if(e.version===3)e.removal.method='DISPEL';e.polarity='BENEFICIAL';s.units[0]!.cleansingAbilities![0]!.spec={...ability().spec,method:'DISPEL',targetSide:'ENEMY'};const result=cleanse(s,'enemy');assert.deepEqual(result.state.units[1]!.effects,[]);
 const other=initial(),ally=unit('ally','PARTY',1);ally.health=0;ally.state='DOWNED';ally.effects=[active()];other.units.push(ally);other.budgets.ally={main:1,quick:1,reaction:1};const removed=cleanse(other,'ally');assert.equal(removed.state.units[2]!.state,'DOWNED');assert.equal(removed.state.units[2]!.health,0);assert.deepEqual(removed.state.units[2]!.effects,[]);
});
test('duplicate equipped copies normalize one ability without power stacking and retain deterministic instance provenance',()=>{
 const a=ability(),b=ability();a.sourceInstanceIds=['11111111-1111-1111-1111-111111111111'];b.sourceInstanceIds=['22222222-2222-2222-2222-222222222222'];const forward=normalizeCleanseAbilities([a,b]),reverse=normalizeCleanseAbilities([b,a]);assert.deepEqual(forward,reverse);assert.equal(forward.length,1);assert.equal(forward[0]!.spec.strength,4);assert.equal(forward[0]!.sourceInstanceIds.length,2);b.spec.strength=5;assert.throws(()=>normalizeCleanseAbilities([a,b]),/CONFLICTING/);
});
test('cleansing definitions require explicit version-three removal metadata and bounded typed ability contracts',()=>{
 for(const patch of [{manaCost:0},{strength:0},{method:'REMOVE_CURSE'},{targetSide:'ENEMY'},{tags:[]},{randomRoll:true}])assert.throws(()=>validateCleanseSpec({...ability().spec,...patch}),/INVALID/);
 for(const patch of [{version:2},{removal:{method:'NONE',difficulty:4}},{removal:{method:'CURE',difficulty:0}},{removal:{method:'REMOVE_CURSE',difficulty:4}},{removal:undefined}])assert.throws(()=>validateRoundEffect({...effect(),...patch}),/INVALID/);
 const hero=unit('hero','PARTY',2);hero.cleansingAbilities=[ability()];assert.throws(()=>startTactical({...rules,roundEffects:{version:2}},[hero,unit('enemy','ENEMY',1)]),/DISABLED/);
});
test('stale requests cannot remove effects and version-one/two states do not gain cleansing keys',()=>{
 const s=initial(),before=structuredClone(s);assert.throws(()=>stepTactical(rules,s,1,{actorId:'hero',kind:'CLEANSE',targetId:'hero',abilityId:'class.one',effectId:'effect.poisoned'}),/STALE/);assert.deepEqual(s,before);
 for(const version of [1,2] as const){const r={...rules,roundEffects:{version}},old=startTactical(r,[unit('hero','PARTY',2),unit('enemy','ENEMY',1)]);assert.ok(!Object.hasOwn(old.units[0]!,'cleansingAbilities'));assert.ok(!Object.hasOwn(stepTactical(r,old,0,{actorId:'hero',kind:'END'}).evidence,'cleansingEvents'));}
});
