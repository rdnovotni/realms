/** Local text-client conveniences. No aliases, history or restored text grant game authority. */
export type MudPreset='HYBRID'|'TEXT'|'MINIMAL'|'RETRO';
export type MudAnnouncement='LATEST'|'IMPORTANT'|'OFF';
export type MudStore=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export const mudStorageKey='follybound.mud.session.v1';
export const mudStore=():MudStore|undefined=>{try{return globalThis.sessionStorage;}catch{return undefined;}};
const reserved=new Set(['alias','unalias','aliases','help','history','look','actions','fields','set','go','visit','exit','inspect','talk','say','retry','refresh','reconnect','undo','clear']);
export class MudCommands{
 readonly history:string[]=[];readonly aliases:Record<string,string>={l:'look',inv:'go Pack',j:'go Journal'};
 private cursor:number|null=null;private scratch='';private erased='';
 remember(text:string){if(text&&text.length<=1000&&this.history.at(-1)!==text)this.history.push(text);while(this.history.length>100)this.history.shift();this.cursor=null;}
 recall(direction:-1|1,draft:string){if(!this.history.length)return draft;if(this.cursor===null){if(direction===1)return draft;this.scratch=draft;this.cursor=this.history.length;}this.cursor=Math.max(0,Math.min(this.history.length,this.cursor+direction));if(this.cursor===this.history.length){this.cursor=null;return this.scratch;}return this.history[this.cursor]!;}
 cancel(draft:string){if(this.cursor===null)return draft;this.cursor=null;return this.scratch;}
 edit(){this.cursor=null;}
 erase(text:string){this.erased=text;this.cursor=null;return '';}
 undo(draft:string){if(!this.erased)return draft;const text=this.erased;this.erased=draft;return text;}
 alias(name:string,value:string){name=name.toLowerCase();if(!/^[a-z][a-z0-9-]{0,15}$/.test(name)||reserved.has(name)||!value.trim()||value.length>300||(!Object.hasOwn(this.aliases,name)&&Object.keys(this.aliases).length>=20))return false;this.aliases[name]=value.trim();return true;}
 expand(text:string){let value=text;const seen=new Set<string>();for(let i=0;i<5;i++){const key=value.trim().toLowerCase();if(!Object.hasOwn(this.aliases,key))return value;if(seen.has(key))return null;seen.add(key);value=this.aliases[key]!;}return null;}
 reset(){this.history.length=0;for(const k of Object.keys(this.aliases))delete this.aliases[k];Object.assign(this.aliases,{l:'look',inv:'go Pack',j:'go Journal'});this.cursor=null;this.scratch='';this.erased='';}
}
export function completion(input:string,commands:readonly string[]){const prefix=input.trim().toLowerCase();return prefix?[...new Set(commands)].filter(c=>c.toLowerCase().startsWith(prefix)).slice(0,12):[];}
export function validPreset(v:unknown):v is MudPreset{return ['HYBRID','TEXT','MINIMAL','RETRO'].includes(String(v));}
export function validAnnouncement(v:unknown):v is MudAnnouncement{return ['LATEST','IMPORTANT','OFF'].includes(String(v));}
import type {DmEnvelope,DmPreferences} from './dm-model.js';
export type SavedMud={version:1;runId:string;entries:DmEnvelope[];draft:string;scene:string;target:string|null;conversation:string|null;selection:{sceneId?:string;npcId?:string};preset:MudPreset;announcements:MudAnnouncement;preferences:DmPreferences;commands:string[];aliases:Record<string,string>};
const words=(v:unknown,max=6000):v is string=>typeof v==='string'&&v.length<=max;
const lines=(v:unknown,max=100):v is string[]=>Array.isArray(v)&&v.length<=max&&v.every(x=>words(x));
const channels=['dm','npc','party','player','facts','choices','warning','error'],surfaces=['room','menu','tooltip','command','check','battle','loot','quest','map','system'];
export function readMud(runId:string,storage=mudStore()):SavedMud|null{try{const raw=storage?.getItem(mudStorageKey);if(!raw||raw.length>524288||new TextEncoder().encode(raw).byteLength>524288)return null;const v=JSON.parse(raw);if(v.version!==1||v.runId!==runId||!Array.isArray(v.entries)||v.entries.length>200||!words(v.draft,1000)||!words(v.scene,40)||!(v.target===null||words(v.target,200))||!(v.conversation===null||words(v.conversation,200))||!validPreset(v.preset)||!validAnnouncement(v.announcements)||!lines(v.commands,100)||v.commands.some((x:string)=>x.length>1000)||!v.aliases||typeof v.aliases!=='object'||Array.isArray(v.aliases)||Object.keys(v.aliases).length>20||!v.selection||typeof v.selection!=='object')return null;
 if(!['RICH','STANDARD','COMPACT','SPEED'].includes(v.preferences?.density)||!['OFF','GENTLE','POINTED'].includes(v.preferences?.sarcasm)||!['OFF','RARE','OCCASIONAL'].includes(v.preferences?.banter))return null;
 for(const key of Object.keys(v.selection))if(!['sceneId','npcId'].includes(key)||!/^[a-z][a-z0-9_.-]{0,119}$/.test(v.selection[key]))return null;
 const ids=new Set<string>();let order=0;const entries:DmEnvelope[]=[];for(const e of v.entries){if(e.version!==1||!words(e.id,180)||ids.has(e.id)||!channels.includes(e.channel)||!surfaces.includes(e.surface)||!lines(e.lines)||e.prose!==undefined&&!lines(e.prose,8)||e.speaker!==undefined&&!words(e.speaker,200)||!Number.isSafeInteger(e.order)||e.order<=order||e.order>1e12)return null;ids.add(e.id);order=e.order;let receipt;
 if(e.receipt){const r=e.receipt;if(!words(r.requestId,180)||!words(r.action,160)||!['SAVED','UNCONFIRMED','REJECTED'].includes(r.phase)||![r.costs,r.checks,r.result,r.journal].every(x=>lines(x)))return null;receipt={requestId:r.requestId,action:r.action,phase:r.phase,costs:r.costs,checks:r.checks,result:r.result,journal:r.journal};}
 entries.push({version:1,id:e.id,order:e.order,surface:e.surface,channel:e.channel,lines:e.lines,...(e.prose?{prose:e.prose}:{}),...(e.speaker?{speaker:e.speaker}:{}),...(e.protected===true?{protected:true}:{}),...(receipt?{receipt}:{}),restored:true});}
 const aliases:Record<string,string>={};const checked=new MudCommands();for(const key of Object.keys(checked.aliases))delete checked.aliases[key];for(const [k,value]of Object.entries(v.aliases)){if(!words(value,300)||!checked.alias(k,value))return null;aliases[k]=value;}return {...v,entries,aliases};
 }catch{return null;}}
export function writeMud(value:SavedMud,storage=mudStore()){try{const copy={...value,entries:[...value.entries]};let raw=JSON.stringify(copy);while(new TextEncoder().encode(raw).byteLength>524288&&copy.entries.length){copy.entries.shift();raw=JSON.stringify(copy);}if(new TextEncoder().encode(raw).byteLength>524288)return false;storage?.setItem(mudStorageKey,raw);return !!storage;}catch{return false;}}
export function forgetMud(storage=mudStore()){try{storage?.removeItem(mudStorageKey);}catch{/* Optional tab storage cannot interrupt game commands. */}}
