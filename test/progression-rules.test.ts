import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addXP,progressionReadiness,validateProgressionCurve } from '../src/domains/progression-rules.js';
const curve={version:1 as const,thresholds:Array.from({length:25},(_,index)=>String(index*100))};
test('XP readiness respects exact boundaries and leaves committed choices unchanged',()=>{
  assert.deepEqual(progressionReadiness(curve,'99',1),{xp:'99',level:1,readyThroughLevel:1,pendingLevels:0,nextThreshold:'100'});
  assert.equal(progressionReadiness(curve,'100',1).pendingLevels,1);
  assert.deepEqual(progressionReadiness(curve,'2400',3),{xp:'2400',level:3,readyThroughLevel:25,pendingLevels:22,nextThreshold:null});
  assert.equal(progressionReadiness(curve,'999999',25).pendingLevels,0);
});
test('XP arithmetic remains exact above JavaScript safe integers and refuses overflow',()=>{
  assert.equal(addXP('9007199254740992','1'),'9007199254740993');
  assert.equal(addXP('9223372036854775806','1'),'9223372036854775807');
  assert.throws(()=>addXP('9223372036854775807','1'),{code:'XP_OVERFLOW'});
  assert.throws(()=>addXP('0','0'),{code:'EMPTY_XP_AWARD'});
  for(const invalid of ['-1','01','1.5','1e3',' 1','9223372036854775808',1,null]) assert.throws(()=>addXP('0',invalid as string),{code:'INVALID_XP_AMOUNT'});
});
test('curves require increasing integer thresholds with level one at zero',()=>{
  validateProgressionCurve(curve);
  const high={version:1 as const,thresholds:['0',...Array.from({length:24},(_,i)=>(9007199254740992n+BigInt(i)).toString())]};
  assert.equal(progressionReadiness(high,'9007199254740993',1).readyThroughLevel,3);
  for(const invalid of [null,[],{...curve,version:2},{...curve,extra:true},{version:1,thresholds:curve.thresholds.slice(0,24)},
    {version:1,thresholds:Array(1000).fill('0')},{...curve,thresholds:['1',...curve.thresholds.slice(1)]},
    {...curve,thresholds:['0','100','100',...curve.thresholds.slice(3)]},
    {...curve,thresholds:['0','200','100',...curve.thresholds.slice(3)]}]) assert.throws(()=>validateProgressionCurve(invalid));
});
test('readiness refuses impossible committed levels and XP below the committed threshold',()=>{
  for(const level of [0,-1,1.5,26,NaN]) assert.throws(()=>progressionReadiness(curve,'100',level),{code:'INVALID_PROGRESSION_STATE'});
  assert.throws(()=>progressionReadiness(curve,'99',2),{code:'INVALID_PROGRESSION_STATE'});
  assert.equal(progressionReadiness(curve,'100',2).pendingLevels,0);
});
