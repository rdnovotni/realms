import { randomUUID } from 'node:crypto';
import type { ActionContext } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';

export type TransferLeg={key:string;currencyId:string;from:string;to:string;amount:string;reason:string};
const maximum=9223372036854775807n,minimum=-9223372036854775808n;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Internal transaction primitive. The owning domain must authorize the entire plan;
// there is no HTTP endpoint for arbitrary legs or faucet/sink access.
export async function postTransfers(context:ActionContext,input:readonly TransferLeg[]){
  const legs=structuredClone(input);
  if(legs.length<1 || legs.length>64)throw new DomainError(400,'INVALID_TRANSFER_PLAN');
  const keys=new Set<string>();
  for(const leg of legs){
    if(!leg || typeof leg.key!=='string' || typeof leg.from!=='string' || typeof leg.to!=='string' || typeof leg.currencyId!=='string' || typeof leg.amount!=='string' || typeof leg.reason!=='string')throw new DomainError(400,'INVALID_TRANSFER_PLAN');
    leg.from=leg.from.toLowerCase();leg.to=leg.to.toLowerCase();
    if(!/^[a-z][a-z0-9_.-]{0,63}$/.test(leg.key) || keys.has(leg.key) || !uuid.test(leg.from) || !uuid.test(leg.to) || leg.from===leg.to ||
      !/^[A-Z][A-Z0-9_]{0,63}$/.test(leg.currencyId) || !/^[1-9][0-9]{0,18}$/.test(leg.amount) || BigInt(leg.amount)>maximum ||
      !leg.reason.trim() || leg.reason.length>200)throw new DomainError(400,'INVALID_TRANSFER_PLAN');
    keys.add(leg.key);
  }
  const ids=[...new Set(legs.flatMap(leg=>[leg.from,leg.to]))].sort();
  // Lock every affected wallet before checking or writing any leg; overlapping batches
  // cannot acquire subsets in opposite order and observe partial settlement.
  const locked=await context.client.query(`SELECT w.*,s.lifecycle FROM wallets w JOIN state_scopes s ON s.id=w.scope_id
    WHERE w.id=ANY($1::uuid[]) ORDER BY w.id FOR UPDATE OF w FOR SHARE OF s`,[ids]);
  if(locked.rows.length!==ids.length || locked.rows.some(w=>w.lifecycle!=='ACTIVE'))throw new DomainError(409,'INVALID_TRANSFER_WALLET');
  const wallets=new Map(locked.rows.map(w=>[w.id,{currency:w.currency_id as string,purpose:w.purpose as string,balance:BigInt(w.balance)}]));
  // Leg order is semantic: escrow must be funded before its payout legs. Simulate the
  // complete plan first, including int64 bounds, before issuing the first INSERT.
  for(const leg of legs){
    const from=wallets.get(leg.from)!,to=wallets.get(leg.to)!,amount=BigInt(leg.amount);
    if(from.currency!==leg.currencyId || to.currency!==leg.currencyId)throw new DomainError(409,'CURRENCY_MISMATCH');
    if(from.purpose!=='FAUCET_SINK' && from.balance<amount)throw new DomainError(409,'INSUFFICIENT_BALANCE');
    from.balance-=amount;to.balance+=amount;
    if(from.balance<minimum || to.balance>maximum)throw new DomainError(409,'BALANCE_OVERFLOW');
  }
  const results=[];
  for(const leg of legs){
    const id=randomUUID();
    await context.client.query(`INSERT INTO currency_transfers(id,action_id,leg_key,currency_id,from_wallet_id,to_wallet_id,amount,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,context.actionId,leg.key,leg.currencyId,leg.from,leg.to,leg.amount,leg.reason]);
    results.push({key:leg.key,transferId:id});
  }
  return results;
}
