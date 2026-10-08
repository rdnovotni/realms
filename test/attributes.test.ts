import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { readdir,readFile } from 'node:fs/promises';
import type pg from 'pg';
import { actor,testDatabase } from './helpers.js';
import { buildPackage } from './build-fixture.js';
import { publishContent,validateContent,type ContentPackage } from '../src/domains/content.js';
import { attributes as names } from '../src/domains/build-content.js';
import { attributeCapacity,type AttributeRules } from '../src/domains/attribute-content.js';
import { startBuild,levelUp } from '../src/domains/builds.js';
import { allocateAttributes,attributeView } from '../src/domains/attributes.js';
import { progressionView } from '../src/domains/progression.js';
import { executeAction,advanceRevision } from '../src/foundation/action.js';
import { beginEncounter,finishEncounter } from '../src/domains/encounters.js';
import { ascend } from '../src/domains/lifecycle.js';
import { integrityReport,unindexedForeignKeys } from '../src/foundation/integrity.js';
import { migrate } from '../src/database.js';
import { buildApp } from '../src/app.js';
import { enrollPassword,requireLogin } from '../src/auth/sessions.js';
const env=(expectedRevision:number,actionType='ALLOCATE_ATTRIBUTES')=>({requestId:randomUUID(),expectedRevision,actionType});
function content(capacity=false):ContentPackage {
  const p=structuredClone(buildPackage);p.version=capacity?'attribute-capacity-fixture':'attribute-fixture';
  for(const e of p.entities.filter(e=>e.kind==='CLASS'))(e.definition.mechanics!.classProgression as {maximumNativeLevel:number}).maximumNativeLevel=25;
  (p.entities.find(e=>e.id==='encounter.build')!.definition.mechanics!.resolutionXP as {amount:string}).amount='2400';
  const maximumScores=Object.fromEntries(names.map(a=>[a,a==='strength'?13:a==='luck'?11:30]));
  if(capacity)maximumScores.dexterity=12;
  for(const id of ['rules.attributes','rules.alternate'])p.entities.push({id,kind:'TUNING',revision:1,schemaVersion:1,definition:{name:id,dependencies:['rules.build'],public:{},mechanics:{attributeRules:{version:1,ruleset:'ATTRIBUTE_MILESTONES_V1',buildRulesId:'rules.build',maximumScores:{...maximumScores},milestones:id==='rules.alternate'?[{level:1,points:1,allowedAttributes:['strength']}]:capacity?[{level:4,points:1,allowedAttributes:['strength','dexterity']},{level:8,points:1,allowedAttributes:['strength']}]:[{level:4,points:2,allowedAttributes:['strength','dexterity']},{level:8,points:2,allowedAttributes:['strength','dexterity','constitution']},{level:12,points:1,allowedAttributes:['luck']}]}}}});
  return p;
}
async function fixture(pool:Awaited<ReturnType<typeof testDatabase>>['pool'],capacity=false) {
  const release=await publishContent(pool,content(capacity)),f=await actor(pool,release,10);
  await pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,'class.one','DISCOVERED')",[f.account]);
  await startBuild(pool,f.account,env(0,'START_BUILD'),'class.one','balanced');
  const begin=await executeAction(pool,f.account,env(1,'ATTRIBUTE_FIXTURE'),{},async c=>({...await beginEncounter(c,'encounter.build',{}),revision:await advanceRevision(c)}));
  await executeAction(pool,f.account,env(2,'ATTRIBUTE_FIXTURE'),{},async c=>({...await finishEncounter(c,begin.instanceId as string,0,'VICTORY',async()=>({})),revision:await advanceRevision(c)}));
  let revision=3;return {...f,next:()=>revision,bump:()=>revision++,levels:async(n:number)=>{for(let i=0;i<n;i++)await levelUp(pool,f.account,env(revision++,'LEVEL_UP'),'class.one');}};
}
test('attribute choices require committed milestones, apply exact budgets and replay once',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await assert.rejects(allocateAttributes(db.pool,f.account,env(f.next()),'rules.attributes',4,{strength:1,dexterity:1}),/ATTRIBUTE_MILESTONE_NOT_READY/);
    await f.levels(3);const request=env(f.bump());
    const results=await Promise.all(Array.from({length:4},()=>allocateAttributes(db.pool,f.account,request,'rules.attributes',4,{strength:1,dexterity:1})));
    assert.equal(results.filter(r=>!r.replayed).length,1);
    assert.deepEqual((await db.pool.query('SELECT strength,dexterity,luck,level FROM run_progression')).rows[0],{strength:13,dexterity:12,luck:10,level:4});
    await assert.rejects(allocateAttributes(db.pool,f.account,env(f.next()),'rules.attributes',4,{dexterity:2}),/ATTRIBUTE_MILESTONE_USED/);
    assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));assert.deepEqual(await unindexedForeignKeys(db.pool),[]);
  }finally{await db.close();}
});
test('later class levels preserve effective attributes without rewriting starting build history',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await f.levels(3);await allocateAttributes(db.pool,f.account,env(f.bump()),'rules.attributes',4,{dexterity:2});
    const next=await levelUp(db.pool,f.account,env(f.bump(),'LEVEL_UP'),'class.one');
    assert.equal((next.build as {attributes:{dexterity:number}}).attributes.dexterity,13);
    assert.equal((await progressionView(db.pool,f.account)).build.attributes.dexterity,13);
    assert.equal((await db.pool.query("SELECT state->'attributes'->>'dexterity' AS original FROM run_builds")).rows[0].original,'11');
    assert.equal((await integrityReport(db.pool)).attributeMismatches,0);assert.equal((await integrityReport(db.pool)).buildMismatches,0);
  }finally{await db.close();}
});
test('caps, allowed attributes, exact point totals and one pinned policy are enforced',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await f.levels(3);
    for(const allocation of [{strength:1},{luck:2},{strength:1,dexterity:2}])await assert.rejects(allocateAttributes(db.pool,f.account,env(f.next()),'rules.attributes',4,allocation),/INVALID_ATTRIBUTE_BUDGET/);
    await assert.rejects(allocateAttributes(db.pool,f.account,env(f.next()),'rules.attributes',4,{strength:2}),/ATTRIBUTE_CAP_REACHED/);
    await allocateAttributes(db.pool,f.account,env(f.bump()),'rules.attributes',4,{strength:1,dexterity:1});
    await assert.rejects(allocateAttributes(db.pool,f.account,env(f.next()),'rules.alternate',1,{strength:1}),/ATTRIBUTE_RULES_MISMATCH/);
    assert.equal((await attributeView(db.pool,f.account)).rules.length,1);
    assert.throws(()=>allocateAttributes(db.pool,f.account,env(f.next()),'rules.attributes',8,{dexterity:0}),/INVALID_ATTRIBUTE_ALLOCATION/);
  }finally{await db.close();}
});
test('allocations reserve enough capacity for all remaining authored milestones',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool,true);await f.levels(3);
    await assert.rejects(allocateAttributes(db.pool,f.account,env(f.next()),'rules.attributes',4,{strength:1}),/ATTRIBUTE_CAPACITY_RESERVED/);
    await allocateAttributes(db.pool,f.account,env(f.bump()),'rules.attributes',4,{dexterity:1});await f.levels(4);
    await allocateAttributes(db.pool,f.account,env(f.bump()),'rules.attributes',8,{strength:1});
    assert.equal((await integrityReport(db.pool)).attributeMismatches,0);
  }finally{await db.close();}
});
test('Luck changes only through an explicitly allowed milestone and old unspent milestones remain usable',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await f.levels(11);await allocateAttributes(db.pool,f.account,env(f.bump()),'rules.attributes',12,{luck:1});
    await allocateAttributes(db.pool,f.account,env(f.bump()),'rules.attributes',4,{dexterity:2});await allocateAttributes(db.pool,f.account,env(f.bump()),'rules.attributes',8,{constitution:2});
    const view=await attributeView(db.pool,f.account);assert.equal(view.attributes.luck,11);assert.deepEqual(view.choices.map(c=>c.milestone),[12,4,8]);
    assert.equal((await integrityReport(db.pool)).attributeMismatches,0);
  }finally{await db.close();}
});
test('competing requests serialize and active instances or automation cannot allocate',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await f.levels(3);
    const results=await Promise.allSettled(Array.from({length:2},()=>allocateAttributes(db.pool,f.account,env(f.next()),'rules.attributes',4,{dexterity:2})));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason.message,/STALE_REVISION/);f.bump();
    assert.throws(()=>allocateAttributes(db.pool,f.account,{...env(f.next()),authorizationSource:'AUTOMATION'},'rules.attributes',8,{constitution:2}),/EXPLICIT_BUILD_CHOICE_REQUIRED/);
    await executeAction(db.pool,f.account,env(f.bump(),'ATTRIBUTE_FIXTURE'),{},async c=>({...await beginEncounter(c,'encounter.build',{}),revision:await advanceRevision(c)}));
    await assert.rejects(allocateAttributes(db.pool,f.account,env(f.next()),'rules.attributes',8,{constitution:2}),/INSTANCE_STILL_ACTIVE/);
  }finally{await db.close();}
});
test('late failure rolls back the projection, history, revision and receipt together',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await f.levels(3);const request=env(f.next());
    await db.pool.query("CREATE FUNCTION fail_attribute() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Late attribute failure'; END $$; CREATE TRIGGER fail_attribute BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_attribute()");
    await assert.rejects(allocateAttributes(db.pool,f.account,request,'rules.attributes',4,{dexterity:2}),/Late attribute failure/);
    assert.equal((await attributeView(db.pool,f.account)).attributes.dexterity,11);assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_attribute_choices')).rows[0].n,0);
    await db.pool.query('DROP TRIGGER fail_attribute ON audit_events');await allocateAttributes(db.pool,f.account,request,'rules.attributes',4,{dexterity:2});
  }finally{await db.close();}
});
test('SQL rejects projection edits, history edits and forged snapshots',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await f.levels(3);await allocateAttributes(db.pool,f.account,env(f.bump()),'rules.attributes',4,{dexterity:2});
    await assert.rejects(db.pool.query('UPDATE run_progression SET dexterity=11'),/inconsistent/);
    await assert.rejects(db.pool.query('UPDATE run_attribute_choices SET milestone=8'),/Immutable record/);await assert.rejects(db.pool.query('DELETE FROM run_attribute_choices'),/Immutable record/);
    await assert.rejects(db.pool.query("INSERT INTO run_attribute_choices(run_id,action_id,rules_id,milestone,allocation,after_attributes) VALUES($1,$2,'rules.attributes',8,$3,$4)",[f.run,randomUUID(),{constitution:2},{constitution:999}]),/server-derived/);
  }finally{await db.close();}
});
test('new publications cannot change pinned growth; Ascension resets effective attributes and preserves replay',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await f.levels(3);const request=env(f.bump());await allocateAttributes(db.pool,f.account,request,'rules.attributes',4,{dexterity:2});
    const newer=content();newer.version='attribute-newer';const e=newer.entities.find(e=>e.id==='rules.attributes')!;e.revision=2;(e.definition.mechanics!.attributeRules as AttributeRules).maximumScores.dexterity=40;await publishContent(db.pool,newer);
    assert.equal((await attributeView(db.pool,f.account)).rules[0]!.maximumScores.dexterity,30);
    await db.pool.query("UPDATE runs SET status='AFTERCORE' WHERE id=$1",[f.run]);await ascend(db.pool,f.account,env(f.bump(),'ASCEND'));
    assert.equal((await allocateAttributes(db.pool,f.account,request,'rules.attributes',4,{dexterity:2})).replayed,true);
    const next=await attributeView(db.pool,f.account);assert.equal(next.attributes.dexterity,10);assert.equal(next.attributes.luck,null);assert.deepEqual(next.choices,[]);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_attribute_choices')).rows[0].n,1);assert.equal((await integrityReport(db.pool)).attributeMismatches,0);
  }finally{await db.close();}
});
test('HTTP requires owned write scope and excludes client-supplied scores or caps',async()=>{
  const db=await testDatabase();let app:ReturnType<typeof buildApp>|undefined;try {
    const f=await fixture(db.pool);await enrollPassword(db.pool,f.account,'attribute_reader','a substantial attribute fixture password');const session=await requireLogin(db.pool,'attribute_reader','a substantial attribute fixture password','Fixture',true);
    app=buildApp(db.pool,{mode:'sessions',throttleKey:'e'.repeat(64)});const headers={authorization:`Bearer ${session.token}`},payload={...env(f.next()),rulesId:'rules.attributes',milestone:4,allocation:{dexterity:2}};
    assert.equal((await app.inject({url:'/api/v1/progression/attributes',headers})).statusCode,200);
    assert.equal((await app.inject({method:'POST',url:'/api/v1/progression/attributes',headers,payload})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:'/api/v1/progression/attributes',headers,payload:{...payload,maximumScores:{dexterity:999}}})).statusCode,400);
    assert.equal((await app.inject({url:'/api/v1/progression/attributes'})).statusCode,401);
  }finally{await app?.close();await db.close();}
});
test('restricted runtime records growth and preserves it at later class level-ups',async()=>{
  const db=await testDatabase(),role=`probe_${randomUUID().replaceAll('-','')}`;let created=false;try {
    const f=await fixture(db.pool);await f.levels(3);await db.pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);created=true;
    await db.pool.query(`GRANT USAGE ON SCHEMA ${db.schema} TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA ${db.schema} TO ${role}; GRANT UPDATE(security_epoch) ON accounts TO ${role};
      GRANT UPDATE ON runs,run_builds,run_progression,discoveries TO ${role}; GRANT INSERT,UPDATE ON run_class_levels TO ${role};
      GRANT INSERT ON run_attribute_choices,run_build_events,action_receipts,audit_events,outbox_events TO ${role}`);
    const client=await db.pool.connect();try {
      await client.query(`SET ROLE ${role}`);const restricted={connect:async()=>({query:client.query.bind(client),release:()=>{}})} as unknown as pg.Pool;
      await allocateAttributes(restricted,f.account,env(f.bump()),'rules.attributes',4,{dexterity:2});await levelUp(restricted,f.account,env(f.bump(),'LEVEL_UP'),'class.one');
      await assert.rejects(client.query('DELETE FROM run_attribute_choices'),(e:{code?:string})=>e.code==='42501');await assert.rejects(client.query('UPDATE run_progression SET dexterity=12'),/inconsistent/);
    }finally{await client.query('RESET ROLE');client.release();}
    assert.equal((await attributeView(db.pool,f.account)).attributes.dexterity,13);assert.equal((await integrityReport(db.pool)).attributeMismatches,0);
  }finally{if(created){await db.pool.query(`DROP OWNED BY ${role}`);await db.pool.query(`DROP ROLE ${role}`);}await db.close();}
});
test('upgrade preserves existing projections and audit detects corruption without inventing growth',async()=>{
  const db=await testDatabase(false);try {
    await db.pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql') && n<'018').sort()){
      const sql=await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8');await db.pool.query(sql);await db.pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
    }
    const f=await fixture(db.pool);await f.levels(3);const prior=(await db.pool.query('SELECT * FROM run_progression')).rows;await migrate(db.pool);
    assert.deepEqual((await db.pool.query('SELECT * FROM run_progression')).rows,prior);assert.equal((await attributeView(db.pool,f.account)).choices.length,0);
    await db.pool.query('ALTER TABLE run_progression DISABLE TRIGGER USER');await db.pool.query('UPDATE run_progression SET dexterity=13');assert.equal((await integrityReport(db.pool)).attributeMismatches,1);
  }finally{await db.close();}
});
test('SQL validates receipt ownership, action source and terminal-run restrictions',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool),other=await actor(db.pool);await f.levels(3);
    const insert=(c:{client:pg.PoolClient;actionId:string})=>c.client.query("INSERT INTO run_attribute_choices(run_id,action_id,rules_id,milestone,allocation) VALUES($1,$2,'rules.attributes',4,$3)",[f.run,c.actionId,{dexterity:2}]);
    await assert.rejects(executeAction(db.pool,other.account,env(0),{},async c=>{await insert(c);return {ok:true};}),/inconsistent/);
    await assert.rejects(executeAction(db.pool,f.account,env(f.next(),'WRONG_TYPE'),{},async c=>{await insert(c);return {ok:true};}),/inconsistent/);
    await assert.rejects(executeAction(db.pool,f.account,{...env(f.next()),authorizationSource:'AUTOMATION'}, {},async c=>{await insert(c);return {ok:true};}),/inconsistent/);
    await db.pool.query("UPDATE runs SET status='ABANDONED' WHERE id=$1",[f.run]);await assert.rejects(db.pool.query("INSERT INTO run_attribute_choices(run_id,action_id,rules_id,milestone,allocation) VALUES($1,$2,'rules.attributes',4,$3)",[f.run,randomUUID(),{dexterity:2}]),/configured normal run/);
  }finally{await db.close();}
});
test('publication rejects bad references, impossible budgets and invalid milestone/cap declarations',()=>{
  validateContent(content());for(const mutate of [(p:ContentPackage)=>{p.entities.find(e=>e.id==='rules.attributes')!.definition.dependencies=[];},(p:ContentPackage)=>{(p.entities.find(e=>e.id==='rules.attributes')!.definition.mechanics!.attributeRules as AttributeRules).maximumScores.strength=11;},(p:ContentPackage)=>{(p.entities.find(e=>e.id==='rules.attributes')!.definition.mechanics!.attributeRules as AttributeRules).milestones[0]!.allowedAttributes=['strength'];},(p:ContentPackage)=>{(p.entities.find(e=>e.id==='rules.attributes')!.definition.mechanics!.attributeRules as AttributeRules).milestones[0]!.level=999;}]){const p=content();mutate(p);assert.throws(()=>validateContent(p));}
  const p=content(true),r=p.entities.find(e=>e.id==='rules.attributes')!.definition.mechanics!.attributeRules as AttributeRules;
  assert.equal(attributeCapacity(r,{strength:12,dexterity:11,constitution:10,intelligence:9,wisdom:8,charisma:7,luck:10}),true);
  assert.equal(attributeCapacity(r,{strength:13,dexterity:11,constitution:10,intelligence:9,wisdom:8,charisma:7,luck:10},[4]),false);
});
