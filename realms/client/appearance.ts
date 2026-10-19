import { mountDialog } from './interactions.js';
export type Appearance={theme:'parchment';texture:boolean};
type Store=Pick<Storage,'getItem'|'setItem'>;
const key='follybound.appearance.v1';
const defaults:Appearance={theme:'parchment',texture:true};
const store=()=>{try{return globalThis.sessionStorage;}catch{return undefined;}};
export function readAppearance(storage:Store|undefined=store()):Appearance{
 try{const raw=storage?.getItem(key);if(!raw||raw.length>128)return {...defaults};const value=JSON.parse(raw);if(value?.theme==='parchment'&&typeof value.texture==='boolean')return {theme:'parchment',texture:value.texture};}catch{/* Optional tab-scoped cosmetics must not interrupt play. */}
 return {...defaults};
}
export function saveAppearance(value:Appearance,storage:Store|undefined=store()){
 if(value.theme!=='parchment'||typeof value.texture!=='boolean')return;
 try{storage?.setItem(key,JSON.stringify({theme:'parchment',texture:value.texture}));}catch{/* Storage may be denied. */}
}
export function applyAppearance(value:Appearance=readAppearance(),root:HTMLElement=document.documentElement){
 root.dataset.folioTheme='parchment';root.dataset.folioTexture=value.texture?'on':'off';
}
export function openAppearance(){
 const value={...readAppearance(),texture:document.documentElement.dataset.folioTexture!=='off'},box=document.createElement('dialog');box.className='appearance-dialog';box.setAttribute('aria-label','Appearance');
 const title=document.createElement('h2');title.textContent='Appearance';const theme=document.createElement('p');theme.textContent='Parchment · The Adventurer’s Folio';
 const label=document.createElement('label');label.className='folio-check';const toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=value.texture;const text=document.createElement('span');text.textContent='Paper grain texture';label.append(toggle,text);
 const help=document.createElement('p');help.className='help';help.textContent='Applies to this browser tab. Turning grain off preserves all text, controls and status cues. Your device’s contrast and motion preferences still apply.';
 const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 toggle.addEventListener('change',()=>{const next:Appearance={theme:'parchment',texture:toggle.checked};saveAppearance(next);applyAppearance(next);status.textContent=next.texture?'Paper grain enabled.':'Paper grain disabled.';});
 const close=document.createElement('button');close.type='button';close.textContent='Close appearance';close.addEventListener('click',()=>box.close());box.addEventListener('close',()=>box.remove(),{once:true});box.append(title,theme,label,help,status,close);mountDialog(box,{initialFocus:toggle});
}
