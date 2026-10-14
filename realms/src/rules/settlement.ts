import { requireFeature } from './controls.js';
import type { ActionContext } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';
import { postTransfers } from '../domains/ledger.js';
import { grantItem } from '../domains/item-accounting.js';
export type Costs={turns:number;worldTime:number;gold:string;resources:{key:string;amount:number}[];rest:'NONE'|'REST'|'FULL_REST'};
export type Reward={kind:'ITEM'|'KNOWLEDGE'|'GOLD';id:string;quantity:number};
export function validateCosts(v:unknown):asserts v is Costs{
 const c=v as Costs;
 if(!c||Object.keys(c).sort().join(',')!=='gold,resources,rest,turns,worldTime'||!Number.isInteger(c.turns)||c.turns<0||c.turns>10||!Number.isInteger(c.worldTime)||c.worldTime<0||c.worldTime>100000||typeof c.gold!=='string'||!/^(0|[1-9][0-9]{0,6})$/.test(c.gold)||!['NONE','REST','FULL_REST'].includes(c.rest)||!Array.isArray(c.resources)||c.resources.length>16||c.resources.some(r=>Object.keys(r).sort().join(',')!=='amount,key'||!/^[a-z][a-z0-9_.-]{2,119}$/.test(r.key)||!Number.isInteger(r.amount)||r.amount<1||r.amount>1000000)||new Set(c.resources.map(r=>r.key)).size!==c.resources.length)throw new DomainError(400,'INVALID_RULE_COSTS');
}
export function validateRewards(v:unknown):asserts v is Reward[]{
 if(!Array.isArray(v)||v.length>16||v.some(r=>!r||Object.keys(r).sort().join(',')!=='id,kind,quantity'||!['ITEM','KNOWLEDGE','GOLD'].includes(r.kind)||!Number.isInteger(r.quantity)||r.quantity<1||r.quantity>1000000||typeof r.id!=='string'||!(/^[a-z][a-z0-9_.-]{2,119}$/.test(r.id)||r.id==='GOLD')||(r.kind==='GOLD'&&r.id!=='GOLD')||(r.kind==='KNOWLEDGE'&&r.quantity!==1)))throw new DomainError(400,'INVALID_RULE_REWARDS');
}
async function wallets(c:ActionContext){
 const target=(await c.client.query("SELECT w.id FROM wallets w JOIN state_scopes s ON s.id=w.scope_id WHERE s.run_id=$1 AND w.currency_id='GOLD' AND w.purpose='PLAYER'",[c.run.id])).rows;
 const faucet=(await c.client.query("SELECT w.id FROM wallets w JOIN state_scopes s ON s.id=w.scope_id WHERE s.kind='WORLD' AND s.lifecycle='ACTIVE' AND w.currency_id='GOLD' AND w.purpose='FAUCET_SINK' ORDER BY w.id LIMIT 2")).rows;
 if(target.length!==1||faucet.length!==1)throw new DomainError(409,'RULE_GOLD_SOURCE_NOT_CONFIGURED');return {target:target[0].id as string,faucet:faucet[0].id as string};
}
export async function payRuleCosts(c:ActionContext,cost:Costs,turnsAlreadyPaid=false){
 validateCosts(cost);if(!turnsAlreadyPaid&&c.run.turns<cost.turns)throw new DomainError(409,'INSUFFICIENT_TURNS');
 for(const r of [...cost.resources].sort((a,b)=>a.key<b.key?-1:1)){
  const row=(await c.client.query(`UPDATE resource_pools p SET amount=amount-$2 FROM state_scopes s WHERE p.scope_id=s.id AND s.run_id=$1 AND s.lifecycle='ACTIVE' AND p.resource_key=$3 AND p.amount>=$2 RETURNING p.amount::text`,[c.run.id,r.amount,r.key])).rows[0];
  if(!row)throw new DomainError(409,'INSUFFICIENT_RESOURCE');
 }
 if(cost.gold!=='0'){const w=await wallets(c);await postTransfers(c,[{key:'rules.cost',currencyId:'GOLD',from:w.target,to:w.faucet,amount:cost.gold,reason:'SHARED_RULE_COST'}]);}
 if(!turnsAlreadyPaid&&cost.turns){await c.client.query('UPDATE runs SET turns=turns-$2 WHERE id=$1',[c.run.id,cost.turns]);c.run.turns-=cost.turns;await c.client.query("INSERT INTO turn_ledger(run_id,request_id,delta,reason) VALUES($1,$2,$3,'SHARED_RULE_COST')",[c.run.id,c.requestId,-cost.turns]);}
 if(cost.worldTime)await c.client.query('UPDATE run_progression SET world_time=world_time+$2 WHERE run_id=$1',[c.run.id,cost.worldTime]);
 return structuredClone(cost);
}
export async function grantRuleRewards(c:ActionContext,rewards:Reward[],source:string){
 validateRewards(rewards);await requireFeature(c.client,'rewards.global',c.accountId);await requireFeature(c.client,`reward.${source}`,c.accountId);const results:{kind:string;id:string;quantity:number;operationId?:string}[]=[];
 for(const [index,r] of rewards.entries()){
  if(r.kind==='ITEM'){
   const container=(await c.client.query("SELECT b.id FROM inventory_containers b JOIN state_scopes s ON s.id=b.scope_id WHERE s.run_id=$1 AND b.kind='CARRIED' AND s.lifecycle='ACTIVE'",[c.run.id])).rows[0];if(!container)throw new DomainError(409,'RULE_REWARD_CONTAINER_MISSING');
   const grant=await grantItem(c,`rules.reward.${index}`,{containerId:container.id,definitionId:r.id,quantity:String(r.quantity),sourceCode:'SHARED_RULE_REWARD',metadata:{sourceEntityId:source,sourceActionId:c.actionId}},'SHARED_RULE_REWARD');results.push({...r,operationId:grant.operationId});
  }else if(r.kind==='GOLD'){const w=await wallets(c);const legs=await postTransfers(c,[{key:`rules.reward.${index}`,currencyId:'GOLD',from:w.faucet,to:w.target,amount:String(r.quantity),reason:`SHARED_RULE_REWARD:${source}`}]);results.push({...r,operationId:legs[0]!.transferId});}
  else {await c.client.query(`INSERT INTO discoveries(account_id,entity_id,knowledge_level,first_run_id) VALUES($1,$2,'LEARNED',$3) ON CONFLICT(account_id,entity_id) DO UPDATE SET knowledge_level=CASE WHEN discoveries.knowledge_level='ADVANCED' THEN 'ADVANCED' ELSE 'LEARNED' END`,[c.accountId,r.id,c.run.id]);results.push({...r});}
 }
 return results;
}
