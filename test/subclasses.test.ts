import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { readdir,readFile } from 'node:fs/promises';
import type pg from 'pg';
import { actor,testDatabase } from './helpers.js';
import { buildPackage } from './build-fixture.js';
import { publishContent,validateContent,type ContentPackage } from '../src/domains/content.js';
import { startBuild,levelUp } from '../src/domains/builds.js';
import { chooseSubclass,subclassView } from '../src/domains/subclasses.js';
import { executeAction,advanceRevision } from '../src/foundation/action.js';
import { beginEncounter,finishEncounter } from '../src/domains/encounters.js';
import { ascend } from '../src/domains/lifecycle.js';
import { integrityReport,unindexedForeignKeys } from '../src/foundation/integrity.js';
import { migrate } from '../src/database.js';
import { buildApp } from '../src/app.js';
import { enrollPassword,requireLogin } from '../src/auth/sessions.js';

const env=(expectedRevision:number,actionType='CHOOSE_SUBCLASS')=>({requestId:randomUUID(),expectedRevision,actionType});
function content():ContentPackage {
  const p=structuredClone(buildPackage);p.version='subclass-fixture';
  for(const e of p.entities.filter(e=>e.kind==='CLASS'))(e.definition.mechanics!.classProgression as {maximumNativeLevel:number}).maximumNativeLevel=20;
  (p.entities.find(e=>e.id==='encounter.build')!.definition.mechanics!.resolutionXP as {amount:string}).amount='2000';
  for(const [id,classId] of [['subclass.first','class.one'],['subclass.other','class.one'],['subclass.second','class.two']])p.entities.push({id:id!,kind:'ABILITY',revision:1,schemaVersion:1,definition:{name:id!,dependencies:[classId!],public:{},mechanics:{subclass:{version:1,ruleset:'SUBCLASS_CHOICE_V1',classId:classId!,unlockNativeLevel:5,access:'DISCOVERED'}}}});
  return p;
}
async function fixture(pool:Awaited<ReturnType<typeof testDatabase>>['pool']) {
  const release=await publishContent(pool,content()),f=await actor(pool,release,10);
  for(const id of ['class.one','class.two','subclass.first','subclass.other','subclass.second'])await pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,$2,'DISCOVERED')",[f.account,id]);
  await startBuild(pool,f.account,env(0,'START_BUILD'),'class.one','balanced');
  const begin=await executeAction(pool,f.account,env(1,'SUBCLASS_FIXTURE'),{},async c=>({...await beginEncounter(c,'encounter.build',{}),revision:await advanceRevision(c)}));
  await executeAction(pool,f.account,env(2,'SUBCLASS_FIXTURE'),{},async c=>({...await finishEncounter(c,begin.instanceId as string,0,'VICTORY',async()=>({})),revision:await advanceRevision(c)}));
  let revision=3;
  return {...f,next:()=>revision,bump:()=>revision++,levels:async(classId:string,n:number)=>{for(let i=0;i<n;i++)await levelUp(pool,f.account,env(revision++,'LEVEL_UP'),classId);}};
}

test('native level five unlocks an explicit choice; retries grant only one immutable selection',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await assert.rejects(chooseSubclass(db.pool,f.account,env(f.next()),'subclass.first'),/SUBCLASS_NOT_READY/);
    await f.levels('class.one',4);const request=env(f.bump());
    const results=await Promise.all(Array.from({length:4},()=>chooseSubclass(db.pool,f.account,request,'subclass.first')));
    assert.equal(results.filter(r=>!r.replayed).length,1);
    assert.equal((await subclassView(db.pool,f.account)).selected[0]!.subclassId,'subclass.first');
    await assert.rejects(chooseSubclass(db.pool,f.account,env(f.next()),'subclass.other'),/SUBCLASS_ALREADY_CHOSEN/);
    await f.levels('class.one',1);assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
    assert.deepEqual(await unindexedForeignKeys(db.pool),[]);
  }finally{await db.close();}
});

test('multiclass qualification uses each native class rather than total character level',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await f.levels('class.one',4);await f.levels('class.two',4);
    await assert.rejects(chooseSubclass(db.pool,f.account,env(f.next()),'subclass.second'),/SUBCLASS_NOT_READY/);
    await chooseSubclass(db.pool,f.account,env(f.bump()),'subclass.first');
    await f.levels('class.two',1);await chooseSubclass(db.pool,f.account,env(f.bump()),'subclass.second');
    assert.equal((await subclassView(db.pool,f.account)).selected.length,2);
    assert.equal((await integrityReport(db.pool)).subclassMismatches,0);
  }finally{await db.close();}
});

test('competing valid choices serialize and stale requests cannot commit another selection',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await f.levels('class.one',4);
    const results=await Promise.allSettled(['subclass.first','subclass.other'].map(id=>chooseSubclass(db.pool,f.account,env(f.next()),id)));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    const failure=results.find(r=>r.status==='rejected') as PromiseRejectedResult;assert.match(failure.reason.message,/STALE_REVISION/);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_subclass_choices')).rows[0].n,1);
  }finally{await db.close();}
});

test('discovery, explicit intent and leaving active instances are mandatory',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await f.levels('class.one',4);
    await db.pool.query("DELETE FROM discoveries WHERE account_id=$1 AND entity_id='subclass.first'",[f.account]);
    await assert.rejects(chooseSubclass(db.pool,f.account,env(f.next()),'subclass.first'),/SUBCLASS_NOT_DISCOVERED/);
    assert.throws(()=>chooseSubclass(db.pool,f.account,{...env(f.next()),authorizationSource:'AUTOMATION'},'subclass.other'),/EXPLICIT_BUILD_CHOICE_REQUIRED/);
    await executeAction(db.pool,f.account,env(f.bump(),'SUBCLASS_FIXTURE'),{},async c=>({...await beginEncounter(c,'encounter.build',{}),revision:await advanceRevision(c)}));
    assert.equal((await subclassView(db.pool,f.account)).options.find(o=>o.subclassId==='subclass.other')!.eligibility,'ACTIVE_INSTANCE');
    await assert.rejects(chooseSubclass(db.pool,f.account,env(f.next()),'subclass.other'),/INSTANCE_STILL_ACTIVE/);
  }finally{await db.close();}
});

test('late failure rolls back choice, projection, revision and receipt together',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await f.levels('class.one',4);const request=env(f.next());
    await db.pool.query("CREATE FUNCTION fail_subclass() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Late subclass failure'; END $$; CREATE TRIGGER fail_subclass BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_subclass()");
    await assert.rejects(chooseSubclass(db.pool,f.account,request,'subclass.first'),/Late subclass failure/);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_subclass_choices')).rows[0].n,0);
    assert.equal((await subclassView(db.pool,f.account)).selected.length,0);
    await db.pool.query('DROP TRIGGER fail_subclass ON audit_events');await chooseSubclass(db.pool,f.account,request,'subclass.first');
  }finally{await db.close();}
});

test('SQL rejects edited history, forged pins and unjournaled projections',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await f.levels('class.one',4);await chooseSubclass(db.pool,f.account,env(f.bump()),'subclass.first');
    for(const sql of ['UPDATE run_subclass_choices SET native_level_at_choice=9','DELETE FROM run_subclass_choices','UPDATE run_subclasses SET subclass_id=\'subclass.other\'','DELETE FROM run_subclasses'])await assert.rejects(db.pool.query(sql),/Immutable record/);
    await assert.rejects(db.pool.query("INSERT INTO run_subclasses(run_id,class_id,subclass_id,subclass_revision,choice_id) VALUES($1,'class.two','subclass.second',1,$2)",[f.run,randomUUID()]),/immutable choice/);
    await assert.rejects(db.pool.query("INSERT INTO run_subclass_choices(run_id,action_id,subclass_id,native_level_at_choice) VALUES($1,$2,'subclass.second',5)",[f.run,randomUUID()]),/server-derived/);
  }finally{await db.close();}
});

test('new publications cannot rewrite selected content and Ascension keeps old history only',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await f.levels('class.one',4);const request=env(f.bump());await chooseSubclass(db.pool,f.account,request,'subclass.first');
    const newer=content();newer.version='subclass-newer';const definition=newer.entities.find(e=>e.id==='subclass.first')!;definition.revision=2;definition.definition.name='Changed';await publishContent(db.pool,newer);
    assert.equal((await subclassView(db.pool,f.account)).selected[0]!.name,'subclass.first');
    await db.pool.query("UPDATE runs SET status='AFTERCORE' WHERE id=$1",[f.run]);await ascend(db.pool,f.account,env(f.bump(),'ASCEND'));
    assert.equal((await chooseSubclass(db.pool,f.account,request,'subclass.first')).replayed,true);
    assert.deepEqual(await subclassView(db.pool,f.account),{selected:[],options:[]});
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_subclass_choices')).rows[0].n,1);
    assert.equal((await integrityReport(db.pool)).subclassMismatches,0);
  }finally{await db.close();}
});

test('HTTP hides unknown subclasses and rejects read-only, unauthenticated and raw eligibility writes',async()=>{
  const db=await testDatabase();let app:ReturnType<typeof buildApp>|undefined;try {
    const f=await fixture(db.pool),other=await actor(db.pool);await enrollPassword(db.pool,f.account,'subclass_reader','a substantial subclass fixture password');
    const session=await requireLogin(db.pool,'subclass_reader','a substantial subclass fixture password','Fixture',true);
    app=buildApp(db.pool,{mode:'sessions',throttleKey:'c'.repeat(64)});const headers={authorization:`Bearer ${session.token}`};
    assert.equal((await app.inject({url:'/api/v1/progression/subclasses',headers})).json().options.length,3);
    const payload={...env(f.next()),subclassId:'subclass.first'};
    assert.equal((await app.inject({method:'POST',url:'/api/v1/progression/subclasses',headers,payload})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:'/api/v1/progression/subclasses',headers,payload:{...payload,nativeLevel:5}})).statusCode,400);
    assert.equal((await app.inject({url:'/api/v1/progression/subclasses'})).statusCode,401);
    assert.deepEqual(await subclassView(db.pool,other.account),{selected:[],options:[]});
    await assert.rejects(chooseSubclass(db.pool,other.account,env(0),'subclass.first'),/BUILD_NOT_CONFIGURED/);
  }finally{await app?.close();await db.close();}
});

test('restricted runtime chooses once while edits and destructive history access remain denied',async()=>{
  const db=await testDatabase(),role=`probe_${randomUUID().replaceAll('-','')}`;let created=false;try {
    const f=await fixture(db.pool);await f.levels('class.one',4);
    await db.pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);created=true;
    await db.pool.query(`GRANT USAGE ON SCHEMA ${db.schema} TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA ${db.schema} TO ${role};
      GRANT UPDATE(security_epoch) ON accounts TO ${role}; GRANT UPDATE ON runs,run_builds,run_class_levels,discoveries TO ${role};
      GRANT INSERT ON run_subclass_choices,run_subclasses,action_receipts,audit_events,outbox_events TO ${role}`);
    const client=await db.pool.connect();try {
      await client.query(`SET ROLE ${role}`);const restricted={connect:async()=>({query:client.query.bind(client),release:()=>{}})} as unknown as pg.Pool;
      await chooseSubclass(restricted,f.account,env(f.next()),'subclass.first');
      await assert.rejects(client.query('DELETE FROM run_subclasses'),(e:{code?:string})=>e.code==='42501');
      await assert.rejects(client.query('UPDATE run_subclass_choices SET native_level_at_choice=9'),(e:{code?:string})=>e.code==='42501');
    }finally{await client.query('RESET ROLE');client.release();}
    assert.equal((await integrityReport(db.pool)).subclassMismatches,0);
  }finally{if(created){await db.pool.query(`DROP OWNED BY ${role}`);await db.pool.query(`DROP ROLE ${role}`);}await db.close();}
});

test('upgrade invents no subclasses and audit detects a corrupted selection',async()=>{
  const db=await testDatabase(false);try {
    await db.pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql') && n<'016').sort()) {
      const sql=await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8');await db.pool.query(sql);await db.pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
    }
    const f=await fixture(db.pool);await f.levels('class.one',4);const prior=(await db.pool.query('SELECT * FROM run_builds')).rows;
    await migrate(db.pool);assert.deepEqual((await db.pool.query('SELECT * FROM run_builds')).rows,prior);assert.equal((await subclassView(db.pool,f.account)).selected.length,0);
    await chooseSubclass(db.pool,f.account,env(f.next()),'subclass.first');await db.pool.query('ALTER TABLE run_subclasses DISABLE TRIGGER USER');
    await db.pool.query("UPDATE run_subclasses SET subclass_id='subclass.other'");assert.equal((await integrityReport(db.pool)).subclassMismatches,1);
  }finally{await db.close();}
});

test('publication rejects wrong kinds, undeclared classes, wrong unlocks and unreachable subclass content',()=>{
  validateContent(content());
  for(const change of [(p:ContentPackage)=>{p.entities.at(-1)!.kind='ITEM';},(p:ContentPackage)=>{p.entities.at(-1)!.definition.dependencies=[];},(p:ContentPackage)=>{(p.entities.at(-1)!.definition.mechanics!.subclass as {unlockNativeLevel:number}).unlockNativeLevel=4;},(p:ContentPackage)=>{(p.entities.find(e=>e.id==='class.two')!.definition.mechanics!.classProgression as {maximumNativeLevel:number}).maximumNativeLevel=4;}]){const p=content();change(p);assert.throws(()=>validateContent(p));}
});

test('SQL binds choices to owner receipts and explicit action sources; archived runs cannot choose',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool),other=await actor(db.pool);await f.levels('class.one',4);
    const insert=(c:{client:pg.PoolClient;actionId:string})=>c.client.query("INSERT INTO run_subclass_choices(run_id,action_id,subclass_id) VALUES($1,$2,'subclass.first')",[f.run,c.actionId]);
    await assert.rejects(executeAction(db.pool,other.account,env(0),{},async c=>{await insert(c);return {ok:true};}),/inconsistent/);
    await assert.rejects(executeAction(db.pool,f.account,env(f.next(),'WRONG_TYPE'),{},async c=>{await insert(c);return {ok:true};}),/inconsistent/);
    await assert.rejects(executeAction(db.pool,f.account,{...env(f.next()),authorizationSource:'AUTOMATION'}, {},async c=>{await insert(c);return {ok:true};}),/inconsistent/);
    await db.pool.query("UPDATE runs SET status='ABANDONED' WHERE id=$1",[f.run]);
    await assert.rejects(db.pool.query("INSERT INTO run_subclass_choices(run_id,action_id,subclass_id) VALUES($1,$2,'subclass.first')",[f.run,randomUUID()]),/configured normal run/);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_subclass_choices')).rows[0].n,0);
  }finally{await db.close();}
});
