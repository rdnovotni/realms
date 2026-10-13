import test from 'node:test';
import assert from 'node:assert/strict';
import {buildApp,type RuntimeLifecycle} from '../src/app.js';
import {transaction} from '../src/foundation/transaction.js';
import {assertSchema,poolFor} from '../src/database.js';
import {testDatabase} from './helpers.js';

test('HTTP running/readiness differ during DB failure, recovery, invalid role and drain',async()=>{
 const db=await testDatabase();let available=true;
 const runtime:RuntimeLifecycle={draining:false,ready:false,check:async()=>{if(!available)throw new Error('unavailable');await assertSchema(db.pool);}};
 const app=buildApp(db.pool,{mode:'sessions',throttleKey:'a'.repeat(64)},false,undefined,runtime);
 try{
  assert.equal((await app.inject('/health/live')).statusCode,200);
  assert.equal((await app.inject('/health/ready')).statusCode,200);
  available=false;
  assert.equal((await app.inject('/health/ready')).statusCode,503);
  assert.equal((await app.inject('/health/live')).statusCode,200);
  assert.equal((await app.inject('/api/v1/state')).statusCode,503);
  available=true;
  assert.equal((await app.inject('/health/ready')).statusCode,200);
  assert.equal((await app.inject('/api/v1/state')).statusCode,401);
  runtime.check=async()=>{throw new Error('invalid runtime role');};
  assert.equal((await app.inject('/health/ready')).statusCode,503);
  assert.equal((await app.inject('/api/v1/state')).statusCode,503);
  runtime.draining=true;
  assert.equal((await app.inject('/health/ready')).json().status,'draining');
  assert.equal((await app.inject('/api/v1/actions')).statusCode,503);
 }finally{await app.close();await db.close();}
});
test('an idle database connection loss is contained and the pool reconnects',async()=>{
 const db=await testDatabase();const url=process.env.TEST_DATABASE_URL!;const app=poolFor(url,db.schema);
 try{
  const pid=(await app.query('SELECT pg_backend_pid() AS id')).rows[0].id;
  const disconnected=new Promise<void>(resolve=>app.once('error',()=>resolve()));
  await db.pool.query('SELECT pg_terminate_backend($1)',[pid]);await disconnected;
  assert.equal((await app.query('SELECT 1 AS value')).rows[0].value,1);
 }finally{await app.end();await db.close();}
});

test('graceful HTTP close lets an in-flight database transaction commit',async()=>{
 const db=await testDatabase();const app=buildApp(db.pool,{mode:'sessions',throttleKey:'a'.repeat(64)});
 let enter!:()=>void,release!:()=>void;
 const started=new Promise<void>(r=>{enter=r;}),proceed=new Promise<void>(r=>{release=r;});
 try{
  await db.pool.query('CREATE TABLE shutdown_probe(value integer); INSERT INTO shutdown_probe VALUES(0)');
  app.get('/test/slow',async()=>transaction(db.pool,async c=>{
   await c.query('UPDATE shutdown_probe SET value=1');enter();await proceed;return {committed:true};
  }));
  const address=await app.listen({host:'127.0.0.1',port:0});
  const response=fetch(address+'/test/slow',{signal:AbortSignal.timeout(5000)});await started;
  let closed=false;const closing=app.close().then(()=>{closed=true;});
  await new Promise(r=>setTimeout(r,30));assert.equal(closed,false);
  release();assert.equal((await response).status,200);await closing;
  assert.equal((await db.pool.query('SELECT value FROM shutdown_probe')).rows[0].value,1);
 }finally{release?.();await app.close();await db.close();}
});
