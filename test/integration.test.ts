import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { migrate } from '../src/database.js';
import { testDatabase } from './helpers.js';
import { publishContent } from '../src/domains/content.js';
import { buildApp } from '../src/app.js';

test('transactional action: concurrent retries, restart, auth, stale input, rollback', async () => {
  const database=await testDatabase(),pool=database.pool;
  const account = randomUUID(), character = randomUUID(), run = randomUUID(), requestId = randomUUID();
  const token = 'integration-only-token'.repeat(2);
  let app = buildApp(pool, {mode:'development',token,accountId:account});
  try {
    await migrate(pool); await migrate(pool);
    await pool.query('INSERT INTO accounts(id) VALUES($1)', [account]);
    await pool.query('INSERT INTO characters(id,account_id) VALUES($1,$2)', [character, account]);
    const release=await publishContent(pool,{version:'integration-fixture',engineVersion:'foundation-1',entities:[]});
    await pool.query('INSERT INTO runs(id,character_id,turns,content_release_id) VALUES($1,$2,3,$3)', [run, character,release]);
    const action = { requestId, actionType: 'SPEND_TURNS', amount: 1, expectedRevision: 0 };
    const post = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/v1/actions', headers: { authorization: `Bearer ${token}` }, payload });
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/actions', payload: action })).statusCode, 401);
    assert.equal((await post({ ...action, amount: 0 })).statusCode, 400);
    assert.equal((await post({ ...action, actorId: randomUUID() })).statusCode, 400);
    assert.equal((await post({ ...action, amount: '1' })).statusCode, 400);
    const results = await Promise.all(Array.from({ length: 8 }, () => post(action)));
    assert.ok(results.every(r => r.statusCode === 200));
    assert.equal(results.filter(r => !r.json().replayed).length, 1);
    assert.ok(results.every(r => r.json().turns === 2 && r.json().revision === 1));
    assert.equal((await post({ ...action, amount: 2 })).json().error, 'REQUEST_ID_REUSED');
    assert.equal((await post({ ...action, requestId: randomUUID() })).json().error, 'STALE_REVISION');
    assert.equal((await post({ ...action, requestId: randomUUID(), expectedRevision: 1, amount: 3 })).json().error, 'INSUFFICIENT_TURNS');
    await app.close();
    app = buildApp(pool, {mode:'development',token,accountId:account});
    assert.equal((await post(action)).json().replayed, true);
    const ledger = await pool.query('SELECT count(*)::int AS count, sum(delta)::int AS delta FROM turn_ledger WHERE run_id=$1', [run]);
    assert.deepEqual(ledger.rows[0], { count: 1, delta: -1 });
    // Force a persistence failure after the update: the entire Action must roll back.
    const collision = randomUUID();
    await pool.query('INSERT INTO turn_ledger(run_id,request_id,delta,reason) VALUES($1,$2,0,$3)', [run, collision, 'TEST_FAILURE_FIXTURE']);
    assert.equal((await post({ ...action, requestId: collision, expectedRevision: 1 })).statusCode, 503);
    const state = await pool.query('SELECT turns,revision FROM runs WHERE id=$1', [run]);
    assert.deepEqual(state.rows[0], { turns: 2, revision: 1 });
    const receipts = await pool.query('SELECT count(*)::int AS count FROM action_receipts WHERE account_id=$1', [account]);
    assert.equal(receipts.rows[0].count, 1);
  } finally {
    await app.close();
    await database.close();
  }
});
