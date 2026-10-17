import type { GameSession } from './session.js';
import type { AdvancementChoice } from './types.js';
import { canChooseAdvancement,publicChoiceText } from './advancement-model.js';
export function node<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''){const el=document.createElement(tag);el.textContent=text;el.className=className;return el;}
export function button(text:string,run:()=>void,disabled=false){const b=node('button',text);b.type='button';b.dataset.focus=text;b.disabled=disabled;b.addEventListener('click',run);return b;}
export function section(title:string){const el=node('section','','panel advancement-section');el.tabIndex=-1;el.append(node('h2',title));return el;}
export function knownText(parent:HTMLElement,item:{description?:unknown;effects?:unknown}){const description=publicChoiceText(item.description);if(description)parent.append(node('p',description,'advancement-description'));const effects=typeof item.effects==='string'?[item.effects]:Array.isArray(item.effects)?item.effects.filter((e):e is string=>typeof e==='string'):[];for(const effect of effects)parent.append(node('p',effect,'help'));}
export function confirmChoice(source:HTMLElement,session:GameSession,choice:AdvancementChoice,title:string,description:string){
 if(!canChooseAdvancement(session.advancement,choice))return;
 const dialog=node('dialog','','advancement-confirmation');dialog.setAttribute('aria-label','Confirm advancement');dialog.append(node('h2',title),node('p',description),node('p','This commits a permanent progression choice for the current run.','help'));
 const restore=document.activeElement instanceof HTMLElement?document.activeElement.dataset.focus:undefined;
 const cancel=button('Cancel advancement',()=>dialog.close()),commit=button('Confirm advancement',()=>{if(!session.busy&&!session.pending&&canChooseAdvancement(session.advancement,choice)){dialog.close();void session.chooseAdvancement(choice);}});
 dialog.append(cancel,commit);const observer=new MutationObserver(()=>{if(!source.isConnected)dialog.close();});observer.observe(document.body,{childList:true,subtree:true});dialog.addEventListener('close',()=>{observer.disconnect();dialog.remove();if(restore){const target=Array.from(document.querySelectorAll<HTMLElement>('[data-focus]')).find(el=>el.dataset.focus===restore);if(target&&!(target instanceof HTMLButtonElement&&target.disabled))target.focus();else document.getElementById('character-section-title')?.focus();}},{once:true});document.body.append(dialog);dialog.showModal();cancel.focus();
}
