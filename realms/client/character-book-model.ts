import type { AbilityEntry } from './types.js';
export const statNames:Record<string,string>={maxHealth:'Maximum Health',maxMana:'Maximum Mana',armor:'Armor',accuracy:'Accuracy',evasion:'Evasion',initiative:'Initiative',attackMin:'Attack minimum',attackMax:'Attack maximum'};
export const knownNumber=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?String(v):'Unavailable';
export const knownPercent=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?`${v/100}%`:'Unavailable';
export function abilityEntries(entries:AbilityEntry[],search:string,category:string,source:string){const q=search.trim().toLocaleLowerCase();return entries.filter(a=>(category==='ALL'||a.category===category)&&(source==='ALL'||a.source.kind===source)&&(a.name+' '+a.source.name+' '+a.effects.join(' ')).toLocaleLowerCase().includes(q));}
export function carryingValue(carry:import('./types.js').CarryView|undefined,key:'weight'|'bulk'|'weightCapacity'|'bulkCapacity'){
 if(!carry?.enabled)return 'Unavailable · no carrying rules';
 if((key==='weight'||key==='bulk')&&carry.unmeasuredItems>0)return 'Unavailable · unmeasured items';
 return carry[key]??'Unmeasured';
}
