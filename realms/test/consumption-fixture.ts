import type { ContentPackage } from '../src/domains/content.js';
import type { Consumable } from '../src/domains/consumption-content.js';
export const consumableSpec=(family:Consumable['family'],cost:number,turns:number):Consumable=>({version:1,family,costs:{fullness:family==='FOOD'?cost:0,drunkenness:family==='BOOZE'?cost:0,tolerance:family==='TOLERANCE'?cost:0},turns,quality:{reference:1,softness:100,maximumBonusBps:2500},automatic:true,rare:false});
export function consumptionPackage():ContentPackage{return {version:'consumption-fixture',engineVersion:'foundation-1',entities:([
 ['bread','FOOD',5,10],['wine','BOOZE',4,7],['tonic','TOLERANCE',3,2],['medicine','MEDICINE',0,0]
] as const).map(([id,family,cost,turns])=>({id:'item.'+id,kind:'ITEM',revision:1,schemaVersion:1,definition:{name:id,dependencies:[],public:{},mechanics:{inventory:{version:1,storageMode:'STACK',category:'CONSUMABLE'},itemUse:{version:2,kind:'USE',effects:[],rewards:[],consumption:consumableSpec(family,cost,turns)}}}}))};}
