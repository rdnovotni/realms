import type pg from 'pg';
import type { ContentEntity } from './content.js';
import { DomainError } from '../foundation/errors.js';
import { validateDate } from '../schedule-clock.js';
/** Release-pinned rule variants. The shared global clock still determines when a day ends. */
export type TurnPolicy={version:1;baselineTurns:number;softCap:number;baselineWeekdays:number[];dailyRefresh:boolean};
export function validateTurnPolicies(entities:Map<string,ContentEntity>){
 let policies=0,bonuses=0;
 for(const e of entities.values()){
  const p=e.definition.mechanics?.turnPolicy as TurnPolicy|undefined;
  if(p!==undefined&&(!p||++policies>1||e.kind!=='TUNING'||Object.keys(p).sort().join(',')!=='baselineTurns,baselineWeekdays,dailyRefresh,softCap,version'||p.version!==1||!Number.isInteger(p.baselineTurns)||p.baselineTurns<0||p.baselineTurns>1000000||!Number.isInteger(p.softCap)||p.softCap<1||p.softCap>1000000||typeof p.dailyRefresh!=='boolean'||!Array.isArray(p.baselineWeekdays)||p.baselineWeekdays.length>7||new Set(p.baselineWeekdays).size!==p.baselineWeekdays.length||p.baselineWeekdays.some(n=>!Number.isInteger(n)||n<0||n>6)))throw new DomainError(400,'INVALID_TURN_POLICY');
  const b=e.definition.mechanics?.rolloverBonus as {version:number;starts:string;ends:string;baselineTurns:number}|undefined;
  if(b!==undefined){
   if(!b||++bonuses>128||e.kind!=='EVENT'||Object.keys(b).sort().join(',')!=='baselineTurns,ends,starts,version'||b.version!==1||!Number.isInteger(b.baselineTurns)||b.baselineTurns<1||b.baselineTurns>10000||typeof b.starts!=='string'||typeof b.ends!=='string'||b.ends<b.starts)throw new DomainError(400,'INVALID_ROLLOVER_BONUS');
   try{validateDate(b.starts);validateDate(b.ends);}catch{throw new DomainError(400,'INVALID_ROLLOVER_BONUS');}
  }
 }
}
export async function rolloverPolicy(client:pg.PoolClient,releaseId:string|null,epoch:string,defaults:{baseline_turns:number;turn_soft_cap:number}){
 const rows=(await client.query(`SELECT e.entity_id,e.revision,v.definition->>'name' AS name,v.definition->'mechanics'->'turnPolicy' AS policy,v.definition->'mechanics'->'rolloverBonus' AS bonus FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=$1 AND (v.definition->'mechanics'->'turnPolicy' IS NOT NULL OR v.definition->'mechanics'->'rolloverBonus' IS NOT NULL) ORDER BY e.entity_id`,[releaseId])).rows;
 const owner=rows.find(r=>r.policy),p=owner?.policy as TurnPolicy|undefined;
 // Historical numeric fixture epochs have no civil date and no weekday/event policy.
 const day=/^20\d{6}$/.test(epoch)?epoch.slice(0,4)+'-'+epoch.slice(4,6)+'-'+epoch.slice(6,8):null;
 const weekday=day?new Date(day+'T12:00:00Z').getUTCDay():null;
 const baselineAllowed=!p||(weekday!==null&&p.baselineWeekdays.includes(weekday));
 const events=rows.filter(r=>r.bonus&&day&&r.bonus.starts<=day&&r.bonus.ends>=day).map(r=>({id:r.entity_id as string,revision:r.revision as number,name:r.name as string,turns:Number(r.bonus.baselineTurns)}));
 const baseline=baselineAllowed?(p?.baselineTurns??defaults.baseline_turns):0;
 const eventBonus=events.reduce((sum,b)=>sum+b.turns,0);
 return {baseline,eventBonus,baselineTurns:baseline+eventBonus,softCap:p?.softCap??defaults.turn_soft_cap,dailyRefresh:p?.dailyRefresh??true,policy:owner?{id:owner.entity_id as string,revision:owner.revision as number,name:owner.name as string}:null,events};
}
