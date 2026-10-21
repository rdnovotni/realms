import { seedLegacyConsumption } from './helpers.js';
import { assertLifetimeFields } from '../src/domains/lifetime-fields.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash,randomBytes } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { testDatabase,actor } from './helpers.js';
import { fixture,win } from './ascension-fixture.js';
import { envelope } from './tactical-fixture.js';
import { registerContract,writeState } from '../src/domains/state.js';
import { ascend,applyRollover } from '../src/domains/lifecycle.js';
import { ascensionPreview } from '../src/domains/ascension-contract.js';
import { startBuild } from '../src/domains/builds.js';
import { transaction } from '../src/foundation/transaction.js';
import { integrityReport } from '../src/foundation/integrity.js';
import { buildApp } from '../src/app.js';
import { contentView } from '../src/domains/content.js';
import { migrate } from '../src/database.js';
const json=(v:unknown)=>v as any;
const integer={type:'integer',minimum:0};

test('campaign → preview → Ascend → rebuild → replay preserves knowledge and daily fields while resetting declared run fields',async()=>{
 const db=await testDatabase();try{
  await assertLifetimeFields(db.pool);
  const f=await fixture(db.pool),scope=(await db.pool.query('SELECT id FROM state_scopes WHERE run_id=$1',[f.run])).rows[0].id;
  await transaction(db.pool,async client=>{
   for(const [key,resetPolicy,ascensionPolicy] of [['daily.used.v1','RESET_AT_ROLLOVER','CARRY'],['quest.route.v1','KEEP','RESET'],['quest.history.v1','KEEP','ARCHIVE']] as const){
    await registerContract(client,{key,ownerModule:'fixtures',scopeKind:'RUN',resetPolicy,ascensionPolicy,schema:integer,defaultValue:0});await writeState(client,'fixtures',scope,key,3,null);
   }
  });
  await seedLegacyConsumption(db.pool,f.run,{fullness:6,drunkenness:4,tolerance:2});
  const first=await win(db.pool,f.account,f.revision),final=await win(db.pool,f.account,first.result.revision,'encounter.finale');
  assert.equal((await contentView(db.pool,f.account,f.release,'campaign.tactical')).name,'Campaign');
  assert.equal((await db.pool.query("SELECT first_run_id FROM discoveries WHERE account_id=$1 AND entity_id='campaign.tactical'",[f.account])).rows[0].first_run_id,f.run);
  const preview=await ascensionPreview(db.pool,f.account);assert.equal(preview.ready,true);assert.equal(preview.retained.carriedFields,1);
  const request=envelope(final.result.revision,'ASCEND');
  const attempts=await Promise.all([ascend(db.pool,f.account,request,preview.previewToken),ascend(db.pool,f.account,request,preview.previewToken)]);
  assert.equal(attempts.filter(a=>!a.replayed).length,1);const next=json(attempts[0]);
  assert.equal(next.turns,preview.retained.turns);assert.deepEqual((await db.pool.query('SELECT fullness,drunkenness,tolerance FROM run_consumption WHERE run_id=$1',[next.runId])).rows[0],{fullness:6,drunkenness:4,tolerance:2});
  const fields=(await db.pool.query('SELECT key,value FROM scoped_state s JOIN state_scopes owner ON owner.id=s.scope_id WHERE owner.run_id=$1 ORDER BY key',[next.runId])).rows;
  assert.deepEqual(fields,[{key:'daily.used.v1',value:3},{key:'quest.route.v1',value:0}]);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM scoped_state WHERE scope_id=$1',[scope])).rows[0].n,3);
  await assert.rejects(db.pool.query("UPDATE scoped_state SET value='0'::jsonb WHERE scope_id=$1",[scope]),/archived/);
  await assert.rejects(db.pool.query('DELETE FROM scoped_state WHERE scope_id=$1',[scope]),/archived/);
  assert.equal((await db.pool.query('SELECT level,xp::text FROM run_progression WHERE run_id=$1',[next.runId])).rows[0].xp,'0');
  assert.equal((await db.pool.query('SELECT state->>\'mode\' AS mode FROM run_builds WHERE run_id=$1',[next.runId])).rows[0].mode,'UNCONFIGURED');
  await startBuild(db.pool,f.account,envelope(0,'START_BUILD'),'class.one','balanced');
  await assert.rejects(win(db.pool,f.account,1,'encounter.finale'),/PREREQUISITES_MISSING/);
  assert.equal((await win(db.pool,f.account,1)).result.outcome,'VICTORY');
  assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM discoveries WHERE account_id=$1 AND entity_id='campaign.tactical'",[f.account])).rows[0].n,1);
  await db.pool.query("UPDATE accounts SET created_at=now()-interval '2 days' WHERE id=$1",[f.account]);
  await db.pool.query("INSERT INTO rollover_epochs VALUES(1,now()-interval '1 day',2,30)");
  assert.deepEqual(await applyRollover(db.pool,f.account),{applied:1,deferred:false});assert.deepEqual(await applyRollover(db.pool,f.account),{applied:0,deferred:false});
  assert.equal((await db.pool.query("SELECT value FROM scoped_state s JOIN state_scopes o ON o.id=s.scope_id WHERE o.run_id=$1 AND key='daily.used.v1'",[next.runId])).rows[0].value,0);
  assert.equal((await db.pool.query("SELECT summary->>'contractVersion' AS version FROM run_history WHERE run_id=$1",[f.run])).rows[0].version,'1');
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{await db.close();}
});

test('shared and identity fields persist independently; active instances block transition and terminal fields freeze',async()=>{
 const db=await testDatabase();try{
  const f=await actor(db.pool),world=randomUUID(),guild=randomUUID(),event=randomUUID(),instance=randomUUID();
  await db.pool.query("INSERT INTO worlds(id,name) VALUES($1,'lifetime-world')",[world]);await db.pool.query("INSERT INTO guilds(id,name) VALUES($1,'lifetime-guild')",[guild]);
  await db.pool.query("INSERT INTO world_events(id,world_id,content_release_id,lifecycle) VALUES($1,$2,(SELECT content_release_id FROM runs WHERE id=$3),'ACTIVE')",[event,world,f.run]);
  await db.pool.query("INSERT INTO instances(id,kind,content_release_id,seed) SELECT $1,'HOME',content_release_id,$3 FROM runs WHERE id=$2",[instance,f.run,randomBytes(32)]);await db.pool.query('INSERT INTO instance_participants(instance_id,run_id) VALUES($1,$2)',[instance,f.run]);
  const scopes=(await db.pool.query('SELECT * FROM state_scopes')).rows;
  await transaction(db.pool,async client=>{for(const scope of scopes.filter(s=>s.kind!=='RUN')){const key=`scope.${scope.kind.toLowerCase()}.v1`;await registerContract(client,{key,ownerModule:'fixtures',scopeKind:scope.kind,resetPolicy:'KEEP',schema:integer,defaultValue:0});await writeState(client,'fixtures',scope.id,key,7,null);}});
  await db.pool.query("UPDATE runs SET status='AFTERCORE' WHERE id=$1",[f.run]);await assert.rejects(ascend(db.pool,f.account,envelope(0,'ASCEND')),/INSTANCE_STILL_ACTIVE/);
  await db.pool.query("UPDATE instances SET lifecycle='RESOLVED' WHERE id=$1",[instance]);await ascend(db.pool,f.account,envelope(0,'ASCEND'));
  for(const scope of scopes.filter(s=>!['RUN','INSTANCE'].includes(s.kind))){assert.equal((await db.pool.query('SELECT value FROM scoped_state WHERE scope_id=$1',[scope.id])).rows[0].value,7);assert.equal((await db.pool.query('SELECT lifecycle FROM state_scopes WHERE id=$1',[scope.id])).rows[0].lifecycle,'ACTIVE');}
  const instanceScope=scopes.find(s=>s.kind==='INSTANCE')!;assert.equal((await db.pool.query('SELECT lifecycle FROM state_scopes WHERE id=$1',[instanceScope.id])).rows[0].lifecycle,'ARCHIVED');await assert.rejects(db.pool.query("UPDATE scoped_state SET value='0'::jsonb WHERE scope_id=$1",[instanceScope.id]),/archived/);
 }finally{await db.close();}
});

test('HTTP confirmation is explicit and current, and the same transition receipt replays after app recreation',async()=>{
 const db=await testDatabase();let app;try{
  const f=await fixture(db.pool),first=await win(db.pool,f.account,f.revision),final=await win(db.pool,f.account,first.result.revision,'encounter.finale');
  const token='ascension-test-token'.repeat(3),headers={authorization:`Bearer ${token}`};app=buildApp(db.pool,{mode:'development',token,accountId:f.account});
  const preview=(await app.inject({url:'/api/v1/ascend/preview',headers})).json();assert.equal(preview.ready,true);assert.ok(!('seed' in preview));assert.ok(!('contracts' in preview));
  assert.equal((await app.inject({url:'/api/v1/ascend/preview'})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/ascend',headers,payload:envelope(final.result.revision,'ASCEND')})).statusCode,400);
  await assert.rejects(ascend(db.pool,f.account,{...envelope(final.result.revision,'ASCEND'),authorizationSource:'AUTOMATION'},preview.previewToken),/EXPLICIT_ASCENSION_REQUIRED/);
  await seedLegacyConsumption(db.pool,f.run,{fullness:8});const payload={...envelope(final.result.revision,'ASCEND'),previewToken:preview.previewToken};
  const changed=await app.inject({method:'POST',url:'/api/v1/ascend',headers,payload});assert.equal(changed.statusCode,409);assert.equal(changed.json().error,'ASCENSION_PREVIEW_CHANGED');assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_history')).rows[0].n,0);
  payload.previewToken=(await app.inject({url:'/api/v1/ascend/preview',headers})).json().previewToken;
  const response=await app.inject({method:'POST',url:'/api/v1/ascend',headers,payload});assert.equal(response.statusCode,200);
  await app.close();app=buildApp(db.pool,{mode:'development',token,accountId:f.account});const repeat=await app.inject({method:'POST',url:'/api/v1/ascend',headers,payload});assert.equal(repeat.statusCode,200);assert.equal(repeat.json().replayed,true);assert.equal(repeat.json().runId,response.json().runId);assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_history')).rows[0].n,1);
 }finally{if(app)await app.close();await db.close();}
});

test('versioned policies reject daily refills, identity changes and edits to an existing contract',async()=>{
 const db=await testDatabase();try{
  const f=await actor(db.pool),scope=(await db.pool.query('SELECT id FROM state_scopes WHERE run_id=$1',[f.run])).rows[0].id;
  await transaction(db.pool,async client=>{const c={key:'daily.policy.v1',ownerModule:'fixtures',scopeKind:'RUN' as const,resetPolicy:'RESET_AT_ROLLOVER' as const,schema:integer,defaultValue:0};await assert.rejects(registerContract(client,{...c,ascensionPolicy:'RESET'}),/Invalid Ascension/);await registerContract(client,c);await assert.rejects(registerContract(client,{...c,ascensionPolicy:'ARCHIVE'}),/Invalid Ascension/);await writeState(client,'fixtures',scope,c.key,2,null);});
  await assert.rejects(db.pool.query("UPDATE state_contracts SET ascension_policy='RESET'"),/Immutable/);
  const other=await actor(db.pool),otherScope=(await db.pool.query('SELECT id FROM state_scopes WHERE run_id=$1',[other.run])).rows[0].id;await assert.rejects(db.pool.query('UPDATE scoped_state SET scope_id=$1',[otherScope]),/identity is immutable/);
 }finally{await db.close();}
});

test('upgrade preserves existing values and derives explicit policies without rewriting past receipts',async()=>{
 const db=await testDatabase(false);try{
  await db.pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');const folder=new URL('../migrations/',import.meta.url);
  for(const name of (await readdir(folder)).filter(n=>n.endsWith('.sql')&&n<'030_').sort()){const sql=await readFile(new URL(name,folder),'utf8');await db.pool.query(sql);await db.pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);}
  const f=await actor(db.pool),scope=(await db.pool.query('SELECT id FROM state_scopes WHERE run_id=$1',[f.run])).rows[0].id;
  await db.pool.query("INSERT INTO state_contracts(key,owner_module,scope_kind,reset_policy,value_schema,default_value) VALUES('old.daily.v1','fixtures','RUN','RESET_AT_ROLLOVER',$1,'0'),('old.run.v1','fixtures','RUN','KEEP',$1,'0'),('old.account.v1','fixtures','ACCOUNT','KEEP',$1,'0')",[integer]);await db.pool.query("INSERT INTO scoped_state(scope_id,scope_kind,key,value) VALUES($1,'RUN','old.daily.v1','5')",[scope]);
  const before=(await db.pool.query('SELECT * FROM scoped_state')).rows;await migrate(db.pool);await migrate(db.pool);assert.deepEqual((await db.pool.query('SELECT * FROM scoped_state')).rows,before);
  assert.deepEqual((await db.pool.query("SELECT key,ascension_policy FROM state_contracts WHERE key LIKE 'old.%' ORDER BY key")).rows,[{key:'old.account.v1',ascension_policy:'KEEP'},{key:'old.daily.v1',ascension_policy:'CARRY'},{key:'old.run.v1',ascension_policy:'ARCHIVE'}]);
 }finally{await db.close();}
});

test('field coverage rejects a newly added run-owned column until its lifetime is declared',async()=>{const db=await testDatabase();try{await assertLifetimeFields(db.pool);await db.pool.query('ALTER TABLE run_consumption ADD COLUMN new_daily_budget integer');await assert.rejects(assertLifetimeFields(db.pool),/field coverage changed/);}finally{await db.close();}});

test('committed tokenless Ascension receipts remain replayable over HTTP, but new tokenless transitions fail',async()=>{
 const db=await testDatabase();let app;try{
  const f=await actor(db.pool);await db.pool.query("UPDATE runs SET status='AFTERCORE' WHERE id=$1",[f.run]);
  const oldRequest=envelope(0,'ASCEND'),next=await ascend(db.pool,f.account,oldRequest);
  const token='legacy-ascension-fixture-token'.repeat(2),headers={authorization:`Bearer ${token}`};app=buildApp(db.pool,{mode:'development',token,accountId:f.account});
  const replay=await app.inject({method:'POST',url:'/api/v1/ascend',headers,payload:oldRequest});assert.equal(replay.statusCode,200);assert.equal(replay.json().replayed,true);assert.equal(replay.json().runId,next.runId);
  const fresh=await app.inject({method:'POST',url:'/api/v1/ascend',headers,payload:envelope(0,'ASCEND')});assert.equal(fresh.statusCode,400);assert.equal(fresh.json().error,'ASCENSION_PREVIEW_REQUIRED');
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_history')).rows[0].n,1);
 }finally{if(app)await app.close();await db.close();}
});

test('invalid historical carry values roll back the entire transition and custody moves',async()=>{
 const db=await testDatabase();try{
  const f=await fixture(db.pool),first=await win(db.pool,f.account,f.revision),final=await win(db.pool,f.account,first.result.revision,'encounter.finale');
  const scope=(await db.pool.query('SELECT id FROM state_scopes WHERE run_id=$1',[f.run])).rows[0].id;
  await transaction(db.pool,async client=>{await registerContract(client,{key:'daily.corrupt.v1',ownerModule:'fixtures',scopeKind:'RUN',resetPolicy:'RESET_AT_ROLLOVER',schema:integer,defaultValue:0});await writeState(client,'fixtures',scope,'daily.corrupt.v1',2,null);});
  // Simulate legacy corruption outside the validated service; do not propagate it.
  await db.pool.query("UPDATE scoped_state SET value='-1'::jsonb WHERE scope_id=$1",[scope]);
  const items=(await db.pool.query('SELECT id,container_id FROM inventory_items ORDER BY id')).rows;
  const request=envelope(final.result.revision,'ASCEND');await assert.rejects(ascend(db.pool,f.account,request),/INVALID_STATE_VALUE/);
  assert.deepEqual((await db.pool.query('SELECT id,container_id FROM inventory_items ORDER BY id')).rows,items);
  assert.equal((await db.pool.query('SELECT status FROM runs WHERE id=$1',[f.run])).rows[0].status,'AFTERCORE');
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_history')).rows[0].n,0);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM action_receipts WHERE request_id=$1',[request.requestId])).rows[0].n,0);
 }finally{await db.close();}
});

test('all generic terminal instance kinds reject reopening and independent scope archival cannot strand an active owner',async()=>{
 const db=await testDatabase();try{
  const f=await actor(db.pool);
  for(const terminal of ['RESOLVED','EXPIRED','MIGRATED']){
   const id=randomUUID();await db.pool.query("INSERT INTO instances(id,kind,content_release_id,seed) SELECT $1,'HOME',content_release_id,$3 FROM runs WHERE id=$2",[id,f.run,randomBytes(32)]);
   await assert.rejects(db.pool.query("UPDATE state_scopes SET lifecycle='ARCHIVED' WHERE instance_id=$1",[id]),/lifetimes must agree/);
   assert.equal((await db.pool.query('SELECT lifecycle FROM state_scopes WHERE instance_id=$1',[id])).rows[0].lifecycle,'ACTIVE');
   await db.pool.query('UPDATE instances SET lifecycle=$1 WHERE id=$2',[terminal,id]);
   assert.equal((await db.pool.query('SELECT lifecycle FROM state_scopes WHERE instance_id=$1',[id])).rows[0].lifecycle,'ARCHIVED');
   await assert.rejects(db.pool.query("UPDATE instances SET lifecycle='ACTIVE' WHERE id=$1",[id]),/cannot be reopened/);
   assert.equal((await db.pool.query('SELECT lifecycle FROM instances WHERE id=$1',[id])).rows[0].lifecycle,terminal);
  }
 }finally{await db.close();}
});
