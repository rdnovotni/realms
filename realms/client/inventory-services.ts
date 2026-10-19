import { mountDialog } from './interactions.js';
import type { GameSession } from './session.js';
import type { InventoryItem } from './types.js';
import { errorMessage } from './api.js';
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className='')=>{const n=document.createElement(tag);n.textContent=text;n.className=className;return n;};
function dialog(title:string){const box=el('dialog','','inventory-service-dialog'),heading=el('h2',title),close=el('button','Cancel');close.type='button';box.setAttribute('aria-label',title);box.append(heading);close.addEventListener('click',()=>box.close());box.addEventListener('close',()=>box.remove());mountDialog(box);return {box,close};}
function ready(session:GameSession,runId:string,revision:number){return session.snapshot?.game.run.runId===runId&&session.snapshot.game.run.revision===revision&&!session.busy&&!session.pending&&!session.needsRefresh&&session.snapshot.game.canWrite;}
export async function openRepair(session:GameSession,ids:string[]|null){
 const s=session.snapshot;if(!s||session.busy)return;const {box,close}=dialog(ids?'Repair selected gear':'Repair all available gear');box.append(el('p','Repairs cover gear carried or stored at Home in this life, outside encounters. Prices come from each item’s authored repair policy.','help'),el('p','Preparing quote…'),close);
 try{
  const q=new URLSearchParams({expectedRevision:String(s.game.run.revision)});if(ids)q.set('items',ids.join(','));
  const quote=await session.query<{runId:string;revision:number;items:{itemId:string;name:string;before:number;after:number;cost:string}[];unavailable:{name:string;reason:string}[];total:string;balance:string;affordable:boolean;token:string}>('/api/v1/inventory/repair-preview?'+q);
  if(!box.isConnected)return;box.replaceChildren(el('h2','Repair quote'));const table=el('table'),head=el('tr');for(const t of ['Item','Condition before → after','Gold'])head.append(el('th',t));const thead=el('thead');thead.append(head);table.append(thead);const body=el('tbody');for(const item of quote.items){const row=el('tr');row.append(el('th',item.name),el('td',`${item.before}/${item.after} → ${item.after}/${item.after}`),el('td',BigInt(item.cost).toLocaleString()));body.append(row);}table.append(body);box.append(table);
  for(const item of quote.unavailable)box.append(el('p',`${item.name}: ${item.reason}.`,'help'));
  box.append(el('p',`Total: ${BigInt(quote.total).toLocaleString()} Gold · Available: ${BigInt(quote.balance).toLocaleString()} Gold.`,quote.affordable?'':'cost'));
  if(!quote.items.length)box.append(el('p','No repairable damage in this selection.'));
  const confirm=el('button','Pay & repair','primary');confirm.disabled=!quote.items.length||!quote.affordable||!ready(session,quote.runId,quote.revision);confirm.addEventListener('click',()=>{if(!ready(session,quote.runId,quote.revision)){box.append(el('p','Your game changed. Close this quote and request a new one.','cost'));confirm.disabled=true;return;}box.close();void session.action('/api/v1/inventory/repair','REPAIR_ITEMS',{itemIds:ids,token:quote.token});});box.append(close,confirm);close.focus();
 }catch(e){if(box.isConnected){box.replaceChildren(el('h2','Repair unavailable'),el('p',errorMessage(e),'cost'),close);close.focus();}}
}
export async function openItemUse(session:GameSession,item:InventoryItem){
 const s=session.snapshot;if(!s||session.busy)return;const {box,close}=dialog(item.useKind==='OPEN'?'Open item':'Use item');box.append(el('p','Checking this item…'),close);
 try{
  const q=new URLSearchParams({itemId:item.id,expectedRevision:String(s.game.run.revision)}),quote=await session.query<{runId:string;revision:number;name:string;kind:string;remaining:string;eligible:boolean;token:string;effects:string[];rewards:{name:string;quantity:number}[];protection:{favorite:boolean;locked:boolean;saved:boolean;equipped:boolean}}>('/api/v1/inventory/use-preview?'+q);
  if(!box.isConnected)return;box.replaceChildren(el('h2',`${quote.kind==='OPEN'?'Open':'Use'} ${quote.name}?`),el('p',`Consumes one item. ${quote.remaining} remain afterward. This change is permanent.`));
  for(const effect of quote.effects)box.append(el('p','Applies: '+effect));for(const reward of quote.rewards)box.append(el('p',`Contains: ${reward.quantity} × ${reward.name}`));
  if(!quote.eligible)box.append(el('p','This item is protected as a collection copy, by a lock, equipment assignment or saved loadout. Release that protection first.','cost'));
  const ack=el('input');ack.type='checkbox';if(quote.protection.favorite){const field=el('label','','binding-ack');field.append(ack,el('span','Consume this favorited item anyway.'));box.append(field);}
  const commit=el('button',quote.kind==='OPEN'?'Confirm open':'Confirm use','primary');const update=()=>commit.disabled=!quote.eligible||!ready(session,quote.runId,quote.revision)||quote.protection.favorite&&!ack.checked;ack.addEventListener('change',update);update();commit.addEventListener('click',()=>{if(!ready(session,quote.runId,quote.revision)){commit.disabled=true;box.append(el('p','Your game changed. Request a fresh preview.','cost'));return;}box.close();void session.action('/api/v1/inventory/use','USE_ITEM',{itemId:item.id,token:quote.token,allowFavorite:ack.checked});});box.append(close,commit);close.focus();
 }catch(e){if(box.isConnected){box.replaceChildren(el('h2','Item action unavailable'),el('p',errorMessage(e),'cost'),close);close.focus();}}
}
