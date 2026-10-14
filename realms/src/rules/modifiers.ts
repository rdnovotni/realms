import { DomainError } from '../foundation/errors.js';
export const ruleLayers=['BASE','GLOBAL','RUN_MODE','PATH','INSTANCE','EXPLICIT'] as const;
export type RuleModifier={key:string;source:string;layer:typeof ruleLayers[number];operation:'ADD'|'MULTIPLY'|'OVERRIDE'|'CAP'|'FLOOR'|'ENABLE'|'DISABLE';value:number|boolean};
/** Equal-precedence conflicting overrides fail instead of relying on load order. */
export function effectiveRule(key:string,base:number|boolean,modifiers:RuleModifier[]){
 if(modifiers.length>128)throw new DomainError(400,'MODIFIER_BUDGET');let value=base;const applied:RuleModifier[]=[];
 for(const layer of ruleLayers){const rows=modifiers.filter(m=>m.key===key&&m.layer===layer).sort((a,b)=>a.source<b.source?-1:a.source>b.source?1:0);const overrides=rows.filter(m=>['OVERRIDE','ENABLE','DISABLE'].includes(m.operation));if(new Set(overrides.map(m=>JSON.stringify([m.operation,m.value]))).size>1)throw new DomainError(400,'CONFLICTING_RULE_OVERRIDE');
 for(const m of rows){if(!m.source||!ruleLayers.includes(m.layer)||!['ADD','MULTIPLY','OVERRIDE','CAP','FLOOR','ENABLE','DISABLE'].includes(m.operation))throw new DomainError(400,'INVALID_RULE_MODIFIER');if(typeof value==='number'){if(typeof m.value!=='number'||!Number.isSafeInteger(m.value))throw new DomainError(400,'INVALID_RULE_MODIFIER');value=m.operation==='ADD'?value+m.value:m.operation==='MULTIPLY'?Math.floor(value*m.value/10000):m.operation==='OVERRIDE'?m.value:m.operation==='CAP'?Math.min(value,m.value):m.operation==='FLOOR'?Math.max(value,m.value):NaN;if(!Number.isSafeInteger(value)||Math.abs(value)>1000000)throw new DomainError(400,'RULE_VALUE_OUT_OF_RANGE');}else {if(typeof m.value!=='boolean'||!['OVERRIDE','ENABLE','DISABLE'].includes(m.operation))throw new DomainError(400,'INVALID_RULE_MODIFIER');value=m.operation==='ENABLE'?true:m.operation==='DISABLE'?false:m.value;}applied.push(m);}}
 return {value,sources:applied};
}
