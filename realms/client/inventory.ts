import { prepareInventoryEquipment } from './equipment.js';
import { renderPaperdoll } from './paperdoll.js';
import type { GameSession } from './session.js';
import type { CarryView,InventoryItem,InventoryQuery,Snapshot,EquipmentPlan,Gear } from './types.js';
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''){const n=document.createElement(tag);n.textContent=text;n.className=className;return n;}
function button(text:string,run:()=>void,disabled=false,className='small'){const b=node('button',text,className);b.type='button';b.disabled=disabled;b.dataset.focus=text;b.addEventListener('click',run);return b;}
const label=(value:string)=>value.replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase().split(/[._-]/).map(x=>x[0]?.toUpperCase()+x.slice(1)).join(' ');
export function inventoryNumber(value:string|null|undefined){if(value===null||value===undefined)return 'Unmeasured';try{return BigInt(value).toLocaleString();}catch{return value;}}
export function carryPercent(value:string,capacity:string|null){if(!capacity||BigInt(capacity)<=0n)return 0;const bps=BigInt(value)*10000n/BigInt(capacity);return Number(bps>10000n?10000n:bps)/100;}
export function renderCarry(load:CarryView|undefined){
 const panel=node('section','','panel carry-panel');panel.setAttribute('aria-label','Carrying capacity');panel.append(node('h2','Carrying capacity'));
 if(!load){panel.append(node('p','Carrying information is loading.','muted'));return panel;}
 panel.classList.add('carry-'+load.state.toLowerCase());
 const header=node('div','','carry-heading');header.append(node('strong',label(load.state),'carry-state'),node('span',load.strength===null?'Choose a starting build':`Strength ${load.strength}`,'muted'));panel.append(header);
 for(const [title,value,capacity] of [['Weight',load.weight,load.weightCapacity],['Bulk',load.bulk,load.bulkCapacity]] as const){
  const line=node('div','','carry-line');line.append(node('span',title),node('strong',`${inventoryNumber(value)} / ${capacity===null?'not configured':inventoryNumber(capacity)} units`));
  const meter=node('div','','carry-meter');meter.setAttribute('role','meter');meter.setAttribute('aria-label',title+' capacity');meter.setAttribute('aria-valuemin','0');meter.setAttribute('aria-valuemax','100');meter.setAttribute('aria-valuenow',String(carryPercent(value,capacity)));meter.setAttribute('aria-valuetext',`${inventoryNumber(value)} carried; ${inventoryNumber(capacity)} capacity`);
  const fill=node('span');fill.style.width=carryPercent(value,capacity)+'%';meter.append(fill);panel.append(line,meter);
 }
 const explanation=load.state==='OVERLOADED'?'Store some items or increase capacity before beginning a dangerous encounter.':load.state==='UNMEASURED'?'Some carried items have no authored measurements, or a starting build is missing. Resolve this before entering a dangerous encounter.':!load.enabled?'This release has no carrying policy. Item measurements may be unavailable; existing adventure rules are unchanged.':load.state==='COMFORTABLE'?'Comfortable · no encumbrance penalties.':'Encumbrance affects initiative and authored stealth/mobility checks.';
 panel.append(node('p',explanation,'help'));
 if(load.enabled&&load.state!=='COMFORTABLE'&&load.state!=='UNMEASURED')panel.append(node('p',`Initiative ${load.penalties.initiative} · Stealth checks ${load.penalties.stealth} · Mobility checks ${load.penalties.mobility}`,'help'));
 if(load.baseCapacity){const details=node('details'),summary=node('summary','Capacity breakdown'),list=node('dl','','carry-sources');details.append(summary,list);
  for(const [title,values] of [['Base',load.baseCapacity],[`Strength ${load.strength??'unknown'}`,load.strengthBonus],...load.sources.map(s=>[s.name||label(s.id),s])] as [string,{weight:string;bulk:string}|null][]){if(values)list.append(node('dt',title),node('dd',`${inventoryNumber(values.weight)} weight · ${inventoryNumber(values.bulk)} bulk`));}
  panel.append(details);
 }
 return panel;
}
export function weightIcon(){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','M9 7a3 3 0 1 1 6 0M7 7h10l4 14H3Z');svg.append(path);return svg;}
function icon(category:string){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 48 48');svg.setAttribute('aria-hidden','true');
 const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',category==='EQUIPMENT'?'M30 5 40 8 20 30 14 24ZM9 23 23 37M15 30 7 39 10 42 19 34':category==='MATERIAL'?'M7 30 15 12 31 9 42 26 30 39 13 39ZM15 12 24 26 31 9M7 30 24 26 30 39M24 26 42 26':category==='CONSUMABLE'?'M19 6H29V15L37 29Q44 42 31 42H17Q4 42 11 29L19 15ZM15 27H33M18 6H30':'M13 13Q24 6 35 13L39 38Q24 44 9 38ZM17 13V8Q24 3 31 8V13M10 25H38M24 23V29');svg.append(path);return svg;
}
export { prepareInventoryEquipment } from './equipment.js';
// Separate display fields keep later player preferences local to presentation.
function tileDetails(item:InventoryItem,grouped:boolean){
 const fields:[string,string][]=[];
 if(item.equipment&&!grouped)fields.push(['level',`Req. level ${item.equipment.minimumLevel}`]);
 fields.push(['category',label(item.category)]);
 return fields;
}
function focusItemDetails(){
 const detail=document.getElementById('inventory-details');detail?.querySelector<HTMLElement>('h3')?.focus({preventScroll:true});
 if(matchMedia('(max-width:650px)').matches)detail?.scrollIntoView({block:'start'});
}
let searchTimer:ReturnType<typeof setTimeout>|undefined;
let mergeSource:InventoryItem|null=null,mergeRevision=-1,lastRun:string|null=null;
function confirm(panel:HTMLElement,text:string,accept:()=>void){panel.querySelector('.inventory-confirmation')?.remove();const box=node('div','','inventory-confirmation');box.setAttribute('role','group');box.setAttribute('aria-label','Confirm inventory change');box.append(node('p',text),button('Cancel',()=>box.remove()),button('Confirm change',accept));panel.append(box);box.querySelector('button')?.focus();}
export function renderInventory(main:HTMLElement,snapshot:Snapshot,session:GameSession,disabled:boolean){
 if(lastRun!==snapshot.game.run.runId){lastRun=snapshot.game.run.runId;mergeSource=null;mergeRevision=-1;}
 if(mergeRevision!==snapshot.game.run.revision)mergeSource=null;
 const page=session.inventory,query=session.inventoryQuery;
 const title=node('h1','Your inventory');title.tabIndex=-1;main.append(title,node('p','Everything you carry, carefully kept. Browse copies without losing their individual histories.','muted'));
 const overview=node('div','','inventory-overview');overview.append(renderPaperdoll(snapshot,session,disabled),renderCarry(page?.carry??snapshot.game.carry));main.append(overview);
 const panel=node('section','','panel inventory-panel');panel.append(node('h2','Pack & storage'));main.append(panel);
 function browse(patch:InventoryQuery){if(searchTimer)clearTimeout(searchTimer);void session.browseInventory({...session.inventoryQuery,...patch,offset:patch.offset??0});}
 const toolbar=node('div','','inventory-toolbar');
 const searchLabel=node('label','Search items'),search=node('input');search.type='search';search.maxLength=80;search.placeholder='Find an item…';search.value=query.search??'';search.dataset.focus='Inventory search';searchLabel.append(search);
 search.addEventListener('input',()=>{session.inventoryQuery={...session.inventoryQuery,search:search.value,offset:0};if(searchTimer)clearTimeout(searchTimer);searchTimer=setTimeout(()=>{if(session.snapshot?.game.run.runId===snapshot.game.run.runId)browse({search:search.value});},180);});toolbar.append(searchLabel);
 function select(title:string,key:keyof InventoryQuery,options:[string,string][],value:string){const labelNode=node('label',title),control=node('select');control.dataset.focus='Inventory '+title;for(const [v,text]of options){const option=node('option',text);option.value=v;control.append(option);}control.value=value;control.addEventListener('change',()=>browse({[key]:control.value}));labelNode.append(control);toolbar.append(labelNode);return control;}
 const containers:[string,string][]=[['','Carried'],['ALL','All personal storage']];for(const c of page?.containers??[])containers.push([c.id,`${c.archived?'Archived · ':''}${c.label||label(c.kind)}${c.accessible?'':' · restricted'} (${c.count})`]);
 const storage=select('Location','container',containers,query.container??'');

 select('Category','category',[['ALL','All categories'],['EQUIPMENT','Equipment'],['CONSUMABLE','Consumables'],['MATERIAL','Materials'],['OTHER','Other']],query.category??'ALL');
 select('Rarity','rarity',[['ALL','All rarities'],...['COMMON','UNCOMMON','RARE','VERY_RARE','LEGENDARY','MYTHIC','ULTRA_ULTRA_RARE','UNKNOWN'].map(v=>[v,label(v)] as [string,string])],query.rarity??'ALL');
 select('Binding','binding',[['ALL','All bindings'],...['TRADEABLE','ACCOUNT_BOUND','RUN_BOUND','SYSTEM_UNTRADEABLE'].map(v=>[v,label(v)] as [string,string])],query.binding??'ALL');
 select('Protection','protection',[['ALL','All items'],['PROTECTED','Protected'],['UNPROTECTED','Unprotected']],query.protection??'ALL');
 select('Sort','sort',[['NAME','Name'],['NEWEST','Acquired'],['QUANTITY','Quantity'],['WEIGHT','Weight'],['BULK','Bulk'],['QUALITY','Known quality']],query.sort??'NAME');
 toolbar.append(button(query.direction==='DESC'?'Descending ↓':'Ascending ↑',()=>browse({direction:query.direction==='DESC'?'ASC':'DESC'})));
 const groupLabel=node('label','','inventory-check'),group=node('input');group.type='checkbox';group.checked=query.grouped??true;group.dataset.focus='Group matching bases';group.addEventListener('change',()=>browse({grouped:group.checked}));groupLabel.append(group,node('span','Group matching bases'));toolbar.append(groupLabel);
 toolbar.append(button('Reset filters',()=>{if(searchTimer)clearTimeout(searchTimer);mergeSource=null;void session.browseInventory({sort:'NAME',direction:'ASC',grouped:true,offset:0});}));panel.append(toolbar,node('p','The grid has no fixed slot limit. Weight and bulk govern what you carry.','help'));
 if(query.definitionId)panel.append(button('← All item bases',()=>browse({definitionId:undefined,grouped:true})));
 if(session.inventoryBusy)panel.append(node('p','Loading your inventory…','help'));
 if(!page){panel.append(node('p',session.inventoryError??'Opening your inventory…',session.inventoryError?'notice error':'muted'));if(session.inventoryError)panel.append(button('Try inventory again',()=>void session.browseInventory(query),session.needsRefresh));else if(!session.inventoryBusy)queueMicrotask(()=>{if(session.snapshot&&!session.inventoryBusy&&!session.inventory&&!session.inventoryError)void session.browseInventory(query);});return;}
 const blocked=disabled||session.inventoryBusy||!!snapshot.game.activeEncounter;
 if(snapshot.game.activeEncounter)panel.append(node('p','Storage and equipment changes are paused while an encounter is active.','help'));
 if(mergeSource)panel.append(node('p',`Choose a stack to receive ${mergeSource.name}. Quantity, quality, binding and provenance must be compatible.`, 'inventory-merge-note'),button('Cancel stack merge',()=>{mergeSource=null;session.selectInventory(session.selectedInventoryItem);}));
 const destinations=node('div','','inventory-destinations');destinations.setAttribute('aria-label','Drag items into storage');
 for(const [kind,title] of [['CARRIED','Carried'],['HOME','Home storage'],['MATERIAL_VAULT','Material Vault']] as const){const zone=node('div','','inventory-drop-zone');zone.setAttribute('role','group');zone.setAttribute('aria-label','Drop item into '+title);zone.append(node('strong',title),node('small','Drop an individual item here'));
  zone.addEventListener('dragover',e=>{if(!blocked){e.preventDefault();zone.classList.add('drag-over');}});zone.addEventListener('dragleave',()=>zone.classList.remove('drag-over'));
  zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('drag-over');const id=e.dataTransfer?.getData('text/plain'),item=page.items.find(i=>i.id===id);if(!blocked&&item?.accessible&&!item.equipped&&item.binding!=='SYSTEM_UNTRADEABLE'&&(!query.grouped||item.copies===1))void session.action('/api/v1/inventory/move','MOVE_INVENTORY',{itemId:item.id,kind});});destinations.append(zone);
 }
 panel.append(destinations);
 const bench=node('div','','inventory-workbench'),grid=node('div','','inventory-grid');grid.setAttribute('role','list');grid.setAttribute('aria-label','Inventory items');bench.append(grid);
 for(const item of page.items){const grouped=!!query.grouped&&item.copies>1,quantity=grouped?item.groupQuantity:item.quantity;
  const metadata=tileDetails(item,grouped),summary=metadata.map(([,text])=>text).join(' · '),totalWeight=grouped?item.groupWeight:item.totalWeight,weightText=`Total ${grouped?'group':'stack'} weight: ${inventoryNumber(totalWeight)}${totalWeight===null?'':' units'}`;
  const cell=node('div','','inventory-cell');cell.setAttribute('role','listitem');const tile=button('',()=>{
   if(mergeSource&&mergeSource.id!==item.id){const source=mergeSource;session.selectInventory(item);const detail=document.getElementById('inventory-details');if(detail)confirm(detail,`Merge ${inventoryNumber(source.quantity)} ${source.name} into this stack? Individual source history is retained.`,()=>{mergeSource=null;void session.action('/api/v1/inventory/merge','MERGE_STACKS',{sourceId:source.id,targetId:item.id});});}
   else {session.selectInventory(item);focusItemDetails();}
  },false,`inventory-tile rarity-${item.rarity.toLowerCase().replace(/[^a-z0-9_-]/g,'')}`);tile.dataset.focus='Inventory item '+item.id;tile.setAttribute('aria-pressed',String(session.selectedInventoryItem?.id===item.id));tile.setAttribute('aria-controls','inventory-details');tile.setAttribute('aria-label',`${item.name}, ${inventoryNumber(quantity)}, ${summary}${grouped?`, ${item.copies} copies`:''}${item.protected?', protected':''}${!item.accessible?', restricted storage':''}, ${weightText}`);tile.title=[item.name,summary,weightText,item.description,grouped?`${item.copies} separate copies`:label(item.binding)].filter(Boolean).join('\n');
  if(query.container==='ALL')tile.append(node('small',grouped&&item.multipleLocations?'Multiple locations':label(item.kind),'inventory-location'));
  tile.append(icon(item.category),node('span',inventoryNumber(quantity),'inventory-quantity'),node('span',item.name,'inventory-item-name'));
  const basics=node('span','','inventory-item-meta');for(const [key,text]of metadata){const field=node('span',text);field.dataset.itemDetail=key;if(key==='level'&&item.equipment!.minimumLevel>snapshot.progression.level)field.classList.add('inventory-requirement-unmet');basics.append(field);}tile.append(basics);
  const weight=node('span','','inventory-weight');weight.append(weightIcon(),node('span',totalWeight===null?'?':inventoryNumber(totalWeight)));weight.title=weightText;weight.setAttribute('aria-label',weightText);tile.append(weight);
  if(grouped)tile.append(node('small',`${item.copies} copies`));if(item.protected)tile.append(node('span',item.equipped?'Equipped':item.locked?'Locked':'Loadout','inventory-protection'));if(!item.accessible)tile.append(node('span','Restricted','inventory-protection'));
  tile.draggable=!blocked&&item.accessible&&!item.equipped&&!grouped&&item.binding!=='SYSTEM_UNTRADEABLE';tile.addEventListener('dragstart',e=>{e.dataTransfer?.setData('text/plain',item.id);if(e.dataTransfer)e.dataTransfer.effectAllowed='move';});
  cell.append(tile);grid.append(cell);
 }
 if(!page.items.length)grid.append(node('p',page.total?'No items on this page. Return to the first page.':'No items match these filters.','inventory-empty'));
 const detail=node('aside','','inventory-details');detail.id='inventory-details';detail.setAttribute('aria-label','Selected item');bench.append(detail);panel.append(bench);
 const selected=session.selectedInventoryItem;
 if(!selected)detail.append(node('h3','Select an item'),node('p','Inspect its details, protect it, manage stacks, or move it into storage.','muted'));
 else {
  const grouped=!!query.grouped&&selected.copies>1;const itemHeading=node('h3',selected.name);itemHeading.tabIndex=-1;detail.append(itemHeading,node('p',selected.description||'No further description is known.','muted'));
  const list=node('dl');for(const [name,value]of [['Location',grouped&&selected.multipleLocations?'Multiple locations':label(selected.kind)],['Category',label(selected.category)],['Rarity',label(selected.rarity)],['Quantity',inventoryNumber(grouped?selected.groupQuantity:selected.quantity)],['Binding',label(selected.binding)],['Quality',selected.numericQuality??selected.qualityLabel],['Unit weight',inventoryNumber(selected.unitWeight)],['Unit bulk',inventoryNumber(selected.unitBulk)],['Condition',selected.condition===null?'Not applicable':`${selected.condition} / ${selected.maximumCondition}`],['Protection',[selected.locked?'Manual lock':'',selected.equipped?'Equipped':'',...selected.loadouts.map(l=>'Loadout: '+l)].filter(Boolean).join(' · ')||'None']] as [string,string][])list.append(node('dt',name),node('dd',value));detail.append(list);
  if(grouped)detail.append(node('p','Grouped copies may have different quality, binding, durability or history. Expand them before changing an individual item.','help'),button('View each matching copy',()=>{session.selectInventory(null);browse({definitionId:selected.definitionId,grouped:false});}));
  else {
   const changes=blocked||!selected.accessible;
   if(!selected.accessible)detail.append(node('p','These possessions are preserved, but their scope or current run mode prevents access.','help'));
   detail.append(button(selected.locked?'Unlock item':'Lock item',()=>{if(selected.locked)confirm(detail,'Remove your manual lock? Saved-loadout protection and binding will remain.',()=>void session.action('/api/v1/inventory/lock','SET_ITEM_LOCK',{itemId:selected.id,locked:false}));else void session.action('/api/v1/inventory/lock','SET_ITEM_LOCK',{itemId:selected.id,locked:true});},changes));
   const moves=node('div','','inventory-actions');for(const [kind,title]of [['CARRIED','Carry'],['HOME','Store at Home'],['MATERIAL_VAULT','Store in Material Vault']] as const)if(selected.kind!==kind&&(kind!=='MATERIAL_VAULT'||selected.category==='MATERIAL'))moves.append(button(title,()=>void session.action('/api/v1/inventory/move','MOVE_INVENTORY',{itemId:selected.id,kind}),changes||selected.equipped||selected.binding==='SYSTEM_UNTRADEABLE'));detail.append(moves);
   if(selected.storageMode==='STACK'){
    const form=node('form','','inventory-split'),amount=node('input'),amountLabel=node('label','Amount to split');amount.type='text';amount.inputMode='numeric';amount.pattern='[1-9][0-9]*';amount.maxLength=19;amount.value='1';amount.required=true;amount.disabled=changes||selected.protected;amountLabel.append(amount);const split=node('button','Split stack','small');split.type='submit';split.disabled=changes||selected.protected||BigInt(selected.quantity)<2n;form.append(amountLabel,split);const error=node('p','','help');error.setAttribute('role','alert');form.append(error);form.addEventListener('submit',e=>{e.preventDefault();try{if(!/^[1-9][0-9]{0,18}$/.test(amount.value)||BigInt(amount.value)>=BigInt(selected.quantity))throw Error();void session.action('/api/v1/inventory/split','SPLIT_STACK',{itemId:selected.id,quantity:amount.value});}catch{error.textContent='Choose a whole amount greater than zero and smaller than this stack.';}});detail.append(form,button('Merge into another stack',()=>{mergeSource=structuredClone(selected);mergeRevision=snapshot.game.run.revision;browse({definitionId:selected.definitionId,grouped:false});},changes||selected.protected));
   }
   if(selected.equipment&&selected.kind==='CARRIED'){
    const positions=node('select');positions.setAttribute('aria-label','Equipment position');
    for(const slot of selected.equipment.slots)for(const set of (['MAIN_HAND','OFF_HAND'].includes(slot)?[snapshot.game.equipment?.activeSet??'A',(snapshot.game.equipment?.activeSet??'A')==='A'?'B':'A']:['WORN']) as ('WORN'|'A'|'B')[]){const option=node('option',set==='WORN'?label(slot):`Set ${set} · ${label(slot)}${snapshot.game.equipment?.activeSet===set?' (active)':''}`);option.value=set+':'+slot;positions.append(option);}
    detail.append(node('p',`Requires level ${selected.equipment.minimumLevel}${selected.proficiencyMet?'':' · proficiency not met'}`,'help'),positions,button('Equip or prepare',()=>{
     const plan=snapshot.game.equipment;if(!plan)return;const [set,slot]=positions.value.split(':');
     const draft=prepareInventoryEquipment(plan,selected,set as 'WORN'|'A'|'B',slot!,snapshot.game.gear??[]);
     const binding=selected.binding==='TRADEABLE'&&selected.equipment?.bindingPolicy==='ACCOUNT_ON_ACTIVE_EQUIP'&&(set==='WORN'||set===plan.activeSet)?' This permanently binds the item to your account.':'';
     const displaced=plan.slots.filter(old=>!draft.slots.some(next=>next.itemId===old.itemId&&next.set===old.set&&next.slot===old.slot));
     confirm(detail,`Prepare ${selected.name} in ${set==='WORN'?'worn equipment':`set ${set}`} · ${label(slot!)}?${displaced.length?' Conflicting assignments will be cleared; items remain in your pack.':''}${binding}`,()=>void session.action('/api/v1/equipment','SET_EQUIPMENT',draft));
    },changes||!selected.eligible||!selected.proficiencyMet||snapshot.progression.level<selected.equipment.minimumLevel||snapshot.progression.build.mode!=='CONFIGURED'));
    const equipped=snapshot.game.equipment?.slots.filter(slot=>selected.equipment!.slots.includes(slot.slot)&&(slot.set==='WORN'||slot.set===snapshot.game.equipment?.activeSet))??[];
    for(const current of equipped){const gear=snapshot.game.gear?.find(g=>g.id===current.itemId);if(!gear||gear.id===selected.id)continue;const comparison=node('div','','inventory-comparison');comparison.append(node('h4',`Compared with ${gear.name}`));
     if(selected.unitWeight!==null&&gear.unitWeight!==null&&gear.unitWeight!==undefined){const delta=BigInt(selected.unitWeight)-BigInt(gear.unitWeight);comparison.append(node('p',`${delta>0n?'+':''}${inventoryNumber(delta.toString())} weight units`));}
     if(selected.knownStats&&gear.knownStats)for(const stat of new Set([...Object.keys(selected.knownStats),...Object.keys(gear.knownStats)])){const delta=(selected.knownStats[stat]??0)-(gear.knownStats[stat]??0);if(delta)comparison.append(node('p',`${delta>0?'+':''}${delta} ${label(stat)}`));}
     else comparison.append(node('p','Further numerical effects must be known on both items before comparison.','help'));detail.append(comparison);
    }
   }
   if(selected.equipped)detail.append(button('Unequip this item',()=>{const plan=snapshot.game.equipment;if(plan)void session.action('/api/v1/equipment','SET_EQUIPMENT',{activeSet:plan.activeSet,slots:plan.slots.filter(slot=>slot.itemId!==selected.id)});},changes));
  }
  if(!grouped){detail.append(button('View item history',()=>void session.loadInventoryHistory(selected.id),session.inventoryHistoryBusy));
   if(session.inventoryHistoryBusy)detail.append(node('p','Loading item history…','help'));
   const history=session.inventoryHistory;if(history?.itemId===selected.id){const list=node('ol','','inventory-history');for(const event of history.events){const entry=node('li');entry.append(node('strong',label(event.kind)+(event.quantity?' · '+inventoryNumber(event.quantity):'')+(event.location?' · '+label(event.location):'')),node('small',new Date(event.at).toLocaleString()));list.append(entry);}detail.append(list);
    const pages=node('div','','inventory-actions');pages.append(button('Earlier history',()=>void session.loadInventoryHistory(selected.id,history.offset+history.pageSize),session.inventoryHistoryBusy||history.offset+history.events.length>=history.total),button('Newer history',()=>void session.loadInventoryHistory(selected.id,Math.max(0,history.offset-history.pageSize)),session.inventoryHistoryBusy||history.offset===0));detail.append(pages);
   }
  }
  detail.append(button('Close item details',()=>{
   session.selectInventory(null);
   const controls=Array.from(document.querySelectorAll<HTMLElement>('[data-focus]'));
   const target=controls.find(n=>n.dataset.focus==='Inventory item '+selected.id)??controls.find(n=>n.dataset.focus==='Inventory search');
   target?.focus();
  }));
 }
 const paging=node('nav','','inventory-pagination');paging.setAttribute('aria-label','Inventory pages');const first=page.total? page.offset+1:0,last=Math.min(page.total,page.offset+page.items.length);paging.append(button('← Previous',()=>browse({offset:Math.max(0,page.offset-page.pageSize)}),session.inventoryBusy||page.offset===0),node('span',`${first}–${last} of ${page.total}${query.grouped?' item groups':' items'}`),button('Next →',()=>browse({offset:page.offset+page.pageSize}),session.inventoryBusy||page.offset+page.items.length>=page.total));panel.append(paging);
 const settings=node('details','','inventory-settings');settings.append(node('summary','Loot storage preferences'));
 for(const [key,title]of [['autoStoreMaterials','Route new materials to this life’s Material Vault'],['autoOverflow','Route eligible new mundane/material overflow to this life’s storage']] as const){const setting=node('label','','inventory-check'),check=node('input');check.type='checkbox';check.checked=page.preferences[key];check.disabled=disabled||session.inventoryBusy;check.addEventListener('change',()=>void session.action('/api/v1/inventory/preferences','SET_INVENTORY_PREFERENCES',{preferences:{...page.preferences,[key]:check.checked}}));setting.append(check,node('span',title));settings.append(setting);}
 settings.append(node('p','These preferences affect future grants. Existing possessions stay where they are. Binding, custody and mode rules still apply.','help'));panel.append(settings);
 if(page.hasMoreContainers)panel.append(node('p','The location picker shows the first 200 containers. All personal storage still includes their items.','help'));
}
