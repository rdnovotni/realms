import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateContent } from '../src/domains/content.js';
import { noncombatPackage } from './noncombat-fixture.js';
import { resolveSharedCheck,sharedCheckChance,contestedChance } from '../src/rules/checks.js';
import { check } from './shared-rules-fixture.js';
test('M03 alternatives have a single owner and reject independent rewards, orphan methods and mismatched ability gates',()=>{
 const p=noncombatPackage();validateContent(p);
 for(const mutate of [(x:any)=>x.entities.find((e:any)=>e.id==='activity.magic').definition.mechanics.sharedAction.rewards.push({kind:'KNOWLEDGE',id:'lore.sluice',quantity:1}),(x:any)=>x.entities.find((e:any)=>e.id==='activity.sluice').definition.mechanics.noncombatObstacle.steps[0].approaches.push({...x.entities.find((e:any)=>e.id==='activity.sluice').definition.mechanics.noncombatObstacle.steps[0].approaches[0],id:'duplicate'}),(x:any)=>x.entities.find((e:any)=>e.id==='ability.unseal').definition.mechanics.noncombatAbility.minimumNativeLevel=5]){const q=structuredClone(p);mutate(q);assert.throws(()=>validateContent(q));}
});
test('contested preview enumerates the committed resolver with defender ties and advantage cancellation',()=>{
 const c={...check,naturalShift:false},actor={attributeScore:10,rank:0,canAttempt:true,modifiers:[]};
 assert.deepEqual(contestedChance(c,actor,c,actor),{numerator:190,denominator:400});let wins=0;for(let x=1;x<=20;x++)for(let y=1;y<=20;y++)if(resolveSharedCheck({...c,difficulty:resolveSharedCheck(c,actor,[y]).total+1},actor,[x]).success)wins++;
 assert.equal(wins,190);assert.deepEqual(sharedCheckChance({...c,advantage:true,disadvantage:true},actor),sharedCheckChance(c,actor));assert.deepEqual(sharedCheckChance({...c,mode:'PASSIVE',difficulty:10},actor),{numerator:1,denominator:1});
});
