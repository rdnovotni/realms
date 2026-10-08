import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import type pg from 'pg';
import { migrate } from '../src/database.js';
import { actor,testDatabase } from './helpers.js';
import { publishContent,validateContent,type ContentPackage } from '../src/domains/content.js';
import { startBuild,levelUp,buildOptions } from '../src/domains/builds.js';
import { executeAction,advanceRevision } from '../src/foundation/action.js';
import { beginEncounter,finishEncounter } from '../src/domains/encounters.js';
import { progressionView } from '../src/domains/progression.js';
import { integrityReport,unindexedForeignKeys } from '../src/foundation/integrity.js';
import { ascend } from '../src/domains/lifecycle.js';
import { buildApp } from '../src/app.js';
import { enrollPassword,requireLogin } from '../src/auth/sessions.js';

import { buildPackage } from './build-fixture.js';
const env=(revision:number,actionType:string)=>({requestId:randomUUID(),expectedRevision:revision,actionType});
async function fixture(pool:Awaited<ReturnType<typeof testDatabase>>['pool'],mode='STANDARD') {
  const release=await publishContent(pool,buildPackage),f=await actor(pool,release,10,mode);
  for(const key of ['one','two','three']) await pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,$2,'DISCOVERED')",[f.account,`class.${key}`]);
  return f;
}
async function earn(pool:Awaited<ReturnType<typeof testDatabase>>['pool'],account:string,revision:number) {
  const start=await executeAction(pool,account,env(revision,'BUILD_FIXTURE'),{},async c=>({...await beginEncounter(c,'encounter.build',{}),revision:await advanceRevision(c)}));
  await executeAction(pool,account,env(revision+1,'BUILD_FIXTURE'),{},async c=>({...await finishEncounter(c,start.instanceId as string,0,'VICTORY',async()=>({})),revision:await advanceRevision(c)}));
}

test('starting preset is authored, journaled, replayable and pins readiness before combat',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool),request=env(0,'START_BUILD');
    assert.equal((await buildOptions(db.pool,f.account)).classes.length,3);
    const results=await Promise.all(Array.from({length:4},()=>startBuild(db.pool,f.account,request,'class.one','balanced')));
    assert.equal(results.filter(r=>!r.replayed).length,1);
    const view=await progressionView(db.pool,f.account);
    assert.equal(view.level,1);assert.equal(view.readiness?.pendingLevels,0);
    assert.deepEqual((await db.pool.query('SELECT strength,luck FROM run_progression WHERE run_id=$1',[f.run])).rows[0],{strength:12,luck:10});
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_build_events')).rows[0].n,1);
    assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
    assert.deepEqual(await unindexedForeignKeys(db.pool),[]);
  }finally{await db.close();}
});

test('earned levels require explicit choices and enforce native and multiclass limits',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await startBuild(db.pool,f.account,env(0,'START_BUILD'),'class.one','balanced');
    await assert.rejects(levelUp(db.pool,f.account,env(1,'LEVEL_UP'),'class.one'),/LEVEL_NOT_READY/);
    await earn(db.pool,f.account,1);assert.equal((await progressionView(db.pool,f.account)).level,1);
    await levelUp(db.pool,f.account,env(3,'LEVEL_UP'),'class.one');
    await assert.rejects(levelUp(db.pool,f.account,env(4,'LEVEL_UP'),'class.one'),/NATIVE_CLASS_LEVEL_LIMIT/);
    await levelUp(db.pool,f.account,env(4,'LEVEL_UP'),'class.two');
    await assert.rejects(levelUp(db.pool,f.account,env(5,'LEVEL_UP'),'class.three'),/CLASS_LIMIT/);
    assert.deepEqual((await db.pool.query('SELECT class_id,native_level FROM run_class_levels ORDER BY class_id')).rows,[{class_id:'class.one',native_level:2},{class_id:'class.two',native_level:1}]);
    assert.equal((await progressionView(db.pool,f.account)).level,3);
    assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
  }finally{await db.close();}
});

test('raw projections and journal edits fail without changing the build',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await startBuild(db.pool,f.account,env(0,'START_BUILD'),'class.one','balanced');
    for(const sql of ['UPDATE run_progression SET level=2','UPDATE run_progression SET luck=20','UPDATE run_class_levels SET native_level=2','DELETE FROM run_class_levels']) await assert.rejects(db.pool.query(sql),/inconsistent/);
    await assert.rejects(db.pool.query('UPDATE run_build_events SET xp_at_choice=1'),/Immutable record/);
    await assert.rejects(db.pool.query('DELETE FROM run_builds'),/cannot be deleted/);
    assert.equal((await progressionView(db.pool,f.account)).level,1);
  }finally{await db.close();}
});

test('discovery, explicit source, supported mode and fresh setup are required',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await db.pool.query('DELETE FROM discoveries WHERE account_id=$1',[f.account]);
    await assert.rejects(startBuild(db.pool,f.account,env(0,'START_BUILD'),'class.one','balanced'),/CLASS_NOT_DISCOVERED/);
    assert.throws(()=>startBuild(db.pool,f.account,{...env(0,'START_BUILD'),authorizationSource:'AUTOMATION'},'class.one','balanced'),/EXPLICIT_BUILD_CHOICE_REQUIRED/);
    const g=await fixture(db.pool,'HARDCORE');await assert.rejects(startBuild(db.pool,g.account,env(0,'START_BUILD'),'class.one','balanced'),/UNSUPPORTED_BUILD_MODE/);
    const h=await fixture(db.pool);await earn(db.pool,h.account,0);
    await assert.rejects(startBuild(db.pool,h.account,env(2,'START_BUILD'),'class.one','balanced'),/BUILD_SETUP_NOT_AVAILABLE/);
  }finally{await db.close();}
});

test('choices cannot occur in an active encounter and failed choices leave no receipt',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await startBuild(db.pool,f.account,env(0,'START_BUILD'),'class.one','balanced');
    await executeAction(db.pool,f.account,env(1,'BUILD_FIXTURE'),{},async c=>({...await beginEncounter(c,'encounter.build',{}),revision:await advanceRevision(c)}));
    const request=env(2,'LEVEL_UP');await assert.rejects(levelUp(db.pool,f.account,request,'class.two'),/INSTANCE_STILL_ACTIVE/);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM action_receipts WHERE request_id=$1',[request.requestId])).rows[0].n,0);
  }finally{await db.close();}
});

test('authoring rejects variable Luck, duplicate presets and missing class rules',()=>{
  validateContent(buildPackage);
  const bad=structuredClone(buildPackage);const rules=bad.entities[1]!.definition.mechanics!.buildRules as {presets:{key:string;attributes:{luck:number}}[]};
  rules.presets.push({key:'other',attributes:{...rules.presets[0]!.attributes,luck:11}});assert.throws(()=>validateContent(bad));
  rules.presets[1]!.attributes.luck=10;rules.presets[1]!.key='balanced';assert.throws(()=>validateContent(bad));
  const missing=structuredClone(buildPackage);missing.entities[2]!.definition.dependencies=[];assert.throws(()=>validateContent(missing));
});

test('late failure rolls back the complete build choice and retry succeeds',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool),request=env(0,'START_BUILD');
    await db.pool.query("CREATE FUNCTION fail_build() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Late build failure'; END $$; CREATE TRIGGER fail_build BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_build()");
    await assert.rejects(startBuild(db.pool,f.account,request,'class.one','balanced'),/Late build failure/);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_build_events')).rows[0].n,0);
    assert.equal((await db.pool.query('SELECT luck FROM run_progression WHERE run_id=$1',[f.run])).rows[0].luck,null);
    await db.pool.query('DROP TRIGGER fail_build ON audit_events');
    await startBuild(db.pool,f.account,request,'class.one','balanced');
    assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
  }finally{await db.close();}
});

test('Ascension preserves old choices and opens an unconfigured build with unknown Luck',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool),request=env(0,'START_BUILD');await startBuild(db.pool,f.account,request,'class.one','balanced');
    await db.pool.query("UPDATE runs SET status='AFTERCORE' WHERE id=$1",[f.run]);
    const next=await ascend(db.pool,f.account,env(1,'ASCEND'));
    assert.equal((await startBuild(db.pool,f.account,request,'class.one','balanced')).replayed,true);
    assert.equal((await db.pool.query('SELECT state->>\'mode\' AS mode FROM run_builds WHERE run_id=$1',[next.runId])).rows[0].mode,'UNCONFIGURED');
    assert.equal((await db.pool.query('SELECT luck FROM run_progression WHERE run_id=$1',[next.runId])).rows[0].luck,null);
    await startBuild(db.pool,f.account,env(0,'START_BUILD'),'class.two','balanced');
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_build_events')).rows[0].n,2);
    assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
  }finally{await db.close();}
});

test('read-only sessions can inspect owned presets but cannot write choices or supply raw stats',async()=>{
  const db=await testDatabase();let app:ReturnType<typeof buildApp>|undefined;try {
    const f=await fixture(db.pool);await enrollPassword(db.pool,f.account,'build_reader','a substantial build fixture password');
    const session=await requireLogin(db.pool,'build_reader','a substantial build fixture password','Fixture',true);
    app=buildApp(db.pool,{mode:'sessions',throttleKey:'b'.repeat(64)});
    const headers={authorization:`Bearer ${session.token}`},payload={...env(0,'START_BUILD'),classId:'class.one',presetKey:'balanced'};
    assert.equal((await app.inject({url:'/api/v1/progression/options',headers})).json().classes.length,3);
    assert.equal((await app.inject({method:'POST',url:'/api/v1/progression/start',headers,payload})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:'/api/v1/progression/start',headers,payload:{...payload,luck:30}})).statusCode,400);
    assert.equal((await app.inject({url:'/api/v1/progression/options'})).statusCode,401);
  }finally{await app?.close();await db.close();}
});

test('upgrade preserves legacy attributes and class levels without inventing Luck or events',async()=>{
  const db=await testDatabase(false);try {
    await db.pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql') && n<'015').sort()) {
      const sql=await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8');await db.pool.query(sql);
      await db.pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
    }
    const f=await fixture(db.pool);
    await db.pool.query('UPDATE run_progression SET level=4,strength=17 WHERE run_id=$1',[f.run]);
    await db.pool.query("INSERT INTO run_class_levels(run_id,class_id,native_level) VALUES($1,'class.one',4)",[f.run]);
    const before=(await db.pool.query('SELECT to_jsonb(p) AS data FROM run_progression p')).rows;
    await migrate(db.pool);
    assert.deepEqual((await db.pool.query("SELECT to_jsonb(p)-'luck' AS data FROM run_progression p")).rows,before);
    assert.equal((await db.pool.query("SELECT state->>'mode' AS mode FROM run_builds")).rows[0].mode,'LEGACY');
    assert.equal((await db.pool.query('SELECT luck FROM run_progression')).rows[0].luck,null);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_build_events')).rows[0].n,0);
    assert.deepEqual(await buildOptions(db.pool,f.account),{classes:[],rules:[]});
    await assert.rejects(startBuild(db.pool,f.account,env(0,'START_BUILD'),'class.one','balanced'),/BUILD_SETUP_NOT_AVAILABLE/);
    assert.equal((await integrityReport(db.pool)).buildMismatches,0);
  }finally{await db.close();}
});

test('restricted runtime records choices while journal edits and projection bypasses fail',async()=>{
  const db=await testDatabase(),role=`probe_${randomUUID().replaceAll('-','')}`;let created=false;try {
    const f=await fixture(db.pool);
    await db.pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);created=true;
    await db.pool.query(`GRANT USAGE ON SCHEMA ${db.schema} TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA ${db.schema} TO ${role};
      GRANT UPDATE(security_epoch) ON accounts TO ${role}; GRANT UPDATE ON runs,run_progression,run_builds,discoveries TO ${role};
      GRANT INSERT,UPDATE ON run_class_levels TO ${role}; GRANT INSERT ON run_build_events,action_receipts,audit_events,outbox_events TO ${role}`);
    const client=await db.pool.connect();try {
      await client.query(`SET ROLE ${role}`);
      const restricted={connect:async()=>({query:client.query.bind(client),release:()=>{}})} as unknown as pg.Pool;
      await startBuild(restricted,f.account,env(0,'START_BUILD'),'class.one','balanced');
      await assert.rejects(client.query('UPDATE run_build_events SET xp_at_choice=1'),(e:{code?:string})=>e.code==='42501');
      await assert.rejects(client.query('UPDATE run_progression SET luck=20'),/inconsistent/);
    }finally{await client.query('RESET ROLE');client.release();}
    assert.equal((await integrityReport(db.pool)).buildMismatches,0);
  }finally{if(created){await db.pool.query(`DROP OWNED BY ${role}`);await db.pool.query(`DROP ROLE ${role}`);}await db.close();}
});
