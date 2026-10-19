import { attachNote } from './notes.js';
import { folioIcon } from './icons.js';
import { comparisonRows } from './item-comparison.js';
import { inventoryGear } from './equipment-picker.js';
import type { InventoryItem,EquipmentPlan,Gear } from './types.js';

/** Existing persisted rarity codes remain compatible with published releases. */
export function rarityTitle(value:string){const names:Record<string,string>={COMMON:'Common',UNCOMMON:'Uncommon',RARE:'Rare',VERY_RARE:'Exceptional',EXCEPTIONAL:'Exceptional',LEGENDARY:'Legendary',MYTHIC:'Mythic',ULTRA_ULTRA_RARE:'Ultra-ultra rare',UNKNOWN:'Unknown'};return Object.hasOwn(names,value)?names[value]!:'Unknown';}
export function storageTitle(value:string){const names:Record<string,string>={CARRIED:'Carried',HOME:'Home storage',MATERIAL_VAULT:'Material Vault',LEGACY:'Legacy storage',ALL:'All personal storage'};return Object.hasOwn(names,value)?names[value]!:'Storage';}
export function decorateItemAction(button:HTMLButtonElement){
 const text=button.textContent??'';const key=/collection/i.test(text)?'collection':/favorite/i.test(text)?'favorite':/^(Unlock|Lock|Protect items)/.test(text)?'lock':/^(Repair|Confirm repair)/.test(text)?'repair':/^(Compare)/.test(text)?'compare':/^(Use item|Open item|Confirm use|Confirm open)/.test(text)?'use':/^(Stage equip|Equip |Unequip|Stage unequip)/.test(text)?'equip':/^(Carry|Store|Move)/.test(text)?'move':/^(View item history|Earlier history|Newer history)/.test(text)?'history':null;
 if(!key)return;button.prepend(folioIcon(key,'action','item-action-icon'));
}
/** A successful receipt supplies counts; names are taken only from owned UI facts. */
export function inventorySuccess(type:string,body:Record<string,unknown>,result:Record<string,unknown>,items:Pick<InventoryItem,'id'|'name'>[]){
 const name=items.find(i=>i.id===body.itemId)?.name??'item';
 if(type==='SET_INVENTORY_WORKSPACE')return `${String(body.layout??'Standard').toLowerCase().replace(/^./,c=>c.toUpperCase())} inventory layout saved to your account.`;
 if(type==='SET_TILE_PREFERENCES')return 'Item tile display preferences saved to your account.';
 if(type==='SET_INVENTORY_PREFERENCES')return 'Automatic loot routing preferences saved.';
 if(type==='SET_INVENTORY_INTELLIGENCE'){const value=body.value as {views?:unknown;automation?:unknown}|undefined;return value?.automation?'Keep-N routing rules saved for future rewards.':'Saved inventory views updated.';}
 if(type==='SET_ITEM_LOCK')return `${body.locked?'Locked':'Unlocked'} ${name}.`;
 if(type==='MOVE_INVENTORY')return `Moved ${name} to ${storageTitle(String(body.kind??'')).toLowerCase()}.`;
 if(type==='SPLIT_STACK')return `Split ${String(body.quantity??'')} units into a separate stack.`;
 if(type==='MERGE_STACKS')return 'Merged the selected compatible stacks.';
 if(type==='REPAIR_ITEMS'){const count=Array.isArray(result.items)?result.items.length:0;return `Repaired ${count} ${count===1?'item':'items'} for ${String(result.total??'0')} Gold.`;}
 if(type==='USE_ITEM')return `${result.kind==='OPEN'?'Opened':'Used'} ${name}${typeof result.remaining==='string'?`; ${result.remaining} remaining`:''}.`;
 if(type==='SET_EQUIPMENT')return result.changed===false?'Equipment already matches this setup.':`Equipment updated · weapon set ${String(result.activeSet??'A')} active.`;
 if(type==='BULK_INVENTORY'){
  const n=typeof result.changed==='number'?result.changed:null;if(n===0)return 'No items changed; the selection already matches that setting.';
  const op=String(body.operation??''),verb=({LOCK:'Locked',COLLECT:'Protected collection copies:',UNCOLLECT:'Released collection protection for',FAVORITE:'Favorited',UNFAVORITE:'Removed favorites from',MARK_INSPECTED:'Marked inspected:'})[op];
  return op.startsWith('MOVE_')?`Moved ${n??'selected'} ${n===1?'item':'items'} to ${storageTitle(op.slice(5)).toLowerCase()}.`:`${verb??'Updated'} ${n??'selected'} ${n===1?'item':'items'}.`;
 }
 return 'Action saved.';
}
export function quickComparison(item:InventoryItem,plan:EquipmentPlan|null,gear:Gear[],grouped:boolean){
 if(!item.equipment)return null;
 if(grouped)return {title:item.name,lines:['Expand matching copies to compare individual equipment.']};
 if(!plan)return null;
 const assigned=plan.slots.find(a=>(a.set==='WORN'||a.set===plan.activeSet)&&item.equipment!.slots.includes(a.slot)&&a.itemId!==item.id),current=gear.find(g=>g.id===assigned?.itemId)??null;
 const rows=comparisonRows(current,inventoryGear(item));const keys=['Required level','Weight','Condition %',...Object.keys(item.knownStats??{}),...Object.keys(current?.knownStats??{}),'Guard capability','Healing capability'];
 const lines=[...new Set(keys)].map(key=>rows.find(r=>r[0]===key)).filter((r):r is [string,string,string]=>!!r&&r[1]!==r[2]).slice(0,6).map(([key,a,b])=>`${key.replace(/([a-z])([A-Z])/g,'$1 $2')}: ${a} → ${b}`);
 return {title:item.name+' · '+(current?`Compared with ${current.name}`:'No other equipment in a compatible active slot'),lines:lines.length?lines:['Same known item properties.']};
}
/** Full comparison remains available through the inspector on every input device. */
export function attachQuickComparison(tile:HTMLButtonElement,comparison:ReturnType<typeof quickComparison>){
 if(!comparison)return;tile.removeAttribute('title');attachNote(tile,{title:comparison.title,lines:[...comparison.lines,'Known item facts only · Select for full comparison.']});
}
