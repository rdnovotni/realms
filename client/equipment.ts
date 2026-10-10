import type { EquipmentPlan,Gear,Snapshot } from './types.js';
import type { GameSession } from './session.js';

const worn=['HEAD','NECK','SHOULDERS','CHEST','HANDS','WAIST','LEGS','FEET','RING_1','RING_2','TRINKET','TOOL'];
const title=(s:string)=>s.split('_').map(w=>w[0]!+w.slice(1).toLowerCase()).join(' ');
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''){const n=document.createElement(tag);n.textContent=text;n.className=className;return n;}
function btn(text:string,run:()=>void,disabled:boolean){const n=node('button',text,'small');n.type='button';n.dataset.focus=text;n.disabled=disabled;n.addEventListener('click',run);return n;}

function requestConfirmation(card:HTMLElement,message:string,accept:()=>void){
 card.querySelector('.loadout-confirmation')?.remove();
 const box=node('div','','loadout-confirmation');box.setAttribute('role','group');box.setAttribute('aria-label','Confirm loadout change');
 const cancel=btn('Cancel change',()=>box.remove(),false),commit=btn('Confirm change',accept,false);
 box.append(node('p',message),cancel,commit);card.append(box);cancel.focus();
}

/** Preparation hints only. The revision-checked server decides equipment legality. */
export function equipmentProblems(plan:EquipmentPlan,gear:Gear[],level:number){
 const problems:string[]=[];
 for(const slot of plan.slots){
  const item=gear.find(g=>g.id===slot.itemId),position=`${slot.set==='WORN'?'Worn':`Set ${slot.set}`} · ${title(slot.slot)}`;
  if(!item){problems.push(`${position}: item is not in the available carried gear.`);continue;}
  if(!item.eligible||!item.proficiencyMet||item.minimumLevel>level)problems.push(`${item.name}: requirements are not met.`);
  if(!item.slots.includes(slot.slot))problems.push(`${item.name}: cannot use ${title(slot.slot)}.`);
  if(item.hands===2&&plan.slots.some(s=>s.set===slot.set&&s.slot==='OFF_HAND'))problems.push(`${item.name}: clear the off hand in Set ${slot.set}.`);
  const copies=plan.slots.filter(s=>s.itemId===item.id);
  if(copies.length>1&&(copies.some(s=>s.set==='WORN')||new Set(copies.map(s=>s.set)).size!==copies.length||new Set(copies.map(s=>s.slot)).size!==1))problems.push(`${item.name}: one physical item cannot fill these positions.`);
 }
 return [...new Set(problems)];
}
export function bindingConsequences(plan:EquipmentPlan,gear:Gear[]){
 return gear.filter(g=>g.binding==='TRADEABLE'&&g.bindingPolicy==='ACCOUNT_ON_ACTIVE_EQUIP'&&plan.slots.some(s=>s.itemId===g.id&&(s.set==='WORN'||s.set===plan.activeSet))).map(g=>g.name);
}

export function renderEquipment(main:HTMLElement,s:Snapshot,session:GameSession,disabled:boolean){
 const game=s.game;if(!game.equipment||!game.gear||!game.loadouts){main.append(node('p','Equipment controls will be available after the server is updated.','help'));return;}
 const gear=game.gear,blocked=disabled||!!game.activeEncounter||!!game.hasMoreGear;
 const panel=node('section','','panel equipment-panel');panel.append(node('h2','Prepare for the road'),node('p','Choose worn gear and two prepared weapon sets. Changes are free outside an encounter. Save commits the complete setup.','help'));
 if(game.activeEncounter)panel.append(node('p','Equipment changes are locked until this encounter ends.','cost'));
 if(game.hasMoreGear)panel.append(node('p','Showing the first 100 gear items. Editing is paused to preserve equipment beyond this list.','cost'));
 const form=node('form'),fields=node('fieldset'),draft=structuredClone(game.equipment);
 fields.disabled=blocked;
 const activeLabel=node('label','Active weapon set'),active=node('select');active.setAttribute('aria-label','Active weapon set');active.dataset.focus='active-weapon-set';
 for(const set of ['A','B']){const option=node('option',`Set ${set}`);option.value=set;active.append(option);}active.value=draft.activeSet;activeLabel.append(active);fields.append(activeLabel);
 const preview=node('div','','equipment-preview'),ackLabel=node('label','','binding-ack'),ack=node('input');ack.type='checkbox';ack.setAttribute('aria-label','Confirm permanent account binding');ackLabel.append(ack,node('span','I understand these items will permanently bind to this account.'));
 const save=node('button','Save equipment','primary');save.type='submit';save.dataset.focus='Save equipment';
 const update=()=>{
  const issues=equipmentProblems(draft,gear,s.progression.level),binding=bindingConsequences(draft,gear);preview.replaceChildren();
  preview.append(node('p',`Prepared Set ${draft.activeSet} will be active. Unequipped items stay in your pack.`,'help'));
  for(const issue of issues)preview.append(node('p',issue,'cost'));
  if(binding.length)preview.append(node('p',`Permanently binds on save: ${binding.join(', ')}. Unequipping will not undo binding.`,'cost'));
  ackLabel.hidden=!binding.length;save.disabled=blocked||issues.length>0||(binding.length>0&&!ack.checked);
 };
 active.addEventListener('change',()=>{draft.activeSet=active.value as 'A'|'B';ack.checked=false;update();});ack.addEventListener('change',update);
 for(const set of ['A','B','WORN'] as const){
  const group=set==='WORN'?node('details','','worn-gear'):node('div','','equipment-set');
  group.append(node(set==='WORN'?'summary':'h3',set==='WORN'?'Worn equipment':`Weapon Set ${set}`));
  const grid=node('div','','equipment-grid');
  for(const slot of set==='WORN'?worn:['MAIN_HAND','OFF_HAND']){
   const label=node('label',title(slot)),select=node('select');select.dataset.focus=`equipment-${set}-${slot}`;select.setAttribute('aria-label',`${set==='WORN'?'Worn':`Set ${set}`} ${title(slot)}`);
   const empty=node('option','Empty');empty.value='';select.append(empty);
   for(const item of gear.filter(g=>g.slots.includes(slot))){const option=node('option',`${item.name}${item.hands===2?' · Two hands':''}${item.minimumLevel>s.progression.level?` · Level ${item.minimumLevel}`:''}${!item.proficiencyMet?' · Proficiency required':''}${!item.eligible?' · Unavailable':''}`);option.value=item.id;option.disabled=!item.eligible||!item.proficiencyMet||item.minimumLevel>s.progression.level;select.append(option);}
   const equipped=draft.slots.find(a=>a.set===set&&a.slot===slot)?.itemId??'';
   if(equipped&&!Array.from(select.options).some(o=>o.value===equipped)){const missing=node('option','Current item · unavailable');missing.value=equipped;select.append(missing);}select.value=equipped;
   select.addEventListener('change',()=>{draft.slots=draft.slots.filter(a=>a.set!==set||a.slot!==slot);if(select.value)draft.slots.push({set,slot,itemId:select.value});ack.checked=false;update();});label.append(select);grid.append(label);
  }
  group.append(grid);fields.append(group);
 }
 fields.append(preview,ackLabel,save);form.append(fields);form.addEventListener('submit',e=>{e.preventDefault();update();if(!save.disabled)void session.action('/api/v1/equipment','SET_EQUIPMENT',{activeSet:draft.activeSet,slots:draft.slots});});panel.append(form);update();main.append(panel);

 const items=node('section','','panel');items.append(node('h2','Your gear'));
 for(const item of gear){const card=node('article','','gear-card');card.append(node('h3',item.name),node('p',`${title(item.binding)} · Level ${item.minimumLevel}${item.hands===2?' · Two hands':''}`,'help'));
  if(item.bindingPolicy==='ACCOUNT_ON_ACTIVE_EQUIP'&&item.binding==='TRADEABLE')card.append(node('p','Permanently binds when worn or equipped in the active weapon set.','cost'));
  if(item.maximumCondition!==null)card.append(node('p',`Condition ${item.condition} / ${item.maximumCondition}`,'help'));
  const positions=game.equipment.slots.filter(a=>a.itemId===item.id).map(a=>`${a.set==='WORN'?'Worn':`Set ${a.set}`} · ${title(a.slot)}`);
  card.append(node('p',positions.length?`Equipped: ${positions.join(', ')}`:'Not equipped','help'));
  if(item.manualLocked)card.append(node('p','Manually protected. Changing a loadout does not remove this lock.','help'));
  if(item.protectedLoadouts.length)card.append(node('p',`Protected by: ${item.protectedLoadouts.map(key=>game.loadouts!.find(l=>l.key===key)?.name??'Saved loadout').join(', ')}`,'help'));
  items.append(card);
 }
 if(!gear.length)items.append(node('p','No carried equipment yet.','muted'));main.append(items);

 const saved=node('section','','panel');saved.append(node('h2','Saved loadouts'),node('p','Save the currently committed setup, including both weapon sets. Saving protects its item identities from consumption. Draft choices above are not included until saved.','help'));
 const naming=node('form'),nameLabel=node('label','Loadout name'),name=node('input');name.required=true;name.maxLength=80;name.disabled=disabled;name.setAttribute('aria-label','Loadout name');nameLabel.append(name);
 const capture=node('button','Save current loadout','primary');capture.type='submit';capture.dataset.focus='Save current loadout';capture.disabled=disabled||game.loadouts.length>=32;naming.append(nameLabel,capture);naming.addEventListener('submit',e=>{e.preventDefault();if(!capture.disabled&&name.value.trim())void session.action('/api/v1/equipment/loadouts/save','SAVE_LOADOUT',{key:`loadout-${crypto.randomUUID().slice(0,8)}`,name:name.value.trim()});});saved.append(naming);
 if(game.loadouts.length>=32)saved.append(node('p','You have 32 saved loadouts. Replace or delete one to make room.','help'));
 for(const loadout of game.loadouts){
  const card=node('article','','gear-card');card.append(node('h3',loadout.name),node('p',`${loadout.plan.slots.length} positions · Active Set ${loadout.plan.activeSet} · ${loadout.protectItems?'Items protected':'Protection released'}`,'help'));
  const issues=equipmentProblems(loadout.plan,gear,s.progression.level),binding=bindingConsequences(loadout.plan,gear);
  for(const issue of issues)card.append(node('p',issue,'help'));
  const consentLabel=node('label','','binding-ack'),consent=node('input');consent.type='checkbox';consent.setAttribute('aria-label',`Confirm binding for ${loadout.name}`);consent.disabled=blocked;
  if(binding.length){consentLabel.append(consent,node('span',`Applying permanently binds: ${binding.join(', ')}. I understand.`));card.append(consentLabel);}
  const apply=btn(`Apply ${loadout.name}`,()=>void session.action(`/api/v1/equipment/loadouts/${loadout.key}/apply`,'SET_EQUIPMENT',{}),blocked||issues.length>0||binding.length>0);consent.addEventListener('change',()=>{apply.disabled=blocked||issues.length>0||(binding.length>0&&!consent.checked);});
  card.append(apply,btn(`Replace ${loadout.name}`,()=>{requestConfirmation(card,`Replace ${loadout.name} with the committed equipment? This protects its new items and releases this template's old references.`,()=>void session.action('/api/v1/equipment/loadouts/save','SAVE_LOADOUT',{key:loadout.key,name:loadout.name}));},disabled),btn(`${loadout.protectItems?'Release':'Restore'} protection for ${loadout.name}`,()=>{const submit=()=>void session.action(`/api/v1/equipment/loadouts/${loadout.key}/protection`,'SET_LOADOUT_PROTECTION',{protectItems:!loadout.protectItems});if(loadout.protectItems)requestConfirmation(card,`Release ${loadout.name}'s item protection? Equipped items, manual locks and other loadouts remain protected.`,submit);else submit();},disabled),btn(`Delete ${loadout.name}`,()=>{requestConfirmation(card,`Delete ${loadout.name}? This releases its item protection but does not unequip anything or undo binding.`,()=>void session.action(`/api/v1/equipment/loadouts/${loadout.key}/delete`,'DELETE_LOADOUT',{}));},disabled));saved.append(card);
 }
 if(!game.loadouts.length)saved.append(node('p','No loadouts saved yet.','muted'));main.append(saved);
}
