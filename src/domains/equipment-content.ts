import { Ajv } from 'ajv';
import { DomainError } from '../foundation/errors.js';
import type { ContentEntity } from './content.js';
import { validateInventorySpec } from './item-accounting.js';
export const wornSlots=['HEAD','NECK','SHOULDERS','CHEST','HANDS','WAIST','LEGS','FEET','RING_1','RING_2','TRINKET','TOOL'] as const;
export const equipmentSlots=[...wornSlots,'MAIN_HAND','OFF_HAND'] as const;
export type EquipmentSlot=typeof equipmentSlots[number];
export type EquipmentSpec={version:1;slots:EquipmentSlot[];hands:0|1|2;minimumLevel:number;bindingPolicy:'PRESERVE'};
const validate=new Ajv({strict:true}).compile({type:'object',additionalProperties:false,required:['version','slots','hands','minimumLevel','bindingPolicy'],properties:{version:{type:'integer',const:1},slots:{type:'array',minItems:1,maxItems:12,uniqueItems:true,items:{type:'string',enum:equipmentSlots}},hands:{type:'integer',enum:[0,1,2]},minimumLevel:{type:'integer',minimum:1,maximum:999},bindingPolicy:{type:'string',const:'PRESERVE'}}});
export function equipmentSpec(value:unknown):EquipmentSpec{
 if(!validate(value))throw new DomainError(400,'INVALID_EQUIPMENT_SPEC');const s=value as EquipmentSpec;
 if(s.slots.some(slot=>s.hands===0?!wornSlots.includes(slot as typeof wornSlots[number]):!['MAIN_HAND','OFF_HAND'].includes(slot)) || (s.hands===2 && (s.slots.length!==1||s.slots[0]!=='MAIN_HAND')))throw new DomainError(400,'INVALID_EQUIPMENT_SPEC');
 return s;
}
export function validateEquipmentContent(e:ContentEntity){const value=e.definition.mechanics?.equipment;if(value===undefined)return;
 if(e.kind!=='ITEM')throw new DomainError(400,'INVALID_EQUIPMENT_SPEC');validateInventorySpec(e.definition.mechanics?.inventory);
 const inv=e.definition.mechanics!.inventory as {category:string;storageMode:string};if(inv.category!=='EQUIPMENT'||inv.storageMode!=='INSTANCE')throw new DomainError(400,'INVALID_EQUIPMENT_SPEC');equipmentSpec(value);
}
