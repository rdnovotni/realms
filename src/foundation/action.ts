import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { checksum, type Json } from './json.js';
import { transaction } from './transaction.js';
import { DomainError } from './errors.js';
export type RunState = { id: string; turns: number; revision: number; status: 'ACTIVE' | 'AFTERCORE' | 'ARCHIVED' | 'ABANDONED'; character_id: string; rules_version: string; content_release_id: string | null; mode: string };
export type ActionContext = { client: pg.PoolClient; accountId: string; actionId: string; requestId: string; run: RunState };
export type Envelope = { requestId: string; actionType: string; expectedRevision: number; authorizationSource?: 'MANUAL_UI' | 'PARSER' | 'AUTOMATION' | 'API' | 'ADMIN' };
export async function executeAction(pool: pg.Pool, accountId: string, envelope: Envelope, parameters: Json,
  handler: (context: ActionContext) => Promise<{ [key: string]: Json }>) {
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(envelope.requestId) ||
    !/^[A-Z][A-Z0-9_]{1,79}$/.test(envelope.actionType) || !Number.isInteger(envelope.expectedRevision) || envelope.expectedRevision<0 || envelope.expectedRevision>2147483646 ||
    !['MANUAL_UI','PARSER','AUTOMATION','API','ADMIN'].includes(envelope.authorizationSource??'MANUAL_UI')) throw new DomainError(400,'INVALID_ACTION_ENVELOPE');
  const hash = checksum({ type: envelope.actionType, revision: envelope.expectedRevision, parameters, source: envelope.authorizationSource ?? 'MANUAL_UI' });
  const actionId = randomUUID();
  return transaction(pool, async client => {
    const account = await client.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE', [accountId]);
    if (!account.rows.length) throw new DomainError(404, 'ACCOUNT_NOT_FOUND');
    const prior = await client.query('SELECT payload_hash,result,envelope_version FROM action_receipts WHERE account_id=$1 AND request_id=$2', [accountId, envelope.requestId]);
    if (prior.rows.length) {
      const legacy = prior.rows[0].envelope_version===1 && envelope.actionType==='SPEND_TURNS' && (envelope.authorizationSource??'MANUAL_UI')==='MANUAL_UI';
      const comparison = legacy ? createHash('sha256').update(JSON.stringify([envelope.actionType,(parameters as {amount:Json}).amount,envelope.expectedRevision])).digest('hex') : hash;
      if (prior.rows[0].payload_hash !== comparison) throw new DomainError(409, 'REQUEST_ID_REUSED');
      return { ...prior.rows[0].result, replayed: true };
    }
    const state = await client.query<RunState>(`SELECT r.* FROM runs r JOIN characters c ON c.id=r.character_id
      WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE') FOR UPDATE OF r`, [accountId]);
    const run = state.rows[0];
    if (!run) throw new DomainError(409, 'NO_RUN');
    if (run.revision !== envelope.expectedRevision) throw new DomainError(409, 'STALE_REVISION');
    const context = { client, accountId, actionId, requestId: envelope.requestId, run };
    const result = { ...(await handler(context)), actionId, requestId: envelope.requestId, rulesVersion: run.rules_version };
    await client.query(`INSERT INTO action_receipts(account_id,request_id,payload_hash,result,action_id,action_type,rules_version,authorization_source,envelope_version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,2)`, [accountId, envelope.requestId, hash, result, actionId, envelope.actionType, run.rules_version, envelope.authorizationSource ?? 'MANUAL_UI']);
    await client.query('INSERT INTO audit_events(action_id,actor_account_id,category,source,payload) VALUES($1,$2,$3,$4,$5)', [actionId, accountId, 'ACTION_COMMITTED', envelope.actionType, { runId: run.id }]);
    await client.query('INSERT INTO outbox_events(action_id,event_type,payload) VALUES($1,$2,$3)', [actionId, 'ACTION_COMMITTED', { actionId, accountId, actionType: envelope.actionType }]);
    return { ...result, replayed: false };
  });
}
export function requireActive(context: ActionContext) {
  if (!['ACTIVE','AFTERCORE'].includes(context.run.status)) throw new DomainError(409, 'RUN_NOT_ACTIVE');
}
export async function advanceRevision(context: ActionContext) {
  const row = await context.client.query('UPDATE runs SET revision=revision+1 WHERE id=$1 RETURNING revision', [context.run.id]);
  return row.rows[0].revision as number;
}
