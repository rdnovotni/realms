import { openAppearance } from './appearance.js';
import { folioIcon } from './icons.js';
import type { GameSession } from './session.js';
import type { Screen } from './views.js';
import { shellNavigationPage,shellNoticeLabel } from './shell-model.js';
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''){const n=document.createElement(tag);n.textContent=text;n.className=className;return n;}
function button(text:string,action:()=>void,disabled=false){const b=node('button',text,'small');b.type='button';b.dataset.focus=text;b.disabled=disabled;b.addEventListener('click',action);return b;}
const icon=(kind:'seal'|'info'|'error'|'success'|'warning')=>folioIcon(kind,'common','shell-icon');
export function renderShellHeader(session:GameSession,screen:Screen,navigate:(s:Screen)=>void){
 const header=node('header','','topbar'),brand=node('div','','wordmark');brand.append(node('span','FOLLYBOUND'),node('small','A world worth wandering'));
 if(!session.snapshot){header.append(brand);return header;}
 const bar=node('div','','shell-bar'),identity=node('div','','shell-brand');identity.append(icon('seal'),brand);
 const navigation=node('nav','','shell-navigation');navigation.setAttribute('aria-label','Game');for(const [key,title]of [['adventure','Adventure'],['character','Character'],['pack','Pack']]as const){const b=button(title,()=>navigate(key));b.classList.remove('small');b.prepend(folioIcon(key==='adventure'?'road':key==='character'?'adventurer':'TOOL',key==='character'?'character':key==='pack'?'slot':'common'));b.setAttribute('aria-current',shellNavigationPage(screen)===key?'page':'false');navigation.append(b);}
 const utility=node('div','','shell-utility'),connection=node('span',session.snapshot.game.canWrite?'Connected · Saved on server':'Viewing only','connection');connection.classList.toggle('shell-readonly',!session.snapshot.game.canWrite);const tools=node('div','','tools');tools.append(button('Appearance',openAppearance),button('Refresh',()=>void session.refresh(),session.busy),button('Sign out',()=>void session.logout(),session.busy||!!session.pending));utility.append(connection,tools);bar.append(identity,navigation,utility);header.append(bar);return header;
}
export function renderShellNotice(session:GameSession){
 const notice=node('div','',`notice ${session.notice.kind}`);notice.setAttribute('role',session.notice.kind==='error'?'alert':'status');notice.setAttribute('aria-atomic','true');
 if(session.snapshot){const kind=session.notice.kind;notice.append(icon(kind==='error'?'error':kind==='success'?'success':'info'));const label=node('strong',session.busy&&session.snapshot?(session.pending?'Saving':'Refreshing'):shellNoticeLabel(kind,session.busy),'shell-notice-label');notice.append(label);}
 notice.append(node('span',session.busy?(session.snapshot?(session.pending?'Saving your action…':'Refreshing your saved game…'):'Connecting to your saved game…'):session.notice.text));if(session.pending&&!session.busy)notice.append(button('Retry same action',()=>void session.retry(),session.busy));return notice;
}
