import { characterIdentity,attributeOverview,classProgression,sheetFact as fact } from './character-presentation.js';
import { renderCharacterHistory } from './character-history.js';
import { pendingCharacterChoices } from './character-history-model.js';
import { ensureAdvancement } from './advancement.js';
import { renderStatistics,renderAbilityBook } from './character-book.js';
import type { CharacterSection } from './types.js';
import { renderAdvancement,renderDecisionSummary } from './advancement.js';
import type { Snapshot } from './types.js';
import type { GameSession } from './session.js';
import { characterAttributes,characterLabel,characterEquipment } from './character-model.js';
import { renderItemArt } from './item-art.js';
import { equipmentSlotTitle } from './equipment.js';
import { sectionNavigation } from './section-navigation.js';
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''){const el=document.createElement(tag);el.textContent=text;el.className=className;return el;}
function card(title:string,className=''){const el=node('section','','panel sheet-card '+className);el.append(node('h2',title));return el;}
function action(title:string,run:()=>void,disabled=false){const b=node('button',title);b.type='button';b.dataset.focus=title;b.disabled=disabled;b.addEventListener('click',run);return b;}
function startingBuild(s:Snapshot,session:GameSession,disabled:boolean){
 const section=card('Starting class & attributes','sheet-setup');section.append(node('p','Choose a discovered class and a starting attribute preset. These choices shape this run.','muted'));
 if(!s.options.classes.length)section.append(node('p','There are no discovered starting classes available for this run.','empty'));
 const cards=node('div','','sheet-builds');for(const c of s.options.classes){const entry=node('article');entry.append(node('h3',c.name));const presets=s.options.rules.find(r=>r.rulesId===c.rulesId)?.presets??[];
 for(const preset of presets){const presetCard=node('div','','sheet-preset');presetCard.append(node('h4',characterLabel(preset.key)),node('p',characterAttributes.map(key=>`${characterLabel(key)} ${preset.attributes[key]??'—'}`).join(' · '),'help'),action(`Choose ${c.name} · ${characterLabel(preset.key)}`,()=>void session.action('/api/v1/progression/start','START_BUILD',{classId:c.classId,presetKey:preset.key}),disabled));entry.append(presetCard);}
 if(!presets.length)entry.append(node('p','No starting presets are available for this class.','help'));cards.append(entry);}section.append(cards);return section;
}
function equipmentSummary(s:Snapshot,session:GameSession,openPack:()=>void){
 const section=card('Equipment','sheet-equipment'),{plan,items}=characterEquipment(s,session);section.append(node('p',plan?`Active weapon set ${plan.activeSet}`:'Equipment information unavailable','sheet-subtitle'));
 if(session.equipmentDraft)section.append(node('p','Showing your staged equipment. Apply or revert changes in Pack.','sheet-note'));
 const weapons=node('dl','','sheet-weapons');for(const slot of ['MAIN_HAND','OFF_HAND']){const item=items.find(i=>i.slot===slot&&i.set===plan?.activeSet),main=items.find(i=>i.slot==='MAIN_HAND'&&i.set===plan?.activeSet);weapons.append(fact(equipmentSlotTitle(slot),item?.gear?.name??(item?'Item details unavailable':slot==='OFF_HAND'&&main?.gear?.hands===2?'Occupied by two-handed weapon':plan?'Empty':'Unavailable')));}section.append(weapons);
 const list=node('ul','','sheet-gear');for(const item of items){const entry=node('li');entry.append(renderItemArt({name:item.gear?.name??'',category:'EQUIPMENT',equipment:{slots:item.gear?.slots??[item.slot]},artwork:item.gear?.artwork,icon:item.gear?.icon}));const text=node('div');text.append(node('small',equipmentSlotTitle(item.slot)),node('strong',item.gear?.name??'Item details unavailable'));entry.append(text);list.append(entry);}if(items.length)section.append(list);else if(plan)section.append(node('p','No items equipped in the active setup.','help'));
 section.append(action('Open Pack & equipment',openPack));return section;
}
export function renderCharacter(main:HTMLElement,s:Snapshot,session:GameSession,disabled:boolean,openPack:()=>void){
 main.classList.add('character-sheet');const configured=s.progression.build.mode==='CONFIGURED',title=node('h1',configured?'Your character':'Choose your starting build');title.tabIndex=-1;main.append(title);
 if(!configured){main.append(node('p','This life has no starting build yet. Your first confirmed choice will begin its advancement history.','sheet-note'),startingBuild(s,session,disabled));if(!s.game.canWrite)main.append(node('p','This session is view only. Sign in with play access to choose a starting build.','notice'));return;}
 ensureAdvancement(session);const indicator=pendingCharacterChoices(s,session.advancement);
 const select=(key:CharacterSection)=>{session.setCharacterSection(key);document.getElementById('character-section-title')?.focus({preventScroll:true});document.getElementById('character-section')?.scrollIntoView({block:'nearest'});};
 main.append(sectionNavigation('Character sections',[{key:'overview',title:'Overview',available:true},{key:'progression',title:'Progression',available:true,indicator},{key:'abilities',title:'Abilities',available:true},{key:'statistics',title:'Statistics',available:true},{key:'history',title:'History',available:true}],session.characterSection,key=>select(key),'character-section'));
 const panel=node('div','','sheet-section');panel.id='character-section';const sectionTitle=node('h2',session.characterSection==='overview'?'Character overview':session.characterSection==='progression'?'Character progression':session.characterSection==='statistics'?'Character statistics':session.characterSection==='history'?'Character history':'Character abilities','sheet-section-title');sectionTitle.id='character-section-title';sectionTitle.tabIndex=-1;panel.setAttribute('aria-labelledby',sectionTitle.id);panel.append(sectionTitle);main.append(panel);
 panel.append(characterIdentity(s,session));
 if(!s.game.canWrite)panel.append(node('p','View-only session: you can inspect your character and history, but cannot commit changes.','notice'));
 if(s.game.activeEncounter)panel.append(node('p','An encounter is active. Character inspection remains available; advancement choices wait until the instance ends.','sheet-note'));
 if(session.characterSection==='history'){renderCharacterHistory(panel,session);return;}
 if(session.characterSection==='statistics'){renderStatistics(panel,session,openPack);return;}
 if(session.characterSection==='abilities'){renderAbilityBook(panel,session);return;}
 if(session.characterSection==='progression'){renderAdvancement(panel,s,session,disabled);return;}
 const grid=node('div','',session.characterSection==='overview'?'sheet-grid':'sheet-grid sheet-progression');panel.append(grid);
 grid.append(classProgression(s,session),renderDecisionSummary(session,()=>select('progression')));
 grid.prepend(attributeOverview(s));grid.insertBefore(equipmentSummary(s,session,openPack),grid.querySelector('.sheet-choices'));
}
