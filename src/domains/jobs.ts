import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Json } from '../foundation/json.js';
import { transaction } from '../foundation/transaction.js';
export async function dispatchOutbox(pool:pg.Pool){
  return transaction(pool,async client=>{
    const batch=await client.query('SELECT * FROM outbox_events WHERE delivered_at IS NULL ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 100');
    for(const event of batch.rows){
      await client.query('INSERT INTO durable_jobs(job_key,kind,payload) VALUES($1,$2,$3) ON CONFLICT(job_key) DO NOTHING',[`outbox:${event.id}`,event.event_type,event.payload]);
      await client.query('UPDATE outbox_events SET delivered_at=now() WHERE id=$1',[event.id]);
    }
    return batch.rows.length;
  });
}
export async function enqueue(pool: pg.Pool, key: string, kind: string, payload: Json) {
  const result = await pool.query(`INSERT INTO durable_jobs(job_key,kind,payload) VALUES($1,$2,$3)
    ON CONFLICT(job_key) DO UPDATE SET job_key=EXCLUDED.job_key
    WHERE durable_jobs.kind=EXCLUDED.kind AND durable_jobs.payload=EXCLUDED.payload RETURNING id`, [key,kind,payload]);
  if (!result.rows.length) throw new Error('Job key reused with different work');
  return result.rows[0].id as string;
}
export async function claimJob(pool: pg.Pool, leaseSeconds = 30) {
  if (!Number.isInteger(leaseSeconds) || leaseSeconds<1 || leaseSeconds>3600) throw new Error('Invalid job lease');
  const result = await pool.query(`WITH candidate AS (
    SELECT id FROM durable_jobs WHERE attempts<max_attempts AND ((status='PENDING' AND available_at<=now()) OR (status='RUNNING' AND lease_until<=now()))
    ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE durable_jobs j SET status='RUNNING',attempts=attempts+1,lease_token=$1,lease_until=now()+$2*interval '1 second'
    FROM candidate c WHERE j.id=c.id RETURNING j.*`, [randomUUID(),leaseSeconds]);
  return result.rows[0] ?? null;
}
export async function finishJob(pool: pg.Pool, id: string, leaseToken: string, success: boolean) {
  const result = await pool.query(`UPDATE durable_jobs SET status=CASE WHEN $3 THEN 'SUCCEEDED' WHEN attempts>=max_attempts THEN 'FAILED' ELSE 'PENDING' END,
    available_at=now()+interval '5 seconds',lease_token=NULL,lease_until=NULL
    WHERE id=$1 AND lease_token=$2 AND status='RUNNING' AND lease_until>now() RETURNING id`, [id,leaseToken,success]);
  return result.rows.length===1;
}
export async function reapExhaustedJobs(pool: pg.Pool) {
  return pool.query(`UPDATE durable_jobs SET status='FAILED',lease_token=NULL,lease_until=NULL
    WHERE status='RUNNING' AND lease_until<=now() AND attempts>=max_attempts`);
}
