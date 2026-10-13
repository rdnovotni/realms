import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createClient} from '@redis/client';
import {poolFor,assertSchema} from '../dist/database.js';
import {enqueue,claimJob} from '../dist/domains/jobs.js';
import {commitJob,failJob,LeaseLost} from '../dist/worker.js';
import {DisposableCache} from '../dist/cache.js';
const name=process.env.DB_NAME,namespace=process.env.CACHE_NAMESPACE;
if(!/^kol_(production|staging)$/.test(name??''))throw new Error('Project database required');
const secret=k=>readFileSync(`/run/secrets/${k}`,'utf8').trim();
const db=role=>poolFor(`postgresql://${role}:${secret(role==='realms_worker'?'worker_password':'migration_password')}@db:5432/${name}`);
const owner=db('realms_migrator'),worker=db('realms_worker');
const raw=user=>createClient({maintNotifications:'disabled',socket:{host:'cache',connectTimeout:1000,reconnectStrategy:false},username:user,password:secret(user==='admin'?'cache_admin_password':'cache_password'),disableOfflineQueue:true}).on('error',()=>{});
const admin=raw('admin'),app=raw('cache'),cache=new DisposableCache(namespace,secret('cache_password'));
const ok=(v,s)=>{assert.ok(v,s);console.log('PASS: '+s);};
const mode=process.argv[2]??'full';
const watchdog=setTimeout(()=>{console.error('Acceptance timed out');process.exit(1);},120000).unref();
const snapshot=async()=>JSON.stringify((await owner.query(`SELECT
 (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM characters c) AS characters,
 (SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY id),'[]') FROM wallets w) AS wallets,
 (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY bucket_key),'[]') FROM auth_throttle a) AS auth_limits`)).rows[0]);
try{
 await assertSchema(worker);await admin.connect();await app.connect();
 ok(!(await worker.query("SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls AS bad FROM pg_roles WHERE rolname=current_user")).rows[0].bad,'worker is not a database administrator');
 for(const sql of ["UPDATE wallets SET balance=balance","UPDATE characters SET account_id=account_id","CREATE TABLE public.unauthorized_probe(id integer)","DELETE FROM job_execution_receipts"]){
  await assert.rejects(worker.query(sql),e=>e.code==='42501');
 }
 ok(true,'worker cannot rewrite characters/economy, create schema or delete receipts');
 await assert.rejects(app.sendCommand(['FLUSHALL']),e=>e.message.includes('NOPERM'));
 await assert.rejects(app.get('another-project:key'),e=>e.message.includes('NOPERM'));
 ok(true,'cache runtime cannot flush instances or read other namespaces');
 const policy=await admin.configGet(['maxmemory','maxmemory-policy','appendonly','save','maxmemory-clients']);
 ok(policy.maxmemory==='134217728'&&policy['maxmemory-policy']==='allkeys-lru'&&policy.appendonly==='no'&&policy.save==='','cache maxmemory, LRU eviction and disposable persistence settings');
 if(mode==='full'){
  await owner.query(`CREATE SCHEMA IF NOT EXISTS infra006_probe;
   CREATE TABLE IF NOT EXISTS infra006_probe.marker(id integer PRIMARY KEY,job uuid NOT NULL,balance integer NOT NULL);
   GRANT USAGE ON SCHEMA infra006_probe TO realms_worker;
   GRANT SELECT,INSERT,UPDATE ON infra006_probe.marker TO realms_worker;`);
  const id=await enqueue(owner,`infra006:${randomUUID()}`,'INFRA006_PROBE',{});
  await owner.query('INSERT INTO infra006_probe.marker VALUES(1,$1,0) ON CONFLICT(id) DO UPDATE SET job=$1,balance=0',[id]);
  const claim=()=>claimJob(worker,30,['INFRA006_PROBE']);
  const old=await claim();ok(old?.id===id,'durable probe claimed');
  await assert.rejects(commitJob(worker,old,async c=>{await c.query('UPDATE infra006_probe.marker SET balance=999 WHERE id=1');throw new Error('interrupted');}));
  ok((await owner.query('SELECT balance FROM infra006_probe.marker WHERE id=1')).rows[0].balance===0,'interrupted SQL effect rolled back');
  await owner.query("UPDATE durable_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);
  const fresh=await claim();ok(fresh.lease_token!==old.lease_token,'expired task reclaimed with a fresh fencing token');
  await assert.rejects(commitJob(worker,old,async()=>({})),LeaseLost);
  const reward=async c=>{await c.query('UPDATE infra006_probe.marker SET balance=balance+10 WHERE id=1');return {credited:10};};
  const replay=await Promise.allSettled([commitJob(worker,fresh,reward),commitJob(worker,fresh,reward)]);
  ok(replay.filter(r=>r.status==='fulfilled').length===1,'concurrent replay commits only once');
  const failed=await enqueue(owner,`infra006:${randomUUID()}`,'INFRA006_PROBE',{});
  for(let i=0;i<3;i++){const j=await claim();await failJob(worker,j,'TEST_FAILURE');await owner.query('UPDATE durable_jobs SET available_at=clock_timestamp() WHERE id=$1',[failed]);}
  ok((await owner.query('SELECT status FROM durable_jobs WHERE id=$1',[failed])).rows[0].status==='FAILED','bounded retry exhausts into a durable dead letter');
  const before=await snapshot();
  ok(await cache.set('probe:cache','disposable',60)==='OK'&&await cache.get('probe:cache')==='disposable','backend cache authenticated round trip');
  ok(await cache.allow('probe-rate',1,60)===true&&await cache.allow('probe-rate',1,60)===false,'atomic ephemeral rate limit');
  const payload='x'.repeat(256*1024);
  for(let i=0;i<640;i++)await app.set(`${namespace}:probe:pressure:${i}`,payload,{EX:5});
  const memory=await admin.info('memory');const stats=await admin.info('stats');
  ok(Number(memory.match(/used_memory:(\d+)/)?.[1])<=134217728&&Number(stats.match(/evicted_keys:(\d+)/)?.[1])>0,'memory pressure evicts disposable keys within configured maxmemory');
  await admin.flushAll();
  ok(await cache.get('probe:cache')===null,'complete cache loss confirmed');
  ok(await snapshot()===before,'cache loss leaves actual characters, economy and durable authentication limits unchanged');
 }
 const marker=(await owner.query('SELECT * FROM infra006_probe.marker WHERE id=1')).rows[0];
 ok(marker?.balance===10,'durable probe effect retained exactly once');
 const receipt=await owner.query('SELECT 1 FROM job_execution_receipts WHERE job_id=$1',[marker.job]);
 ok(receipt.rowCount===1,'durable execution receipt retained');
 ok((await owner.query('SELECT status FROM durable_jobs WHERE id=$1',[marker.job])).rows[0].status==='SUCCEEDED','durable completed task remains terminal');
}finally{
 clearTimeout(watchdog);cache.close();if(admin.isOpen)admin.destroy();if(app.isOpen)app.destroy();await worker.end();await owner.end();
}
