import { DomainError } from '../foundation/errors.js';
export type Fact=string|number|boolean;
export type Facts=Record<string,Fact>;
export type Prerequisite={op:'ALL'|'ANY';args:Prerequisite[]}|{op:'NOT';arg:Prerequisite}|{op:'FACT';key:string;test:'EQ'|'GTE'|'LTE';value:Fact};
export const factKey=/^(level|mode|attribute\.(strength|dexterity|constitution|intelligence|wisdom|charisma|luck)|(?:class|skill|known|item|quest|capability|flag|obstacle)\.[a-z][a-z0-9_.-]{0,119})$/;
export function validatePrerequisite(value:unknown):asserts value is Prerequisite {
 let count=0;
 const walk=(v:unknown,depth:number)=>{
  if(++count>64||depth>8||!v||typeof v!=='object'||Array.isArray(v))throw new DomainError(400,'INVALID_PREREQUISITE');
  const p=v as Record<string,unknown>,keys=Object.keys(p).sort().join(',');
  if(p.op==='ALL'||p.op==='ANY'){
   if(keys!=='args,op'||!Array.isArray(p.args)||p.args.length<1||p.args.length>16)throw new DomainError(400,'INVALID_PREREQUISITE');
   p.args.forEach(a=>walk(a,depth+1));
  }else if(p.op==='NOT'){
   if(keys!=='arg,op')throw new DomainError(400,'INVALID_PREREQUISITE');walk(p.arg,depth+1);
  }else if(p.op==='FACT'){
   if(keys!=='key,op,test,value'||typeof p.key!=='string'||!factKey.test(p.key)||!['EQ','GTE','LTE'].includes(p.test as string)||!['number','string','boolean'].includes(typeof p.value)||(typeof p.value==='number'&&(!Number.isSafeInteger(p.value)||Math.abs(p.value)>1000000))||(typeof p.value==='string'&&p.value.length>120)||(p.test!=='EQ'&&typeof p.value!=='number'))throw new DomainError(400,'INVALID_PREREQUISITE');
  }else throw new DomainError(400,'INVALID_PREREQUISITE');
 };walk(value,0);
}
/** Missing facts are unknown, including under NOT. Unknown never unlocks an action. */
export function prerequisite(expr:Prerequisite,facts:Facts){
 validatePrerequisite(expr);
 type Result={met:boolean;known:boolean;children?:Result[]};
 const walk=(p:Prerequisite):Result=>{
  if(p.op==='FACT'){
   const actual=Object.hasOwn(facts,p.key)?facts[p.key]:undefined,known=actual!==undefined&&typeof actual===typeof p.value;
   return {known,met:known&&(p.test==='EQ'?actual===p.value:p.test==='GTE'?(actual as number)>=(p.value as number):(actual as number)<=(p.value as number))};
  }
  if(p.op==='NOT'){const child=walk(p.arg);return {known:child.known,met:child.known&&!child.met,children:[child]};}
  const children=p.args.map(walk),met=p.op==='ALL'?children.every(c=>c.met):children.some(c=>c.met);
  return {met,known:p.op==='ALL'?children.every(c=>c.known):met||children.every(c=>c.known),children};
 };return walk(expr);
}
export function prerequisiteKeys(expr:Prerequisite):string[]{validatePrerequisite(expr);return expr.op==='FACT'?[expr.key]:expr.op==='NOT'?prerequisiteKeys(expr.arg):expr.args.flatMap(prerequisiteKeys);}
