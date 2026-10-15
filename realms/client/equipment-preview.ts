import type { GameSession } from './session.js';
import type { Snapshot } from './types.js';
import { bindingConsequences,equipmentSlotTitle } from './equipment.js';
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''){const n=document.createElement(tag);n.textContent=text;n.className=className;return n;}
const label=(s:string)=>{const text=s.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ').toLowerCase();return text[0]?.toUpperCase()+text.slice(1);};
export function renderEquipmentPreview(s:Snapshot,session:GameSession,blocked:boolean){
 const box=node('section','','equipment-stat-preview');box.append(node('h3',session.equipmentDraft?'Equipment draft':'Character statistics'));
 const draft=session.equipmentDraft,stale=!!draft&&draft.revision!==s.game.run.revision;
 if(draft){box.append(node('p',stale?'Your game changed since this draft began. Revert and prepare a fresh setup.':'Staged changes stay here as you browse. Apply commits the complete setup.','help'));
  const bindings=bindingConsequences(draft.plan,session.equipmentGear()),ack=node('input');ack.type='checkbox';const consent=node('label','','binding-ack');consent.append(ack,node('span',`I understand applying permanently binds: ${bindings.join(', ')}.`));if(bindings.length)box.append(consent);
  const apply=node('button','Apply equipment','primary');apply.type='button';apply.disabled=blocked||stale||bindings.length>0;ack.addEventListener('change',()=>apply.disabled=blocked||stale||(bindings.length>0&&!ack.checked));apply.addEventListener('click',()=>void session.applyEquipment());
  const revert=node('button','Revert draft');revert.type='button';revert.disabled=session.busy;revert.addEventListener('click',()=>session.revertEquipment());box.append(apply,revert);
 }
 const preview=session.equipmentPreview;
 if(preview?.contexts.length){const field=node('label','Rules context'),select=node('select');select.setAttribute('aria-label','Statistics rules context');for(const c of preview.contexts){const o=node('option',c.name);o.value=c.id;select.append(o);}select.value=preview.contextId??'';select.addEventListener('change',()=>void session.previewEquipment(select.value));field.append(select);box.append(field);}
 if(session.equipmentPreviewBusy)box.append(node('p','Calculating equipment totals…','help'));
 else if(session.equipmentPreviewError){box.append(node('p',session.equipmentPreviewError,'cost'));const retry=node('button','Recalculate statistics');retry.type='button';retry.addEventListener('click',()=>void session.previewEquipment());box.append(retry);}
 else if(!preview){queueMicrotask(()=>{if(box.isConnected&&!session.equipmentPreviewBusy&&!session.equipmentPreview&&!session.equipmentPreviewError)void session.previewEquipment();});}
 if(preview?.reason)box.append(node('p',preview.reason,'help'));
 if(preview?.current&&preview.preview){const before=preview.current,after=preview.preview,table=node('table','','equipment-stat-table'),head=node('tr');for(const title of ['Statistic','Current',draft?'After applying':'Prepared'])head.append(node('th',title));const thead=node('thead');thead.append(head);table.append(thead);const body=node('tbody');
  const row=(name:string,a:string,b:string)=>{const r=node('tr');r.append(node('th',name),node('td',a),node('td',b));body.append(r);};
  for(const key of ['maxHealth','maxMana','armor','accuracy','evasion','initiative','attackMin','attackMax']){const value=before.stats[key]??0,next=after.stats[key]??value,delta=next-value;row(label(key),String(value),`${next}${delta?` (${delta>0?'+':''}${delta})`:''}`);}
  if(before.damage&&after.damage){row('Attack type',before.damage.attackType,after.damage.attackType);row('Armor penetration',String(before.damage.penetration),String(after.damage.penetration));for(const type of new Set([...Object.keys(before.damage.resistances),...Object.keys(after.damage.resistances)]))row(label(type)+' resistance',`${(before.damage.resistances[type]??0)/100}%`,`${(after.damage.resistances[type]??0)/100}%`);for(const condition of new Set([...(before.damage.conditional??[]),...(after.damage.conditional??[])].map(c=>c.type+'|'+c.ownerTag))){const [type,tag]=condition.split('|');const amount=(damage:typeof before.damage)=>damage?.conditional?.find(c=>c.type===type&&c.ownerTag===tag)?.resistanceBps??0;row(`${label(type!)} when ${label(tag!)}`,`${amount(before.damage)/100}%`,`${amount(after.damage)/100}%`);}}
  else box.append(node('p','This context has no typed-resistance rules.','help'));
  if(before.status&&after.status){for(const tag of new Set([...before.status.immuneTags,...after.status.immuneTags]))row(`${label(tag)} immunity`,before.status.immuneTags.includes(tag)?'Yes':'No',after.status.immuneTags.includes(tag)?'Yes':'No');for(const tag of new Set([...Object.keys(before.status.durationReductionBps??{}),...Object.keys(after.status.durationReductionBps??{})]))row(`${label(tag)} duration reduction`,`${(before.status.durationReductionBps?.[tag]??0)/100}%`,`${(after.status.durationReductionBps?.[tag]??0)/100}%`);}
  if(before.capabilities&&after.capabilities){row('Guard available',before.capabilities.guard?'Yes':'No',after.capabilities.guard?'Yes':'No');row('Basic healing available',before.capabilities.heal?'Yes':'No',after.capabilities.heal?'Yes':'No');}
  row('Carrying state',label(before.carry.state),label(after.carry.state));row('Weight capacity',before.carry.weightCapacity??'—',after.carry.weightCapacity??'—');row('Bulk capacity',before.carry.bulkCapacity??'—',after.carry.bulkCapacity??'—');table.append(body);box.append(table);
  if(after.breakdown){const details=node('details');details.append(node('summary','Calculation breakdown'));for(const [stat,b]of Object.entries(after.breakdown))details.append(node('p',`${label(stat)}: ${b.base} base + ${b.attributes} attributes + ${b.sources} class/feat/equipment + ${b.carrying} carrying = ${after.stats[stat]}`,'help'));box.append(details);}
  if(preview.removed?.length)box.append(node('p','Assignments cleared: '+preview.removed.map(p=>`${p.set} · ${equipmentSlotTitle(p.slot)}`).join(', '),'help'));
  box.append(node('p','Accuracy affects attack checks; evasion is their target. Armor reduces connected damage; initiative orders turns. Only worn gear and the active weapon set contribute.','help'));
  for(const note of preview.notes??[])box.append(node('p',note,'help'));
 }
 return box;
}
