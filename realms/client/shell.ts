import type { GameSession } from './session.js';
import type { Screen } from './views.js';
import { shellNavigationPage,shellNoticeLabel } from './shell-model.js';
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''){const n=document.createElement(tag);n.textContent=text;n.className=className;return n;}
function button(text:string,action:()=>void,disabled=false){const b=node('button',text,'small');b.type='button';b.dataset.focus=text;b.disabled=disabled;b.addEventListener('click',action);return b;}
function icon(kind:'seal'|'info'|'error'|'success'|'warning'){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 32 32');svg.setAttribute('class','folio-icon shell-icon');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
 const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',kind==='seal'?'M16 3a13 13 0 1 0 0 26 13 13 0 0 0 0-26Zm6 7-4 8-8 4 4-8 8-4ZM16 3v3m0 20v3M3 16h3m20 0h3':kind==='success'?'M5 16l7 7L27 8':kind==='warning'?'M16 3 30 28H2L16 3Zm0 8v8m0 4v1':kind==='error'?'M7 7l18 18M25 7 7 25M16 2a14 14 0 1 0 0 28 14 14 0 0 0 0-28Z':'M16 2a14 14 0 1 0 0 28 14 14 0 0 0 0-28Zm0 12v10m0-16v1');svg.append(path);return svg;
}
export function renderShellHeader(session:GameSession,screen:Screen,navigate:(s:Screen)=>void){
 const header=node('header','','topbar'),brand=node('div','','wordmark');brand.append(node('span','FOLLYBOUND'),node('small','A world worth wandering'));
 if(!session.snapshot){header.append(brand);return header;}
 const bar=node('div','','shell-bar'),identity=node('div','','shell-brand');identity.append(icon('seal'),brand);
 const navigation=node('nav','','shell-navigation');navigation.setAttribute('aria-label','Game');for(const [key,title]of [['adventure','Adventure'],['character','Character'],['pack','Pack']]as const){const b=button(title,()=>navigate(key));b.classList.remove('small');b.setAttribute('aria-current',shellNavigationPage(screen)===key?'page':'false');navigation.append(b);}
 const utility=node('div','','shell-utility'),connection=node('span',session.snapshot.game.canWrite?'Connected · Saved on server':'Viewing only','connection');connection.classList.toggle('shell-readonly',!session.snapshot.game.canWrite);const tools=node('div','','tools');tools.append(button('Refresh',()=>void session.refresh(),session.busy),button('Sign out',()=>void session.logout(),session.busy||!!session.pending));utility.append(connection,tools);bar.append(identity,navigation,utility);header.append(bar);return header;
}
export function renderShellNotice(session:GameSession){
 const notice=node('div','',`notice ${session.notice.kind}`);notice.setAttribute('role',session.notice.kind==='error'?'alert':'status');
 if(session.snapshot){const kind=session.notice.kind;notice.append(icon(kind==='error'?'error':kind==='success'?'success':'info'));const label=node('strong',shellNoticeLabel(kind,session.busy),'shell-notice-label');notice.append(label);}
 notice.append(node('span',session.busy?'Connecting to your saved game…':session.notice.text));if(session.pending&&!session.busy)notice.append(button('Retry same action',()=>void session.retry(),session.busy));return notice;
}
