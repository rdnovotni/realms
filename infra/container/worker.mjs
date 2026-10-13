import { readFileSync,writeFileSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';
import { poolFor,assertSchema } from '../dist/database.js';
import { workerStep } from '../dist/worker.js';
import { DisposableCache } from '../dist/cache.js';
const secret=key=>readFileSync(`/run/secrets/${key}`,'utf8').trim();
const name=process.env.DB_NAME;
if(!/^kol_(production|staging)$/.test(name??''))throw new Error('Explicit project database required');
const pool=poolFor(`postgresql://realms_worker:${secret('worker_password')}@db:5432/${name}`);
const cache=new DisposableCache(process.env.CACHE_NAMESPACE,secret('cache_password'));
let stopping=false;
const wake=new AbortController();
for(const sig of ['SIGTERM','SIGINT'])process.once(sig,()=>{stopping=true;wake.abort();});
const handlers={
  ACTION_COMMITTED:async(client,job)=>{
    const action=job.payload.actionId;
    const r=await client.query('SELECT 1 FROM action_receipts WHERE action_id=$1',[action]);
    if(!r.rowCount)throw new Error('MISSING_ACTION_RECEIPT');
    // Gameplay and its reward were committed by the original action transaction.
    return {acknowledged:true};
  },
  CACHE_INVALIDATE:async()=>({invalidated:true})
};
try{
  await assertSchema(pool);
  while(!stopping){
    try{
      const worked=await workerStep(pool,handlers,async job=>{
        if(job.kind==='CACHE_INVALIDATE'){
          if(typeof job.payload.key!=='string')throw new Error('INVALID_CACHE_KEY');
          // Deleting an already-lost cache entry is a safe repeat; outage delays completion.
          if(await cache.invalidate(job.payload.key)===null)throw new Error('CACHE_UNAVAILABLE');
        }
      });
      writeFileSync('/tmp/worker-heartbeat',String(Date.now()));
      if(!worked)await pause(1000,undefined,{signal:wake.signal}).catch(()=>{});
    }catch{
      if(!stopping)console.error(JSON.stringify({event:'worker_unavailable'}));
      await pause(2000,undefined,{signal:wake.signal}).catch(()=>{});
    }
  }
}finally{cache.close();await pool.end();console.log(JSON.stringify({event:'worker_stopped'}));}
