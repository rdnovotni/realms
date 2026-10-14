import { DomainError } from '../foundation/errors.js';
import { prerequisite,validatePrerequisite,type Prerequisite,type Facts } from './prerequisites.js';
export const clockKinds=['ROUNDS','ENCOUNTERS','ADVENTURE_TURNS','WORLD_TIME','REST','FULL_REST','ROLLOVER','UNTIL_CLEANSED','CONDITIONAL','RUN','REAL_TIME'] as const;
export type Clock=typeof clockKinds[number];
export type ClockValues=Record<Clock,number>;
export const zeroClocks=():ClockValues=>Object.fromEntries(clockKinds.map(k=>[k,0])) as ClockValues;
export type EffectSpec={version:1;family:string;clock:Clock;duration:number;stacking:'REPLACE'|'REFRESH'|'EXTEND'|'INTENSITY'|'STACKS'|'STRONGEST'|'INDEPENDENT'|'EXCLUSIVE';maximumStacks:number;maximumMagnitude:number;maximumDuration:number;magnitude:number;tags:string[];modifiers:{key:string;amount:number}[];capabilities:{key:string;enabled:boolean}[];removal:{method:'CLEANSE'|'DISPEL'|'CURE'|'REMOVE_CURSE'|'NONE';difficulty:number};condition?:Prerequisite;deadlinePermission?:'SHARED_INSTANCE'|'LIVE_EVENT_WINDOW';triggers:{on:'APPLY'|'EXPIRE'|'REMOVE';effectId:string}[]};
export type EffectDefinition={id:string;revision:number;spec:EffectSpec};
export type ActiveEffect={id:string;revision:number;source:string;application:string;spec:EffectSpec;magnitude:number;stacks:number;expires:number|null};
const identity=/^[a-z][a-z0-9_.-]{2,119}$/;
export function validateEffect(v:unknown):asserts v is EffectSpec{
 const e=v as EffectSpec;
 const required=['version','family','clock','duration','stacking','maximumStacks','maximumMagnitude','maximumDuration','magnitude','tags','modifiers','capabilities','removal','triggers'];
 if(!e||typeof e!=='object'||required.some(k=>!Object.hasOwn(e,k))||Object.keys(e).some(k=>![...required,'condition','deadlinePermission'].includes(k))||e.version!==1||!identity.test(e.family)||!clockKinds.includes(e.clock)||!['REPLACE','REFRESH','EXTEND','INTENSITY','STACKS','STRONGEST','INDEPENDENT','EXCLUSIVE'].includes(e.stacking)||![e.duration,e.maximumStacks,e.maximumMagnitude,e.maximumDuration,e.magnitude].every(Number.isSafeInteger)||e.duration<1||e.duration>1000000||e.maximumDuration<e.duration||e.maximumDuration>1000000||e.maximumStacks<1||e.maximumStacks>16||e.magnitude<1||e.maximumMagnitude<e.magnitude||e.maximumMagnitude>1000||!Array.isArray(e.tags)||e.tags.length<1||e.tags.length>16||e.tags.some(t=>!identity.test(t))||new Set(e.tags).size!==e.tags.length||!Array.isArray(e.modifiers)||e.modifiers.length>16||e.modifiers.some(m=>Object.keys(m).sort().join(',')!=='amount,key'||!/^check\.[a-z][a-z0-9_.-]{0,119}$/.test(m.key)||!Number.isInteger(m.amount)||Math.abs(m.amount)>1000)||!Array.isArray(e.capabilities)||e.capabilities.length>16||e.capabilities.some(c=>Object.keys(c).sort().join(',')!=='enabled,key'||!/^capability\.[a-z][a-z0-9_.-]{0,119}$/.test(c.key)||typeof c.enabled!=='boolean')||!e.removal||Object.keys(e.removal).sort().join(',')!=='difficulty,method'||!['CLEANSE','DISPEL','CURE','REMOVE_CURSE','NONE'].includes(e.removal.method)||!Number.isInteger(e.removal.difficulty)||e.removal.difficulty<0||e.removal.difficulty>1000||(e.removal.method==='NONE')!==(e.removal.difficulty===0)||!Array.isArray(e.triggers)||e.triggers.length>4||e.triggers.some(t=>Object.keys(t).sort().join(',')!=='effectId,on'||!['APPLY','EXPIRE','REMOVE'].includes(t.on)||!identity.test(t.effectId)))throw new DomainError(400,'INVALID_SHARED_EFFECT');
 if(new Set(e.modifiers.map(m=>m.key)).size!==e.modifiers.length||new Set(e.capabilities.map(c=>c.key)).size!==e.capabilities.length)throw new DomainError(400,'DUPLICATE_EFFECT_CONTRIBUTION');
 if((e.clock==='CONDITIONAL')!==(e.condition!==undefined))throw new DomainError(400,'INVALID_EFFECT_CONDITION');
 if(e.condition)validatePrerequisite(e.condition);
 if(e.clock==='REAL_TIME'?( !['SHARED_INSTANCE','LIVE_EVENT_WINDOW'].includes(e.deadlinePermission??'')||e.modifiers.length>0||e.capabilities.length>0||e.triggers.length>0):e.deadlinePermission!==undefined)throw new DomainError(400,'UNPERMITTED_REAL_TIME_EFFECT');
}
export function validateEffectGraph(definitions:Map<string,EffectDefinition>){
 const visiting=new Set<string>(),done=new Set<string>(),families=new Map<string,string>();
 const walk=(id:string,depth:number)=>{if(depth>4||visiting.has(id))throw new DomainError(400,'EFFECT_TRIGGER_CYCLE');const d=definitions.get(id);if(!d)throw new DomainError(400,'MISSING_EFFECT_TRIGGER');if(d.id!==id||!identity.test(id)||!Number.isInteger(d.revision)||d.revision<1||d.revision>2147483647)throw new DomainError(400,'INVALID_EFFECT_DEFINITION');validateEffect(d.spec);const signature=JSON.stringify([d.spec.stacking,d.spec.clock,d.spec.maximumStacks,d.spec.maximumMagnitude,d.spec.maximumDuration]);const old=families.get(d.spec.family);if(old&&old!==signature)throw new DomainError(400,'CONFLICTING_EFFECT_FAMILY');families.set(d.spec.family,signature);visiting.add(id);for(const t of d.spec.triggers){if(t.on==='EXPIRE'&&definitions.get(t.effectId)?.spec.clock!==d.spec.clock)throw new DomainError(400,'AMBIGUOUS_EXPIRATION_CLOCK');walk(t.effectId,depth+1);}visiting.delete(id);done.add(id);};
 for(const id of definitions.keys())walk(id,0);
}
function expiry(e:EffectSpec,clocks:ClockValues){return ['UNTIL_CLEANSED','CONDITIONAL'].includes(e.clock)?null:clocks[e.clock]+(['REST','FULL_REST','ROLLOVER','RUN'].includes(e.clock)?1:e.duration);}
export function effectTransition(input:ActiveEffect[],definitions:Map<string,EffectDefinition>,clocks:ClockValues,facts:Facts,operation:{kind:'APPLY';ids:string[];source:string;application:string}|{kind:'CLOCK'}|{kind:'END_ENCOUNTER'}|{kind:'REMOVE';method:EffectSpec['removal']['method'];power:number;tags:string[]}){
 validateEffectGraph(definitions);
 if(input.length>64||clockKinds.some(k=>!Object.hasOwn(clocks,k))||Object.values(clocks).some(n=>!Number.isSafeInteger(n)||n<0))throw new DomainError(409,'INVALID_EFFECT_STATE');
 const effects=structuredClone(input),events:{kind:string;effectId:string;source:string}[]=[],queue:{on:'APPLY'|'EXPIRE'|'REMOVE';effect:ActiveEffect;depth:number}[]=[];
 const emit=(on:'APPLY'|'EXPIRE'|'REMOVE',e:ActiveEffect,depth:number)=>{if(events.length>=128)throw new DomainError(409,'EFFECT_TRIGGER_BUDGET');events.push({kind:on,effectId:e.id,source:e.source});queue.push({on,effect:structuredClone(e),depth});};
 const apply=(id:string,source:string,application:string,depth:number,starts=clocks)=>{
  if(depth>4)throw new DomainError(409,'EFFECT_TRIGGER_BUDGET');const d=definitions.get(id);if(!d)throw new DomainError(409,'EFFECT_NOT_PINNED');
  const e=d.spec,next:ActiveEffect={id,revision:d.revision,source,application,spec:structuredClone(e),magnitude:e.magnitude,stacks:1,expires:expiry(e,starts)};
  const family=effects.filter(a=>a.spec.family===e.family),old=family.find(a=>e.stacking!=='INDEPENDENT'||a.source===source);
  if(family.some(a=>a.spec.stacking!==e.stacking||a.spec.clock!==e.clock))throw new DomainError(409,'CONFLICTING_EFFECT_FAMILY');
  if(old){
   if(e.stacking==='EXCLUSIVE'){events.push({kind:'BLOCKED',effectId:id,source});return;}
   if(e.stacking==='STRONGEST'&&old.magnitude>=next.magnitude){events.push({kind:'BLOCKED',effectId:id,source});return;}
   if(e.stacking==='REFRESH'||e.stacking==='EXTEND'||e.stacking==='INTENSITY'||e.stacking==='STACKS'){
    if(old.expires!==null&&next.expires!==null)old.expires=e.stacking==='EXTEND'?Math.min(clocks[e.clock]+e.maximumDuration,old.expires+e.duration):Math.max(old.expires,next.expires);
    if(e.stacking==='INTENSITY')old.magnitude=Math.min(e.maximumMagnitude,old.magnitude+e.magnitude);
    if(e.stacking==='STACKS')old.stacks=Math.min(e.maximumStacks,old.stacks+1);
    events.push({kind:e.stacking,effectId:old.id,source:old.source});return;
   }
   effects.splice(effects.indexOf(old),1);emit('REMOVE',old,depth);events.push({kind:'REPLACED',effectId:old.id,source:old.source});
  }else if((e.stacking==='INDEPENDENT'&&family.length>=e.maximumStacks)||effects.length>=64)throw new DomainError(409,'EFFECT_CAPACITY');
  effects.push(next);emit('APPLY',next,depth);
 };
 for(const e of [...effects]){
  validateEffect(e.spec);
  if((operation.kind==='END_ENCOUNTER'&&e.spec.clock==='ROUNDS')||(e.expires!==null&&clocks[e.spec.clock]>=e.expires)||(e.spec.condition&&!prerequisite(e.spec.condition,facts).met)){effects.splice(effects.indexOf(e),1);emit('EXPIRE',e,0);}
 }
 if(operation.kind==='APPLY'){if(operation.ids.length>16||!operation.source||!operation.application)throw new DomainError(400,'INVALID_EFFECT_APPLICATION');for(const id of operation.ids)apply(id,operation.source,operation.application,0);}
 if(operation.kind==='REMOVE'){
  if(operation.method==='NONE'||!Number.isInteger(operation.power)||operation.power<1||operation.power>1000||operation.tags.length>16)throw new DomainError(400,'INVALID_EFFECT_REMOVAL');
  for(const e of [...effects])if(e.spec.removal.method===operation.method&&operation.power>=e.spec.removal.difficulty&&operation.tags.some(t=>e.spec.tags.includes(t))){effects.splice(effects.indexOf(e),1);emit('REMOVE',e,0);}
 }
 const fired=new Set<string>();
 while(queue.length){const q=queue.shift()!;for(const [i,t] of q.effect.spec.triggers.entries())if(t.on===q.on){const key=JSON.stringify([q.effect.id,q.effect.application,q.on,i]);if(fired.has(key))continue;fired.add(key);const starts=q.on==='EXPIRE'&&q.effect.expires!==null?{...clocks,[q.effect.spec.clock]:Math.min(clocks[q.effect.spec.clock],q.effect.expires)}:clocks;apply(t.effectId,q.effect.source,q.effect.application,q.depth+1,starts);}
  for(const e of [...effects])if((operation.kind==='END_ENCOUNTER'&&e.spec.clock==='ROUNDS')||(e.expires!==null&&clocks[e.spec.clock]>=e.expires)){effects.splice(effects.indexOf(e),1);emit('EXPIRE',e,q.depth+1);}
 }
 effects.sort((a,b)=>JSON.stringify([a.spec.family,a.source,a.id]).localeCompare(JSON.stringify([b.spec.family,b.source,b.id]),'en'));
 const totals=new Map<string,number>();for(const e of effects)for(const m of e.spec.modifiers){const value=(totals.get(m.key)??0)+m.amount*e.magnitude*e.stacks;if(!Number.isSafeInteger(value)||Math.abs(value)>1000000)throw new DomainError(409,'EFFECT_MODIFIER_BUDGET');totals.set(m.key,value);}
 if(events.length>128)throw new DomainError(409,'EFFECT_TRIGGER_BUDGET');
 return {effects,events};
}
export function effectContributions(effects:ActiveEffect[],key:string){return effects.flatMap(e=>e.spec.modifiers.filter(m=>m.key===key).map(m=>({source:e.id,amount:m.amount*e.magnitude*e.stacks})));}
export function effectCapabilities(effects:ActiveEffect[],facts:Facts){const result={...facts};for(const e of effects)for(const c of e.spec.capabilities){if(c.enabled&&result[c.key]!==false)result[c.key]=true;else if(!c.enabled)result[c.key]=false;}return result;}
