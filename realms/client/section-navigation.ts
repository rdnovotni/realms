/** Page sections use ordinary navigation buttons; unavailable work is text, never a fake tab. */
export function sectionNavigation<K extends string>(name:string,sections:readonly {key:K;title:string;available:boolean;indicator?:string}[],active:K,onSelect:(key:K)=>void,panelId:string){
 const nav=document.createElement('nav');nav.className='sheet-navigation';nav.setAttribute('aria-label',name);
 for(const section of sections){if(!section.available){const text=document.createElement('span');text.className='sheet-section-planned';text.textContent=section.title;const hint=document.createElement('small');hint.textContent='Not yet available';text.append(hint);nav.append(text);continue;}
 const button=document.createElement('button');button.type='button';button.textContent=section.title;if(section.indicator){const badge=document.createElement('span');badge.className='sheet-navigation-indicator';badge.id=panelId+'-indicator-'+section.key;badge.textContent=section.indicator;button.append(badge);button.setAttribute('aria-label',section.title);button.setAttribute('aria-describedby',badge.id);}button.dataset.focus=name+' '+section.key;button.setAttribute('aria-current',active===section.key?'page':'false');button.setAttribute('aria-controls',panelId);button.addEventListener('click',()=>onSelect(section.key));nav.append(button);}
 return nav;
}
