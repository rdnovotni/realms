import { seedLegacyConsumption } from './helpers.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {actor,testDatabase} from './helpers.js';
import {configureSchedule,planSchedules,schedulerStep,resumePeriod,dryRun,type ScheduleHook} from '../src/scheduler.js';
import {rolloverInstant} from '../src/schedule-clock.js';
const definition={id:'game-daily',hook:'DAILY_ROLLOVER',cadence:'DAILY' as const,timezone:'America/Chicago',localTime:'00:00',startDate:'2026-01-01',config:{turns:7,cap:30}};
async function ready(pool:any){await pool.query("UPDATE scheduled_periods SET available_at=available_at-interval '1 day' WHERE status='PENDING'; UPDATE rollover_subjects SET available_at=now() WHERE status<>'DONE'");}
async function drain(pool:any,batch=1){for(let n=0;n<50;n++){await ready(pool);if(!await schedulerStep(pool,batch))break;}}
test('civil daily boundaries choose early fold and first valid gap minute without a 24-hour assumption',()=>{
 assert.equal(rolloverInstant('2026-03-08','02:30','America/New_York'),'2026-03-08T07:00:00.000Z');
 assert.equal(rolloverInstant('2026-11-01','01:30','America/New_York'),'2026-11-01T05:30:00.000Z');
 assert.equal(Date.parse(rolloverInstant('2026-03-09','00:00','America/Chicago'))-Date.parse(rolloverInstant('2026-03-08','00:00','America/Chicago')),23*3600000);
 assert.equal(Date.parse(rolloverInstant('2026-11-02','00:00','America/Chicago'))-Date.parse(rolloverInstant('2026-11-01','00:00','America/Chicago')),25*3600000);
 assert.throws(()=>rolloverInstant('2026-02-30','00:00','UTC'));assert.throws(()=>rolloverInstant('2026-01-01','00:00','not-a-zone'));
});
test('bounded catch-up, concurrent planners/workers, daily resets and repeats produce one ledger grant per account/day',async()=>{
 const db=await testDatabase(),p=db.pool;try{
  const users=await Promise.all([actor(p,null,3),actor(p,null,40),actor(p,null,3)]);
  await p.query("UPDATE accounts SET created_at='2025-12-01'");for(const user of users)await seedLegacyConsumption(p,user.run,{fullness:4,drunkenness:2,tolerance:1});
  await configureSchedule(p,definition);const preview=await dryRun(p,3);assert.equal(preview.periods.length,3);
  assert.equal((await p.query('SELECT count(*) FROM scheduled_periods')).rows[0].count,'0');
  await Promise.all([planSchedules(p,3),planSchedules(p,3)]);
  // Concurrent calls either skip the locked schedule or plan the next bounded tranche.
  const periods=Number((await p.query('SELECT count(*) FROM scheduled_periods')).rows[0].count);assert.ok(periods>=3&&periods<=6);
  for(let n=0;n<50;n++){await ready(p);await Promise.all([schedulerStep(p,1),schedulerStep(p,1)]);}
  assert.equal((await p.query("SELECT count(*) FROM scheduled_periods WHERE status<>'SUCCEEDED'")).rows[0].count,'0');
  assert.equal((await p.query('SELECT count(*) FROM run_rollovers')).rows[0].count,String(periods*3));
  assert.equal((await p.query('SELECT count(*) FROM turn_ledger WHERE reason LIKE \'ROLLOVER:%\'')).rows[0].count,String(periods*3));
  assert.equal((await p.query('SELECT turns FROM runs WHERE id=$1',[users[1]!.run])).rows[0].turns,40);
  assert.equal((await p.query('SELECT fullness+drunkenness+tolerance AS total FROM run_consumption LIMIT 1')).rows[0].total,0);
  await drain(p);assert.equal((await p.query('SELECT count(*) FROM run_rollovers')).rows[0].count,String(periods*3));
  await assert.rejects(p.query("UPDATE scheduled_periods SET status='PENDING' WHERE status='SUCCEEDED'"),/immutable/);
  await assert.rejects(p.query("UPDATE game_schedules SET timezone='UTC'"),/immutable/);
 }finally{await db.close();}
});
test('a failed SQL hook rolls back effects, records bounded retries, resumes with cursor and never repeats completed work',async()=>{
 const db=await testDatabase(),p=db.pool;try{
  await p.query('CREATE TABLE hook_probe(value integer NOT NULL); INSERT INTO hook_probe VALUES(0)');
  await configureSchedule(p,{...definition,id:'event-fixture',hook:'TIMED_EVENT',cadence:'ONCE',config:{}});await planSchedules(p);
  await p.query("UPDATE game_schedules SET enabled=false WHERE id='event-fixture'");assert.equal(await schedulerStep(p),false);
  await p.query("UPDATE game_schedules SET enabled=true WHERE id='event-fixture'");
  const broken:ScheduleHook=async(c)=>{await c.query('UPDATE hook_probe SET value=value+1');throw new Error('FIXTURE_FAILURE');};
  for(let n=0;n<5;n++){await ready(p);await schedulerStep(p,1,{TIMED_EVENT:broken});}
  assert.equal((await p.query('SELECT value FROM hook_probe')).rows[0].value,0);
  assert.equal((await p.query('SELECT status FROM scheduled_periods')).rows[0].status,'FAILED');
  assert.equal((await p.query('SELECT count(*) FROM scheduler_execution_log WHERE error_code=\'FIXTURE_FAILURE\'')).rows[0].count,'5');
  await resumePeriod(p,'event-fixture:2026-01-01');
  const good:ScheduleHook=async(c,period)=>{await c.query('UPDATE hook_probe SET value=value+1');const n=Number(period.cursor.n??0)+1;return {done:n===2,cursor:{n},report:{processed:1}};};
  await schedulerStep(p,1,{TIMED_EVENT:good});await ready(p);await schedulerStep(p,1,{TIMED_EVENT:good});
  assert.equal((await p.query('SELECT value FROM hook_probe')).rows[0].value,2);
  assert.equal(await schedulerStep(p,1,{TIMED_EVENT:good}),false);
  assert.equal(await planSchedules(p),0);assert.equal((await dryRun(p)).periods.length,0);
 }finally{await db.close();}
});
test('unknown guild/event hooks fail visibly instead of inventing rewards; production policy is explicitly required',async()=>{
 const db=await testDatabase(),p=db.pool;try{
  await assert.rejects(configureSchedule(p,{...definition,config:{}}),/EXPLICIT_ROLLOVER_POLICY_REQUIRED/);
  await configureSchedule(p,{...definition,id:'guild-fixture',hook:'GUILD_ACTIVITY',cadence:'ONCE',config:{}});await planSchedules(p);await schedulerStep(p);
  assert.equal((await p.query('SELECT last_error FROM scheduled_periods')).rows[0].last_error,'UNREGISTERED_SCHEDULE_HOOK');
 }finally{await db.close();}
});
test('interrupted PostgreSQL transaction releases period lock and resumes without retaining partial effects',async()=>{
 const db=await testDatabase(),p=db.pool;try{
  await p.query('CREATE TABLE interrupted_probe(value integer); INSERT INTO interrupted_probe VALUES(0)');
  await configureSchedule(p,{...definition,id:'crash-fixture',hook:'TIMED_EVENT',cadence:'ONCE',config:{}});await planSchedules(p);
  const interrupted:ScheduleHook=async(c)=>{await c.query('UPDATE interrupted_probe SET value=1');const pid=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;await p.query('SELECT pg_terminate_backend($1)',[pid]);await c.query('SELECT 1');return {done:true,cursor:{},report:{}};};
  await assert.rejects(schedulerStep(p,1,{TIMED_EVENT:interrupted}));
  assert.equal((await p.query('SELECT value FROM interrupted_probe')).rows[0].value,0);
  assert.equal((await p.query('SELECT status FROM scheduled_periods')).rows[0].status,'PENDING');
  await schedulerStep(p,1,{TIMED_EVENT:async(c)=>{await c.query('UPDATE interrupted_probe SET value=1');return {done:true,cursor:{},report:{}};}});
  assert.equal((await p.query('SELECT value FROM interrupted_probe')).rows[0].value,1);
 }finally{await db.close();}
});
test('encounter deferral does not block other accounts, and missed days resume chronologically after resolution',async()=>{
 const db=await testDatabase(),p=db.pool;try{
  const {createInstance}=await import('../src/domains/instances.js');const {randomUUID}=await import('node:crypto');
  const a=await actor(p),b=await actor(p);await p.query("UPDATE accounts SET created_at='2025-12-01'");
  const release=(await p.query('SELECT content_release_id FROM runs WHERE id=$1',[a.run])).rows[0].content_release_id;
  const combat=await createInstance(p,a.account,{requestId:randomUUID(),actionType:'CREATE_INSTANCE',expectedRevision:0},release,'COMBAT');
  await configureSchedule(p,definition);await planSchedules(p,2);
  for(let n=0;n<8;n++){await ready(p);await schedulerStep(p,2);}
  assert.equal((await p.query('SELECT count(*) FROM run_rollovers WHERE account_id=$1',[a.account])).rows[0].count,'0');
  assert.equal((await p.query('SELECT count(*) FROM run_rollovers WHERE account_id=$1',[b.account])).rows[0].count,'2');
  await p.query("UPDATE instances SET lifecycle='RESOLVED' WHERE id=$1",[combat.instanceId]);
  await drain(p,2);
  assert.equal((await p.query('SELECT count(*) FROM run_rollovers WHERE account_id=$1',[a.account])).rows[0].count,'2');
  assert.equal((await p.query('SELECT turns FROM runs WHERE id=$1',[a.run])).rows[0].turns,17);
 }finally{await db.close();}
});
test('the restricted scheduler role can execute real domain rollover with sealed-content and integrity triggers',async()=>{
 const db=await testDatabase(),p=db.pool;try{
  const {provisionScheduler}=await import('../src/scheduler-role.js');
  // This role name matches the runtime; no memberships or administrator grants.
  await p.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='realms_scheduler') THEN CREATE ROLE realms_scheduler NOLOGIN; END IF; END $$");
  const c=await p.connect();try{await provisionScheduler(c,db.schema);}finally{c.release();}
  const user=await actor(p);await p.query("UPDATE accounts SET created_at='2025-12-01'");
  await configureSchedule(p,definition);
  // Each transaction checks actual grants via SET LOCAL ROLE, which resets at commit.
  const limited={connect:async()=>{const c=await p.connect();const query=c.query.bind(c);c.query=((...args:any[])=>{const result=(query as any)(...args);if(args[0]==='BEGIN')return result.then(()=>query('SET LOCAL ROLE realms_scheduler'));return result;}) as typeof c.query;const release=c.release.bind(c);c.release=((broken?:boolean)=>{c.query=query as typeof c.query;release(broken);}) as typeof c.release;return c;}} as typeof p;
  await planSchedules(limited,1);
  for(let n=0;n<3;n++){await ready(p);await schedulerStep(limited,1);}
  assert.equal((await p.query('SELECT turns FROM runs WHERE id=$1',[user.run])).rows[0].turns,10);
  assert.equal((await p.query('SELECT status FROM scheduled_periods')).rows[0].status,'SUCCEEDED');
 }finally{await db.close();}
});
test('paused policies preview without execution, and future schedules cannot starve a due definition',async()=>{
 const db=await testDatabase(),p=db.pool;try{
  const day=(await p.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD') AS day")).rows[0].day;
  for(let n=0;n<18;n++)await configureSchedule(p,{...definition,id:'aaa-fixture-'+String(n).padStart(2,'0'),hook:'TIMED_EVENT',cadence:'ONCE',timezone:'UTC',localTime:'23:59',startDate:day,config:{}});
  await configureSchedule(p,{...definition,timezone:'UTC',startDate:day,enabled:false});
  assert.equal((await p.query("SELECT enabled FROM game_schedules WHERE id='game-daily'")).rows[0].enabled,false);
  await dryRun(p);assert.equal((await p.query('SELECT count(*) FROM scheduled_periods')).rows[0].count,'0');
  await p.query("UPDATE game_schedules SET enabled=true WHERE id='game-daily'");
  for(let n=0;n<3;n++)await planSchedules(p);
  assert.equal((await p.query("SELECT count(*) FROM scheduled_periods WHERE schedule_id='game-daily'")).rows[0].count,'1');
 }finally{await db.close();}
});
