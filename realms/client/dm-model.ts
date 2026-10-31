import {MudCommands,readMud,writeMud,forgetMud,type MudPreset,type MudAnnouncement} from './mud-model.js';
/** DM01 presentation only. Inputs must already be filtered for this reader. */
export type DmChannel='dm'|'npc'|'party'|'player'|'facts'|'choices'|'warning'|'error';
export type DmSurface='room'|'menu'|'tooltip'|'command'|'check'|'battle'|'loot'|'quest'|'map'|'system';
export type Density='RICH'|'STANDARD'|'COMPACT'|'SPEED';
export const sentenceBudgets:Readonly<Record<Density,number>>={RICH:4,STANDARD:2,COMPACT:1,SPEED:0};
export const channelLabels:Readonly<Record<DmChannel,string>>={dm:'Dungeon Master',npc:'NPC speech',party:'Party chat',player:'You',facts:'Mechanical facts',choices:'Available choices',warning:'Warning',error:'System error'};
export type DmReceipt=Readonly<{requestId:string;action:string;phase:'SAVED'|'UNCONFIRMED'|'REJECTED';costs:readonly string[];checks:readonly string[];result:readonly string[];journal:readonly string[]}>;
export type DmEnvelope=Readonly<{version:1;id:string;order?:number;restored?:boolean;mentions?:readonly {label:string;command:string}[];surface:DmSurface;channel:DmChannel;speaker?:string;lines:readonly string[];prose?:readonly string[];protected?:boolean;receipt?:DmReceipt}>;
export type DmPreferences={density:Density;sarcasm:'OFF'|'GENTLE'|'POINTED';banter:'OFF'|'RARE'|'OCCASIONAL'};
export function validDmPreferences(value:unknown):value is DmPreferences{if(!value||typeof value!=='object')return false;const p=value as DmPreferences;return ['RICH','STANDARD','COMPACT','SPEED'].includes(p.density)&&['OFF','GENTLE','POINTED'].includes(p.sarcasm)&&['OFF','RARE','OCCASIONAL'].includes(p.banter);}
export function visibleDmProse(e:DmEnvelope,density:Density){return (e.prose??[]).flatMap(line=>Array.from(new Intl.Segmenter('en',{granularity:'sentence'}).segment(line),part=>part.segment.trim()).filter(Boolean)).slice(0,sentenceBudgets[density]);}
export const routineTemplates={welcome:'There you are. Choose your calling, or pick up the thread of your saved journey.',revisit:'Back to familiar ground. Your known choices are below.',invalid:'I could not match that to a visible choice. Try “actions” or choose a numbered option.',reconnect:'Your saved game is ready. We continue from what the server confirmed.',saved:'The result is recorded. The next move is yours.',error:'The result is not confirmed. Keep the same action receipt when retrying.',automation:'The routine reports its saved progress. Its budget and stop conditions still apply.'} as const;
export class DmTranscript{
 readonly entries:DmEnvelope[]=[];
 readonly commands=new MudCommands();preset:MudPreset='HYBRID';announcements:MudAnnouncement='LATEST';selection:{sceneId?:string;npcId?:string}={};storageAvailable=true;
 preferences:DmPreferences={density:'STANDARD',sarcasm:'POINTED',banter:'OCCASIONAL'};
 draft='';target:string|null=null;conversation:string|null=null;scene='';
 focus(target:string|null,conversation=this.conversation){this.target=target;this.conversation=conversation;}
 private next=0;private run:string|null=null;private ids=new Set<string>();private banterWindow:boolean[]=[];
 reset(clearStored=this.run!==null){if(clearStored)forgetMud();this.entries.length=0;this.ids.clear();this.run=null;this.draft='';this.target=null;this.conversation=null;this.scene='';this.selection={};this.commands.reset();this.banterWindow=[];this.next=0;}
 scope(run:string){if(this.run!==run){const resume=this.run===null;this.reset(!resume);this.run=run;if(resume){const saved=readMud(run);if(saved){this.preferences=saved.preferences;this.preset=saved.preset;this.announcements=saved.announcements;this.draft=saved.draft;this.scene=saved.scene;this.target=saved.target;this.conversation=saved.conversation;this.selection=saved.selection;this.commands.history.push(...saved.commands);for(const k of Object.keys(this.commands.aliases))delete this.commands.aliases[k];Object.assign(this.commands.aliases,saved.aliases);for(const e of saved.entries){Object.freeze(e.lines);if(e.prose)Object.freeze(e.prose);if(e.receipt){for(const value of [e.receipt.costs,e.receipt.checks,e.receipt.result,e.receipt.journal])Object.freeze(value);Object.freeze(e.receipt);}this.entries.push(Object.freeze(e));this.ids.add(e.id);this.next=Math.max(this.next,e.order??0);}}else forgetMud();}}}
 save(){if(!this.run)return;this.storageAvailable=writeMud({version:1,runId:this.run,entries:this.entries.map(({mentions:_,...e})=>e),draft:this.draft,scene:this.scene,target:this.target,conversation:this.conversation,selection:this.selection,preset:this.preset,announcements:this.announcements,preferences:this.preferences,commands:this.commands.history,aliases:this.commands.aliases});}
 clearScrollback(){this.entries.length=0;this.ids.clear();this.save();}
 add(entry:Omit<DmEnvelope,'version'|'id'>&{id?:string}){if(entry.id&&this.ids.has(entry.id))return;let order=++this.next;while(this.ids.has('dm-'+order))order=++this.next;const id=entry.id??'dm-'+order;const immutable=structuredClone({...entry,version:1 as const,id,order});Object.freeze(immutable.lines);if(immutable.prose)Object.freeze(immutable.prose);if(immutable.mentions)Object.freeze(immutable.mentions);if(immutable.receipt){for(const v of [immutable.receipt.costs,immutable.receipt.checks,immutable.receipt.result,immutable.receipt.journal])Object.freeze(v);Object.freeze(immutable.receipt);}Object.freeze(immutable);this.entries.push(immutable);this.ids.add(id);while(this.entries.length>200)this.ids.delete(this.entries.shift()!.id);this.save();}
 /** Eligible completed manual results only; no budget accrues on protected/error/automation beats. */
 aside(eligible:boolean,text:string){if(!eligible)return undefined;const limit=this.preferences.banter==='OCCASIONAL'?2:this.preferences.banter==='RARE'?1:0;const allow=this.preferences.sarcasm!=='OFF'&&this.banterWindow.filter(Boolean).length<limit;this.banterWindow.push(allow);if(this.banterWindow.length>9)this.banterWindow.shift();return allow?[text]:undefined;}
}
export type CommandChoice={id:string;label:string;disabled?:boolean;reason?:string};
const normalized=(s:string)=>s.trim().replace(/\s+/g,' ').toLocaleLowerCase();
export function resolveDmCommand(input:string,choices:readonly CommandChoice[]):{kind:'MATCH';choice:CommandChoice}|{kind:'AMBIGUOUS';choices:CommandChoice[]}|{kind:'UNKNOWN'}{
 const text=normalized(input),number=/^(?:choose\s+)?(\d+)$/.exec(text);
 if(number){const choice=choices[Number(number[1])-1];return choice?{kind:'MATCH',choice}:{kind:'UNKNOWN'};}
 const exact=choices.filter(c=>normalized(c.label)===text);const matches=exact.length?exact:choices.filter(c=>normalized(c.label).includes(text));
 return !text||!matches.length?{kind:'UNKNOWN'}:matches.length===1?{kind:'MATCH',choice:matches[0]!}:{kind:'AMBIGUOUS',choices:matches};
}
const human=(s:string)=>s.toLowerCase().replaceAll('_',' ');
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const scalar=(v:unknown)=>typeof v==='string'||typeof v==='number'||typeof v==='boolean'?String(v):null;
/** Explicit public-result allowlist. Never stringify a result, command body, seed, token or evidence packet. */
export function dmReceipt(requestId:string,action:string,result:Record<string,unknown>,summary:string):DmReceipt{
 const facts=[summary],costs:string[]=[],checks:string[]=[],journal:string[]=[];
 for(const key of ['revision','outcome','degree','lifecycle','remaining','round','damage','healing']){const value=scalar(result[key]);if(value!==null)facts.push(`${human(key)}: ${value}`);}
 for(const [label,source]of [['Attempt',result.costs],['Failure consequence',result.failureCosts]]as const){const spent=record(source);for(const key of ['turns','gold','worldTime']){const value=scalar(spent[key]);if(value!==null)costs.push(`${label} ${human(key)}: ${value}`);}if(Array.isArray(spent.resources))for(const item of spent.resources){const r=record(item);if(typeof r.key==='string'&&typeof r.amount==='number')costs.push(`${label} ${r.key}: ${r.amount}`);}}
 // Check details are only accepted from the public check projection, not committed evidence.
 const check=record(result.check);for(const key of ['success','roll','total','dc','difficulty']){const value=scalar(check[key]);if(value!==null)checks.push(`${human(key)}: ${value}`);}
 const chance=record(check.chance);if(typeof chance.numerator==='number'&&typeof chance.denominator==='number'&&chance.denominator>0)checks.push(`Disclosed chance: ${chance.numerator}/${chance.denominator}`);const obstacle=record(result.obstacle);for(const key of ['outcome','consequence']){const value=scalar(obstacle[key]);if(value!==null)facts.push(`${human(key)}: ${value}`);}
 if(action==='SCENE_ACTION'){const scene=record(result.scene);for(const key of ['outcome','consequence']){const value=scalar(scene[key]);if(value!==null)facts.push(`${human(key)}: ${value}`);}if(Array.isArray(scene.newClues))for(const clue of scene.newClues)if(typeof clue==='string')journal.push('Evidence discovered: '+clue);}
 if(action==='NPC_CHOICE'){costs.push('No Turns or resources spent.');if(typeof result.consequence==='string')facts.push(result.consequence);if(result.memory)facts.push('Authored NPC memory recorded.');}
 if(action==='QUEST_COMMAND')journal.push(`Quest state: ${scalar(result.lifecycle)??'saved; open Journal for the current objective'}.`);
 if(action==='JOURNAL_NOTE')journal.push('Personal note saved. It does not establish a quest fact.');
 return Object.freeze({requestId,action:human(action),phase:'SAVED',costs:Object.freeze(costs),checks:Object.freeze(checks),result:Object.freeze(facts),journal:Object.freeze(journal)});
}
