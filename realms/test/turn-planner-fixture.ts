import type { ContentPackage } from '../src/domains/content.js';
import { spec } from './shared-rules-fixture.js';
export function turnsPackage():ContentPackage{
 const paid=spec('INTERACTION');paid.costs={turns:2,worldTime:0,gold:'0',resources:[],rest:'NONE'};paid.rewards=[];paid.effects=[];paid.retry='PAID';paid.check={...paid.check,possibility:'AUTOMATIC'} as typeof paid.check;
 return {version:'turns-fixture',engineVersion:'foundation-1',entities:[
  {id:'activity.garden',kind:'ACTIVITY',revision:1,schemaVersion:1,definition:{name:'Garden harvest',dependencies:[],public:{},mechanics:{dailyAllowance:{version:1,refresh:1,capacity:3,banking:'BANK',turnBonus:5,autoCollect:true}}}},
  {id:'activity.strict',kind:'ACTIVITY',revision:1,schemaVersion:1,definition:{name:'Strict daily',dependencies:[],public:{},mechanics:{dailyAllowance:{version:1,refresh:1,capacity:1,banking:'RESET',turnBonus:1,autoCollect:false}}}},
  {id:'activity.work',kind:'ACTIVITY',revision:1,schemaVersion:1,definition:{name:'Extended work',dependencies:[],public:{},mechanics:{sharedAction:paid as any}}},
  {id:'activity.prayer',kind:'ACTIVITY',revision:1,schemaVersion:1,definition:{name:'Prayer',dependencies:[],public:{},mechanics:{sharedAction:{...paid,costs:{...paid.costs,turns:0}} as any,dailyAllowance:{version:1,refresh:1,capacity:3,banking:'BANK',turnBonus:0,autoCollect:false}}}}
 ]};
}
