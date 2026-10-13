import type pg from 'pg';
import { checksum, type Json } from './foundation/json.js';
import { transaction } from './foundation/transaction.js';
import { claimJob,dispatchOutbox } from './domains/jobs.js';
export type ClaimedJob={id:string;kind:string;payload:Json;lease_token:string;attempts:number};
export type SqlHandler=(client:pg.PoolClient,job:ClaimedJob)=>Promise<Record<string,Json>>;
export class LeaseLost extends Error {}
// Effects, receipt, execution log and completion share ONE PostgreSQL transaction.
// Handlers must only perform SQL through the supplied client. No network effects here.
export async function commitJob(pool:pg.Pool,job:ClaimedJob,handler:SqlHandler){
  return transaction(pool,async client=>{
    await client.query("SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='5s'");
    const locked=await client.query(`SELECT *,lease_until>clock_timestamp() AS live FROM durable_jobs WHERE id=$1 FOR UPDATE`,[job.id]);
    const row=locked.rows[0];
    if(!row || row.status!=='RUNNING'||row.lease_token!==job.lease_token||!row.live)throw new LeaseLost();
    // Never trust a caller's envelope in place of the locked durable record.
    if(row.kind!==job.kind || checksum(row.payload)!==checksum(job.payload))throw new Error('JOB_ENVELOPE_CHANGED');
    if((await client.query('SELECT 1 FROM job_execution_receipts WHERE job_id=$1',[job.id])).rowCount)throw new Error('JOB_RECEIPT_CONFLICT');
    const result=await handler(client,{...job,payload:row.payload});
    await client.query('INSERT INTO job_execution_receipts(job_id,payload_checksum,outcome) VALUES($1,$2,$3)',[job.id,checksum(row.payload),result]);
    const done=await client.query(`UPDATE durable_jobs SET status='SUCCEEDED',lease_token=NULL,lease_until=NULL
      WHERE id=$1 AND lease_token=$2 AND status='RUNNING' AND lease_until>clock_timestamp() RETURNING id`,[job.id,job.lease_token]);
    if(!done.rowCount)throw new LeaseLost(); // Roll back effects even if the lease expired during the callback.
    await client.query("INSERT INTO job_execution_log(job_id,lease_token,outcome) VALUES($1,$2,'SUCCEEDED')",[job.id,job.lease_token]);
    return result;
  });
}
export function retryDelay(attempt:number){return Math.min(300,5*2**Math.min(6,Math.max(0,attempt-1)));}
export async function failJob(pool:pg.Pool,job:ClaimedJob,code='HANDLER_FAILED'){
  if(!/^[A-Z0-9_]{1,64}$/.test(code))code='HANDLER_FAILED';
  return transaction(pool,async client=>{
    const result=await client.query(`UPDATE durable_jobs SET status=CASE WHEN attempts>=max_attempts THEN 'FAILED' ELSE 'PENDING' END,
      available_at=clock_timestamp()+$3*interval '1 second',lease_token=NULL,lease_until=NULL
      WHERE id=$1 AND lease_token=$2 AND status='RUNNING' AND lease_until>clock_timestamp() RETURNING status`,[job.id,job.lease_token,retryDelay(job.attempts)]);
    await client.query('INSERT INTO job_execution_log(job_id,lease_token,outcome,error_code) VALUES($1,$2,$3,$4)',[job.id,job.lease_token,result.rowCount?(result.rows[0].status==='FAILED'?'FAILED':'RETRY'):'LEASE_LOST',code]);
    return !!result.rowCount;
  });
}
export async function workerStep(pool:pg.Pool,handlers:Record<string,SqlHandler>,before?: (job:ClaimedJob)=>Promise<void>){
  await dispatchOutbox(pool);
  await pool.query(`WITH expired AS (
    SELECT id,lease_token FROM durable_jobs WHERE status='RUNNING' AND lease_until<=clock_timestamp()
      AND attempts>=max_attempts FOR UPDATE SKIP LOCKED), done AS (
    UPDATE durable_jobs j SET status='FAILED',lease_token=NULL,lease_until=NULL FROM expired e WHERE j.id=e.id RETURNING j.id,e.lease_token)
    INSERT INTO job_execution_log(job_id,lease_token,outcome,error_code) SELECT id,lease_token,'FAILED','LEASE_EXHAUSTED' FROM done`);
  const job=await claimJob(pool,30) as ClaimedJob|null;
  if(!job)return false;
  try {
    const handler=handlers[job.kind];
    if(!handler){await failJob(pool,job,'UNKNOWN_JOB_KIND');return true;}
    if(before)await before(job); // Only replay-safe, non-authoritative cache effects allowed by runtime.
    await commitJob(pool,job,handler);
  } catch(error){await failJob(pool,job,error instanceof LeaseLost?'LEASE_LOST':'HANDLER_FAILED');}
  return true;
}
