import test from 'node:test';
import assert from 'node:assert/strict';
import { readAppearance,saveAppearance } from '../client/appearance.js';
const storage=(initial:string|null=null)=>{let value=initial;return {getItem:()=>value,setItem:(_key:string,next:string)=>{value=next;}};};
test('appearance defaults to the implemented parchment theme with grain',()=>{assert.deepEqual(readAppearance(storage()),{theme:'parchment',texture:true});});
test('texture preference round trips without account or run state',()=>{const s=storage();saveAppearance({theme:'parchment',texture:false},s);assert.deepEqual(readAppearance(s),{theme:'parchment',texture:false});assert.deepEqual(JSON.parse(s.getItem()!),{theme:'parchment',texture:false});});
test('future themes and malformed preferences cannot select unavailable styling',()=>{for(const value of ['dark','light','minimal','high-contrast','retro-mud'])assert.deepEqual(readAppearance(storage(JSON.stringify({theme:value,texture:false}))),{theme:'parchment',texture:true});for(const raw of ['{','null','[]',JSON.stringify({theme:'parchment',texture:'false'}),' '.repeat(129)])assert.deepEqual(readAppearance(storage(raw)),{theme:'parchment',texture:true});});
test('denied cosmetic storage never interrupts play',()=>{const s={getItem(){throw Error('denied');},setItem(){throw Error('denied');}};assert.deepEqual(readAppearance(s),{theme:'parchment',texture:true});assert.doesNotThrow(()=>saveAppearance({theme:'parchment',texture:false},s));});
