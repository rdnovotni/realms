import {readFileSync,writeFileSync} from 'node:fs';
import {setTimeout as pause} from 'node:timers/promises';
import {poolFor,assertSchema} from '../dist/database.js';
import {planSchedules,schedulerStep} from '../dist/scheduler.js';
const name=process.env.DB_NAME;if(!/^kol_(production|staging)$/.test(name??''))throw new Error('Explicit project required');
const batch=Number(process.env.SCHEDULER_BATCH??50);if(!Number.isInteger(batch)||batch<1||batch>200)throw new Error('Invalid batch size');
const password=readFileSync('/run/secrets/scheduler_password','utf8').trim();
const pool=poolFor(`postgresql://realms_scheduler:${password}@db:5432/${name}`);
let stopping=false;const wake=new AbortController();
for(const sig of ['SIGTERM','SIGINT'])process.once(sig,()=>{stopping=true;wake.abort();});
try{
 await assertSchema(pool);
 while(!stopping){
  try{
   await planSchedules(pool);if(!stopping)await schedulerStep(pool,batch);
   writeFileSync('/tmp/scheduler-heartbeat',String(Date.now()));
  }catch{console.error(JSON.stringify({event:'scheduler_unavailable'}));}
  await pause(1000,undefined,{signal:wake.signal}).catch(()=>{});
 }
}finally{await pool.end();console.log(JSON.stringify({event:'scheduler_stopped'}));}
