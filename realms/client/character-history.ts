import { characterIcon,type CharacterMotif } from './character-icons.js';
import type { GameSession } from './session.js';
import { node,section,button } from './advancement-controls.js';
import { titleCase } from './advancement-model.js';
import { historyCategories,historyTime } from './character-history-model.js';
export function renderCharacterHistory(parent:HTMLElement,session:GameSession){
 const box=section('Advancement History');parent.append(box);const title=box.querySelector('h2')!;title.id='character-history-title';title.tabIndex=-1;box.setAttribute('aria-busy',String(session.characterHistoryBusy));
 box.append(node('p','Committed advancements in this run, from earliest to latest. Archived lives are kept separate. Recorded choices cannot be edited or deleted here.','sheet-note'));
 if(!session.characterHistory&&!session.characterHistoryBusy&&!session.characterHistoryError&&!session.busy&&!session.needsRefresh)queueMicrotask(()=>{if(box.isConnected&&!session.characterHistory&&!session.characterHistoryBusy&&!session.characterHistoryError)void session.loadCharacterHistory();});
 if(session.characterHistoryBusy)box.append(node('p','Loading recorded advancements…','help'));
 if(session.characterHistoryError)box.append(node('p',session.characterHistoryError,'notice error'),button(session.characterHistoryNeedsRefresh?'Refresh character history':'Retry character history',()=>session.characterHistoryNeedsRefresh?void session.refresh():void session.loadCharacterHistory(),session.characterHistoryBusy||session.busy));
 const history=session.characterHistory;if(!history)return;
 if(!history.total){box.append(node('p','No character advancements have been recorded in this run. Choose a starting build to begin its history.','help'));return;}
 const status=node('p',`${history.total} recorded advancement${history.total===1?'':'s'} · ${history.entries.length?`showing ${history.offset+1}–${history.offset+history.entries.length}`:'no entries on this page'}`,'sheet-history-status');status.setAttribute('role','status');box.append(status);
 const page=(offset:number)=>{void session.loadCharacterHistory(offset).then(()=>{if(session.characterSection==='history')document.getElementById('character-history-title')?.focus();});};
 const last=Math.floor((history.total-1)/history.pageSize)*history.pageSize;
 const jumps=node('div','','sheet-history-controls');jumps.append(button('Show earliest history',()=>page(0),history.offset===0),button('Show newest history',()=>page(last),history.offset===last));box.append(jumps);
 const list=node('ol','','sheet-history');list.start=history.offset+1;list.setAttribute('aria-label','Committed advancements');
 for(const entry of history.entries){const item=node('li','','sheet-history-entry'),head=node('div','','sheet-history-entry-header');item.dataset.category=entry.category;const motif:CharacterMotif=entry.category==='ATTRIBUTE'?'milestone':entry.category==='PROFICIENCY'?'proficiency':entry.category==='FEAT'?'feat':entry.category==='SUBCLASS'?'subclass':'class',marker=node('span','','chronicle-marker');marker.append(characterIcon(motif));item.append(marker);head.append(node('span',historyCategories[entry.category]??'Advancement','sheet-history-category'),node('h3',entry.name));const time=historyTime(entry.recordedAt);if(time){const at=node('time',time.label);at.dateTime=time.iso;at.title='Recorded event time: '+time.iso;head.append(at);}else head.append(node('span','Recorded time unavailable','help'));item.append(head);
  const context=[entry.level!==null?`Character level ${entry.level}`:'',entry.milestone!==null?`Milestone ${entry.milestone}`:''].filter(Boolean).join(' · ');if(context)item.append(node('p',context,'help'));
  if(entry.changes.length){const changes=node('dl','','sheet-history-changes');for(const change of entry.changes){const row=node('div'),value=(v:number|string|null)=>v===null?'Unavailable':typeof v==='number'?String(v):titleCase(v);row.append(node('dt',titleCase(change.name)),node('dd',change.before===null?value(change.after):`${value(change.before)} → ${value(change.after)}`));changes.append(row);}item.append(changes);}list.append(item);
 }box.append(list);
 const nav=node('nav','','sheet-history-controls');nav.setAttribute('aria-label','History pages');nav.append(button('Previous history page',()=>page(Math.max(0,history.offset-history.pageSize)),history.offset===0),button('Next history page',()=>page(history.offset+history.pageSize),!history.hasMore));box.append(nav);
 const top=node('a','Back to history heading');top.href='#character-history-title';box.append(top);
}
