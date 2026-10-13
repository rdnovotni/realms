import type pg from 'pg';
import { executeAction, requireActive, advanceRevision, type Envelope } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';
import { postTransfers } from './ledger.js';
export function transferGold(pool: pg.Pool, accountId: string, envelope: Envelope, from: string, to: string, amount: string) {
  from=from.toLowerCase();to=to.toLowerCase();
  if (!/^[1-9][0-9]{0,18}$/.test(amount) || BigInt(amount)>9223372036854775807n) throw new DomainError(400, 'INVALID_AMOUNT');
  return executeAction(pool, accountId, envelope, { from, to, amount }, async context => {
    requireActive(context);
    const wallets = await context.client.query(`SELECT w.*,s.account_id,s.run_id FROM wallets w JOIN state_scopes s ON s.id=w.scope_id
      WHERE w.id=ANY($1::uuid[]) AND s.lifecycle='ACTIVE' ORDER BY w.id FOR UPDATE OF w`, [[from,to]]);
    const source = wallets.rows.find(w=>w.id===from), target = wallets.rows.find(w=>w.id===to);
    if (!source || !target || from===to || source.currency_id!=='GOLD' || target.currency_id!=='GOLD' || source.purpose!=='PLAYER' || target.purpose==='FAUCET_SINK') throw new DomainError(409,'INVALID_TRANSFER');
    if (!(source.account_id===accountId || source.run_id===context.run.id)) throw new DomainError(403,'WALLET_NOT_OWNED');
    if (source.run_id || target.run_id || context.run.mode!=='CASUAL') throw new DomainError(409,'RUN_TRADE_RESTRICTED');
    if (BigInt(source.balance)<BigInt(amount)) throw new DomainError(409,'INSUFFICIENT_GOLD');
    const legs=await postTransfers(context,[{key:'primary',currencyId:'GOLD',from,to,amount,reason:'PLAYER_TRANSFER'}]);
    return { transferId:legs[0]!.transferId,amount,revision:await advanceRevision(context) };
  });
}
