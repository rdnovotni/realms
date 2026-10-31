import {forgetMud} from '../mud-model.js';
forgetMud();
import {sceneFixture} from './scene-fixture.js';
import { npcFixture,npcProposal } from './npc-fixture.js';
import { journalFixture } from './journal-fixture.js';
import { noncombatFixture } from './noncombat-fixture.js';
import { combatFixture,combatPreparationFixture } from './combat-fixture.js';
import { openCombatPreparation,openPreparedItemUse } from '../combat-preparation.js';
import { openMonsterManual,openCombatLog } from '../combat-tools.js';
import { consumptionFixture,nightcapFixture,mealFixture } from './consumption-fixture.js';
import { openItemUse } from '../inventory-services.js';
import { reviewMeal } from '../consumption.js';
import { turnFixture } from './turn-fixture.js';
/** Development-only frozen public projections. Not served by production registerClient. */
import { GameSession } from '../session.js';
import { ApiClient } from '../api.js';
import { render,type Screen } from '../views.js';
import { openItemComparison } from '../item-comparison.js';
import { openAppearance,applyAppearance } from '../appearance.js';
import type { Snapshot,InventoryPage,Advancement,EquipmentPreview,AbilityBook,AdvancementHistory,CharacterSection } from '../types.js';
type Fixture={schemaVersion:number;snapshot:Snapshot;inventory:InventoryPage|null;advancement:Advancement|null;equipmentPreview:EquipmentPreview|null;characterStats:EquipmentPreview|null;abilityBook:AbilityBook|null;characterHistory:AdvancementHistory|null};
const scenes=['mud-text','mud-minimal','mud-retro','mud-resume','mud-error','scene','scene-alarm','scene-solved','scene-failforward','scene-empty','scene-loading','scene-error','scene-readonly','npc','npc-remembered','npc-proposal','npc-ambiguous','npc-absent','npc-empty','npc-loading','npc-error','npc-readonly','dm-shell','dm-compact','dm-speed','dm-onboarding','overview','progression','abilities','statistics','history','inventory','paperdoll','inspector','comparison','loadouts','adventure','combat','dialog','empty','loading','error','setup','stress','daily','daily-waiting','daily-confirmation','daily-loading','daily-error','daily-readonly','consumption','consumption-overdrunk','consumption-empty','consumption-loading','consumption-error','consumption-readonly','consumption-running','consumption-nightcap','consumption-meal','adventure-overdrunk','combat-field','combat-boss','combat-shared-lobby','combat-shared-waiting','combat-shared-claim','combat-readonly','combat-preparation','combat-item-review','combat-manual','combat-log','combat-routine','noncombat','noncombat-empty','noncombat-loading','noncombat-error','noncombat-readonly','noncombat-resolved','journal','journal-empty','journal-loading','journal-error','journal-readonly','journal-resolved','journal-partial'];
const url=new URL(location.href),scene=url.searchParams.get('scene')??'overview',mode=url.searchParams.get('mode')??'normal';
const name=scene==='setup'||scene==='dm-onboarding'?'setup':(scene.startsWith('dm-')||scene.startsWith('mud-'))?'adventure':scene.startsWith('adventure')?'adventure':['inventory','paperdoll','inspector','comparison','loadouts','empty','loading','error'].includes(scene)?'pack':(['adventure','combat','setup'].includes(scene)||scene.startsWith('combat'))?'combat':'character';
const response=await fetch('/dev/fixture/'+name);if(!response.ok)throw Error('Start the frozen visual reference server');const fixture:Fixture=await response.json();
const manifest=await (await fetch('/dev/manifest')).json() as {sha256:string};
if(fixture.schemaVersion!==1)throw Error('Unsupported visual fixture');
const root=document.getElementById('app')!;
if(scene.startsWith('combat-'))fixture.snapshot.battle=combatFixture(fixture.snapshot,scene);
const readModels:Record<string,unknown>={
 '/api/v1/tactical/preparation':combatPreparationFixture(fixture.snapshot),
 '/api/v1/monsters':{entries:[{id:'monster.temple',name:'Temple guardian',knowledge:'OBSERVED',encounters:3,victories:2,description:{description:'An ancient ward protects the ruined hall.'},abilities:['temple.marked_eruption']}],offset:0,hasMore:false},
 ['/api/v1/tactical/'+fixture.snapshot.battle?.instanceId+'/log']:{round:3,outcome:'VICTORY',entries:[{revision:1,actorId:'hero',kind:'INTERACT',targetId:null,source:'brazier',roll:14,hit:true,damage:8,healing:0,events:[{kind:'COMBO',targetId:'enemy',amount:8},{kind:'BREAK',targetId:'enemy',amount:0}]}],hasMore:false,nextAfter:1},
 '/api/v1/inventory/use-preview':nightcapFixture(fixture.snapshot),'/api/v1/consumption/meals/preview':mealFixture(fixture.snapshot),
 '/api/v1/client/state':fixture.snapshot.game,'/api/v1/progression':fixture.snapshot.progression,
 '/api/v1/progression/options':fixture.snapshot.options,'/api/v1/inventory':fixture.inventory,
 '/api/v1/equipment/preview':fixture.equipmentPreview,'/api/v1/character/abilities':fixture.abilityBook,'/api/v1/character/history':fixture.characterHistory,
};
const session=new GameSession(new ApiClient(async(path,init)=>{
 if(init?.method!=='GET')return new Response(JSON.stringify({error:'VISUAL_REFERENCE_READ_ONLY'}),{status:403});
 const key=path.split('?')[0]!;
 if(key==='/api/v1/equipment/preview'){const plan=new URL(path,'http://reference').searchParams.get('plan');if(plan){const canonical=(p:{activeSet:string;slots:{set:string;slot:string;itemId:string}[]})=>JSON.stringify({activeSet:p.activeSet,slots:[...p.slots].sort((a,b)=>(a.set+a.slot).localeCompare(b.set+b.slot))});try{if(canonical(JSON.parse(plan))!==canonical(fixture.snapshot.game.equipment!))return new Response(JSON.stringify({error:'VISUAL_REFERENCE_UNAVAILABLE'}),{status:404});}catch{return new Response('{}',{status:400});}}}
 const value=readModels[key];return new Response(JSON.stringify(value??{error:'VISUAL_REFERENCE_UNAVAILABLE'}),{status:value?200:404,headers:{'Content-Type':'application/json'}});
}));
session.snapshot=structuredClone(fixture.snapshot);session.config={protocolVersion:1,authMode:'sessions',previewOnly:true};session.inventory=structuredClone(fixture.inventory);session.inventoryQuery={sort:'NAME',direction:'ASC',grouped:false,offset:0};session.advancement=structuredClone(fixture.advancement);session.equipmentPreview=structuredClone(fixture.equipmentPreview);session.characterStats=structuredClone(fixture.characterStats);session.abilityBook=structuredClone(fixture.abilityBook);session.characterHistory=structuredClone(fixture.characterHistory);session.inventoryEquipmentOpen=true;
session.notice={kind:'info',text:'Frozen disposable visual fixture · no gameplay writes.'};
if(scene.startsWith('scene')){session.scenes=sceneFixture(session.snapshot,scene);session.sceneSelected=session.scenes.selected?.id;}
if(scene==='scene-loading'){session.scenes=null;session.sceneBusy=true;}
if(scene==='scene-error'){session.scenes=null;session.sceneError='Could not load the scene. Retry when connected.';}
if(scene==='scene-readonly')session.snapshot.game.canWrite=false;
if(scene.startsWith('npc')){session.npcs=npcFixture(session.snapshot,scene);session.npcSelected=session.npcs.selected?.id;}
if(scene==='npc-loading'){session.npcs=null;session.npcBusy=true;}
if(scene==='npc-error'){session.npcs=null;session.npcError='Could not load your contact. Retry when connected.';}
if(scene==='npc-readonly')session.snapshot.game.canWrite=false;
if(scene==='npc-proposal'||scene==='npc-ambiguous')session.npcInterpretation=npcProposal(session.npcs!,scene==='npc-ambiguous');
if(scene.startsWith('journal'))session.journal=journalFixture(session.snapshot,scene);
if(scene==='journal-loading'){session.journal=null;session.journalBusy=true;}
if(scene==='journal-error'){session.journal=null;session.journalError='Could not load your saved Journal. Retry when connected.';}
if(scene==='journal-readonly')session.snapshot.game.canWrite=false;
if(scene.startsWith('daily'))session.turns=turnFixture(session.snapshot);
if(scene==='daily-waiting'){session.snapshot.game.rolloverPending=true;session.turns!.rollover.pending=3;session.turns!.rollover.deferred=true;}
if(scene==='daily-confirmation')session.reserveAction={path:'/api/v1/rules/interaction',type:'RESOLVE_RULE_INTERACTION',parameters:{entityId:'activity.quick'}};
if(scene==='daily-loading'){session.turns=null;session.turnsBusy=true;}
if(scene==='daily-error'){session.turns=null;session.turnsError='Daily plan could not be loaded. Refresh to reconnect.';}
if(scene==='daily-readonly'){session.snapshot.game.canWrite=false;session.reserveAction={path:'/api/v1/rules/interaction',type:'RESOLVE_RULE_INTERACTION',parameters:{entityId:'activity.quick'}};}
if(scene.startsWith('consumption'))session.consumption=consumptionFixture(session.snapshot);
if(scene==='consumption-overdrunk'){session.snapshot.game.overdrunk=true;session.consumption!.overdrunk=true;session.consumption!.balance.drunkenness=18;session.consumption!.undoEventId='123';}
if(scene==='consumption-empty'){session.consumption!.items=[];session.consumption!.plans=[];session.consumption!.executions=[];}
if(scene==='consumption-loading'){session.consumption=null;session.consumptionBusy=true;}
if(scene==='consumption-error'){session.consumption=null;session.consumptionError='Your consumable planner could not be loaded. Refresh to reconnect.';}
if(scene==='consumption-readonly')session.snapshot.game.canWrite=false;
if(scene==='consumption-running'){session.consumption!.executions[0]!.status='ACTIVE';session.consumption!.executions[0]!.stopReason=null;session.runningMeal=session.consumption!.executions[0]!.id;}
if(scene==='adventure-overdrunk')session.snapshot.game.overdrunk=true;
if(scene.startsWith('mud-')){session.dm.scope(session.snapshot.game.run.runId);session.dm.preset=scene==='mud-minimal'?'MINIMAL':scene==='mud-retro'?'RETRO':'TEXT';session.scenes=sceneFixture(session.snapshot,'scene');session.snapshot.game.playerStatus={vitals:{health:21,maxHealth:30,mana:4,maxMana:10},resources:[{name:'Energy',amount:'4',capacity:'10'}],conditions:['Fatigued'],companions:['Companion']};session.dm.draft=scene==='mud-error'?'open impossible door':'inspect the maintenance desk';session.dm.add({surface:'room',channel:'dm',lines:['Town archive','Known exits: Sluice office. Visible observer: Gallery guard.'],mentions:[{label:'Inspect maintenance desk',command:'inspect Maintenance desk'}],restored:scene==='mud-resume'});session.dm.add({surface:'command',channel:'facts',lines:['No action has been taken.'],restored:scene==='mud-resume'});if(scene==='mud-error')session.dm.add({surface:'command',channel:'warning',lines:['Unknown command. Your input is preserved; try actions.']});}
if(scene.startsWith('dm-')){session.dm.scope(session.snapshot.game.run.runId);session.dm.focus('The gatekeeper','synthetic-gatekeeper');session.dm.add({surface:'room',channel:'dm',lines:['You reach the old watchtower.'],prose:['The gatekeeper has arranged his forms into a small defensive wall.','He appears willing to negotiate its surrender.']});session.dm.add({surface:'room',channel:'npc',speaker:'Gatekeeper · synthetic example',lines:['The bridge is safe, according to my predecessor.']});session.dm.add({surface:'system',channel:'party',speaker:'Companion · synthetic example',lines:['Let us inspect it first.']});session.dm.add({surface:'check',channel:'facts',lines:['Inspection preview: 1 Turn. No action has been taken.']});session.dm.add({surface:'check',channel:'warning',lines:['Failure may increase alert. Review the disclosed consequence before committing.'],protected:true});if(scene==='dm-compact')session.dm.preferences.density='COMPACT';if(scene==='dm-speed')session.dm.preferences.density='SPEED';}
let screen:Screen=scene.startsWith('mud-')?'scenes':scene==='dm-onboarding'?'character':(scene.startsWith('dm-')||scene.startsWith('mud-'))?'adventure':scene.startsWith('scene')?'scenes':scene.startsWith('npc')?'npcs':scene.startsWith('journal')?'journal':scene.startsWith('consumption')?'consumption':scene.startsWith('daily')?'daily':['inventory','paperdoll','inspector','comparison','loadouts','empty','loading','error'].includes(scene)?'pack':scene.startsWith('adventure')?'adventure':scene.startsWith('combat')?'combat':'character';
if(['overview','progression','abilities','statistics','history'].includes(scene))session.characterSection=scene as CharacterSection;
if(scene==='stress'){
 session.characterSection='progression';
 for(const c of session.snapshot.options.classes)c.name='The extraordinarily long named Order of the Wandering Lantern · '+c.name;
 if(session.advancement){for(const c of session.advancement.classes)c.name='The extraordinarily long named Order of the Wandering Lantern · '+c.name;
  const skill=session.advancement.proficiencies.options[0];if(skill)session.advancement.proficiencies.options=Array.from({length:64},(_,i)=>({...structuredClone(skill),skillId:'visual.skill.'+i,name:'Synthetic lengthy proficiency '+i+' · '+skill.name}));
  const feat=session.advancement.feats.options[0];if(feat)session.advancement.feats.options=Array.from({length:64},(_,i)=>({...structuredClone(feat),featId:'visual.feat.'+i,name:'Synthetic lengthy compendium entry '+i+' · '+feat.name}));
 }
}
if(scene==='loadouts')session.inventoryLoadoutsOpen=true;
if(scene==='empty'&&session.inventory)session.inventory={...session.inventory,total:0,items:[]};
if(scene==='loading'){session.inventory=null;session.inventoryBusy=true;}
if(scene==='error'){session.inventory=null;session.inventoryError='Inventory could not be loaded. Refresh to reconnect.';}
const selected=session.inventory?.items.find(i=>i.id===session.snapshot!.game.equipment?.slots.find(s=>s.set===session.snapshot!.game.equipment!.activeSet&&s.slot==='MAIN_HAND')?.itemId)??session.inventory?.items.find(i=>i.equipment);
if(['inspector','comparison'].includes(scene)&&selected)session.selectInventory(selected);
const draw=()=>render(root,session,screen,next=>{screen=next;draw();},()=>{});
session.action=async()=>{session.notice={kind:'info',text:'Visual reference only: no gameplay action was sent.'};draw();};
session.subscribe(draw);
applyAppearance({theme:'parchment',texture:url.searchParams.get('texture')!=='off'});draw();
const bar=document.createElement('aside');bar.className='visual-reference-controls';bar.setAttribute('aria-label','Development visual reference');
const title=document.createElement('strong');title.textContent='Visual reference · frozen synthetic test projections';bar.append(title);
for(const [label,options,current,key]of [['Scene',scenes,scene,'scene'],['CSS test mode',['normal','motion','contrast','forced','text200','coarse'],mode,'mode']]as const){const field=document.createElement('label');field.textContent=label;const select=document.createElement('select');for(const value of options){const option=document.createElement('option');option.value=value;option.textContent=value;select.append(option);}select.value=current;select.addEventListener('change',()=>{const next=new URL(location.href);next.searchParams.set(key,select.value);location.assign(next);});field.append(select);bar.append(field);}
const audit=document.createElement('button');audit.type='button';audit.textContent='Audit current visual fixture';const output=document.createElement('output');output.id='visual-audit';output.setAttribute('aria-live','polite');
if(scene.startsWith('noncombat')){session.noncombat=scene==='noncombat-loading'||scene==='noncombat-error'?null:noncombatFixture(session.snapshot!,scene);session.noncombatBusy=scene==='noncombat-loading';session.noncombatError=scene==='noncombat-error'?'Connection lost. Refresh to retry.':null;session.snapshot!.game.canWrite=scene!=='noncombat-readonly';render(root,session,'noncombat',()=>{},()=>{});}
const captureKey='folio-visual-capture:'+manifest.sha256;
const captured=new Map<string,unknown>();
try{for(const record of JSON.parse(sessionStorage.getItem(captureKey)??'[]'))captured.set(record.scene+':'+record.mode+':'+record.viewport.width,record);}catch{ /* Storage is optional; current-page export still works. */ }
const runAudit=()=>{
 const visible=(n:Element)=>!!n.getClientRects().length;
 const controls=[...document.querySelectorAll<HTMLElement>('#app button,#app input,#app select,dialog button,dialog input,dialog select')].filter(visible);
 const unnamed=controls.filter(n=>!n.getAttribute('aria-label')&&!n.getAttribute('aria-labelledby')&&!n.textContent?.trim()&&!(n instanceof HTMLInputElement&&n.labels?.length));
 const tileCollisions=[...document.querySelectorAll('.inventory-tile')].filter(tile=>{const footer=tile.querySelector('.inventory-tile-footer'),meta=tile.querySelector('.inventory-item-meta');return footer&&meta&&footer.getBoundingClientRect().top<meta.getBoundingClientRect().bottom-1;}).length;
 // Check rendered text/control boxes: a compressed grid cell can hide overflow
 // while its wordmark still paints underneath a neighboring utility button.
 const headerGroups=['.shell-brand svg,.shell-brand .wordmark>span,.shell-brand .wordmark>small','.shell-utility .connection,.shell-utility button','.shell-navigation button'].map(selector=>[...document.querySelectorAll(selector)].filter(visible));
 const intersects=(a:Element,b:Element)=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return Math.min(x.right,y.right)-Math.max(x.left,y.left)>1&&Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>1;};
 let headerCollisions=0;
 for(let i=0;i<headerGroups.length;i++)for(let j=i+1;j<headerGroups.length;j++)for(const a of headerGroups[i]!)for(const b of headerGroups[j]!)if(intersects(a,b))headerCollisions++;
 const shellBar=document.querySelector('.shell-bar')?.getBoundingClientRect();
 const headerOverflow=shellBar?headerGroups.flat().filter(n=>{const r=n.getBoundingClientRect();return r.left<shellBar.left-1||r.right>shellBar.right+1;}).length:0;
 const headingLevels=[...document.querySelectorAll('#app main h1,#app main h2,#app main h3,#app main h4')].filter(visible).map(n=>Number(n.tagName[1]));
 const rgb=(value:string)=>{const numbers=value.match(/[\d.]+/g)?.map(Number);return numbers&&numbers.length>=3&&(numbers[3]??1)===1?numbers.slice(0,3):null;};
 const light=(color:number[])=>color.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i]!,0);
 const contrasts:{sample:string;ratio:number;minimum:number}[]=[];
 for(const n of document.querySelectorAll<HTMLElement>('#app main>h1,#app .sheet-identity,#app .inventory-details,#app .adventure-cost,#app .combat-turn,#app .combat-warning,#app .combat-option-cost,#app .combat-option-reason,#app .combat-target-summary,#app .zone-hazard,#app button.primary,dialog,dialog button.danger')){
  if(!visible(n))continue;const style=getComputedStyle(n),foreground=rgb(style.color);let background:number[]|null=null,parent:Element|null=n;
  while(parent&&!background){background=rgb(getComputedStyle(parent).backgroundColor);parent=parent.parentElement;}
  if(foreground&&background){const values=[light(foreground),light(background)].sort((a,b)=>b-a),ratio=(values[0]!+.05)/(values[1]!+.05),large=parseFloat(style.fontSize)>=24||Number(style.fontWeight)>=700&&parseFloat(style.fontSize)>=18.66;contrasts.push({sample:n.tagName+'.'+n.className,ratio:Math.round(ratio*100)/100,minimum:large?3:4.5});}
 }
 const targets=controls.filter(n=>!n.matches(':disabled')&&n.tagName==='BUTTON');
 const report={scene,mode,manifest:manifest.sha256,viewport:{width:innerWidth,height:innerHeight},horizontalOverflow:document.documentElement.scrollWidth>innerWidth,controls:controls.length,contrastSamples:contrasts.length,contrastFailures:contrasts.filter(c=>c.ratio<c.minimum),minimumSampleContrast:contrasts.length?Math.min(...contrasts.map(c=>c.ratio)):null,domElements:document.querySelectorAll('#app *').length,filteredItemArt:[...document.querySelectorAll('.item-illustration')].filter(n=>getComputedStyle(n).filter!=='none').length,smallTargets:targets.filter(n=>n.getBoundingClientRect().height<24||n.getBoundingClientRect().width<24).length,coarseSmallTargets:mode==='coarse'?targets.filter(n=>n.getBoundingClientRect().height<44).length:null,unnamedControls:unnamed.length,tileCollisions,headerCollisions,headerOverflow,decorativeSvgErrors:[...document.querySelectorAll('.folio-icon')].filter(n=>n.getAttribute('aria-hidden')!=='true'||n.getAttribute('focusable')!=='false').length,headingSkips:headingLevels.filter((n,i)=>i>0&&n>headingLevels[i-1]!+1).length,texture:getComputedStyle(document.documentElement).getPropertyValue('--folio-paper-texture').trim(),bodyFont:getComputedStyle(document.documentElement).fontSize,maximumControlTransitionMs:Math.max(0,...controls.flatMap(n=>getComputedStyle(n).transitionDuration.split(',').map(v=>parseFloat(v)*(v.trim().endsWith('ms')?1:1000)))),mainTransition:getComputedStyle(document.querySelector('main')!).transitionDuration,openDialogs:document.querySelectorAll('dialog[open]').length};
 output.textContent=JSON.stringify(report);
 if(parent!==window)parent.postMessage({type:'FOLLYBOUND_VISUAL_REPORT',report},location.origin);
 captured.set(scene+':'+mode+':'+innerWidth,report);
 try{sessionStorage.setItem(captureKey,JSON.stringify([...captured.values()]));}catch{ /* Cosmetic QA capture cannot block rendering. */ }
};audit.addEventListener('click',runAudit);const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Browser contract report';details.append(summary,output);const exportReports=document.createElement('button');exportReports.type='button';exportReports.textContent='Export captured browser reports';exportReports.addEventListener('click',()=>{const blob=new Blob([JSON.stringify([...captured.values()],null,2)+'\n'],{type:'application/json'}),href=URL.createObjectURL(blob),link=document.createElement('a');link.href=href;link.download='browser-contracts.json';link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);});bar.append(audit,exportReports,details);document.body.insertBefore(bar,root);
if(scene==='comparison'&&selected)openItemComparison(session,selected);
if(scene==='dialog')openAppearance();
if(scene==='consumption-nightcap')await openItemUse(session,{id:'00000000-0000-4000-8000-000000000102',useKind:'USE'});
if(scene==='consumption-meal')await reviewMeal(session,'00000000-0000-4000-8000-000000000201');

if(scene==='combat-preparation')await openCombatPreparation(session);
if(scene==='combat-item-review')await openPreparedItemUse(session,session.snapshot.battle!,()=>{});
if(scene==='combat-manual')await openMonsterManual(session);
if(scene==='combat-log')await openCombatLog(session,session.snapshot.battle!.instanceId);
if(scene==='combat-field'||scene==='combat-routine')for(const d of document.querySelectorAll<HTMLDetailsElement>('#app main details'))d.open=true;
window.addEventListener('resize',()=>requestAnimationFrame(runAudit));
window.addEventListener('message',event=>{if(event.source===parent&&event.origin===location.origin&&event.data?.type==='FOLLYBOUND_VISUAL_AUDIT')requestAnimationFrame(runAudit);});
requestAnimationFrame(runAudit);
