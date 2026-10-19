import { folioIcon } from './icons.js';
import { itemCondition,type TileSettings } from './item-tiles.js';
/** Presentation of public slot facts only; never an equipment legality decision. */
export function equipmentSlotPresentation(item:{condition:number|null;maximumCondition:number|null}|null,selected:boolean,compatible:boolean,blocked:boolean,twoHanded:boolean,settings:TileSettings){
 const condition=item?itemCondition(item,settings):null;
 const broken=!!condition&&item!.condition===0;
 return {condition,broken,className:[item?'occupied':'empty',selected?(compatible?'compatible':'incompatible'):'',blocked?'changes-locked':'',twoHanded?'two-handed':'',broken?'broken':condition&&condition.state!=='healthy'?'damaged':''].filter(Boolean).join(' '),hint:blocked?'Changes locked':selected?(compatible?'Fits selected item':'Does not fit selected item'):twoHanded?'Occupied by main hand':item?'Inspect gear':'Search equipment'};
}
export const renderEmptySlotIcon=(slot:string)=>folioIcon(['RING_1','RING_2','TRINKET'].includes(slot)?'TRINKET':slot,'slot','paperdoll-empty-icon');
