import type { ContentPackage } from '../src/domains/content.js';
export function inventoryPackage():ContentPackage{return {version:'inventory-fixture',engineVersion:'foundation-1',entities:[
 {id:'item.ore',kind:'ITEM',revision:1,schemaVersion:1,definition:{name:'Copper ore',dependencies:[],public:{description:'A small testing material.',rarity:'COMMON'},mechanics:{inventory:{version:2,storageMode:'STACK',category:'MATERIAL',unitWeight:2,unitBulk:1,mundane:true}},secrets:{privateMarker:'not-for-clients'}}},
 {id:'rules.inventory',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'Test carrying',dependencies:[],public:{},mechanics:{inventoryRules:{version:1,baseWeight:10,weightPerStrength:1,baseBulk:10,bulkPerStrength:1,comfortableBps:10000,burdenedBps:12500,encumberedBps:15000,burdened:{initiative:-1,stealth:-1,mobility:-1},encumbered:{initiative:-3,stealth:-3,mobility:-3},stealthSkills:[],mobilitySkills:[]}}}},
 {id:'encounter.inventory',kind:'ENCOUNTER',revision:1,schemaVersion:1,definition:{name:'Test trail',dependencies:[],public:{},mechanics:{encounter:{version:1,turnCost:1}}}}
]};}
