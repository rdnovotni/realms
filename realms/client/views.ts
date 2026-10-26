import { renderNoncombat } from './noncombat.js';
import { renderConsumption } from './consumption.js';
import { renderTurnPlanner,renderReserveConfirmation } from './turn-planner.js';
import { folioIcon } from './icons.js';
import { renderAdventure,renderCombat,renderJourneyJournal } from './campaign.js';
export { zoneDistance,failureSummary } from './campaign-model.js';
import { renderShellHeader,renderShellNotice } from './shell.js';
import { shellChapter,shellRenderedScreen } from './shell-model.js';
import { renderCharacter } from './character.js';
import { renderInventory } from './inventory.js';
import { renderLanding } from './landing.js';
import type { GameSession } from './session.js';
import type { Command,Snapshot,Failure } from './types.js';
export type Screen='adventure'|'character'|'pack'|'combat'|'daily'|'consumption'|'noncombat';
let retainedFocus:string|null=null;
export const label=(value:string)=>value==='hero'?'You':value.split(/[._-]/).filter(Boolean).map(w=>w[0]!.toUpperCase()+w.slice(1).toLowerCase()).join(' ');
function el<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''):HTMLElementTagNameMap[K]{const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node;}
function add(node:HTMLElement,...children:(HTMLElement|null)[]){for(const child of children)if(child)node.append(child);return node;}
function button(text:string,action:()=>void,disabled=false,className=''){const b=el('button',text,className);b.type='button';b.dataset.focus=text;b.disabled=disabled;b.addEventListener('click',action);return b;}
function heading(text:string){const h=el('h1',text);h.tabIndex=-1;return h;}
function section(title:string){return add(el('section','','panel'),el('h2',title));}
function field(text:string,name:string,type='text'){const l=el('label',text),input=el('input');input.name=name;input.type=type;input.required=true;input.autocomplete=name==='token'?'off':type==='password'?'current-password':name==='handle'?'username':'off';l.append(input);return {label:l,input};}
export function render(root:HTMLElement,session:GameSession,screen:Screen,navigate:(screen:Screen)=>void,onCommand:(command:Command)=>void){
 root.classList.toggle('public-shell',!session.snapshot);root.classList.toggle('game-shell',!!session.snapshot);
 const selection=document.activeElement instanceof HTMLInputElement?{start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd}:null;
 const previousFocus=document.activeElement instanceof HTMLElement?document.activeElement.dataset.focus:null;
 if(previousFocus)retainedFocus=previousFocus;
 const renderedScreen=shellRenderedScreen(screen,!!session.snapshot?.battle);
 const fragment=document.createDocumentFragment();fragment.append(renderShellHeader(session,renderedScreen,navigate),renderShellNotice(session));
 const disabled=session.busy||!!session.pending||session.needsRefresh||!session.snapshot?.game.canWrite;
 const snapshot=session.snapshot;
 if(!snapshot){fragment.append(renderLanding(session));
 }else{
  const layout=el('div','',screen==='pack'||screen==='character'||screen==='daily'||screen==='consumption'||screen==='noncombat'?'layout inventory-layout':'layout'),left=el('aside','','left-column'),character=section('The wayfarer');character.classList.add('character');const cameo=el('div','','portrait');cameo.append(folioIcon('adventurer','character'));character.prepend(cameo);add(character,el('small',snapshot.progression.build.mode==='CONFIGURED'?snapshot.progression.build.classes?.map(c=>`${snapshot.options.classes.find(option=>option.classId===c.classId)?.name??label(c.classId)} ${c.nativeLevel}`).join(' · ')??'Adventurer':'Choose your calling'),add(el('div','','stats'),stat('Level',String(snapshot.progression.level)),stat('Turns',String(snapshot.game.run.turns)),stat('XP',snapshot.progression.xp)),el('div','','rule'),el('p',snapshot.game.run.status==='AFTERCORE'?'Aftercore · A new chapter':'A life still being written','build-list muted'));left.append(character);
  const help=section('Your next step');add(help,el('p',snapshot.progression.build.mode!=='CONFIGURED'?'Choose a class and starting attributes to shape this life.':snapshot.game.activeEncounter?'Your encounter is saved. Continue from the current turn.':snapshot.progression.readiness?.pendingLevels?'You have earned a level. Choose how your character grows.':'Choose a known adventure. Each entry shows its Turn cost.','help'),button(snapshot.progression.build.mode!=='CONFIGURED'?'Create your build':'View character',()=>navigate('character'),false,'small'));left.append(help);
  if(screen==='combat')layout.classList.add('combat-layout');
  left.setAttribute('aria-label','Character summary');
  const main=el('main','','folio-page');main.id='main';main.setAttribute('aria-busy',String(session.busy));
  const reserveConfirmation=renderReserveConfirmation(session);if(reserveConfirmation)main.append(reserveConfirmation);
  if(screen==='noncombat')renderNoncombat(main,session,disabled);
  else if(screen==='daily')renderTurnPlanner(main,session,disabled,()=>{navigate('consumption');void session.loadConsumption();});
  else if(screen==='consumption')renderConsumption(main,session,disabled,()=>{navigate('daily');void session.loadTurns();});
  else if(screen==='character')renderCharacter(main,snapshot,session,disabled,()=>navigate('pack'));
  else if(screen==='pack')renderPack(main,snapshot,session,disabled);
  else if(screen==='combat'&&snapshot.battle)renderCombat(main,snapshot,disabled,onCommand,navigate,session);
  else renderAdventure(main,snapshot,session,disabled,navigate);
  main.prepend(el('p',shellChapter(renderedScreen),'shell-page-label'));
  const right=el('aside','','right-column');right.setAttribute('aria-label','Journey notes');const journal=renderJourneyJournal(snapshot,()=>navigate('combat'));
  const guide=section('A few things to know');add(guide,el('p','Explore at your own pace. Browsing your character, pack, and saved encounter costs no Turns.','help'),el('p','Choose actions during your turn. The server resolves opponents and automated companions, then returns control to your party.','help'),el('p','Victory rewards and recovery are saved automatically.','help'));add(right,journal,guide);add(layout,left,main,right);fragment.append(layout);
 }
 fragment.append(el('footer','Follybound · A living world, one journey at a time.','footer'));root.replaceChildren(fragment);
 if(!session.busy&&retainedFocus){const matching=Array.from(root.querySelectorAll<HTMLElement>('[data-focus]')).find(e=>e.dataset.focus===retainedFocus);if(matching&&!(matching instanceof HTMLButtonElement&&matching.disabled)){matching.focus();if(matching instanceof HTMLInputElement&&selection?.start!==null&&selection?.start!==undefined)matching.setSelectionRange(selection.start,selection.end);}else (root.querySelector<HTMLElement>('#combat-controls')??root.querySelector<HTMLElement>('main h1'))?.focus();retainedFocus=null;}
}
function stat(name:string,value:string){return add(el('div','','stat'),el('strong',value),el('span',name));}


function renderPack(main:HTMLElement,s:Snapshot,session:GameSession,disabled:boolean){renderInventory(main,s,session,disabled);}
