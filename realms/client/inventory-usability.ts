import { comparisonRows } from './item-comparison.js';
import { inventoryGear } from './equipment-picker.js';
import type { InventoryItem,EquipmentPlan,Gear } from './types.js';

/** Existing persisted rarity codes remain compatible with published releases. */
export function rarityTitle(value:string){const names:Record<string,string>={COMMON:'Common',UNCOMMON:'Uncommon',RARE:'Rare',VERY_RARE:'Exceptional',EXCEPTIONAL:'Exceptional',LEGENDARY:'Legendary',MYTHIC:'Mythic',ULTRA_ULTRA_RARE:'Ultra-ultra rare',UNKNOWN:'Unknown'};return Object.hasOwn(names,value)?names[value]!:'Unknown';}
export function storageTitle(value:string){const names:Record<string,string>={CARRIED:'Carried',HOME:'Home storage',MATERIAL_VAULT:'Material Vault',LEGACY:'Legacy storage',ALL:'All personal storage'};return Object.hasOwn(names,value)?names[value]!:'Storage';}
const paths:Record<string,string>={equip:'M9 3h6l2 4 5 3-3 5-3-2v8H8v-8l-3 2-3-5 5-3Z',use:'M9 3h6M10 3v5L5 18q-1 3 2 3h10q3 0 2-3L14 8V3M8 14h8',move:'M3 7h12m-4-4 4 4-4 4M21 17H9m4-4-4 4 4 4',lock:'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5ZM12 14v3',favorite:'m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z',repair:'m4 20 9-9M12 4q3-3 7-1l-4 4 2 2 4-4q2 7-5 8L6 22Z',compare:'M5 4v16M19 4v16M2 8h6M16 8h6M10 5l4 3-4 3M14 13l-4 3 4 3',history:'M3 4v6h6M3 10a9 9 0 1 1 1 8M12 7v6l4 2',collection:'M5 3h14v18l-7-4-7 4ZM8 8h8M8 12h8'};
export function decorateItemAction(button:HTMLButtonElement){
 const text=button.textContent??'';const key=/collection/i.test(text)?'collection':/favorite/i.test(text)?'favorite':/^(Unlock|Lock|Protect items)/.test(text)?'lock':/^(Repair|Confirm repair)/.test(text)?'repair':/^(Compare)/.test(text)?'compare':/^(Use item|Open item|Confirm use|Confirm open)/.test(text)?'use':/^(Stage equip|Equip |Unequip|Stage unequip)/.test(text)?'equip':/^(Carry|Store|Move)/.test(text)?'move':/^(View item history|Earlier history|Newer history)/.test(text)?'history':null;
 if(!key)return;const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('item-action-icon');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[key]!);svg.append(path);button.prepend(svg);
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
 if(type==='SPLIT_STACK')return `Split ${String(body.amount??'')} units into a separate stack.`;
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
let dismissTimer:ReturnType<typeof setTimeout>|undefined;
let tooltip:HTMLElement|null=null,owner:HTMLElement|null=null,observer:MutationObserver|null=null;
function hideTooltip(){if(dismissTimer)clearTimeout(dismissTimer);dismissTimer=undefined;owner?.removeAttribute('aria-describedby');owner=null;window.removeEventListener('scroll',hideTooltip,true);window.removeEventListener('resize',hideTooltip);tooltip?.remove();tooltip=null;observer?.disconnect();observer=null;}
/** Hover/focus only: no reads, writes, hidden mechanics, or replacement of item actions. */
export function attachQuickComparison(tile:HTMLButtonElement,comparison:ReturnType<typeof quickComparison>){
 if(!comparison)return;tile.removeAttribute('title');let suppressed=false;const id='quick-compare-'+tile.dataset.focus?.replace(/[^a-z0-9-]/gi,'');
 const hide=()=>{if(tooltip?.id===id){hideTooltip();tile.removeAttribute('aria-describedby');}};
 const show=()=>{if(suppressed)return;hideTooltip();const box=document.createElement('div');box.id=id;box.className='inventory-quick-comparison';box.setAttribute('role','tooltip');box.addEventListener('pointerenter',()=>{if(dismissTimer)clearTimeout(dismissTimer);});box.addEventListener('pointerleave',hide);const title=document.createElement('strong');title.textContent=comparison.title;box.append(title);for(const text of comparison.lines){const line=document.createElement('div');line.textContent=text;box.append(line);}const help=document.createElement('small');help.textContent='Known item facts only · Select for full comparison.';box.append(help);document.body.append(box);tooltip=box;owner=tile;window.addEventListener('scroll',hideTooltip,true);window.addEventListener('resize',hideTooltip);tile.setAttribute('aria-describedby',id);const rect=tile.getBoundingClientRect();box.style.width=Math.min(300,innerWidth-24)+'px';box.style.left=Math.max(12,Math.min(rect.left,innerWidth-box.offsetWidth-12))+'px';box.style.top=Math.max(12,Math.min(rect.bottom+6,innerHeight-box.offsetHeight-12))+'px';observer=new MutationObserver(()=>{if(!tile.isConnected)hide();});observer.observe(document.body,{childList:true,subtree:true});};
 tile.addEventListener('pointerenter',e=>{if(e.pointerType!=='touch')show();});tile.addEventListener('focus',()=>requestAnimationFrame(()=>{if(tile.isConnected&&document.activeElement===tile)show();}));tile.addEventListener('pointerleave',()=>{dismissTimer=setTimeout(hide,120);suppressed=false;});tile.addEventListener('blur',()=>{hide();suppressed=false;});tile.addEventListener('pointerdown',()=>{suppressed=true;hide();});tile.addEventListener('dragstart',hide);tile.addEventListener('keydown',e=>{if(e.key==='Escape'){suppressed=true;hide();}});
}
