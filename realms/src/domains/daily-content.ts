import type { ContentEntity } from './content.js';
import { DomainError } from '../foundation/errors.js';
/** Source-local limits; no client may invent or copy a free-action source. */
export type DailyAllowance={version:1;refresh:number;capacity:number;banking:'BANK'|'RESET';turnBonus:number;autoCollect:boolean};
export function validateDailyContent(entities:Map<string,ContentEntity>){
 let count=0;
 for(const e of entities.values()){
  const d=e.definition.mechanics?.dailyAllowance as DailyAllowance|undefined;if(d===undefined){if(e.definition.mechanics?.freeEncounterSource!==undefined)throw new DomainError(400,'INVALID_FREE_ENCOUNTER_SOURCE');continue;}
  if(!d||typeof d!=='object'||Array.isArray(d))throw new DomainError(400,'INVALID_DAILY_ALLOWANCE');
  const free=e.definition.mechanics?.freeEncounterSource;if(free!==undefined&&(free!==true||e.definition.mechanics?.sharedAction!==undefined||d.turnBonus!==0||d.autoCollect))throw new DomainError(400,'INVALID_FREE_ENCOUNTER_SOURCE');
  const action=e.definition.mechanics?.sharedAction as {domain:string;costs:{turns:number}}|undefined;
  if(++count>128||e.kind!=='ACTIVITY'||!d||Object.keys(d).sort().join(',')!=='autoCollect,banking,capacity,refresh,turnBonus,version'||d.version!==1||
   !Number.isInteger(d.refresh)||d.refresh<1||d.refresh>1000||!Number.isInteger(d.capacity)||d.capacity<d.refresh||d.capacity>1000||
   !['BANK','RESET'].includes(d.banking)||!Number.isInteger(d.turnBonus)||d.turnBonus<0||d.turnBonus>10000||typeof d.autoCollect!=='boolean'||
   (d.autoCollect&&e.definition.mechanics?.prerequisite!==undefined)||
   (action?(action.domain!=='INTERACTION'||action.costs?.turns!==0||d.turnBonus!==0||d.autoCollect):d.turnBonus===0&&free!==true))throw new DomainError(400,'INVALID_DAILY_ALLOWANCE');
 }
 for(const e of entities.values()){
  const spec=e.definition.mechanics?.encounter as {version:number;freeSource?:string}|undefined;if(spec?.version!==3||!spec.freeSource)continue;
  const source=entities.get(spec.freeSource);if(source?.definition.mechanics?.freeEncounterSource!==true||!e.definition.dependencies.includes(spec.freeSource))throw new DomainError(400,'INVALID_FREE_ENCOUNTER_REFERENCE');
 }
}
