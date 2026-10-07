import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config,serverConfig } from '../src/config.js';
import { checksum,canonicalJson } from '../src/foundation/json.js';
import { randomInteger } from '../src/foundation/rng.js';
import { mkdtemp,mkdir,writeFile,readFile,stat,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify,parseEnv } from 'node:util';
const env = { DATABASE_URL: 'postgresql://localhost/test', DEV_API_TOKEN: 'x'.repeat(32), DEV_ACCOUNT_ID: '12345678-1234-1234-1234-123456789abc' };
test('development server defaults to loopback', () => assert.equal(config(env).host, '127.0.0.1'));
test('public binding is refused', () => assert.throws(() => config({ ...env, HOST: '0.0.0.0' })));
test('invalid ports and short credentials are refused', () => {
  assert.throws(() => config({ ...env, PORT: 'NaN' }));
  assert.throws(() => config({ ...env, DEV_API_TOKEN: 'short' }));
});
test('runtime rejects administration secrets and excludes the development bypass in session mode',()=>{
  assert.throws(()=>serverConfig({...env,DATABASE_ADMIN_URL:'private'}));
  assert.throws(()=>serverConfig({...env,TEST_DATABASE_URL:'private'}));
  assert.throws(()=>serverConfig({...env,AUTH_MODE:'sessions',AUTH_THROTTLE_KEY:'a'.repeat(64)}));
  assert.equal(serverConfig({DATABASE_URL:env.DATABASE_URL,AUTH_MODE:'sessions',AUTH_THROTTLE_KEY:'a'.repeat(64)}).auth.mode,'sessions');
  assert.throws(()=>serverConfig({DATABASE_URL:env.DATABASE_URL,AUTH_MODE:'unknown'}));
});
test('runtime file filters secrets, uses owner-only permissions and removes the bypass in session mode',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'realms-runtime-'));
  try{
    await mkdir(join(dir,'.state'));
    const source=`DATABASE_URL=postgresql://realms_app@localhost/dev\nDATABASE_ADMIN_URL=private-admin\nTEST_DATABASE_URL=private-test\nDEV_API_TOKEN=${'x'.repeat(32)}\nDEV_ACCOUNT_ID=${env.DEV_ACCOUNT_ID}\n`;
    const script=fileURLToPath(new URL('../scripts/runtime-config.mjs',import.meta.url));
    await writeFile(join(dir,'.env'),source);
    await promisify(execFile)(process.execPath,[script],{cwd:dir});
    const development=parseEnv(await readFile(join(dir,'.state/runtime.env'),'utf8'));
    assert.equal(development.DEV_API_TOKEN,env.DEV_API_TOKEN);assert.equal(development.DATABASE_ADMIN_URL,undefined);assert.equal(development.TEST_DATABASE_URL,undefined);
    await writeFile(join(dir,'.env'),source+'AUTH_MODE=sessions\n');
    await promisify(execFile)(process.execPath,[script],{cwd:dir});
    const sessions=parseEnv(await readFile(join(dir,'.state/runtime.env'),'utf8'));
    assert.equal(sessions.AUTH_MODE,'sessions');assert.equal(sessions.DEV_API_TOKEN,undefined);assert.equal(sessions.DEV_ACCOUNT_ID,undefined);
    assert.match(sessions.AUTH_THROTTLE_KEY!,/^[0-9a-f]{64}$/);assert.equal(sessions.DATABASE_ADMIN_URL,undefined);
    assert.equal((await stat(join(dir,'.state/runtime.env'))).mode&0o777,0o600);assert.equal((await stat(join(dir,'.env'))).mode&0o777,0o600);
  }finally{await rm(dir,{recursive:true,force:true});}
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
