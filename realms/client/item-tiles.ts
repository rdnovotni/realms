import type { InventoryItem } from './types.js';
export type TileSettings={healthyPercent:number;wornPercent:number;showSingleQuantity:boolean};
export const defaultTileSettings:TileSettings={healthyPercent:70,wornPercent:25,showSingleQuantity:true};
export function validTileSettings(s:TileSettings){return Number.isInteger(s.healthyPercent)&&Number.isInteger(s.wornPercent)&&s.wornPercent>0&&s.wornPercent<s.healthyPercent&&s.healthyPercent<=100&&typeof s.showSingleQuantity==='boolean';}
const number=(s:string)=>BigInt(s).toLocaleString();
/** Presentation never rescales or rounds the underlying condition values. */
export function itemCondition(item:Pick<InventoryItem,'condition'|'maximumCondition'>,settings:TileSettings=defaultTileSettings){
 if(item.condition===null||item.maximumCondition===null||item.maximumCondition<=0)return null;
 const state=item.condition*100>=item.maximumCondition*settings.healthyPercent?'healthy':item.condition*100>=item.maximumCondition*settings.wornPercent?'worn':'critical';
 const label={healthy:'Healthy',worn:'Worn',critical:'Critically damaged'}[state];
 return {state,label,text:`${item.condition}/${item.maximumCondition}`,description:`${label} · durability ${item.condition}/${item.maximumCondition}`};
}
export function itemWeight(item:Pick<InventoryItem,'unitWeight'|'totalWeight'|'groupWeight'|'quantity'|'groupQuantity'|'storageMode'>,grouped:boolean){
 const total=grouped?item.groupWeight:item.storageMode==='STACK'?item.totalWeight:item.unitWeight;
 if(total===null)return {text:'—',description:'Weight unmeasured — no authored measurement'};
 if(grouped)return {text:number(total),description:`${number(total)} total weight across ${number(item.groupQuantity)} grouped items; expand copies for individual weights`};
 if(item.storageMode==='STACK')return {text:number(total),description:item.unitWeight===null?`${number(total)} total weight`:`${number(item.unitWeight)} each × ${number(item.quantity)} = ${number(total)} total`};
 return {text:number(total),description:`${number(total)} unit weight`};
}
export function itemTileDetails(item:InventoryItem,grouped:boolean){
 if(grouped)return [['copies',`${item.copies} copies · inspect individually`]] as [string,string][];
 const fields:[string,string][]=[];
 if(item.equipment)fields.push(['level',`Req. level ${item.equipment.minimumLevel}`]);
 if(item.numericQuality!==null)fields.push(['quality',`Quality ${item.numericQuality}`]);
 else if(item.qualityLabel&&item.qualityLabel!=='Unassessed')fields.push(['quality',item.qualityLabel]);
 if(!fields.length)fields.push(['property',item.family||item.category.toLowerCase().replace(/_/g,' ')]);
 return fields;
}
export function itemStatuses(item:InventoryItem,grouped:boolean){
 if(grouped)return [{kind:'copies',label:'Grouped copies — expand to inspect individual statuses'}];
 const statuses:{kind:string;label:string}[]=[];
 if(item.locked)statuses.push({kind:'locked',label:'Locked'});
 if(item.equipped)statuses.push({kind:'equipped',label:'Equipped'});
 if(item.loadouts.length)statuses.push({kind:'loadout',label:'Protected by saved loadout'});
 if(!item.accessible)statuses.push({kind:'restricted',label:'Restricted storage'});
 return statuses;
}


export function groupedInspectionFacts(item:InventoryItem):[string,string][]{return [['Copies',String(item.copies)],['Total quantity',number(item.groupQuantity)],['Total weight',item.groupWeight===null?'—':number(item.groupWeight)],['Total bulk',item.groupBulk===null?'—':number(item.groupBulk)],['Locations',item.multipleLocations?'Multiple locations':'Expand copies for individual locations']];}
