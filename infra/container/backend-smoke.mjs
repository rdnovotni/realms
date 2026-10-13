import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {poolFor,assertSchema,assertRuntimeRole} from '../dist/database.js';
import {DisposableCache} from '../dist/cache.js';
const name=process.env.DB_NAME,namespace=process.env.CACHE_NAMESPACE;
if(!/^kol_(production|staging)$/.test(name??''))throw new Error('Explicit project required');
const secret=k=>readFileSync(`/run/secrets/${k}`,'utf8').trim();
const pool=poolFor(`postgresql://realms_app:${secret('app_password')}@db:5432/${name}`);
const cache=new DisposableCache(namespace,secret('cache_password'));
const request=(path,options={})=>fetch(`http://api:3000${path}`,{...options,signal:AbortSignal.timeout(7000)});
const ok=(v,label)=>{assert.ok(v,label);console.log('PASS: '+label);};
try{
 ok((await request('/health/live')).status===200,'HTTP liveness');
 const ready=await request('/health/ready');ok(ready.status===200&&(await ready.json()).status==='ready','HTTP PostgreSQL/schema/role readiness');
 await assertSchema(pool);await assertRuntimeRole(pool);ok(true,'application database/schema and restricted runtime permissions');
 for(const path of ['/api/v1/state','/api/v1/client/state'])ok((await request(path)).status===401,'unauthenticated game read rejected');
 const action={requestId:randomUUID(),actionType:'SPEND_TURNS',amount:1,expectedRevision:0,accountId:randomUUID(),balance:999999};
 ok((await request('/api/v1/actions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(action)})).status===401,'unauthorized direct state mutation rejected');
 const invalid=await request('/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:'invalid',password:'not-a-login',deviceLabel:'smoke',balance:999999})});
 ok(invalid.status===400,'unexpected state fields rejected before login processing');
 // Database privileges are checked without performing any real game mutation.
 const flags=(await pool.query(`SELECT has_table_privilege(current_user,'schema_migrations','UPDATE') OR
  has_table_privilege(current_user,'turn_ledger','UPDATE') OR has_table_privilege(current_user,'job_execution_receipts','INSERT') OR
  has_column_privilege(current_user,'accounts','access_status','UPDATE') AS forbidden`)).rows[0];
 ok(!flags.forbidden,'runtime cannot rewrite protected ledgers, migrations, worker receipts or account access');
 const key=`smoke:${randomUUID()}`;ok(await cache.set(key,'ephemeral',30)==='OK'&&await cache.get(key)==='ephemeral','application can reach authenticated project cache');
 await cache.invalidate(key);
 const wrong=poolFor(`postgresql://realms_app:deliberately-invalid@db:5432/${name}`);
 try{await assert.rejects(wrong.query('SELECT 1'),e=>e.code==='28P01');ok(true,'unauthorized database credential rejected');}finally{await wrong.end();}
}finally{cache.close();await pool.end();}
