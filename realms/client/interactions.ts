/** Native modal semantics provide containment and Escape; this owns naming and restoration. */
let dialogId=0;
export function restoreControl(origin:HTMLElement|null){
 const key=origin?.dataset.focus;
 const target=origin?.isConnected?origin:key?Array.from(document.querySelectorAll<HTMLElement>('[data-focus]')).find(n=>n.dataset.focus===key):null;
 const closed=target?.closest('details:not([open])');
 if(target&&!target.matches(':disabled,[hidden]')&&!target.closest('[hidden]')&&(!closed||closed.querySelector('summary')?.contains(target)))target.focus();
 else (document.getElementById('character-section-title')??document.querySelector<HTMLElement>('main h1'))?.focus();
}
export function mountDialog(box:HTMLDialogElement,options:{origin?:HTMLElement|null;initialFocus?:HTMLElement;restore?:boolean}={}){
 const origin=options.origin??(document.activeElement instanceof HTMLElement?document.activeElement:null);
 if(!box.hasAttribute('aria-label')&&!box.hasAttribute('aria-labelledby')){const title=box.querySelector<HTMLElement>('h1,h2,h3');if(title){title.id||='folio-dialog-'+ ++dialogId;box.setAttribute('aria-labelledby',title.id);}}
 box.tabIndex=-1;
 box.addEventListener('keydown',e=>{
  if(e.key!=='Tab')return;
  const controls=Array.from(box.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],summary,[tabindex]')).filter(n=>n.tabIndex>=0&&!n.matches(':disabled,[hidden]')&&n.getClientRects().length>0);
  const first=controls[0],last=controls.at(-1);
  if(!first){e.preventDefault();box.focus();}
  else if(e.shiftKey&&(document.activeElement===first||document.activeElement===box)){e.preventDefault();last!.focus();}
  else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===box)){e.preventDefault();first.focus();}
 });
 box.addEventListener('close',()=>{queueMicrotask(()=>{if(options.restore!==false&&!document.querySelector('dialog[open]'))restoreControl(origin);});},{once:true});
 if(!box.isConnected)document.body.append(box);box.showModal();(options.initialFocus??box.querySelector<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')??box).focus();
}
/** Inline reviews remain inline, with the same cancellation and one-shot commit behavior. */
export function inlineConfirmation(parent:HTMLElement,message:string,accept:()=>void,options:{className?:string;title?:string;cancel?:string;commit?:string;blocked?:boolean;danger?:boolean}={}){
 const className=options.className??'inventory-confirmation';parent.querySelector('.'+className)?.remove();
 const origin=document.activeElement instanceof HTMLElement?document.activeElement:null,box=document.createElement('div');box.className=className;box.setAttribute('role','group');box.setAttribute('aria-label',options.title??'Confirm change');
 const text=document.createElement('p');text.textContent=message;const cancel=document.createElement('button'),commit=document.createElement('button');cancel.type=commit.type='button';cancel.textContent=options.cancel??'Cancel';commit.textContent=options.commit??'Confirm change';commit.disabled=!!options.blocked;if(options.danger)commit.className='danger';
 const dismiss=()=>{box.remove();restoreControl(origin);};cancel.addEventListener('click',dismiss);box.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();dismiss();}});
 let submitted=false;commit.addEventListener('click',()=>{if(submitted||commit.disabled)return;submitted=true;commit.disabled=true;accept();});box.append(text,cancel,commit);parent.append(box);cancel.focus();return box;
}
