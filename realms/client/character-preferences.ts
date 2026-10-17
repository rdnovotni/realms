import type { CharacterSection } from './types.js';
const key='follybound.character.view.v1';
const sections:CharacterSection[]=['overview','progression','abilities','statistics','history'];
type SessionStore=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const browserStore=()=>{try{return globalThis.sessionStorage;}catch{return undefined;}};
export function readCharacterView(runId:string,storage:SessionStore|undefined=browserStore()):{section:CharacterSection;offset:number}|null{
 try{const raw=storage?.getItem(key);if(!raw||raw.length>512)return null;const v=JSON.parse(raw);return v?.runId===runId&&sections.includes(v.section)&&Number.isInteger(v.offset)&&v.offset>=0&&v.offset<=10000&&v.offset%25===0?{section:v.section,offset:v.offset}:null;}catch{return null;}
}
/** Tab-scoped presentation only. Never store credentials, choices, or history records. */
export function saveCharacterView(runId:string,section:CharacterSection,offset:number,storage:SessionStore|undefined=browserStore()){
 try{if(sections.includes(section)&&Number.isInteger(offset)&&offset>=0&&offset<=10000&&offset%25===0)storage?.setItem(key,JSON.stringify({runId,section,offset}));}catch{/* Storage denial must not interrupt play. */}
}
export function clearCharacterView(storage:SessionStore|undefined=browserStore()){try{storage?.removeItem(key);}catch{/* Optional cosmetic storage. */}}
