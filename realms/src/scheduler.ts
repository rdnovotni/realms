import type pg from 'pg';
import {transaction} from './foundation/transaction.js';
import {applyRolloverEpoch} from './domains/lifecycle.js';
import {nextDate,rolloverInstant,validateDate} from './schedule-clock.js';
import type {Json} from './foundation/json.js';
export type ScheduleDefinition={id:string;hook:string;cadence:'DAILY'|'ONCE';timezone:string;localTime:string;startDate:string;config:Record<string,Json>;enabled?:boolean};
export type ScheduledPeriod={id:string;epoch:string|null;cursor:Record<string,Json>;effective_at:Date;config:Record<string,Json>};
export type ScheduleHook=(client:pg.PoolClient,period:ScheduledPeriod,batch:number)=>Promise<{done:boolean;cursor:Record<string,Json>;report:Record<string,Json>}>;
const code=(e:unknown)=>{
 if(e instanceof Error&&/^[A-Z0-9_]{1,64}$/.test(e.message))return e.message;
 const state=(e as {code?:unknown})?.code;return typeof state==='string'&&/^[0-9A-Z]{5}$/.test(state)?'DATABASE_'+state:'SCHEDULER_FAILED';
};
export function validateSchedule(d:ScheduleDefinition){
 if(!/^[a-z][a-z0-9_-]{2,63}$/.test(d.id)||! /^[A-Z][A-Z0-9_]{2,63}$/.test(d.hook)||!['DAILY','ONCE'].includes(d.cadence))throw new Error('INVALID_SCHEDULE');
 validateDate(d.startDate);rolloverInstant(d.startDate,d.localTime,d.timezone);
 if(d.hook==='DAILY_ROLLOVER'){
  if(d.id!=='game-daily'||d.cadence!=='DAILY'||!Number.isInteger(d.config.turns)||!Number.isInteger(d.config.cap)||Number(d.config.turns)<0||Number(d.config.turns)>2147483647||Number(d.config.cap)<=0||Number(d.config.cap)>2147483647)throw new Error('EXPLICIT_ROLLOVER_POLICY_REQUIRED');
 }
}
export async function configureSchedule(pool:pg.Pool,d:ScheduleDefinition){
 validateSchedule(d);
 await pool.query(`INSERT INTO game_schedules(id,hook,cadence,timezone,local_time,start_date,next_date,config,enabled)
 VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8)`,[d.id,d.hook,d.cadence,d.timezone,d.localTime,d.startDate,d.config,d.enabled??true]);
}
export async function planSchedules(pool:pg.Pool,limit=14){
 if(!Number.isInteger(limit)||limit<1||limit>32)throw new Error('INVALID_PERIOD_BATCH');
 return transaction(pool,async client=>{
  const schedules=(await client.query(`SELECT *,to_char(next_date,'YYYY-MM-DD') AS day FROM game_schedules
   WHERE enabled AND (cadence='DAILY' OR next_date=start_date) ORDER BY last_planned_at NULLS FIRST,next_date,id FOR UPDATE SKIP LOCKED LIMIT 16`)).rows;
  const now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;let created=0;
  for(const s of schedules){
   await client.query('UPDATE game_schedules SET last_planned_at=clock_timestamp() WHERE id=$1',[s.id]);
   const previousCreated=created;await client.query('SAVEPOINT planning');
   try{
    let day=s.day;
    while(created<limit){
     const effective=rolloverInstant(day,s.local_time,s.timezone);if(Date.parse(effective)>now.getTime())break;
     const id=s.id+':'+day;let epoch:string|null=null;
     if(s.hook==='DAILY_ROLLOVER'){
      epoch=day.replaceAll('-','');
      await client.query(`INSERT INTO rollover_epochs(epoch,effective_at,baseline_turns,turn_soft_cap) VALUES($1,$2,$3,$4) ON CONFLICT(epoch) DO NOTHING`,[epoch,effective,s.config.turns,s.config.cap]);
      const e=(await client.query('SELECT * FROM rollover_epochs WHERE epoch=$1',[epoch])).rows[0];
      if(e.effective_at.toISOString()!==effective||e.baseline_turns!==s.config.turns||e.turn_soft_cap!==s.config.cap)throw new Error('EPOCH_IDENTITY_CONFLICT');
     }
     await client.query('INSERT INTO scheduled_periods(id,schedule_id,game_date,effective_at,epoch) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[id,s.id,day,effective,epoch]);
     created++;day=nextDate(day);
     await client.query('UPDATE game_schedules SET next_date=$2,last_error=NULL,enabled=$3 WHERE id=$1',[s.id,day,true]);
     if(s.cadence==='ONCE')break;
    }
    await client.query('RELEASE SAVEPOINT planning');
   }catch(error){
    await client.query('ROLLBACK TO SAVEPOINT planning');created=previousCreated;
    await client.query('UPDATE game_schedules SET last_error=$2,enabled=false WHERE id=$1',[s.id,code(error)]);
    await client.query(`INSERT INTO scheduler_execution_log(schedule_id,outcome,error_code) VALUES($1,'PLANNING_FAILED',$2)`,[s.id,code(error)]);
   }
  }
  return created;
 });
}
export const dailyRollover:ScheduleHook=async(client,period,batch)=>{
 const cursor={...period.cursor};let enrolled=0,processed=0,deferred=0;
 if(!cursor.enumerated){
  const rows=(await client.query(`SELECT id FROM accounts WHERE created_at<=$1 AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT $3`,[period.effective_at,cursor.account??null,batch])).rows;
  for(const row of rows)await client.query('INSERT INTO rollover_subjects(period_id,account_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[period.id,row.id]);
  enrolled=rows.length;if(rows.length)cursor.account=rows.at(-1)!.id;
  if(rows.length<batch)cursor.enumerated=true;
 }
 const subjects=(await client.query(`SELECT account_id FROM rollover_subjects WHERE period_id=$1 AND status<>'DONE' AND available_at<=clock_timestamp() ORDER BY account_id LIMIT $2 FOR UPDATE SKIP LOCKED`,[period.id,batch])).rows;
 for(const s of subjects){
  const result=await applyRolloverEpoch(client,s.account_id,period.epoch!);
  await client.query(`UPDATE rollover_subjects SET status=$3,result=$4,available_at=clock_timestamp()+interval '5 seconds' WHERE period_id=$1 AND account_id=$2`,[period.id,s.account_id,result.deferred?'DEFERRED':'DONE',result]);
  processed++;if(result.deferred)deferred++;
 }
 const waiting=!!(await client.query("SELECT 1 FROM rollover_subjects WHERE period_id=$1 AND status<>'DONE' LIMIT 1",[period.id])).rowCount;
 return {done:!!cursor.enumerated&&!waiting,cursor,report:{enrolled,processed,deferred}};
};
export async function schedulerStep(pool:pg.Pool,batch=50,hooks:Record<string,ScheduleHook>={DAILY_ROLLOVER:dailyRollover}){
 if(!Number.isInteger(batch)||batch<1||batch>200)throw new Error('INVALID_PLAYER_BATCH');
 return transaction(pool,async client=>{
  await client.query("SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='2s'");
  const p=(await client.query(`SELECT p.*,s.hook,s.config FROM scheduled_periods p JOIN game_schedules s ON s.id=p.schedule_id
   WHERE p.status='PENDING' AND p.available_at<=clock_timestamp() AND s.enabled
   ORDER BY p.available_at,p.effective_at,p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED`)).rows[0];
  if(!p || p.available_at> (await client.query('SELECT clock_timestamp() AS now')).rows[0].now)return false;
  await client.query('SAVEPOINT effects');
  try{
   const hook=hooks[p.hook];if(!hook)throw new Error('UNREGISTERED_SCHEDULE_HOOK');
   const result=await hook(client,p,batch);
   // Surface deferred domain-integrity failures inside the recorded retry boundary.
   await client.query("SET CONSTRAINTS ALL IMMEDIATE");
   await client.query(`UPDATE scheduled_periods SET cursor=$2,status=$3,completed_at=CASE WHEN $4 THEN clock_timestamp() ELSE NULL END,
    attempts=0,last_error=NULL,available_at=clock_timestamp()+interval '1 second' WHERE id=$1`,[p.id,result.cursor,result.done?'SUCCEEDED':'PENDING',result.done]);
   await client.query(`INSERT INTO scheduler_execution_log(period_id,schedule_id,outcome,report) VALUES($1,$2,$3,$4)`,[p.id,p.schedule_id,result.done?'SUCCEEDED':'BATCH',result.report]);
  }catch(error){
   await client.query('ROLLBACK TO SAVEPOINT effects');const attempts=p.attempts+1;
   await client.query(`UPDATE scheduled_periods SET attempts=$2,status=$3,last_error=$4,available_at=clock_timestamp()+$5*interval '1 second' WHERE id=$1`,[p.id,attempts,attempts>=5?'FAILED':'PENDING',code(error),Math.min(300,5*2**(attempts-1))]);
   await client.query(`INSERT INTO scheduler_execution_log(period_id,schedule_id,outcome,error_code) VALUES($1,$2,$3,$4)`,[p.id,p.schedule_id,attempts>=5?'FAILED':'RETRY',code(error)]);
  }
  return true;
 });
}
export async function resumePeriod(pool:pg.Pool,id:string){
 return transaction(pool,async c=>{
  const row=(await c.query("UPDATE scheduled_periods SET status='PENDING',attempts=0,last_error=NULL,available_at=now() WHERE id=$1 AND status='FAILED' RETURNING schedule_id",[id])).rows[0];
  if(!row)throw new Error('FAILED_PERIOD_REQUIRED');
  await c.query("INSERT INTO scheduler_execution_log(period_id,schedule_id,outcome) VALUES($1,$2,'RESUMED')",[id,row.schedule_id]);
 });
}
export async function schedulerReport(pool:pg.Pool){
 return {schedules:(await pool.query('SELECT id,hook,cadence,timezone,local_time,start_date,next_date,config,enabled,last_planned_at,last_error FROM game_schedules ORDER BY id LIMIT 100')).rows,
 periods:(await pool.query(`SELECT p.id,p.effective_at,p.status,p.attempts,p.last_error,p.cursor,p.completed_at,
  (SELECT count(*) FROM rollover_subjects r WHERE r.period_id=p.id AND r.status='DONE') AS done,
  (SELECT count(*) FROM rollover_subjects r WHERE r.period_id=p.id AND r.status='DEFERRED') AS deferred
  FROM scheduled_periods p ORDER BY p.effective_at DESC LIMIT 100`)).rows,
 logs:(await pool.query('SELECT * FROM scheduler_execution_log ORDER BY id DESC LIMIT 100')).rows};
}
export async function dryRun(pool:pg.Pool,limit=14){
 if(!Number.isInteger(limit)||limit<1||limit>32)throw new Error('INVALID_PERIOD_BATCH');
 const rows=(await pool.query("SELECT *,to_char(next_date,'YYYY-MM-DD') AS day FROM game_schedules WHERE (enabled OR next_date=start_date) AND (cadence='DAILY' OR next_date=start_date) ORDER BY next_date,id LIMIT 16")).rows;
 const now=(await pool.query('SELECT clock_timestamp() AS now')).rows[0].now;const periods=[];
 for(const s of rows){let day=s.day;while(periods.length<limit){const instant=rolloverInstant(day,s.local_time,s.timezone);if(Date.parse(instant)>now.getTime())break;
  const eligible=(await pool.query('SELECT count(*) FROM accounts WHERE created_at<=$1',[instant])).rows[0].count;
  periods.push({id:s.id+':'+day,effectiveAt:instant,eligibleAccounts:eligible,hook:s.hook,enabled:s.enabled});if(s.cadence==='ONCE')break;day=nextDate(day);
 }}return {dryRun:true,periods,truncated:periods.length===limit||rows.length===16};
}
