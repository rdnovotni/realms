import type { NoncombatView } from '../noncombat.js';
import type { Snapshot } from '../types.js';
export function noncombatFixture(snapshot:Snapshot,scene:string):NoncombatView{
 const costs={turns:1,worldTime:2,gold:'0',resources:[]};
 const base:NoncombatView={runId:snapshot.game.run.runId,revision:snapshot.game.run.revision,hasMore:false,obstacles:[{id:'activity.sluice',name:'The old sluice gate',complete:scene==='noncombat-resolved'}],selected:null};
 if(scene==='noncombat-empty'){base.obstacles=[];return base;}
 base.selected={id:'activity.sluice',name:'The old sluice gate',history:scene==='noncombat-resolved'?[{step:'release',outcome:'FAILED_FORWARD',consequence:'The keeper hears you. Take the longer reed path.'}]:[],state:{step:scene==='noncombat-resolved'?1:0,failed:scene==='noncombat-resolved',alert:scene==='noncombat-resolved'?2:0,complete:scene==='noncombat-resolved'},step:scene==='noncombat-resolved'?null:{id:'release',name:'Open the sluice',failure:{advance:true,alert:2,text:'The keeper hears you. Take the longer reed path.',costs:{...costs,turns:0,worldTime:0}}},approaches:scene==='noncombat-resolved'?[]:[
 {id:'lever',intent:'INTERACT',name:'Raise the counterweight',eligible:true,reason:null,costs,items:[],assistants:[{companionId:'npc.ally',name:'Mara',bonus:3}],companionId:null,check:{chance:{numerator:14,denominator:20},mode:'ACTIVE',breakdown:{attribute:'Strength',proficiency:2,difficulty:12,modifiers:[]}}},
 {id:'magic',intent:'ABILITY_USE',name:'Unseal with magic',eligible:true,reason:null,costs:{...costs,resources:[{key:'resource.mana',amount:2}]},items:[],assistants:[],companionId:null,check:{chance:{numerator:1,denominator:1},mode:'ACTIVE'}},
 {id:'tool',intent:'ITEM_USE',name:'Jam the gate with a wedge',eligible:true,reason:null,costs,items:[{id:'00000000-0000-4000-8000-000000000001',quantity:'2',name:'Iron wedge'}],assistants:[],companionId:null,check:{chance:{numerator:1,denominator:1},mode:'ACTIVE'}},
 {id:'skill',intent:'SKILL_CHECK',name:'Pick the release',eligible:false,reason:'PROFICIENCY_REQUIRED',costs,items:[],assistants:[],companionId:null,check:{chance:{numerator:0,denominator:1},mode:'ACTIVE'}}]};return base;
}
