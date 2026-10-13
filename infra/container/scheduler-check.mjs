// Durable acceptance fixture lives in its own schema, never in player tables.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {poolFor,migrate,assertSchema} from '../dist/database.js';
import {provisionScheduler} from '../dist/scheduler-role.js';
import {publishContent} from '../dist/domains/content.js';
import {configureSchedule,planSchedules,schedulerStep,dryRun} from '../dist/scheduler.js';
const name=process.env.DB_NAME,mode=process.argv[2];if(!/^kol_(production|staging)$/.test(name??''))throw new Error('Explicit project required');
const password=k=>readFileSync('/run/secrets/'+k,'utf8').trim();
const url=(role,key)=>`postgresql://${role}:${password(key)}@db:5432/${name}`;
const schema='infra_scheduler_acceptance',admin=poolFor(url('realms_migrator','migration_password'));
const owner=poolFor(url('realms_migrator','migration_password'),schema),runtime=poolFor(url('realms_scheduler','scheduler_password'),schema);
const ok=(value,label)=>{assert.ok(value,label);console.log('PASS: '+label);};
try{
 const exists=(await admin.query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[schema])).rowCount;
 if(!exists){
  assert.equal(mode,'initial');await admin.query('CREATE SCHEMA '+schema);
  await migrate(owner);const c=await owner.connect();try{await provisionScheduler(c,schema);}finally{c.release();}
  const release=await publishContent(owner,{version:'infra008-fixture',engineVersion:'foundation-1',entities:[]});
  await owner.query("INSERT INTO accounts(id,created_at) VALUES('00000000-0000-4000-8000-000000000008','1999-01-01'); INSERT INTO characters(id,account_id) VALUES('00000000-0000-4000-8000-000000000018','00000000-0000-4000-8000-000000000008')");
  await owner.query("INSERT INTO runs(id,character_id,turns,content_release_id) VALUES('00000000-0000-4000-8000-000000000028','00000000-0000-4000-8000-000000000018',3,$1)",[release]);
  await owner.query("INSERT INTO run_consumption(run_id) VALUES('00000000-0000-4000-8000-000000000028')");
  await configureSchedule(owner,{id:'game-daily',hook:'DAILY_ROLLOVER',cadence:'DAILY',timezone:'America/Chicago',localTime:'00:00',startDate:'2000-01-01',config:{turns:7,cap:30}});
 }
 await assertSchema(runtime);
 const unsafe=(await runtime.query(`SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR
  has_table_privilege(current_user,'wallets','UPDATE') OR has_column_privilege(current_user,'accounts','access_status','UPDATE') OR
  has_table_privilege(current_user,'schema_migrations','UPDATE') OR has_table_privilege(current_user,'game_schedules','INSERT') AS unsafe
  FROM pg_roles WHERE rolname=current_user`)).rows[0].unsafe;
 ok(!unsafe,'scheduler role cannot manage economy, account access, migrations or policy enrollment');
 if(mode==='initial'){
  if(!(await runtime.query('SELECT 1 FROM scheduled_periods LIMIT 1')).rowCount){
   const preview=await dryRun(runtime,3);ok(preview.periods.length===3,'dry-run sees bounded due periods');
   ok(!(await runtime.query('SELECT 1 FROM scheduled_periods LIMIT 1')).rowCount,'dry-run writes no periods');
   await planSchedules(runtime,3);
  }
  for(let n=0;n<12;n++){
   await runtime.query("UPDATE scheduled_periods SET available_at=now() WHERE status='PENDING'; UPDATE rollover_subjects SET available_at=now() WHERE status<>'DONE'");
   await Promise.all([schedulerStep(runtime,1),schedulerStep(runtime,1)]);
  }
 }
 ok((await runtime.query('SELECT turns FROM runs')).rows[0].turns===24,'three fixture day grants retained exactly once');
 ok((await runtime.query('SELECT count(*) FROM run_rollovers')).rows[0].count==='3','one durable account receipt per fixture game day');
 ok((await runtime.query("SELECT count(*) FROM scheduled_periods WHERE status='SUCCEEDED'")).rows[0].count==='3','completed scheduler checkpoints retained');
 ok(!await schedulerStep(runtime),'completed fixture days cannot replay');
 const publicPool=poolFor(url('realms_scheduler','scheduler_password'));
 try{
  const count=(await publicPool.query('SELECT count(*) FROM game_schedules')).rows[0].count;
  console.log('Actual configured schedules: '+count+' (acceptance fixture is separate; no gameplay policy added)');
 }finally{await publicPool.end();}
}finally{await runtime.end();await owner.end();await admin.end();}
