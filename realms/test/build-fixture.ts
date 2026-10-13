import type { ContentPackage } from '../src/domains/content.js';
export const buildPackage:ContentPackage={version:'build-fixture',engineVersion:'foundation-1',entities:[
  {id:'curve.build',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'Fixture curve',dependencies:[],public:{},mechanics:{xpCurve:{version:1,thresholds:Array.from({length:25},(_,i)=>String(i*100))}}}},
  {id:'rules.build',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'Fixture build rules',dependencies:['curve.build'],public:{},mechanics:{buildRules:{version:1,ruleset:'CLASS_LEVELS_V1',curveId:'curve.build',maximumClasses:2,startingLuck:10,presets:[{key:'balanced',attributes:{strength:12,dexterity:11,constitution:10,intelligence:9,wisdom:8,charisma:7,luck:10}}]}}}},
  ...['one','two','three'].map(key=>({id:`class.${key}`,kind:'CLASS' as const,revision:1,schemaVersion:1,definition:{name:key,dependencies:['rules.build'],public:{},mechanics:{classProgression:{version:1,rulesId:'rules.build',access:'DISCOVERED',maximumNativeLevel:2}}}})),
  {id:'encounter.build',kind:'ENCOUNTER',revision:1,schemaVersion:1,definition:{name:'Fixture encounter',dependencies:['curve.build'],public:{},mechanics:{encounter:{version:1,turnCost:1},resolutionXP:{version:1,amount:'500',curveId:'curve.build'}}}}
]};
