import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { contentView,publishContent } from '../src/domains/content.js';
import { actor } from './helpers.js';
import { testDatabase } from './helpers.js';
import { enqueue,claimJob } from '../src/domains/jobs.js';
import { commitJob,failJob,LeaseLost,workerStep } from '../src/worker.js';
import { DisposableCache } from '../src/cache.js';

test('SQL effect and completion commit once under concurrent replay',async()=>{
 const db=await testDatabase();try{
  await db.pool.query('CREATE TABLE reward_probe(id integer PRIMARY KEY,amount integer NOT NULL); INSERT INTO reward_probe VALUES(1,0)');
  const key=randomUUID();const id=await enqueue(db.pool,key,'REWARD_PROBE',{});const job=await claimJob(db.pool);
  const handler=async(c:Parameters<Parameters<typeof commitJob>[2]>[0])=>{await c.query('UPDATE reward_probe SET amount=amount+10 WHERE id=1');return {credited:10};};
  const results=await Promise.allSettled([commitJob(db.pool,job,handler),commitJob(db.pool,job,handler)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await db.pool.query('SELECT amount FROM reward_probe')).rows[0].amount,10);
  assert.equal(await enqueue(db.pool,key,'REWARD_PROBE',{}),id);
  assert.equal(await claimJob(db.pool),null);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM job_execution_receipts')).rows[0].n,1);
 }finally{await db.close();}
});
test('interrupted SQL rolls back, expired lease is fenced, fresh owner completes',async()=>{
 const db=await testDatabase();try{
  await db.pool.query('CREATE TABLE reward_probe(amount integer); INSERT INTO reward_probe VALUES(0)');
  await enqueue(db.pool,randomUUID(),'REWARD_PROBE',{});const old=await claimJob(db.pool);
  await assert.rejects(commitJob(db.pool,old,async c=>{await c.query('UPDATE reward_probe SET amount=99');throw new Error('simulated interruption');}));
  assert.equal((await db.pool.query('SELECT amount FROM reward_probe')).rows[0].amount,0);
  await db.pool.query("UPDATE durable_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[old.id]);
  const fresh=await claimJob(db.pool);
  await assert.rejects(commitJob(db.pool,old,async()=>({})),LeaseLost);
  await commitJob(db.pool,fresh,async c=>{await c.query('UPDATE reward_probe SET amount=10');return {credited:10};});
  assert.equal((await db.pool.query('SELECT amount FROM reward_probe')).rows[0].amount,10);
 }finally{await db.close();}
});
test('lease expiring DURING transaction rolls back its effects and receipt',async()=>{
 const db=await testDatabase();try{
  await db.pool.query('CREATE TABLE reward_probe(amount integer); INSERT INTO reward_probe VALUES(0)');
  await enqueue(db.pool,randomUUID(),'REWARD_PROBE',{});const job=await claimJob(db.pool,1);
  await assert.rejects(commitJob(db.pool,job,async c=>{await c.query('UPDATE reward_probe SET amount=10');await c.query('SELECT pg_sleep(1.1)');return {credited:10};}),LeaseLost);
  assert.equal((await db.pool.query('SELECT amount FROM reward_probe')).rows[0].amount,0);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM job_execution_receipts')).rows[0].n,0);
 }finally{await db.close();}
});
test('unknown work retries with backoff then becomes durable dead letter; exhausted crash logged',async()=>{
 const db=await testDatabase();try{
  const id=await enqueue(db.pool,randomUUID(),'UNKNOWN',{});
  for(let i=0;i<3;i++){await workerStep(db.pool,{});await db.pool.query("UPDATE durable_jobs SET available_at=clock_timestamp() WHERE id=$1",[id]);}
  assert.equal((await db.pool.query('SELECT status FROM durable_jobs WHERE id=$1',[id])).rows[0].status,'FAILED');
  assert.deepEqual((await db.pool.query('SELECT outcome FROM job_execution_log ORDER BY id')).rows.map(r=>r.outcome),['RETRY','RETRY','FAILED']);
  await assert.rejects(db.pool.query("UPDATE durable_jobs SET status='PENDING' WHERE id=$1",[id]));
  await enqueue(db.pool,randomUUID(),'CRASHED',{});const job=await claimJob(db.pool);
  await db.pool.query("UPDATE durable_jobs SET attempts=max_attempts,lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[job.id]);
  await workerStep(db.pool,{});
  assert.equal((await db.pool.query('SELECT error_code FROM job_execution_log WHERE job_id=$1',[job.id])).rows[0].error_code,'LEASE_EXHAUSTED');
 }finally{await db.close();}
});
test('cache outage is bounded and returns fallback instead of permanent data',async()=>{
 const cache=new DisposableCache('kol-staging','unused','127.0.0.1',1);
 try{const before=Date.now();assert.equal(await cache.get('content:probe'),null);assert.ok(Date.now()-before<1500);assert.equal(await cache.allow('user'),null);}finally{cache.close();}
});

test('lost PostgreSQL connection rolls back work and permits lease recovery',async()=>{
 const db=await testDatabase();try{
  await db.pool.query('CREATE TABLE reward_probe(amount integer); INSERT INTO reward_probe VALUES(0)');
  await enqueue(db.pool,randomUUID(),'REWARD_PROBE',{});const old=await claimJob(db.pool);
  await assert.rejects(commitJob(db.pool,old,async c=>{
   const pid=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
   await c.query('UPDATE reward_probe SET amount=999');
   await db.pool.query('SELECT pg_terminate_backend($1)',[pid]);
   await c.query('SELECT 1');return {credited:999};
  }));
  assert.equal((await db.pool.query('SELECT amount FROM reward_probe')).rows[0].amount,0);
  await db.pool.query("UPDATE durable_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[old.id]);
  const fresh=await claimJob(db.pool);
  await commitJob(db.pool,fresh,async c=>{await c.query('UPDATE reward_probe SET amount=10');return {credited:10};});
  assert.equal((await db.pool.query('SELECT amount FROM reward_probe')).rows[0].amount,10);
 }finally{await db.close();}
});

test('cached content checks discoveries anew and never shares advanced knowledge with another account',async()=>{
 const db=await testDatabase();try{
  const release=await publishContent(db.pool,{version:'cache-fixture',engineVersion:'foundation-1',entities:[{id:'lore.cache',kind:'LORE',revision:1,schemaVersion:1,definition:{name:'Lore',dependencies:[],public:{text:'public'},advanced:{text:'advanced'},secrets:{hidden:true}}}]});
  const a=await actor(db.pool,release),b=await actor(db.pool,release);
  await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,'lore.cache','ADVANCED'),($2,'lore.cache','DISCOVERED')",[a.account,b.account]);
  const entries=new Map<string,string>();
  const cache={allow:async()=>true,get:async(k:string)=>entries.get(k)??null,set:async(k:string,v:string)=>{entries.set(k,v);return 'OK';}} as unknown as DisposableCache;
  const advanced=await contentView(db.pool,a.account,release,'lore.cache',cache);
  assert.deepEqual(advanced.advanced,{text:'advanced'});assert.equal('secrets' in advanced,false);
  const basic=await contentView(db.pool,b.account,release,'lore.cache',cache);assert.equal(basic.advanced,null);
  await db.pool.query('DELETE FROM discoveries WHERE account_id=$1',[a.account]);
  await assert.rejects(contentView(db.pool,a.account,release,'lore.cache',cache));
 }finally{await db.close();}
});
