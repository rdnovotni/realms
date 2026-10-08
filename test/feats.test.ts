import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { readdir,readFile } from 'node:fs/promises';
import type pg from 'pg';
import { actor,testDatabase } from './helpers.js';
import { buildPackage } from './build-fixture.js';
import { publishContent,validateContent,type ContentPackage } from '../src/domains/content.js';
import { startBuild,levelUp } from '../src/domains/builds.js';
import { chooseFeat,featView } from '../src/domains/feats.js';
import { executeAction,advanceRevision } from '../src/foundation/action.js';
import { beginEncounter,finishEncounter } from '../src/domains/encounters.js';
import { ascend } from '../src/domains/lifecycle.js';
import { integrityReport,unindexedForeignKeys } from '../src/foundation/integrity.js';
import { migrate } from '../src/database.js';
import { buildApp } from '../src/app.js';
import { enrollPassword,requireLogin } from '../src/auth/sessions.js';
const env=(expectedRevision:number,actionType='CHOOSE_FEAT')=>({requestId:randomUUID(),expectedRevision,actionType});
function content():ContentPackage {
  const p=structuredClone(buildPackage);p.version='feat-fixture';
  for(const e of p.entities.filter(e=>e.kind==='CLASS'))(e.definition.mechanics!.classProgression as {maximumNativeLevel:number}).maximumNativeLevel=25;
  (p.entities.find(e=>e.id==='encounter.build')!.definition.mechanics!.resolutionXP as {amount:string}).amount='2400';
  for(const id of ['rules.feats','rules.alternate'])p.entities.push({id,kind:'TUNING',revision:1,schemaVersion:1,definition:{name:id,dependencies:['rules.build'],public:{},mechanics:{featRules:{version:1,ruleset:'FEAT_CHOICES_V1',buildRulesId:'rules.build',milestones:id==='rules.feats'?[3,5,10,15,20,25]:[1]}}}});
  for(const [id,classes,feats,rulesId] of [
    ['feat.root',[],[],'rules.feats'],['feat.other',[],[],'rules.feats'],
    ['feat.child',[{classId:'class.one',nativeLevel:5}],['feat.root'],'rules.feats'],
    ['feat.second',[{classId:'class.two',nativeLevel:5}],[],'rules.feats'],
    ['feat.alternate',[],[],'rules.alternate']
  ] as [string,{classId:string;nativeLevel:number}[],string[],string][])p.entities.push({id,kind:'ABILITY',revision:1,schemaVersion:1,definition:{name:id,dependencies:[rulesId,...classes.map(c=>c.classId),...feats],public:{},mechanics:{feat:{version:1,rulesId,access:'DISCOVERED',antiTaxReview:'PASS',prerequisites:{classes,feats}}}}});
  return p;
}
async function fixture(pool:Awaited<ReturnType<typeof testDatabase>>['pool']) {
  const release=await publishContent(pool,content()),f=await actor(pool,release,10);
  for(const id of ['class.one','class.two','feat.root','feat.other','feat.child','feat.second','feat.alternate'])await pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,$2,'DISCOVERED')",[f.account,id]);
  await startBuild(pool,f.account,env(0,'START_BUILD'),'class.one','balanced');
  const begin=await executeAction(pool,f.account,env(1,'FEAT_FIXTURE'),{},async c=>({...await beginEncounter(c,'encounter.build',{}),revision:await advanceRevision(c)}));
  await executeAction(pool,f.account,env(2,'FEAT_FIXTURE'),{},async c=>({...await finishEncounter(c,begin.instanceId as string,0,'VICTORY',async()=>({})),revision:await advanceRevision(c)}));
  let revision=3;return {...f,next:()=>revision,bump:()=>revision++,levels:async(classId:string,n:number)=>{for(let i=0;i<n;i++)await levelUp(pool,f.account,env(revision++,'LEVEL_UP'),classId);}};
}
test('authored milestones require committed levels and retries select once without changing attributes',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await assert.rejects(chooseFeat(db.pool,f.account,env(f.next()),'feat.root',3),/FEAT_MILESTONE_NOT_READY/);
    await f.levels('class.one',2);const prior=(await db.pool.query('SELECT * FROM run_progression')).rows,request=env(f.bump());
    const results=await Promise.all(Array.from({length:4},()=>chooseFeat(db.pool,f.account,request,'feat.root',3)));
    assert.equal(results.filter(r=>!r.replayed).length,1);assert.deepEqual((await db.pool.query('SELECT * FROM run_progression')).rows,prior);
    assert.equal((await featView(db.pool,f.account)).selected[0]!.featId,'feat.root');
    await assert.rejects(chooseFeat(db.pool,f.account,env(f.next()),'feat.other',3),/FEAT_MILESTONE_USED/);
    assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));assert.deepEqual(await unindexedForeignKeys(db.pool),[]);
  }finally{await db.close();}
});
test('class and prior-feat prerequisites use native levels and actual earlier choices',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await f.levels('class.one',4);await f.levels('class.two',4);
    await assert.rejects(chooseFeat(db.pool,f.account,env(f.next()),'feat.second',3),/FEAT_PREREQUISITES_NOT_MET/);
    await assert.rejects(chooseFeat(db.pool,f.account,env(f.next()),'feat.child',5),/FEAT_PREREQUISITES_NOT_MET/);
    await chooseFeat(db.pool,f.account,env(f.bump()),'feat.root',5);await chooseFeat(db.pool,f.account,env(f.bump()),'feat.child',3);
    await f.levels('class.two',1);await chooseFeat(db.pool,f.account,env(f.bump()),'feat.second',10);
    assert.equal((await featView(db.pool,f.account)).selected.length,3);assert.equal((await integrityReport(db.pool)).featMismatches,0);
  }finally{await db.close();}
});
test('a feat cannot repeat and a second schedule cannot add slots to an existing choice policy',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await f.levels('class.one',4);await chooseFeat(db.pool,f.account,env(f.bump()),'feat.root',3);
    await assert.rejects(chooseFeat(db.pool,f.account,env(f.next()),'feat.root',5),/FEAT_ALREADY_CHOSEN/);
    await assert.rejects(chooseFeat(db.pool,f.account,env(f.next()),'feat.alternate',1),/FEAT_RULES_MISMATCH/);
    await assert.rejects(chooseFeat(db.pool,f.account,env(f.next()),'feat.other',4),/FEAT_MILESTONE_NOT_READY/);
    assert.ok(!(await featView(db.pool,f.account)).options.some(o=>o.featId==='feat.alternate'));
  }finally{await db.close();}
});
test('competing requests serialize; discovery and explicit manual intent are required',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await f.levels('class.one',2);
    await db.pool.query("DELETE FROM discoveries WHERE account_id=$1 AND entity_id='feat.child'",[f.account]);
    await assert.rejects(chooseFeat(db.pool,f.account,env(f.next()),'feat.child',3),/FEAT_NOT_DISCOVERED/);
    assert.throws(()=>chooseFeat(db.pool,f.account,{...env(f.next()),authorizationSource:'AUTOMATION'},'feat.root',3),/EXPLICIT_BUILD_CHOICE_REQUIRED/);
    const results=await Promise.allSettled(['feat.root','feat.other'].map(id=>chooseFeat(db.pool,f.account,env(f.next()),id,3)));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.match((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason.message,/STALE_REVISION/);
  }finally{await db.close();}
});
test('active encounters block choices and previews explain the stop',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await f.levels('class.one',2);
    await executeAction(db.pool,f.account,env(f.bump(),'FEAT_FIXTURE'),{},async c=>({...await beginEncounter(c,'encounter.build',{}),revision:await advanceRevision(c)}));
    assert.equal((await featView(db.pool,f.account)).options.find(o=>o.featId==='feat.root')!.eligibility,'ACTIVE_INSTANCE');
    await assert.rejects(chooseFeat(db.pool,f.account,env(f.next()),'feat.root',3),/INSTANCE_STILL_ACTIVE/);
  }finally{await db.close();}
});
test('late failure rolls back feat choice, projection, receipt and revision',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await f.levels('class.one',2);const request=env(f.next());
    await db.pool.query("CREATE FUNCTION fail_feat() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Late feat failure'; END $$; CREATE TRIGGER fail_feat BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_feat()");
    await assert.rejects(chooseFeat(db.pool,f.account,request,'feat.root',3),/Late feat failure/);
    assert.equal((await featView(db.pool,f.account)).selected.length,0);assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_feat_choices')).rows[0].n,0);
    await db.pool.query('DROP TRIGGER fail_feat ON audit_events');await chooseFeat(db.pool,f.account,request,'feat.root',3);
  }finally{await db.close();}
});
test('SQL rejects forged pins, unjournaled projections and edited history',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await f.levels('class.one',2);await chooseFeat(db.pool,f.account,env(f.bump()),'feat.root',3);
    for(const sql of ['UPDATE run_feat_choices SET level_at_choice=9','DELETE FROM run_feat_choices','UPDATE run_feats SET feat_id=\'feat.other\'','DELETE FROM run_feats'])await assert.rejects(db.pool.query(sql),/Immutable record/);
    await assert.rejects(db.pool.query("INSERT INTO run_feats(run_id,feat_id,feat_revision,milestone,choice_id) VALUES($1,'feat.other',1,5,$2)",[f.run,randomUUID()]),/immutable choice/);
    await assert.rejects(db.pool.query("INSERT INTO run_feat_choices(run_id,action_id,feat_id,milestone,level_at_choice) VALUES($1,$2,'feat.other',5,5)",[f.run,randomUUID()]),/server-derived/);
  }finally{await db.close();}
});
test('published changes cannot rewrite chosen feats; Ascension retains old history and replay',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);await f.levels('class.one',2);const request=env(f.bump());await chooseFeat(db.pool,f.account,request,'feat.root',3);
    const newer=content();newer.version='feat-newer';const e=newer.entities.find(e=>e.id==='feat.root')!;e.revision=2;e.definition.name='Changed';await publishContent(db.pool,newer);
    assert.equal((await featView(db.pool,f.account)).selected[0]!.name,'feat.root');await db.pool.query("UPDATE runs SET status='AFTERCORE' WHERE id=$1",[f.run]);
    await ascend(db.pool,f.account,env(f.bump(),'ASCEND'));assert.equal((await chooseFeat(db.pool,f.account,request,'feat.root',3)).replayed,true);
    assert.deepEqual(await featView(db.pool,f.account),{selected:[],options:[]});assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_feat_choices')).rows[0].n,1);
    assert.equal((await integrityReport(db.pool)).featMismatches,0);
  }finally{await db.close();}
});
test('HTTP limits reads to discovered options and denies read-only, unauthenticated and raw stat writes',async()=>{
  const db=await testDatabase();let app:ReturnType<typeof buildApp>|undefined;try {
    const f=await fixture(db.pool),other=await actor(db.pool);await enrollPassword(db.pool,f.account,'feat_reader','a substantial feat fixture password');
    const session=await requireLogin(db.pool,'feat_reader','a substantial feat fixture password','Fixture',true);app=buildApp(db.pool,{mode:'sessions',throttleKey:'d'.repeat(64)});
    const headers={authorization:`Bearer ${session.token}`},payload={...env(f.next()),featId:'feat.root',milestone:3};
    assert.equal((await app.inject({url:'/api/v1/progression/feats',headers})).json().options.length,5);
    assert.equal((await app.inject({method:'POST',url:'/api/v1/progression/feats',headers,payload})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:'/api/v1/progression/feats',headers,payload:{...payload,strength:30}})).statusCode,400);
    assert.equal((await app.inject({url:'/api/v1/progression/feats'})).statusCode,401);assert.deepEqual(await featView(db.pool,other.account),{selected:[],options:[]});
  }finally{await app?.close();await db.close();}
});
test('restricted runtime records feats but denies history edits and deletion',async()=>{
  const db=await testDatabase(),role=`probe_${randomUUID().replaceAll('-','')}`;let created=false;try {
    const f=await fixture(db.pool);await f.levels('class.one',2);await db.pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);created=true;
    await db.pool.query(`GRANT USAGE ON SCHEMA ${db.schema} TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA ${db.schema} TO ${role};
      GRANT UPDATE(security_epoch) ON accounts TO ${role}; GRANT UPDATE ON runs,run_builds,discoveries TO ${role};
      GRANT INSERT ON run_feat_choices,run_feats,action_receipts,audit_events,outbox_events TO ${role}`);
    const client=await db.pool.connect();try {
      await client.query(`SET ROLE ${role}`);const restricted={connect:async()=>({query:client.query.bind(client),release:()=>{}})} as unknown as pg.Pool;
      await chooseFeat(restricted,f.account,env(f.next()),'feat.root',3);
      await assert.rejects(client.query('DELETE FROM run_feats'),(e:{code?:string})=>e.code==='42501');await assert.rejects(client.query('UPDATE run_feat_choices SET milestone=5'),(e:{code?:string})=>e.code==='42501');
    }finally{await client.query('RESET ROLE');client.release();}
    assert.equal((await integrityReport(db.pool)).featMismatches,0);
  }finally{if(created){await db.pool.query(`DROP OWNED BY ${role}`);await db.pool.query(`DROP ROLE ${role}`);}await db.close();}
});
test('upgrade invents no choices and audit detects a corrupted projection',async()=>{
  const db=await testDatabase(false);try {
    await db.pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql') && n<'017').sort()){
      const sql=await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8');await db.pool.query(sql);await db.pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
    }
    const f=await fixture(db.pool);await f.levels('class.one',2);const before=(await db.pool.query('SELECT * FROM run_builds')).rows;await migrate(db.pool);
    assert.deepEqual((await db.pool.query('SELECT * FROM run_builds')).rows,before);assert.equal((await featView(db.pool,f.account)).selected.length,0);
    await chooseFeat(db.pool,f.account,env(f.next()),'feat.root',3);await db.pool.query('ALTER TABLE run_feats DISABLE TRIGGER USER');await db.pool.query("UPDATE run_feats SET feat_id='feat.other'");
    assert.equal((await integrityReport(db.pool)).featMismatches,1);
  }finally{await db.close();}
});
test('SQL requires owner receipts, correct action/source and live runs',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool),other=await actor(db.pool);await f.levels('class.one',2);
    const insert=(c:{client:pg.PoolClient;actionId:string})=>c.client.query("INSERT INTO run_feat_choices(run_id,action_id,feat_id,milestone) VALUES($1,$2,'feat.root',3)",[f.run,c.actionId]);
    await assert.rejects(executeAction(db.pool,other.account,env(0),{},async c=>{await insert(c);return {ok:true};}),/inconsistent/);
    await assert.rejects(executeAction(db.pool,f.account,env(f.next(),'WRONG_TYPE'),{},async c=>{await insert(c);return {ok:true};}),/inconsistent/);
    await assert.rejects(executeAction(db.pool,f.account,{...env(f.next()),authorizationSource:'AUTOMATION'}, {},async c=>{await insert(c);return {ok:true};}),/inconsistent/);
    await db.pool.query("UPDATE runs SET status='ABANDONED' WHERE id=$1",[f.run]);await assert.rejects(db.pool.query("INSERT INTO run_feat_choices(run_id,action_id,feat_id,milestone) VALUES($1,$2,'feat.root',3)",[f.run,randomUUID()]),/configured normal run/);
  }finally{await db.close();}
});
test('publication rejects feat taxes, bad milestones, undeclared references, cycles and excessive chains',()=>{
  validateContent(content());
  for(const mutate of [(p:ContentPackage)=>{(p.entities.find(e=>e.id==='feat.root')!.definition.mechanics!.feat as {antiTaxReview:string}).antiTaxReview='FAIL';},(p:ContentPackage)=>{(p.entities.find(e=>e.id==='rules.feats')!.definition.mechanics!.featRules as {milestones:number[]}).milestones=[5,3];},(p:ContentPackage)=>{p.entities.find(e=>e.id==='feat.child')!.definition.dependencies=['rules.feats'];},(p:ContentPackage)=>{(p.entities.find(e=>e.id==='rules.feats')!.definition.mechanics!.featRules as {milestones:number[]}).milestones=[999];}]){const p=content();mutate(p);assert.throws(()=>validateContent(p));}
  const chain=content();for(let n=1;n<=3;n++){const prior=n===1?'feat.root':`feat.chain${n-1}`;chain.entities.push({id:`feat.chain${n}`,kind:'ABILITY',revision:1,schemaVersion:1,definition:{name:'Chain',dependencies:['rules.feats',prior],public:{},mechanics:{feat:{version:1,rulesId:'rules.feats',access:'DISCOVERED',antiTaxReview:'PASS',prerequisites:{classes:[],feats:[prior]}}}}});if(n===2)validateContent(chain);}assert.throws(()=>validateContent(chain),/EXCESSIVE_FEAT_CHAIN/);
  const cycle=content(),root=cycle.entities.find(e=>e.id==='feat.root')!;root.definition.dependencies.push('feat.child');(root.definition.mechanics!.feat as {prerequisites:{feats:string[]}}).prerequisites.feats.push('feat.child');assert.throws(()=>validateContent(cycle),/CYCLIC_FEAT_PREREQUISITE/);
});
test('publication rejects prerequisite families exceeding available slots or legal native investment',()=>{
  const slots=content();(slots.entities.find(e=>e.id==='rules.feats')!.definition.mechanics!.featRules as {milestones:number[]}).milestones=[3];
  assert.throws(()=>validateContent(slots),/UNREACHABLE_FEAT_PREREQUISITES/);
  const levels=content(),root=levels.entities.find(e=>e.id==='feat.root')!,child=levels.entities.find(e=>e.id==='feat.child')!;
  root.definition.dependencies.push('class.two');(root.definition.mechanics!.feat as {prerequisites:{classes:{classId:string;nativeLevel:number}[]}}).prerequisites.classes=[{classId:'class.two',nativeLevel:20}];
  (child.definition.mechanics!.feat as {prerequisites:{classes:{classId:string;nativeLevel:number}[]}}).prerequisites.classes[0]!.nativeLevel=20;
  assert.throws(()=>validateContent(levels),/UNREACHABLE_FEAT_PREREQUISITES/);
  const classes=content(),cRoot=classes.entities.find(e=>e.id==='feat.root')!;cRoot.definition.dependencies.push('class.two');
  (cRoot.definition.mechanics!.feat as {prerequisites:{classes:{classId:string;nativeLevel:number}[]}}).prerequisites.classes=[{classId:'class.two',nativeLevel:1}];
  classes.entities.push({id:'feat.third',kind:'ABILITY',revision:1,schemaVersion:1,definition:{name:'Third',dependencies:['rules.feats','class.three','feat.child'],public:{},mechanics:{feat:{version:1,rulesId:'rules.feats',access:'DISCOVERED',antiTaxReview:'PASS',prerequisites:{classes:[{classId:'class.three',nativeLevel:1}],feats:['feat.child']}}}}});
  assert.throws(()=>validateContent(classes),/UNREACHABLE_FEAT_PREREQUISITES/);
});
