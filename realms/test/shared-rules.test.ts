import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prerequisite,validatePrerequisite,type Prerequisite } from '../src/rules/prerequisites.js';
import { resolveSharedCheck,sharedCheckChance,contest,groupCheck } from '../src/rules/checks.js';
import { effectiveRule } from '../src/rules/modifiers.js';
import { effectTransition,validateEffect,validateEffectGraph,zeroClocks,clockKinds,effectCapabilities,type EffectDefinition } from '../src/rules/effects.js';
import { advanceLocalClocks,durationRemaining } from '../src/rules/clocks.js';
import { check,effect } from './shared-rules-fixture.js';
const actor={attributeScore:10,rank:0,modifiers:[],canAttempt:true};
test('structured prerequisites bound nesting, types and unknown negation',()=>{
 const p:Prerequisite={op:'ALL',args:[{op:'FACT',key:'level',test:'GTE',value:2},{op:'ANY',args:[{op:'FACT',key:'known.lore.test',test:'EQ',value:true},{op:'FACT',key:'class.class.test',test:'GTE',value:1}]}]};
 assert.equal(prerequisite(p,{level:2,'class.class.test':1}).met,true);assert.equal(prerequisite(p,{level:1,'class.class.test':1}).met,false);
 assert.equal(prerequisite({op:'NOT',arg:{op:'FACT',key:'flag.secret',test:'EQ',value:true}},{}).met,false);
 assert.equal(prerequisite({op:'FACT',key:'level',test:'GTE',value:1},{level:'9'}).met,false);
 assert.throws(()=>validatePrerequisite({op:'FACT',key:'__proto__',test:'EQ',value:true}));
 let deep:Prerequisite={op:'FACT',key:'level',test:'GTE',value:1};for(let i=0;i<10;i++)deep={op:'NOT',arg:deep};assert.throws(()=>validatePrerequisite(deep));
});
test('checks share degrees, bounded advantage, exact chances and impossible gates',()=>{
 assert.equal(resolveSharedCheck(check,actor,[20]).degree,'EXCEPTIONAL');assert.equal(resolveSharedCheck({...check,possibility:'IMPOSSIBLE'},actor,[]).success,false);
 assert.equal(resolveSharedCheck({...check,possibility:'AUTOMATIC'},actor,[]).success,true);assert.equal(resolveSharedCheck({...check,minimumRank:2},actor,[]).eligible,false);
 assert.equal(resolveSharedCheck({...check,advantage:true},actor,[2,19]).roll,19);assert.equal(resolveSharedCheck({...check,advantage:true,disadvantage:true},actor,[10]).roll,10);
 assert.equal(sharedCheckChance({...check,naturalShift:false},actor).numerator,9);assert.equal(sharedCheckChance({...check,naturalShift:false,advantage:true},actor).numerator,279);
 assert.equal(resolveSharedCheck({...check,mode:'PASSIVE'},actor,[]).total,10);assert.throws(()=>resolveSharedCheck(check,actor,[1,20]));
 assert.equal(contest(10,10),false);assert.equal(contest(10,10,'ATTACKER'),true);assert.equal(groupCheck('MAJORITY',[9,12,14],12).success,true);
 assert.equal(groupCheck('WEAKEST',[9,20],12).success,false);assert.equal(groupCheck('LEADER_ASSIST',[10,20],12,0,2).success,true);assert.throws(()=>groupCheck('LEADER_ASSIST',[10,20],12,0,99));
});
test('typed rule layers expose contributions and reject conflicting overrides',()=>{
 assert.equal(effectiveRule('damage',10,[{key:'damage',source:'base',layer:'BASE',operation:'ADD',value:2},{key:'damage',source:'path',layer:'PATH',operation:'MULTIPLY',value:20000},{key:'damage',source:'cap',layer:'EXPLICIT',operation:'CAP',value:20}]).value,20);
 assert.throws(()=>effectiveRule('x',true,[{key:'x',source:'a',layer:'PATH',operation:'ENABLE',value:true},{key:'x',source:'b',layer:'PATH',operation:'DISABLE',value:false}]));
});
test('all clocks expire only at declared boundaries; full rest implies rest',()=>{
 for(const clock of clockKinds){const spec={...effect,clock,...(clock==='CONDITIONAL'?{condition:{op:'FACT',key:'level',test:'GTE',value:1} as Prerequisite}:{}),...(clock==='REAL_TIME'?{deadlinePermission:'SHARED_INSTANCE' as const,modifiers:[]}:{} )};const defs=new Map([['effect.test',{id:'effect.test',revision:1,spec}]]),clocks=zeroClocks();const state=effectTransition([],defs,clocks,{level:1},{kind:'APPLY',ids:['effect.test'],source:'source.test',application:'a'}).effects;
  clocks.ADVENTURE_TURNS=clock==='ADVENTURE_TURNS'?0:100;assert.equal(effectTransition(state,defs,clocks,{level:1},{kind:'CLOCK'}).effects.length,1);clocks[clock]=100;
  assert.equal(effectTransition(state,defs,clocks,clock==='CONDITIONAL'?{level:0}:{level:1},{kind:'CLOCK'}).effects.length,clock==='UNTIL_CLEANSED'?1:0,clock);
 }
 assert.deepEqual(advanceLocalClocks({rounds:0,rests:0,fullRests:0},'FULL_REST'),{rounds:0,rests:1,fullRests:1});assert.equal(durationRemaining(2,3),0);assert.throws(()=>durationRemaining(2,-1));assert.throws(()=>validateEffect({...effect,clock:'REAL_TIME'}));
});
test('every stacking policy has explicit bounded behavior and provenance',()=>{
 for(const stacking of ['REPLACE','REFRESH','EXTEND','INTENSITY','STACKS','STRONGEST','INDEPENDENT','EXCLUSIVE'] as const){const defs=new Map([['effect.test',{id:'effect.test',revision:1,spec:{...effect,stacking}}]]),clocks=zeroClocks();const a=effectTransition([],defs,clocks,{}, {kind:'APPLY',ids:['effect.test'],source:'a',application:'1'});const b=effectTransition(a.effects,defs,clocks,{}, {kind:'APPLY',ids:['effect.test'],source:'b',application:'2'});assert.equal(b.effects.length,stacking==='INDEPENDENT'?2:1);if(stacking==='EXTEND')assert.equal(b.effects[0]!.expires,4);if(stacking==='INTENSITY')assert.equal(b.effects[0]!.magnitude,2);if(stacking==='STACKS')assert.equal(b.effects[0]!.stacks,2);if(stacking==='REPLACE')assert.equal(b.effects[0]!.source,'b');if(stacking==='REFRESH'||stacking==='EXCLUSIVE'||stacking==='STRONGEST')assert.equal(b.effects[0]!.source,'a');}
});
test('cleansing uses typed methods and power; trigger graphs reject cycles',()=>{
 const defs=new Map<string,EffectDefinition>([['effect.test',{id:'effect.test',revision:1,spec:{...effect,triggers:[{on:'REMOVE',effectId:'effect.child'}]}}],['effect.child',{id:'effect.child',revision:1,spec:{...effect,family:'effect.child',triggers:[]}}]]),clocks=zeroClocks();const a=effectTransition([],defs,clocks,{}, {kind:'APPLY',ids:['effect.test'],source:'a',application:'1'});
 assert.equal(effectTransition(a.effects,defs,clocks,{}, {kind:'REMOVE',method:'CURE',power:100,tags:['effect.beneficial']}).effects[0]!.id,'effect.test');
 const b=effectTransition(a.effects,defs,clocks,{}, {kind:'REMOVE',method:'DISPEL',power:1,tags:['effect.beneficial']});assert.equal(b.effects[0]!.id,'effect.child');defs.get('effect.child')!.spec.triggers=[{on:'APPLY',effectId:'effect.test'}];assert.throws(()=>validateEffectGraph(defs));
 assert.equal(effectCapabilities([{...a.effects[0]!,spec:{...effect,capabilities:[{key:'capability.act',enabled:false}]}}],{'capability.act':true})['capability.act'],false);
});

test('late clock reconciliation starts expiration triggers at the original boundary',()=>{
 const defs=new Map<string,EffectDefinition>([['effect.parent',{id:'effect.parent',revision:1,spec:{...effect,family:'effect.parent',triggers:[{on:'EXPIRE',effectId:'effect.child'}]}}],['effect.child',{id:'effect.child',revision:1,spec:{...effect,family:'effect.child'}}]]),clocks=zeroClocks();
 const state=effectTransition([],defs,clocks,{}, {kind:'APPLY',ids:['effect.parent'],source:'a',application:'1'}).effects;
 clocks.ADVENTURE_TURNS=20;const result=effectTransition(state,defs,clocks,{}, {kind:'CLOCK'});assert.equal(result.effects.length,0);assert.deepEqual(result.events.map(e=>e.kind),['EXPIRE','APPLY','EXPIRE']);
});
test('terminal encounter expires its round conditions without leaking to a new fight',()=>{
 const defs=new Map([['effect.round',{id:'effect.round',revision:1,spec:{...effect,clock:'ROUNDS' as const}}]]),clocks=zeroClocks();
 const state=effectTransition([],defs,clocks,{}, {kind:'APPLY',ids:['effect.round'],source:'a',application:'1'}).effects;
 assert.equal(effectTransition(state,defs,clocks,{}, {kind:'END_ENCOUNTER'}).effects.length,0);
});
