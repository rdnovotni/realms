import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
const env = { DATABASE_URL: 'postgresql://localhost/test', DEV_API_TOKEN: 'x'.repeat(32), DEV_ACCOUNT_ID: '12345678-1234-1234-1234-123456789abc' };
test('development server defaults to loopback', () => assert.equal(config(env).host, '127.0.0.1'));
test('public binding is refused', () => assert.throws(() => config({ ...env, HOST: '0.0.0.0' })));
test('invalid ports and short credentials are refused', () => {
  assert.throws(() => config({ ...env, PORT: 'NaN' }));
  assert.throws(() => config({ ...env, DEV_API_TOKEN: 'short' }));
});
