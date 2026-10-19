import type { GameSession } from './session.js';
import type { Snapshot } from './types.js';
import { node } from './advancement-controls.js';
import { characterAttributes,characterClasses,characterLabel,characterXP,exactXP } from './character-model.js';
import { characterIcon } from './character-icons.js';
import { knownSpecializations } from './character-presentation-model.js';

export function sheetFact(title:string,value:string){const fact=node('div','','sheet-fact');fact.append(node('dt',title),node('dd',value));return fact;}
export function characterIdentity(s:Snapshot,session:GameSession){
 const p=s.progression,classes=characterClasses(s),xp=characterXP(p),specializations=knownSpecializations(s,session.advancement);
 const header=node('section','','sheet-identity panel'+(session.characterSection==='overview'?'':' sheet-identity-compact'));header.setAttribute('aria-label','Character identity and experience');
 const cameo=node('div','','sheet-cameo');cameo.append(characterIcon('adventurer'));const identity=node('div','','sheet-identity-body');identity.append(node('p','Character folio','folio-kicker'),node('p',classes.map(c=>`${c.name} ${c.nativeLevel}`).join(' · ')||'Class information unavailable','sheet-class-line'));
 if(specializations?.length)identity.append(node('p',specializations.map(c=>`${classes.find(k=>k.classId===c.classId)?.name??'Class name unavailable'} · ${c.name}`).join(' / '),'sheet-specializations'));
 identity.append(node('p',`${characterLabel(s.game.run.mode)} · ${characterLabel(s.game.run.status)}`,'sheet-run-status'));
 const badge=node('div','','sheet-level');badge.classList.toggle('sheet-level-wide',String(p.level).length>2);badge.append(node('span','Total level'),node('strong',String(p.level)));
 const experience=node('div','','sheet-experience'),facts=node('dl','','sheet-facts');facts.append(sheetFact('Total XP',exactXP(p.xp)),sheetFact('Pending level-ups',p.readiness?String(p.readiness.pendingLevels):'Unavailable'));
 if(!xp.capped&&xp.nextEarnableLevel!==null&&p.readiness?.nextThreshold)facts.append(sheetFact('Next earnable threshold',exactXP(p.readiness.nextThreshold)+' XP'));experience.append(facts);
 if(xp.capped)experience.append(node('p',p.level===xp.maximumLevel?'Maximum level reached':`All authored XP levels earned${xp.maximumLevel?' · level '+xp.maximumLevel:''}. Allocate pending levels to complete your build.`,'sheet-cap'));
 else if(xp.nextEarnableLevel!==null&&p.readiness?.nextThreshold){experience.append(node('p',`Toward earnable level ${xp.nextEarnableLevel}`,'sheet-xp-title'));if(xp.percent!==null){const meter=node('div','','sheet-xp-meter');meter.setAttribute('role','progressbar');meter.setAttribute('aria-label',`XP toward earnable level ${xp.nextEarnableLevel}`);meter.setAttribute('aria-valuemin','0');meter.setAttribute('aria-valuemax','100');meter.setAttribute('aria-valuenow',String(xp.percent));meter.setAttribute('aria-valuetext',`${exactXP(p.xp)} total XP; ${xp.remaining?exactXP(xp.remaining):'unknown'} XP remaining`);const fill=node('span');fill.style.width=xp.percent+'%';meter.append(fill);experience.append(meter);}if(xp.remaining)experience.append(node('p',`${exactXP(xp.remaining)} XP to the next earnable level`,'sheet-xp-remaining'));}
 else experience.append(node('p','Next-level XP progress is unavailable.','help'));
 header.append(cameo,identity,badge,experience);return header;
}
export function attributeOverview(s:Snapshot){
 const section=node('section','','panel sheet-card sheet-attributes');section.append(node('h2','Attributes'));const list=node('dl','','sheet-attribute-grid');
 for(const key of characterAttributes){const fact=sheetFact(characterLabel(key),String(s.progression.build.attributes?.[key]??'—'));fact.classList.add('sheet-attribute');fact.querySelector('dt')!.prepend(characterIcon(key));list.append(fact);}
 section.append(list,node('p','Current character attributes from your saved progression. Equipment and temporary effects are not included.','sheet-note'));return section;
}
export function classProgression(s:Snapshot,session:GameSession){
 const section=node('section','','panel sheet-card sheet-class-progression');section.append(node('h2','Class progression'),node('p',`Total character level ${s.progression.level}`,'sheet-subtitle'));
 const list=node('ul','','sheet-classes'),specializations=knownSpecializations(s,session.advancement);
 for(const c of characterClasses(s)){const entry=node('li'),seal=node('span','','sheet-class-seal');seal.append(characterIcon('class'));const text=node('div','','sheet-class-entry');text.append(node('strong',c.name),node('span',`Native level ${c.nativeLevel}${c.maximumNativeLevel===null?'':' / '+c.maximumNativeLevel}`));for(const sub of specializations?.filter(v=>v.classId===c.classId)??[])text.append(node('small',sub.name));
  if(c.maximumNativeLevel!==null){const bar=node('div','','sheet-class-meter'),fill=node('span');fill.style.width=Math.min(100,c.nativeLevel/c.maximumNativeLevel*100)+'%';bar.setAttribute('aria-hidden','true');bar.append(fill);text.append(bar);}entry.append(seal,text);list.append(entry);
 }section.append(list);return section;
}
