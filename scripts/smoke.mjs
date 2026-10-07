import assert from 'node:assert/strict';
const base = `http://127.0.0.1:${process.env.PORT ?? '3000'}`;
for (const path of ['/health/live', '/health/ready']) {
  const response = await fetch(`${base}${path}`);
  assert.equal(response.status, 200);
}
assert.equal((await fetch(`${base}/api/v1/state`)).status, 401);
const response = await fetch(`${base}/api/v1/state`, { headers: { authorization: `Bearer ${process.env.DEV_API_TOKEN}` } });
assert.equal(response.status, 200);
const state = await response.json();
assert.ok(Number.isInteger(state.turns) && state.turns >= 0);
assert.ok(Number.isInteger(state.revision) && state.revision >= 0);
console.log('Live endpoints, authorization, and persisted run state verified.');
