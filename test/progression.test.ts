import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { actor,testDatabase } from './helpers.js';
import { migrate } from '../src/database.js';
import { publishContent,validateContent,type ContentPackage } from '../src/domains/content.js';
import { executeAction,advanceRevision,type ActionContext } from '../src/foundation/action.js';
import { beginEncounter,finishEncounter,type EncounterOutcome } from '../src/domains/encounters.js';
import { progressionView } from '../src/domains/progression.js';
import { ascend } from '../src/domains/lifecycle.js';
import { integrityReport,unindexedForeignKeys } from '../src/foundation/integrity.js';
import { buildApp } from '../src/app.js';
import { enrollPassword,requireLogin } from '../src/auth/sessions.js';

const pkg:ContentPackage={version:'xp-fixture',engineVersion:'foundation-1',entities:[
  {id:'curve.test',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'XP curve',dependencies:[],public:{},mechanics:{xpCurve:{version:1,thresholds:Array.from({length:25},(_,i)=>String(i*100))}}}},
  {id:'encounter.test',kind:'ENCOUNTER',revision:1,schemaVersion:1,definition:{name:'Obstacle',dependencies:['curve.test'],public:{},mechanics:{encounter:{version:1,turnCost:1},resolutionXP:{version:1,amount:'250',curveId:'curve.test'}}}}
]};
const env=(revision=0,type='XP_FIXTURE')=>({requestId:randomUUID(),actionType:type,expectedRevision:revision});
async function fixture(pool:Awaited<ReturnType<typeof testDatabase>>['pool'],custom=pkg) {
  const release=await publishContent(pool,custom),f=await actor(pool,release,10);
  const request=env(),start=()=>executeAction(pool,f.account,request,{},async c=>({...await beginEncounter(c,'encounter.test',{}),revision:await advanceRevision(c)}));
  return {...f,release,request,start};
}
function finish(pool:Awaited<ReturnType<typeof testDatabase>>['pool'],account:string,id:string,revision=1,outcome:EncounterOutcome='VICTORY',request=env(revision)) {
  return executeAction(pool,account,request,{id,outcome},async c=>({...await finishEncounter(c,id,0,outcome,async()=>({solution:'SERVER_AUTHORIZED'})),revision:await advanceRevision(c)}));
}

test('successful resolution awards its pinned budget once and marks pending levels without committing a build',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);
    assert.equal((await progressionView(db.pool,f.account)).readiness,null);
    const starts=await Promise.all(Array.from({length:5},f.start)),id=starts[0]!.instanceId as string;
    assert.equal(starts.filter(r=>!r.replayed).length,1);
    assert.equal((await progressionView(db.pool,f.account)).xp,'0');
    const request=env(1),wins=await Promise.all(Array.from({length:5},()=>finish(db.pool,f.account,id,1,'VICTORY',request)));
    assert.equal(wins.filter(r=>!r.replayed).length,1);
    const view=await progressionView(db.pool,f.account);
    assert.deepEqual(view.readiness,{xp:'250',level:1,readyThroughLevel:3,pendingLevels:2,nextThreshold:'300'});
    assert.equal(view.campaignState,'ACTIVE');
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_xp_awards')).rows[0].n,1);
    await assert.rejects(finish(db.pool,f.account,id,2),/ENCOUNTER_RESOLVED/);
    assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
    assert.deepEqual(await unindexedForeignKeys(db.pool),[]);
  }finally{await db.close();}
});

test('late failure rolls back outcome, XP, award, revision and receipt together',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool),id=(await f.start()).instanceId as string,request=env(1);
    await assert.rejects(executeAction(db.pool,f.account,request,{id},async c=>{
      await finishEncounter(c,id,0,'VICTORY',async()=>({}));
      assert.equal((await c.client.query('SELECT xp::text FROM run_progression WHERE run_id=$1',[f.run])).rows[0].xp,'250');
      await advanceRevision(c);throw new Error('Late XP failure');
    }),/Late XP failure/);
    assert.equal((await db.pool.query('SELECT outcome FROM encounter_records WHERE instance_id=$1',[id])).rows[0].outcome,null);
    assert.equal((await progressionView(db.pool,f.account)).xp,'0');
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_xp_awards')).rows[0].n,0);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM action_receipts WHERE request_id=$1',[request.requestId])).rows[0].n,0);
    await finish(db.pool,f.account,id);assert.equal((await progressionView(db.pool,f.account)).xp,'250');
  }finally{await db.close();}
});

test('defeat, retreat and failed-forward retain XP; repeatable encounters get distinct occurrence budgets',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);let revision=0;
    for(const outcome of ['VICTORY','DEFEAT','RETREAT','FAILED_FORWARD','SURRENDER','VICTORY'] as EncounterOutcome[]) {
      const start=await executeAction(db.pool,f.account,env(revision++),{},async c=>({...await beginEncounter(c,'encounter.test',{}),revision:await advanceRevision(c)}));
      await finish(db.pool,f.account,start.instanceId as string,revision++,outcome);
      assert.equal((await progressionView(db.pool,f.account)).xp,outcome==='VICTORY' && revision>2 ? '500':'250');
    }
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM encounter_xp_plans')).rows[0].n,6);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_xp_awards')).rows[0].n,2);
  }finally{await db.close();}
});

test('a changed content release cannot rewrite an open encounter or switch a run to a different curve',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool),id=(await f.start()).instanceId as string;
    const newer=structuredClone(pkg);newer.version='xp-fixture-2';newer.entities[0]!.revision=2;
    newer.entities[0]!.definition.mechanics!.xpCurve={version:1,thresholds:Array.from({length:25},(_,i)=>String(i*200))};
    newer.entities[1]!.revision=2;newer.entities[1]!.definition.mechanics!.resolutionXP={version:1,amount:'900',curveId:'curve.test'};
    await publishContent(db.pool,newer);
    await finish(db.pool,f.account,id);assert.equal((await progressionView(db.pool,f.account)).xp,'250');
    const custom=structuredClone(pkg);custom.version='xp-two-curves';custom.entities.push({...structuredClone(pkg.entities[0]!),id:'curve.other'});
    custom.entities.push({...structuredClone(pkg.entities[1]!),id:'encounter.other',definition:{name:'Other',dependencies:['curve.other'],public:{},mechanics:{encounter:{version:1,turnCost:1},resolutionXP:{version:1,amount:'25',curveId:'curve.other'}}}});
    const g=await fixture(db.pool,custom),other=(await g.start()).instanceId as string;await finish(db.pool,g.account,other);
    await assert.rejects(executeAction(db.pool,g.account,env(2),{},c=>beginEncounter(c,'encounter.other',{})),/curve is already pinned/);
    assert.equal((await db.pool.query('SELECT turns FROM runs WHERE id=$1',[g.run])).rows[0].turns,9);
  }finally{await db.close();}
});

test('SQL rejects projection edits, forged awards, history edits and nonzero new-run baselines',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool),id=(await f.start()).instanceId as string;
    await assert.rejects(db.pool.query('UPDATE run_progression SET xp=7 WHERE run_id=$1',[f.run]),/XP history/);
    await assert.rejects(db.pool.query('INSERT INTO run_xp_awards(instance_id,run_id,action_id,amount) SELECT instance_id,run_id,start_action_id,250 FROM encounter_records WHERE instance_id=$1',[id]),/matching successful resolution/);
    await assert.rejects(db.pool.query('UPDATE encounter_xp_plans SET amount=1'),/Immutable record/);
    await assert.rejects(db.pool.query('DELETE FROM run_xp_baselines'),/Immutable record/);
    await finish(db.pool,f.account,id);
    await assert.rejects(db.pool.query('UPDATE run_xp_awards SET amount=1'),/Immutable record/);
    const extra=randomUUID();await db.pool.query("UPDATE runs SET status='ABANDONED' WHERE id=$1",[f.run]);
    await db.pool.query('INSERT INTO runs(id,character_id,content_release_id,turns) VALUES($1,$2,$3,0)',[extra,f.character,f.release]);
    await assert.rejects(db.pool.query('INSERT INTO run_progression(run_id,xp) VALUES($1,10)',[extra]),/start at zero/);
  }finally{await db.close();}
});

test('signed bigint overflow fails the entire resolution and preserves the open encounter',async()=>{
  const db=await testDatabase();try {
    const custom=structuredClone(pkg);custom.entities[1]!.definition.mechanics!.resolutionXP={version:1,amount:'9223372036854775807',curveId:'curve.test'};
    const f=await fixture(db.pool,custom),id=(await f.start()).instanceId as string;await finish(db.pool,f.account,id);
    assert.equal((await progressionView(db.pool,f.account)).xp,'9223372036854775807');
    const next=await executeAction(db.pool,f.account,env(2),{},async c=>({...await beginEncounter(c,'encounter.test',{}),revision:await advanceRevision(c)}));
    await assert.rejects(finish(db.pool,f.account,next.instanceId as string,3),(e:{code?:string})=>e.code==='22003');
    assert.equal((await db.pool.query('SELECT outcome FROM encounter_records WHERE instance_id=$1',[next.instanceId])).rows[0].outcome,null);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_xp_awards')).rows[0].n,1);
  }finally{await db.close();}
});

test('Ascension keeps the old XP history and creates a zero-XP new-run baseline',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool),id=(await f.start()).instanceId as string;await finish(db.pool,f.account,id);
    await db.pool.query("UPDATE runs SET status='AFTERCORE' WHERE id=$1",[f.run]);
    const request=env(2,'ASCEND'),next=await ascend(db.pool,f.account,request);
    assert.equal((await ascend(db.pool,f.account,request)).replayed,true);
    assert.equal((await progressionView(db.pool,f.account)).xp,'0');
    assert.equal((await progressionView(db.pool,f.account)).readiness,null);
    assert.deepEqual((await db.pool.query('SELECT xp::text,level FROM run_progression WHERE run_id=$1',[f.run])).rows[0],{xp:'250',level:1});
    assert.equal((await db.pool.query('SELECT xp::text,origin FROM run_xp_baselines WHERE run_id=$1',[next.runId])).rows[0].origin,'NEW_RUN');
    assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
  }finally{await db.close();}
});

test('upgrade preserves existing XP as a baseline without inventing historical awards',async()=>{
  const db=await testDatabase(false);try {
    await db.pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql') && n<'014').sort()) {
      const sql=await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8');await db.pool.query(sql);
      await db.pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
    }
    const f=await actor(db.pool);await db.pool.query('UPDATE run_progression SET xp=9007199254740993 WHERE run_id=$1',[f.run]);
    const before=(await db.pool.query('SELECT * FROM run_progression WHERE run_id=$1',[f.run])).rows;
    await migrate(db.pool);assert.deepEqual((await db.pool.query('SELECT * FROM run_progression WHERE run_id=$1',[f.run])).rows.map(({luck,...prior})=>prior),before);
    assert.deepEqual((await db.pool.query('SELECT xp::text,origin FROM run_xp_baselines WHERE run_id=$1',[f.run])).rows[0],{xp:'9007199254740993',origin:'MIGRATION_014'});
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_xp_awards')).rows[0].n,0);
    assert.equal((await integrityReport(db.pool)).xpMismatches,0);
  }finally{await db.close();}
});

test('public progression is owned, readable by read-only sessions, and accepts no reward writes',async()=>{
  const db=await testDatabase();let app:ReturnType<typeof buildApp>|undefined;try {
    const f=await fixture(db.pool),id=(await f.start()).instanceId as string;await finish(db.pool,f.account,id);
    const other=await actor(db.pool);assert.equal((await progressionView(db.pool,other.account)).xp,'0');
    await assert.rejects(progressionView(db.pool,randomUUID()),/PROGRESSION_NOT_FOUND/);
    await assert.rejects(finish(db.pool,other.account,id,0),/ENCOUNTER_NOT_FOUND/);
    await enrollPassword(db.pool,f.account,'xp_reader','a substantial xp fixture password');
    const session=await requireLogin(db.pool,'xp_reader','a substantial xp fixture password','Fixture',true);
    app=buildApp(db.pool,{mode:'sessions',throttleKey:'f'.repeat(64)});
    assert.equal((await app.inject({url:'/api/v1/progression'})).statusCode,401);
    const response=await app.inject({url:'/api/v1/progression',headers:{authorization:`Bearer ${session.token}`}});
    assert.equal(response.statusCode,200);assert.equal(response.json().xp,'250');
    assert.equal(response.json().awards,undefined);assert.equal(response.json().mechanics,undefined);
    assert.equal((await app.inject({method:'POST',url:'/api/v1/progression',headers:{authorization:`Bearer ${session.token}`},payload:{amount:'1000'}})).statusCode,404);
  }finally{await app?.close();await db.close();}
});

test('restricted runtime can start, award and open new zero-XP progression but cannot rewrite history',async()=>{
  const db=await testDatabase(),role=`probe_${randomUUID().replaceAll('-','')}`;let created=false;try {
    const f=await fixture(db.pool),freshAccount=randomUUID(),freshCharacter=randomUUID(),freshRun=randomUUID();
    await db.pool.query('INSERT INTO accounts(id) VALUES($1)',[freshAccount]);
    await db.pool.query('INSERT INTO characters(id,account_id) VALUES($1,$2)',[freshCharacter,freshAccount]);
    await db.pool.query('INSERT INTO runs(id,character_id,content_release_id,turns) VALUES($1,$2,$3,0)',[freshRun,freshCharacter,f.release]);
    await db.pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);created=true;
    await db.pool.query(`GRANT USAGE ON SCHEMA ${db.schema} TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA ${db.schema} TO ${role};
      GRANT INSERT,UPDATE ON instances,instance_participants,state_scopes,encounter_records,run_progression TO ${role}; GRANT UPDATE ON runs TO ${role};
      GRANT INSERT ON action_receipts,turn_ledger,run_builds,run_xp_baselines,encounter_xp_plans,run_xp_awards TO ${role};
      GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ${db.schema} TO ${role}`);
    const client=await db.pool.connect();try {
      await client.query('BEGIN');await client.query(`SET LOCAL ROLE ${role}`);
      const run=(await client.query('SELECT * FROM runs WHERE id=$1 FOR UPDATE',[f.run])).rows[0],actionId=randomUUID(),requestId=randomUUID();
      await client.query('INSERT INTO action_receipts(account_id,request_id,payload_hash,result,action_id,envelope_version) VALUES($1,$2,$3,$4,$5,2)',[f.account,requestId,'0'.repeat(64),{probe:true},actionId]);
      const c:ActionContext={client,accountId:f.account,actionId,requestId,run},start=await beginEncounter(c,'encounter.test',{});
      await finishEncounter(c,start.instanceId,0,'VICTORY',async()=>({}));await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      assert.equal((await client.query('SELECT xp::text FROM run_progression WHERE run_id=$1',[f.run])).rows[0].xp,'250');
      await client.query('INSERT INTO run_progression(run_id) VALUES($1)',[freshRun]);
      assert.deepEqual((await client.query('SELECT xp::text,origin FROM run_xp_baselines WHERE run_id=$1',[freshRun])).rows[0],{xp:'0',origin:'NEW_RUN'});
      for(const sql of ['UPDATE run_xp_awards SET amount=amount','DELETE FROM encounter_xp_plans','DELETE FROM run_xp_baselines']) {
        await client.query('SAVEPOINT denied');await assert.rejects(client.query(sql),(e:{code?:string})=>e.code==='42501');await client.query('ROLLBACK TO denied');
      }
    }finally{await client.query('ROLLBACK');client.release();}
  }finally{if(created){await db.pool.query(`DROP OWNED BY ${role}`);await db.pool.query(`DROP ROLE ${role}`);}await db.close();}
});

test('content rejects malformed budgets, missing/undeclared curves and curves on the wrong kind',()=>{
  validateContent(pkg);
  for(const amount of ['0','-1','1.5','01','9223372036854775808',1]) {
    const bad=structuredClone(pkg);bad.entities[1]!.definition.mechanics!.resolutionXP={version:1,amount,curveId:'curve.test'};assert.throws(()=>validateContent(bad));
  }
  const missing=structuredClone(pkg);missing.entities[1]!.definition.dependencies=[];assert.throws(()=>validateContent(missing),/INVALID_XP_CURVE_REFERENCE/);
  const kind=structuredClone(pkg);kind.entities[0]!.kind='ITEM';assert.throws(()=>validateContent(kind),/INVALID_XP_CURVE_KIND/);
  const malformed=structuredClone(pkg);malformed.entities[0]!.definition.mechanics!.xpCurve={version:1,thresholds:['0','100']};assert.throws(()=>validateContent(malformed),/INVALID_PROGRESSION_CURVE/);
});

test('audit detects an XP projection corrupted outside normal constraints',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);
    await db.pool.query('ALTER TABLE run_progression DISABLE TRIGGER USER');
    await db.pool.query('UPDATE run_progression SET xp=9 WHERE run_id=$1',[f.run]);
    await db.pool.query('ALTER TABLE run_progression ENABLE TRIGGER USER');
    assert.equal((await integrityReport(db.pool)).xpMismatches,1);
  }finally{await db.close();}
});
