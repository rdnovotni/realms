import { decorateItemAction } from './inventory-usability.js';
/** Reuses inspector guards and confirmations for mouse, touch and keyboard. */
export function attachItemContextMenu(tile:HTMLButtonElement,open:()=>void){
 let timer:ReturnType<typeof setTimeout>|undefined,start:{x:number;y:number}|null=null,suppress=false;
 const cancel=()=>{if(timer)clearTimeout(timer);timer=undefined;start=null;};
 const show=()=>{
  cancel();if(!tile.isConnected)return;open();const detail=document.getElementById('inventory-details');if(!detail)return;
  let chosen:HTMLButtonElement|undefined;const dialog=document.createElement('dialog');dialog.className='item-context-menu';dialog.setAttribute('aria-label','Item actions');const heading=document.createElement('h3');heading.textContent=detail.querySelector('h3')?.textContent??'Item actions';dialog.append(heading);
  for(const action of Array.from(detail.querySelectorAll<HTMLButtonElement>('button')).filter(b=>!b.disabled&&!b.closest('form')&&!b.closest('details:not([open])')&&b.textContent!=='Close item details')){const button=document.createElement('button');button.type='button';button.textContent=action.textContent;decorateItemAction(button);button.addEventListener('click',()=>{chosen=action;dialog.close();});dialog.append(button);}
  const close=document.createElement('button');close.type='button';close.textContent='Close item actions';close.addEventListener('click',()=>dialog.close());dialog.append(close);
  const observer=new MutationObserver(()=>{if(!detail.isConnected&&dialog.open)dialog.close();});observer.observe(document.body,{childList:true,subtree:true});
  const restore=tile.dataset.focus;dialog.addEventListener('close',()=>{observer.disconnect();dialog.remove();if(chosen){if(chosen.isConnected)chosen.click();return;}Array.from(document.querySelectorAll<HTMLElement>('[data-focus]')).find(n=>n.dataset.focus===restore)?.focus();},{once:true});document.body.append(dialog);dialog.showModal();dialog.querySelector('button')?.focus();
 };
 tile.addEventListener('contextmenu',e=>{e.preventDefault();show();});
 tile.addEventListener('keydown',e=>{if(e.key==='ContextMenu'||e.key==='F10'&&e.shiftKey){e.preventDefault();show();}});
 tile.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch')return;start={x:e.clientX,y:e.clientY};timer=setTimeout(()=>{suppress=true;show();},550);});
 tile.addEventListener('pointermove',e=>{if(start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>10)cancel();});
 for(const event of ['pointerup','pointercancel','dragstart'])tile.addEventListener(event,cancel);
 tile.addEventListener('click',e=>{if(suppress){suppress=false;e.preventDefault();e.stopImmediatePropagation();}},true);
}
