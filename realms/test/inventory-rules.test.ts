import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryPackage } from './inventory-fixture.js';
import { encumbrance,carryCheckPenalty,validateCarryRules,validateInventoryContent,type CarryRules } from '../src/domains/inventory-rules.js';
import { validateInventorySpec } from '../src/domains/item-accounting.js';
import { prepareInventoryEquipment,carryPercent,inventoryNumber } from '../client/inventory.js';
import type { InventoryItem,EquipmentPlan } from '../client/types.js';
const rules=()=>structuredClone(inventoryPackage().entities.find(e=>e.id==='rules.inventory')!.definition.mechanics!.inventoryRules) as CarryRules;
test('carry bands use exact inclusive boundaries and independent weight/bulk limits',()=>{
 const r=rules();
 for(const [weight,state]of [[100n,'COMFORTABLE'],[101n,'BURDENED'],[125n,'BURDENED'],[126n,'ENCUMBERED'],[150n,'ENCUMBERED'],[151n,'OVERLOADED']] as const)assert.equal(encumbrance(r,weight,0n,100n,100n).state,state);
 assert.equal(encumbrance(r,0n,151n,100n,100n).state,'OVERLOADED');
 const huge=9223372036854775807n*1000000000n;assert.equal(encumbrance(r,huge,0n,huge,1n).state,'COMFORTABLE');assert.equal(encumbrance(r,huge+1n,0n,huge,1n).state,'BURDENED');
 assert.equal(encumbrance(r,0n,0n,1n,1n,1).state,'UNMEASURED');assert.equal(carryPercent(huge.toString(),'1'),100);assert.match(inventoryNumber(huge.toString()),/[0-9]/);
});
test('publication refuses invented units, inverted bands and unowned capacity sources',()=>{
 assert.throws(()=>validateInventorySpec({version:'2',storageMode:'STACK',category:'MATERIAL',unitWeight:1,unitBulk:1,mundane:true}));
 assert.throws(()=>validateInventorySpec({version:2,storageMode:'STACK',category:'MATERIAL',unitWeight:-1,unitBulk:1,mundane:true}));
 const r=rules();r.encumberedBps=r.comfortableBps;assert.throws(()=>validateCarryRules(r));
 const p=inventoryPackage();p.entities[0]!.definition.mechanics!.inventoryCapacity={version:1,weight:10,bulk:10,minimumNativeLevel:0};assert.throws(()=>validateInventoryContent(new Map(p.entities.map(e=>[e.id,e]))));
 const doubled=inventoryPackage();doubled.entities.push({...structuredClone(doubled.entities[1]!),id:'rules.other'});assert.throws(()=>validateInventoryContent(new Map(doubled.entities.map(e=>[e.id,e]))));
});
test('grid equipment preview clears only conflicting positions and preserves other prepared sets',()=>{
 const item={id:'blade',equipment:{slots:['MAIN_HAND'],hands:2}} as InventoryItem;
 const before:EquipmentPlan={activeSet:'A',slots:[{set:'A',slot:'MAIN_HAND',itemId:'sword'},{set:'A',slot:'OFF_HAND',itemId:'shield'},{set:'B',slot:'OFF_HAND',itemId:'other'}]};
 const after=prepareInventoryEquipment(before,item,'A','MAIN_HAND',[]);assert.equal(before.slots.length,3);assert.deepEqual(after.slots,[{set:'B',slot:'OFF_HAND',itemId:'other'},{set:'A',slot:'MAIN_HAND',itemId:'blade'}]);
 assert.throws(()=>prepareInventoryEquipment(before,item,'WORN','MAIN_HAND',[]));
});

test('authored encumbrance skill modifiers match the canonical skill fact namespace',()=>{
 const r=rules();r.stealthSkills=['skill.sneak'];r.mobilitySkills=['skill.climb'];
 const load={enabled:true,rules:r,state:'BURDENED',penalties:r.burdened} as any;
 assert.deepEqual(carryCheckPenalty(load,'skill.skill.sneak'),[{source:'encumbrance:burdened',amount:-1}]);
 assert.deepEqual(carryCheckPenalty(load,'skill.skill.climb'),[{source:'encumbrance:burdened',amount:-1}]);
 assert.deepEqual(carryCheckPenalty(load,'skill.skill.lore'),[]);
});
