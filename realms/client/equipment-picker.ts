import type { Gear,InventoryItem,Snapshot } from './types.js';
import type { GameSession } from './session.js';
import { renderItemArt } from './item-art.js';
export function inventoryGear(item:InventoryItem):Gear {if(!item.equipment)throw Error('Not equipment');return {...(item.definitionId?{inspection:structuredClone(item)}:{}),id:item.id,name:item.name,binding:item.binding,artwork:item.artwork,icon:item.icon,...item.equipment,eligible:item.eligible,proficiencyMet:item.proficiencyMet,manualLocked:item.locked,protectedLoadouts:item.loadouts,condition:item.condition,maximumCondition:item.maximumCondition,unitWeight:item.unitWeight,unitBulk:item.unitBulk,knownStats:item.knownStats};}
export function gearCandidate(item:Gear):InventoryItem{if(item.inspection)return structuredClone(item.inspection);return {id:item.id,name:item.name,binding:item.binding,equipment:{version:2,slots:item.slots,hands:item.hands,minimumLevel:item.minimumLevel,bindingPolicy:item.bindingPolicy},eligible:item.eligible,proficiencyMet:item.proficiencyMet,kind:'CARRIED',accessible:true,copies:1} as InventoryItem;}
/** Bounded, revision-checked reads; opening/searching never changes the inventory query. */
export function openEquipmentPicker(origin:HTMLElement,snapshot:Snapshot,session:GameSession,slot:string,position:string,onPick:(item:InventoryItem)=>void){
 const dialog=document.createElement('dialog');dialog.className='equipment-picker';dialog.setAttribute('aria-label','Choose equipment for '+position);
 const title=document.createElement('h2');title.textContent='Choose '+position;
 const search=document.createElement('input');search.type='search';search.maxLength=80;search.placeholder='Search all eligible carried equipment…';search.setAttribute('aria-label','Search equipment');
 const info=document.createElement('p');info.className='help';info.setAttribute('role','status');
 const list=document.createElement('div');list.className='equipment-picker-list';list.setAttribute('role','list');
 const pages=document.createElement('nav');pages.setAttribute('aria-label','Equipment search pages');
 const close=document.createElement('button');close.type='button';close.textContent='Close equipment picker';close.addEventListener('click',()=>dialog.close());
 dialog.append(title,search,info,list,pages,close);document.body.append(dialog);
 let generation=0,timer:ReturnType<typeof setTimeout>|undefined,closed=false,picked:InventoryItem|null=null;
 const unsubscribe=session.subscribe(()=>{if(session.snapshot!==snapshot||session.busy||!origin.isConnected)dialog.close();});
 dialog.addEventListener('close',()=>{if(closed)return;closed=true;generation++;if(timer)clearTimeout(timer);unsubscribe();dialog.remove();if(origin.isConnected)origin.focus();else document.querySelector<HTMLElement>('main h1')?.focus();if(picked&&session.snapshot===snapshot&&!session.busy&&origin.isConnected)onPick(picked);});
 async function load(offset=0){
  const current=++generation;info.textContent='Finding equipment…';list.replaceChildren();pages.replaceChildren();
  try{const page=await session.findEquipment(slot,search.value,offset);if(closed||current!==generation)return;
   info.textContent=page.total?`${page.offset+1}–${Math.min(page.total,page.offset+page.items.length)} of ${page.total} eligible items. Equipment changes are confirmed before saving.`:'No eligible carried equipment matches. Try another search or check level and proficiency requirements.';
   for(const item of page.items){const row=document.createElement('div');row.setAttribute('role','listitem');const choice=document.createElement('button');choice.type='button';choice.className='equipment-choice';choice.append(renderItemArt(item));const text=document.createElement('span');text.textContent=`${item.name} · Level ${item.equipment!.minimumLevel}${item.condition===null?'':` · ${item.condition}/${item.maximumCondition}`} · ${item.binding.toLowerCase().replaceAll('_',' ')}`;choice.append(text);choice.addEventListener('click',()=>{picked=item;dialog.close();});row.append(choice);list.append(row);}
   for(const [label,target,disabled]of [['Previous equipment page',Math.max(0,page.offset-page.pageSize),page.offset===0],['Next equipment page',page.offset+page.pageSize,page.offset+page.items.length>=page.total]] as const){const button=document.createElement('button');button.type='button';button.textContent=label;button.disabled=disabled;button.addEventListener('click',()=>void load(target));pages.append(button);}
  }catch{if(closed||current!==generation)return;info.textContent='Equipment could not be loaded. Refresh your game if it changed in another window.';const retry=document.createElement('button');retry.type='button';retry.textContent='Retry equipment search';retry.addEventListener('click',()=>void load(offset));list.append(retry);}
 }
 search.addEventListener('input',()=>{if(timer)clearTimeout(timer);generation++;list.replaceChildren();pages.replaceChildren();info.textContent='Finding equipment…';timer=setTimeout(()=>void load(),180);});
 dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();dialog.close();}});
 dialog.showModal();search.focus();void load();
}
