import { itemCondition,type TileSettings } from './item-tiles.js';
/** Presentation of public slot facts only; never an equipment legality decision. */
export function equipmentSlotPresentation(item:{condition:number|null;maximumCondition:number|null}|null,selected:boolean,compatible:boolean,blocked:boolean,twoHanded:boolean,settings:TileSettings){
 const condition=item?itemCondition(item,settings):null;
 const broken=!!condition&&item!.condition===0;
 return {condition,broken,className:[item?'occupied':'empty',selected?(compatible?'compatible':'incompatible'):'',blocked?'changes-locked':'',twoHanded?'two-handed':'',broken?'broken':condition&&condition.state!=='healthy'?'damaged':''].filter(Boolean).join(' '),hint:blocked?'Changes locked':selected?(compatible?'Fits selected item':'Does not fit selected item'):twoHanded?'Occupied by main hand':item?'Inspect gear':'Search equipment'};
}
const paths:Record<string,string>={
 HEAD:'M7 19v-7a9 9 0 0 1 18 0v7l-5 4h-8ZM7 14h18M16 5v9M12 23v4h8v-4',
 NECK:'M6 5q0 15 10 16Q26 20 26 5M12 23l4-3 4 3-4 6Z',
 SHOULDERS:'M3 18 7 9l7 3v10H4ZM29 18l-4-9-7 3v10h10Z',
 CHEST:'M11 5h10l3 5 5 3-4 7-4-3v11H11V17l-4 3-4-7 5-3ZM12 5q4 7 8 0',
 HANDS:'M7 14V7h4v6-9h4v9-9h4v9-7h4v11l-4 10H10L4 18v-5Z',
 WAIST:'M3 12h26v10H3ZM12 10h8v14h-8ZM4 17h7m10 0h7',
 LEGS:'M7 5h18v9l3 14H18l-2-14-2 14H4l3-14ZM7 10h18',
 FEET:'M7 4h10v14l9 4v6H5V14ZM6 23h19M9 8h5',
 TOOL:'m7 5 6 2 2 6-4 4 13 11 4-4-11-13 1-6-6-2 1 6-4 2Z',
 MAIN_HAND:'m21 3 6 2-2 6-12 12-4-4ZM7 17l10 10M5 27l5-5M3 29l3-1',
 OFF_HAND:'M5 6 16 2l11 4v10q-2 9-11 14Q7 25 5 16ZM16 7v16M10 12h12',
 TRINKET:'M8 17a8 8 0 1 0 16 0 8 8 0 1 0-16 0M12 6l4-4 4 4-4 5Z'
};
export function renderEmptySlotIcon(slot:string){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 32 32');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.classList.add('paperdoll-empty-icon');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[slot]??paths.TRINKET!);svg.append(path);return svg;}
