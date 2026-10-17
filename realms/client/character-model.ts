import type { Progression,Snapshot } from './types.js';
export const characterAttributes=['strength','dexterity','constitution','intelligence','wisdom','charisma','luck'] as const;
export const characterLabel=(text:string)=>text.toLowerCase().split(/[_ .-]/).filter(Boolean).map(s=>s[0]!.toUpperCase()+s.slice(1)).join(' ');
const decimal=(value:unknown)=>typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)?BigInt(value):null;
export function exactXP(value:string){return decimal(value)?.toLocaleString()??'Unavailable';}
/** Earned XP levels and committed build levels are deliberately separate. */
export function characterXP(p:Progression){
 const total=decimal(p.xp),r=p.readiness,earned=r?.readyThroughLevel??(r?p.level+r.pendingLevels:p.level);
 const next=r?.nextThreshold===null?null:decimal(r?.nextThreshold),base=decimal(p.xpProgress?.earnedThreshold);
 const capped=!!r&&r.nextThreshold===null;
 const remaining=total!==null&&next!==null&&next>total?(next-total).toString():null;
 const percent=total!==null&&base!==null&&next!==null&&base<=total&&next>total&&next>base?Number((total-base)*10000n/(next-base))/100:null;
 return {earnedLevel:earned,nextEarnableLevel:r&&!capped?earned+1:null,nextAllocationLevel:r&&r.pendingLevels>0?p.level+1:null,capped,remaining,percent,maximumLevel:p.xpProgress?.maximumLevel??null};
}
export function characterClasses(s:Snapshot){return (s.progression.build.classes??[]).map(c=>{const known=s.options.classes.find(option=>option.classId===c.classId);return {...c,name:known?.name??'Class name unavailable',maximumNativeLevel:known?.maximumNativeLevel??null};});}
export function characterEquipment(s:Snapshot,session:{equipmentState:()=>Snapshot['game']['equipment']|null;equipmentGear:()=>NonNullable<Snapshot['game']['gear']>}){
 const plan=session.equipmentState()??s.game.equipment,gear=session.equipmentGear();
 return {plan,items:(plan?.slots??[]).filter(slot=>slot.set==='WORN'||slot.set===plan?.activeSet).map(slot=>({...slot,gear:gear.find(item=>item.id===slot.itemId)}))};
}
