export type Note={title:string;lines:readonly string[]};
let active:{box:HTMLElement;owner:HTMLElement;cleanup:()=>void}|null=null,nextId=0;
export function dismissNote(){active?.cleanup();}
/** One bounded parchment note. Never fetches content or owns an essential action. */
export function attachNote(owner:HTMLElement,note:Note,clickToToggle=false){
 let suppressed=false,timer:ReturnType<typeof setTimeout>|undefined;
 const hide=()=>{if(active?.owner===owner)dismissNote();};
 const show=()=>{
  if(suppressed||!owner.isConnected||active?.owner===owner)return;dismissNote();
  const box=document.createElement('div');box.className='folio-note';box.id='folio-note-'+ ++nextId;box.setAttribute('role','tooltip');
  const title=document.createElement('strong');title.textContent='DM guidance · '+note.title;box.append(title);for(const text of note.lines){const line=document.createElement('p');line.textContent=text;box.append(line);}document.body.append(box);
  const prior=owner.getAttribute('aria-describedby');owner.setAttribute('aria-describedby',[prior,box.id].filter(Boolean).join(' '));if(clickToToggle)owner.setAttribute('aria-expanded','true');
  const cleanup=()=>{if(timer)clearTimeout(timer);observer.disconnect();window.removeEventListener('scroll',hide,true);window.removeEventListener('resize',hide);document.removeEventListener('keydown',escape,true);document.removeEventListener('pointerdown',outside,true);const ids=(owner.getAttribute('aria-describedby')??'').split(' ').filter(id=>id&&id!==box.id);if(ids.length)owner.setAttribute('aria-describedby',ids.join(' '));else owner.removeAttribute('aria-describedby');if(clickToToggle)owner.setAttribute('aria-expanded','false');box.remove();active=null;};
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){suppressed=true;hide();e.preventDefault();e.stopPropagation();}},outside=(e:PointerEvent)=>{if(!owner.contains(e.target as Node)&&!box.contains(e.target as Node))hide();};
  const observer=new MutationObserver(()=>{if(!owner.isConnected)hide();});observer.observe(document.body,{childList:true,subtree:true});active={box,owner,cleanup};
  window.addEventListener('scroll',hide,true);window.addEventListener('resize',hide);document.addEventListener('keydown',escape,true);document.addEventListener('pointerdown',outside,true);
  box.addEventListener('pointerenter',()=>{if(timer)clearTimeout(timer);});box.addEventListener('pointerleave',hide);
  const r=owner.getBoundingClientRect();box.style.width=Math.min(300,innerWidth-24)+'px';box.style.left=Math.max(12,Math.min(r.left,innerWidth-box.offsetWidth-12))+'px';const below=r.bottom+6;box.style.top=(below+box.offsetHeight<=innerHeight-12?below:Math.max(12,r.top-box.offsetHeight-6))+'px';
 };
 owner.addEventListener('pointerenter',e=>{if(e.pointerType!=='touch'&&!clickToToggle)show();});owner.addEventListener('focus',()=>{if(!clickToToggle)requestAnimationFrame(()=>{if(document.activeElement===owner)show();});});
 owner.addEventListener('pointerleave',()=>{timer=setTimeout(hide,120);suppressed=false;});owner.addEventListener('blur',()=>{hide();suppressed=false;});owner.addEventListener('dragstart',hide);
 if(clickToToggle){owner.setAttribute('aria-expanded','false');owner.addEventListener('click',()=>{suppressed=false;if(active?.owner===owner)hide();else show();});}else owner.addEventListener('pointerdown',()=>{suppressed=true;hide();});
}
