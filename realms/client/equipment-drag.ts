import type { EquipmentPlan } from './types.js';
export const equipmentDragType='application/x-follybound-equipment';
export type EquipmentDrag={set:'WORN'|'A'|'B';slot:string;itemId:string};
export function equipmentDrag(data:string,plan:EquipmentPlan):EquipmentDrag|null{try{const value=JSON.parse(data);return plan.slots.some(s=>s.set===value.set&&s.slot===value.slot&&s.itemId===value.itemId)?value:null;}catch{return null;}}
export function removeEquipmentAssignment(plan:EquipmentPlan,assignment:EquipmentDrag){return {...plan,slots:plan.slots.filter(s=>!(s.set===assignment.set&&s.slot===assignment.slot&&s.itemId===assignment.itemId))};}
