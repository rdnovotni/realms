import type pg from 'pg';
import { executeAction, requireActive } from './foundation/action.js';
import { DomainError } from './foundation/errors.js';
export { DomainError as ActionError } from './foundation/errors.js';
export type SpendTurns = { requestId: string; actionType: 'SPEND_TURNS'; amount: number; expectedRevision: number; principal?:import('./auth/sessions.js').Principal };
export function spendTurns(pool: pg.Pool, accountId: string, action: SpendTurns) {
  return executeAction(pool, accountId, action, { amount: action.amount }, async context => {
    requireActive(context);
    if (!Number.isInteger(action.amount) || action.amount < 1 || action.amount > 10) throw new DomainError(400, 'INVALID_AMOUNT');
    if (context.run.turns < action.amount) throw new DomainError(409, 'INSUFFICIENT_TURNS');
    const updated = await context.client.query('UPDATE runs SET turns=turns-$1,revision=revision+1 WHERE id=$2 RETURNING turns,revision', [action.amount, context.run.id]);
    await context.client.query('INSERT INTO turn_ledger(run_id,request_id,delta,reason) VALUES($1,$2,$3,$4)', [context.run.id, action.requestId, -action.amount, 'PROTOTYPE_SPEND']);
    return { runId: context.run.id, turns: updated.rows[0].turns, revision: updated.rows[0].revision };
  });
}
