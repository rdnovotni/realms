import { Ajv } from 'ajv';
import { DomainError } from '../foundation/errors.js';
import type { ContentEntity } from './content.js';
import { validateRewards,type Reward } from '../rules/settlement.js';
export type ItemUseSpec={version:1;kind:'USE'|'OPEN';effects:string[];rewards:Reward[]};
const validate=new Ajv({strict:true}).compile({type:'object',additionalProperties:false,required:['version','kind','effects','rewards'],properties:{version:{type:'integer',const:1},kind:{type:'string',enum:['USE','OPEN']},effects:{type:'array',maxItems:8,uniqueItems:true,items:{type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'}},rewards:{type:'array'}}});
export function validateItemUse(value:unknown):asserts value is ItemUseSpec{if(!validate(value))throw new DomainError(400,'INVALID_ITEM_USE');const s=value as ItemUseSpec;validateRewards(s.rewards);if(!s.effects.length&&!s.rewards.length||s.kind==='OPEN'&&s.effects.length)throw new DomainError(400,'INVALID_ITEM_USE');}
export function validateInventoryServices(entities:Map<string,ContentEntity>){
 for(const e of entities.values()){
  const repair=e.definition.mechanics?.repair;
  if(repair!==undefined){const r=repair as {version:number;goldPerPoint:number};if(e.kind!=='ITEM'||!e.definition.mechanics?.equipment||!e.definition.mechanics.tacticalDurability||!r||Object.keys(r).sort().join(',')!=='goldPerPoint,version'||r.version!==1||!Number.isInteger(r.goldPerPoint)||r.goldPerPoint<1||r.goldPerPoint>1000000)throw new DomainError(400,'INVALID_ITEM_REPAIR');}
  const use=e.definition.mechanics?.itemUse;if(use===undefined)continue;validateItemUse(use);
  const inventory=e.definition.mechanics?.inventory as {category:string}|undefined;
  if(e.kind!=='ITEM'||e.definition.mechanics?.equipment||!inventory||!(use.kind==='USE'?inventory.category==='CONSUMABLE':inventory.category==='OTHER'))throw new DomainError(400,'INVALID_ITEM_USE_CATEGORY');
  for(const id of [...use.effects,...use.rewards.filter(r=>r.kind!=='GOLD').map(r=>r.id)])if(!e.definition.dependencies.includes(id)||!entities.has(id))throw new DomainError(400,'INVALID_ITEM_USE_REFERENCE');
  for(const id of use.effects){const effect=entities.get(id);const spec=effect?.definition.mechanics?.sharedEffect as {clock:string}|undefined;if(effect?.kind!=='EFFECT'||!spec||spec.clock==='ROUNDS')throw new DomainError(400,'INVALID_ITEM_USE_EFFECT');}
  for(const r of use.rewards)if(r.kind==='ITEM'){const item=entities.get(r.id),spec=item?.definition.mechanics?.inventory as {storageMode:string}|undefined;if(item?.kind!=='ITEM'||!spec||spec.storageMode==='INSTANCE'&&r.quantity!==1)throw new DomainError(400,'INVALID_ITEM_USE_REWARD');}
 }
}
