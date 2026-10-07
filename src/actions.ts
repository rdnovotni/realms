import { createHash } from 'node:crypto';
import type pg from 'pg';

export type SpendTurns = { requestId: string; actionType: 'SPEND_TURNS'; amount: number; expectedRevision: number };
export class ActionError extends Error {
  constructor(public statusCode: number, public code: string) { super(code); }
}
export async function spendTurns(pool: pg.Pool, accountId: string, action: SpendTurns) {
  const hash = createHash('sha256').update(JSON.stringify([action.actionType, action.amount, action.expectedRevision])).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Account lock serializes duplicate requests and all current prototype mutations.
    const account = await client.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE', [accountId]);
    if (!account.rows.length) throw new ActionError(404, 'ACCOUNT_NOT_FOUND');
    const receipt = await client.query('SELECT payload_hash, result FROM action_receipts WHERE account_id=$1 AND request_id=$2', [accountId, action.requestId]);
    if (receipt.rows.length) {
      if (receipt.rows[0].payload_hash !== hash) throw new ActionError(409, 'REQUEST_ID_REUSED');
      await client.query('COMMIT');
      return { ...receipt.rows[0].result, replayed: true };
    }
    const state = await client.query('SELECT r.* FROM runs r JOIN characters c ON c.id=r.character_id WHERE c.account_id=$1 AND r.status=\'ACTIVE\' FOR UPDATE OF r', [accountId]);
    const run = state.rows[0];
    if (!run) throw new ActionError(409, 'NO_ACTIVE_RUN');
    if (run.revision !== action.expectedRevision) throw new ActionError(409, 'STALE_REVISION');
    if (run.turns < action.amount) throw new ActionError(409, 'INSUFFICIENT_TURNS');
    const updated = await client.query('UPDATE runs SET turns=turns-$1, revision=revision+1 WHERE id=$2 RETURNING id, turns, revision, rules_version', [action.amount, run.id]);
    const next = updated.rows[0];
    const result = { requestId: action.requestId, runId: next.id, turns: next.turns, revision: next.revision, rulesVersion: next.rules_version };
    await client.query('INSERT INTO turn_ledger(run_id,request_id,delta,reason) VALUES($1,$2,$3,$4)', [run.id, action.requestId, -action.amount, 'PROTOTYPE_SPEND']);
    await client.query('INSERT INTO action_receipts(account_id,request_id,payload_hash,result) VALUES($1,$2,$3,$4)', [accountId, action.requestId, hash, result]);
    await client.query('COMMIT');
    return { ...result, replayed: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
