import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { checksum,canonicalJson } from '../src/foundation/json.js';
import { randomInteger } from '../src/foundation/rng.js';
const env = { DATABASE_URL: 'postgresql://localhost/test', DEV_API_TOKEN: 'x'.repeat(32), DEV_ACCOUNT_ID: '12345678-1234-1234-1234-123456789abc' };
test('development server defaults to loopback', () => assert.equal(config(env).host, '127.0.0.1'));
test('public binding is refused', () => assert.throws(() => config({ ...env, HOST: '0.0.0.0' })));
test('invalid ports and short credentials are refused', () => {
  assert.throws(() => config({ ...env, PORT: 'NaN' }));
  assert.throws(() => config({ ...env, DEV_API_TOKEN: 'short' }));
});
test('canonical content hashes ignore object key order and reject non-finite values',()=>{
  assert.equal(checksum({b:2,a:[1,{z:true}]}),checksum({a:[1,{z:true}],b:2}));
  assert.throws(()=>canonicalJson({value:Infinity}));
});
test('seeded RNG is repeatable and cosmetic streams cannot advance outcome streams',()=>{
  const seed=Buffer.alloc(32,7),roll=()=>Array.from({length:20},(_,n)=>randomInteger(seed,'loot',BigInt(n),100));
  const before=roll();for(let n=0;n<200;n++)randomInteger(seed,'cosmetic',BigInt(n),100);
  assert.deepEqual(before.slice(0,5),[79,79,24,41,85]); // Versioned compatibility vector.
  assert.deepEqual(roll(),before);assert.ok(before.every(n=>n>=0&&n<100));
  assert.notDeepEqual(before,Array.from({length:20},(_,n)=>randomInteger(seed,'combat',BigInt(n),100)));
  assert.throws(()=>randomInteger(Buffer.alloc(1),'loot',0n,10));
  assert.throws(()=>randomInteger(seed,'loot',-1n,10));
});
