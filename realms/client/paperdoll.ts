import { openEquipmentPicker,gearCandidate } from './equipment-picker.js';
import { equipmentDrag,equipmentDragType,removeEquipmentAssignment } from './equipment-drag.js';
import { renderItemArt } from './item-art.js';
import type { EquipmentPlan,Snapshot,InventoryItem } from './types.js';
import type { GameSession } from './session.js';
import { bindingConsequences,prepareInventoryEquipment,worn,equipmentSlotTitle } from './equipment.js';
const title=equipmentSlotTitle;
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''){const n=document.createElement(tag);n.textContent=text;n.className=className;return n;}
function button(text:string,run:()=>void,disabled=false){const b=node('button',text);b.dataset.focus=text;b.type='button';b.disabled=disabled;b.addEventListener('click',run);return b;}
/** Every assignment is represented, including prepared weapons outside the active set. */
export function paperdollPositions(plan:EquipmentPlan){return [...worn.map(slot=>({set:'WORN' as const,slot})),...(['A','B'] as const).flatMap(set=>['MAIN_HAND','OFF_HAND'].map(slot=>({set,slot})))].map(position=>({...position,itemId:plan.slots.find(s=>s.set===position.set&&s.slot===position.slot)?.itemId??null}));}
export function paperdollCandidate(selected:InventoryItem|null,grouped:boolean,level:number){return selected?.equipment&&selected.kind==='CARRIED'&&selected.accessible&&!(grouped&&selected.copies>1)&&selected.eligible&&selected.proficiencyMet&&selected.equipment.minimumLevel<=level?selected:null;}
function silhouette(){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 180 330');svg.setAttribute('aria-hidden','true');svg.classList.add('paperdoll-silhouette');
 for(const [tag,attrs]of [['ellipse',{cx:'90',cy:'167',rx:'78',ry:'145'}],['path',{d:'M90 19v292M20 165h140'}],['path',{d:'M73 60Q90 45 107 60L110 81 102 98 78 98 70 81ZM75 103 48 117 29 177 40 185 65 143 68 192 58 273 70 290 89 218 91 218 110 290 122 273 112 192 115 143 140 185 151 177 132 117 105 103 90 114ZM68 160 112 160M75 103 90 139 105 103M70 290 60 306H78L90 255 102 306H120L110 290'}]] as [string,Record<string,string>][]){const shape=document.createElementNS(svg.namespaceURI,tag);for(const [key,value]of Object.entries(attrs))shape.setAttribute(key,value);svg.append(shape);}return svg;
}
export function renderPaperdoll(snapshot:Snapshot,session:GameSession,disabled:boolean){
 const panel=node('section','','panel paperdoll-panel');panel.setAttribute('aria-label','Equipped gear');panel.append(node('h2','Equipped gear'));
 const plan=snapshot.game.equipment,gear=snapshot.game.gear??[];
 if(!plan){panel.append(node('p','Equipment information is unavailable.','help'));return panel;}
 const blocked=disabled||session.inventoryBusy||!!snapshot.game.activeEncounter||snapshot.progression.build.mode!=='CONFIGURED';
 const selected=session.selectedInventoryItem;
 const candidate=paperdollCandidate(selected,session.inventoryQuery.grouped??true,snapshot.progression.level);
 panel.append(node('p',candidate?`Select a highlighted slot to equip ${candidate.name}.`:'Click a slot to search your equipment. Drag carried items onto slots, or return equipped gear to your pack.','help'));
 if(snapshot.game.activeEncounter)panel.append(node('p','Gear changes are locked during an encounter.','cost'));
 const body=node('div','','paperdoll-body'),figure=node('div','','paperdoll-figure');figure.append(silhouette());body.append(figure);
 const inspector=node('div','','paperdoll-inspector');inspector.id='equipment-inspector';inspector.setAttribute('aria-live','polite');
 function inspect(set:'WORN'|'A'|'B',slot:string,origin:HTMLButtonElement,choice?:InventoryItem){
  inspector.replaceChildren();const assignment=plan!.slots.find(a=>a.set===set&&a.slot===slot),item=gear.find(g=>g.id===assignment?.itemId),position=`${set==='WORN'?'Worn':`Set ${set}`} · ${title(slot)}`;
  const heading=node('h3',position);heading.tabIndex=-1;inspector.append(heading);
  const commit=(draft:EquipmentPlan,message:string,picked:InventoryItem|null=candidate)=>{
   const binding=bindingConsequences(draft,gear,picked);inspector.replaceChildren(heading,node('p',message+(binding.length?` Permanently binds to your account: ${binding.join(', ')}. Unequipping does not undo binding.`:'')));
   inspector.append(button('Cancel gear change',()=>{inspect(set,slot,origin);}),button('Confirm gear change',()=>void session.action('/api/v1/equipment','SET_EQUIPMENT',draft),blocked));heading.focus();
  };
  if(item){inspector.append(node('strong',item.name),node('p',`Required level ${item.minimumLevel} · ${title(item.binding)}${item.hands===2?' · Two hands':''}`,'help'));
   if(item.maximumCondition!==null)inspector.append(node('p',`Condition ${item.condition} / ${item.maximumCondition}`,'help'));
   inspector.append(button('Unequip '+item.name,()=>commit({...plan!,slots:plan!.slots.filter(a=>a.set!==set||a.slot!==slot)},`Remove ${item.name} from ${position}? It stays in your pack; other positions are preserved.`),blocked));
  }else inspector.append(node('p','This slot is empty.','muted'));
  const equipChoice=(picked:InventoryItem)=>{const draft=prepareInventoryEquipment(plan!,picked,set,slot,gear),displaced=plan!.slots.some(a=>!draft.slots.some(b=>a.set===b.set&&a.slot===b.slot&&a.itemId===b.itemId));commit(draft,`Equip ${picked.name} in ${position}?${displaced?' Conflicting positions will be cleared; their items stay in your pack.':''}`,picked);};
  if(choice){equipChoice(choice);return;}
  if(candidate?.equipment?.slots.includes(slot))inspector.append(button('Equip '+candidate.name,()=>equipChoice(candidate),blocked));
  inspector.append(button('Search '+position,()=>openEquipmentPicker(origin,snapshot,session,slot,position,picked=>inspect(set,slot,origin,picked)),blocked));
  inspector.append(button('Close gear details',()=>{inspector.replaceChildren();origin.setAttribute('aria-expanded','false');origin.focus();}));heading.focus();
  if(!assignment&&!blocked)openEquipmentPicker(origin,snapshot,session,slot,position,picked=>inspect(set,slot,origin,picked));
 }
 const positions=paperdollPositions(plan);
 for(const position of positions){
  const {set,slot,itemId}=position,item=gear.find(g=>g.id===itemId),hand=slot==='MAIN_HAND'||slot==='OFF_HAND';
  let target:HTMLElement=body;
  if(hand){let bank=panel.querySelector<HTMLElement>(`[data-weapon-set="${set}"]`);if(!bank){bank=node('div','','paperdoll-weapons');bank.dataset.weaponSet=set;bank.append(node('h3',`Weapon set ${set}${plan.activeSet===set?' · Active':' · Prepared'}`));panel.append(bank);}target=bank;}
  const compatible=!!candidate?.equipment?.slots.includes(slot),twoHand=!item&&slot==='OFF_HAND'&&gear.find(g=>g.id===plan.slots.find(a=>a.set===set&&a.slot==='MAIN_HAND')?.itemId)?.hands===2;
  const control=button('',()=>inspect(set,slot,control));control.className=`paperdoll-slot ${hand?'hand-slot':'slot-'+slot.toLowerCase()}${item?' occupied':''}${compatible?' compatible':''}`;control.dataset.focus=`Gear ${set} ${slot}`;
  const name=item?.name??(itemId?'Item unavailable':twoHand?'Two-handed weapon':'Empty');control.setAttribute('aria-label',`${set==='WORN'?'Worn':`Set ${set}`} ${title(slot)}: ${name}${compatible?`, can equip ${candidate!.name}`:''}`);control.setAttribute('aria-controls','equipment-inspector');control.setAttribute('aria-expanded','false');control.addEventListener('click',()=>{panel.querySelectorAll('[aria-expanded]').forEach(n=>n.setAttribute('aria-expanded','false'));control.setAttribute('aria-expanded','true');});
  control.draggable=!!item&&!blocked;
  control.addEventListener('dragstart',e=>{if(!item||blocked){e.preventDefault();return;}e.dataTransfer?.setData(equipmentDragType,JSON.stringify({set,slot,itemId:item.id}));e.dataTransfer?.setData('text/plain',item.id);if(e.dataTransfer)e.dataTransfer.effectAllowed='move';});
  control.addEventListener('dragover',e=>{if(!blocked){e.preventDefault();control.classList.add('drag-over');}});control.addEventListener('dragleave',()=>control.classList.remove('drag-over'));
  control.addEventListener('drop',e=>{e.preventDefault();control.classList.remove('drag-over');if(blocked)return;const id=e.dataTransfer?.getData('text/plain'),fromGear=equipmentDrag(e.dataTransfer?.getData(equipmentDragType)??'',plan),owned=fromGear?gear.find(g=>g.id===fromGear.itemId):null;
   const carried=session.inventory?.items.find(i=>i.id===id),picked=owned?gearCandidate(owned):paperdollCandidate(carried??null,session.inventoryQuery.grouped??true,snapshot.progression.level);
   if(picked?.equipment?.slots.includes(slot))inspect(set,slot,control,picked);else {inspector.replaceChildren(node('p','That item cannot be placed here. Expand grouped copies or choose eligible carried equipment.','help'));}
  });
  if(item)control.append(renderItemArt({...item,category:'EQUIPMENT',equipment:{slots:item.slots}}));
  control.append(node('span',title(slot),'paperdoll-slot-label'),node('strong',name));if(item)control.append(node('small',`Lv ${item.minimumLevel}${item.maximumCondition!==null?` · ${item.condition}/${item.maximumCondition}`:''}`));target.append(control);
 }
 panel.insertBefore(body,panel.children[2]??null);
 const swap=button(`Activate weapon set ${plan.activeSet==='A'?'B':'A'}`,()=>{panel.querySelectorAll('[aria-expanded]').forEach(n=>n.setAttribute('aria-expanded','false'));const next={...plan,activeSet:plan.activeSet==='A'?'B' as const:'A' as const};const binding=bindingConsequences(next,gear);inspector.replaceChildren(node('h3',`Activate weapon set ${next.activeSet}?`),node('p',binding.length?`Permanently binds to your account: ${binding.join(', ')}.`:'Your other weapons remain prepared.'),button('Cancel weapon switch',()=>{inspector.replaceChildren();swap.focus();}),button('Confirm weapon switch',()=>void session.action('/api/v1/equipment','SET_EQUIPMENT',next),blocked));inspector.querySelector('button')?.focus();},blocked);swap.className='small';swap.dataset.focus='Switch weapon set';const pack=node('div','','equipment-return-zone');pack.setAttribute('role','group');pack.setAttribute('aria-label','Return equipped item to pack');pack.append(node('strong','Return to pack'),node('small','Drop equipped gear here to remove that assignment.'));
 pack.addEventListener('dragover',e=>{if(!blocked&&e.dataTransfer?.types.includes(equipmentDragType)){e.preventDefault();pack.classList.add('drag-over');}});pack.addEventListener('dragleave',()=>pack.classList.remove('drag-over'));
 pack.addEventListener('drop',e=>{e.preventDefault();pack.classList.remove('drag-over');if(blocked)return;const origin=equipmentDrag(e.dataTransfer?.getData(equipmentDragType)??'',plan);if(!origin)return;inspector.replaceChildren(node('h3','Return equipped item to pack?'),node('p','Only this assignment is removed. Other prepared references and item protection remain.'),button('Cancel unequip',()=>inspector.replaceChildren()),button('Confirm unequip',()=>void session.action('/api/v1/equipment','SET_EQUIPMENT',removeEquipmentAssignment(plan,origin)),blocked));inspector.querySelector('button')?.focus();});
 panel.append(swap,pack,inspector);return panel;
}
