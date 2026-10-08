import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import type pg from 'pg';
import { actor,testDatabase } from './helpers.js';
import { buildPackage } from './build-fixture.js';
import { publishContent,validateContent,type ContentPackage } from '../src/domains/content.js';
import { advanceProficiency,proficiencyView } from '../src/domains/proficiencies.js';
import { startBuild,levelUp } from '../src/domains/builds.js';
import { executeAction,advanceRevision } from '../src/foundation/action.js';
import { beginEncounter,finishEncounter } from '../src/domains/encounters.js';
import { ascend } from '../src/domains/lifecycle.js';
import { integrityReport,unindexedForeignKeys } from '../src/foundation/integrity.js';
import { migrate } from '../src/database.js';
import { buildApp } from '../src/app.js';
import { enrollPassword,requireLogin } from '../src/auth/sessions.js';
const env=(expectedRevision:number,actionType='ADVANCE_PROFICIENCY')=>({requestId:randomUUID(),expectedRevision,actionType});
function content():ContentPackage {
  const p=structuredClone(buildPackage);p.version='proficiency-fixture';
  for(const e of p.entities.filter(e=>e.kind==='CLASS'))(e.definition.mechanics!.classProgression as {maximumNativeLevel:number}).maximumNativeLevel=25;
  (p.entities.find(e=>e.id==='encounter.build')!.definition.mechanics!.resolutionXP as {amount:string}).amount='2400';
  for(const [id,family,attr,cap] of [['skill.athletics','PHYSICAL','strength',5],['skill.medicine','CARE','wisdom',2],['skill.fortune','FORTUNE','luck',1]] as const)
    p.entities.push({id,kind:'SKILL',revision:1,schemaVersion:1,definition:{name:id,dependencies:[],public:{},mechanics:{skill:{version:1,family,defaultAttribute:attr,maximumRank:cap,access:'DISCOVERED'}}}});
  for(const id of ['rules.skills','rules.alternate'])p.entities.push({id,kind:'TUNING',revision:1,schemaVersion:1,definition:{name:id,dependencies:['rules.build','skill.athletics','skill.medicine'],public:{},mechanics:{proficiencyRules:{version:1,ruleset:'PROFICIENCY_CHOICES_V1',buildRulesId:'rules.build',skillIds:['skill.athletics','skill.medicine'],milestones:[1,3,5,7,9,11,13]}}}});
  return p;
}
async function fixture(pool:pg.Pool){
  const release=await publishContent(pool,content()),f=await actor(pool,release,10);
  for(const id of ['class.one','skill.athletics','skill.medicine','skill.fortune'])await pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,$2,'DISCOVERED')",[f.account,id]);
  await startBuild(pool,f.account,env(0,'START_BUILD'),'class.one','balanced');
  const begin=await executeAction(pool,f.account,env(1,'SKILL_FIXTURE'),{},async c=>({...await beginEncounter(c,'encounter.build',{}),revision:await advanceRevision(c)}));
  await executeAction(pool,f.account,env(2,'SKILL_FIXTURE'),{},async c=>({...await finishEncounter(c,begin.instanceId as string,0,'VICTORY',async()=>({})),revision:await advanceRevision(c)}));
  let revision=3;return {...f,next:()=>revision,bump:()=>revision++,levels:async(n:number)=>{for(let i=0;i<n;i++)await levelUp(pool,f.account,env(revision++,'LEVEL_UP'),'class.one');}};
}
const choose=(pool:pg.Pool,f:{account:string},revision:number,milestone:number,skill='skill.athletics',rules='rules.skills')=>advanceProficiency(pool,f.account,env(revision),rules,skill,milestone);
test('earned proficiency advances one rank, conserves Turns and concurrent replays pay once',async()=>{
  const db=await testDatabase();try{
    const f=await fixture(db.pool),request=env(f.bump());
    const result=await Promise.all(Array.from({length:4},()=>advanceProficiency(db.pool,f.account,request,'rules.skills','skill.athletics',1)));
    assert.equal(result.filter(r=>!r.replayed).length,1);assert.equal(result[0]!.rank,'NOVICE');
    assert.deepEqual((await db.pool.query('SELECT rank,skill_revision FROM run_skill_ranks')).rows,[{rank:1,skill_revision:1}]);
    assert.equal((await db.pool.query('SELECT turns FROM runs WHERE id=$1',[f.run])).rows[0].turns,9);
    await assert.rejects(advanceProficiency(db.pool,f.account,request,'rules.skills','skill.medicine',1),/REQUEST_ID_REUSED/);
    assert.deepEqual(await unindexedForeignKeys(db.pool),[]);assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
  }finally{await db.close();}
});
test('all six ranks and authored caps are enforced without changing class or attribute history',async()=>{
  const db=await testDatabase();try{
    const f=await fixture(db.pool);await f.levels(12);const baseline=(await db.pool.query('SELECT * FROM run_builds')).rows;
    assert.equal((await proficiencyView(db.pool,f.account)).options[0]!.rank,'UNTRAINED');
    for(const [n,m] of [1,3,5,7,9].entries()){const r=await choose(db.pool,f,f.bump(),m);assert.equal(r.rank,['NOVICE','TRAINED','EXPERT','MASTER','LEGENDARY'][n]);}
    await assert.rejects(choose(db.pool,f,f.next(),11),/SKILL_RANK_CAP_REACHED/);
    await choose(db.pool,f,f.bump(),11,'skill.medicine');await choose(db.pool,f,f.bump(),13,'skill.medicine');
    assert.deepEqual((await db.pool.query('SELECT * FROM run_builds')).rows,baseline);
    const view=await proficiencyView(db.pool,f.account);assert.equal(view.choices.length,7);assert.equal(view.selected.find(s=>s.skillId==='skill.athletics')!.rank,'LEGENDARY');
    assert.equal((await integrityReport(db.pool)).proficiencyMismatches,0);
  }finally{await db.close();}
});
test('committed levels, unique milestones, skill discovery, allowed skills and policy pinning are required',async()=>{
  const db=await testDatabase();try{
    const f=await fixture(db.pool);await assert.rejects(choose(db.pool,f,f.next(),3),/PROFICIENCY_MILESTONE_NOT_READY/);
    await assert.rejects(choose(db.pool,f,f.next(),2),/PROFICIENCY_MILESTONE_NOT_READY/);
    await assert.rejects(choose(db.pool,f,f.next(),1,'skill.fortune'),/SKILL_NOT_ALLOWED/);
    await db.pool.query("DELETE FROM discoveries WHERE account_id=$1 AND entity_id='skill.medicine'",[f.account]);
    await assert.rejects(choose(db.pool,f,f.next(),1,'skill.medicine'),/SKILL_NOT_DISCOVERED/);
    await choose(db.pool,f,f.bump(),1);await assert.rejects(choose(db.pool,f,f.next(),1),/PROFICIENCY_MILESTONE_USED/);
    await f.levels(2);await assert.rejects(choose(db.pool,f,f.next(),3,'skill.athletics','rules.alternate'),/PROFICIENCY_RULES_MISMATCH/);
    assert.ok((await proficiencyView(db.pool,f.account)).options.every(o=>o.rulesId==='rules.skills'));
  }finally{await db.close();}
});
test('old unspent milestones remain usable while skill ranks always advance sequentially',async()=>{
  const db=await testDatabase();try{
    const f=await fixture(db.pool);await f.levels(4);await choose(db.pool,f,f.bump(),5);await choose(db.pool,f,f.bump(),1);await choose(db.pool,f,f.bump(),3);
    assert.deepEqual((await proficiencyView(db.pool,f.account)).choices.map(c=>[c.milestone,c.afterRank]),[[5,'NOVICE'],[1,'TRAINED'],[3,'EXPERT']]);
    await levelUp(db.pool,f.account,env(f.bump(),'LEVEL_UP'),'class.one');assert.equal((await proficiencyView(db.pool,f.account)).selected[0]!.rank,'EXPERT');
  }finally{await db.close();}
});
test('competing requests serialize and active instances or automation cannot choose ranks',async()=>{
  const db=await testDatabase();try{
    const f=await fixture(db.pool),r=await Promise.allSettled([choose(db.pool,f,f.next(),1),choose(db.pool,f,f.next(),1,'skill.medicine')]);
    assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.match((r.find(x=>x.status==='rejected') as PromiseRejectedResult).reason.message,/STALE_REVISION/);f.bump();
    assert.throws(()=>advanceProficiency(db.pool,f.account,{...env(f.next()),authorizationSource:'PARSER'},'rules.skills','skill.athletics',3),/EXPLICIT_BUILD_CHOICE_REQUIRED/);
    await executeAction(db.pool,f.account,env(f.bump(),'SKILL_FIXTURE'),{},async c=>({...await beginEncounter(c,'encounter.build',{}),revision:await advanceRevision(c)}));
    await assert.rejects(choose(db.pool,f,f.next(),3),/INSTANCE_STILL_ACTIVE/);assert.ok((await proficiencyView(db.pool,f.account)).options.every(o=>o.blockedByInstance));
  }finally{await db.close();}
});
test('late failure rolls back ranks, journal, revision and receipt together',async()=>{
  const db=await testDatabase();try{
    const f=await fixture(db.pool),request=env(f.next());
    await db.pool.query("CREATE FUNCTION fail_skill() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Late skill failure'; END $$; CREATE TRIGGER fail_skill BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_skill()");
    await assert.rejects(advanceProficiency(db.pool,f.account,request,'rules.skills','skill.athletics',1),/Late skill failure/);
    assert.deepEqual((await proficiencyView(db.pool,f.account)).selected,[]);assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_proficiency_choices')).rows[0].n,0);
    assert.equal((await db.pool.query('SELECT revision FROM runs WHERE id=$1',[f.run])).rows[0].revision,f.next());
    await db.pool.query('DROP TRIGGER fail_skill ON audit_events');await advanceProficiency(db.pool,f.account,request,'rules.skills','skill.athletics',1);
  }finally{await db.close();}
});
test('SQL rejects forged pins, skipped ranks, unjournaled projections and edited history',async()=>{
  const db=await testDatabase();try{
    const f=await fixture(db.pool);await choose(db.pool,f,f.bump(),1);
    for(const sql of ['UPDATE run_proficiency_choices SET after_rank=2','DELETE FROM run_proficiency_choices','DELETE FROM run_skill_ranks'])await assert.rejects(db.pool.query(sql),/Immutable record/);
    await assert.rejects(db.pool.query('UPDATE run_skill_ranks SET rank=3'),/next immutable choice/);
    await assert.rejects(db.pool.query("INSERT INTO run_skill_ranks(run_id,skill_id,skill_revision,rank,last_choice_id) VALUES($1,'skill.medicine',1,1,$2)",[f.run,randomUUID()]),/immutable choice/);
    await assert.rejects(db.pool.query("INSERT INTO run_proficiency_choices(run_id,action_id,rules_id,skill_id,milestone,after_rank) VALUES($1,$2,'rules.skills','skill.medicine',3,3)",[f.run,randomUUID()]),/server-derived/);
  }finally{await db.close();}
});
test('Ascension resets run ranks, preserves old choices and old replay despite newer content',async()=>{
  const db=await testDatabase();try{
    const f=await fixture(db.pool),request=env(f.bump());await advanceProficiency(db.pool,f.account,request,'rules.skills','skill.athletics',1);
    const newer=content();newer.version='skills-newer';const s=newer.entities.find(e=>e.id==='skill.athletics')!;s.revision=2;s.definition.name='New athletics';await publishContent(db.pool,newer);
    assert.equal((await proficiencyView(db.pool,f.account)).selected[0]!.name,'skill.athletics');
    await db.pool.query("UPDATE runs SET status='AFTERCORE' WHERE id=$1",[f.run]);await ascend(db.pool,f.account,env(f.bump(),'ASCEND'));
    assert.deepEqual(await proficiencyView(db.pool,f.account),{selected:[],choices:[],options:[]});assert.equal((await advanceProficiency(db.pool,f.account,request,'rules.skills','skill.athletics',1)).replayed,true);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_proficiency_choices')).rows[0].n,1);assert.equal((await integrityReport(db.pool)).proficiencyMismatches,0);
  }finally{await db.close();}
});
test('HTTP enforces ownership, discovered reads, write scope and intent-only payloads',async()=>{
  const db=await testDatabase();let app:ReturnType<typeof buildApp>|undefined;try{
    const f=await fixture(db.pool),other=await actor(db.pool);await enrollPassword(db.pool,f.account,'skill_reader','a substantial skill fixture password');
    const session=await requireLogin(db.pool,'skill_reader','a substantial skill fixture password','Fixture',true);app=buildApp(db.pool,{mode:'sessions',throttleKey:'e'.repeat(64)});
    const headers={authorization:`Bearer ${session.token}`},payload={...env(f.next()),rulesId:'rules.skills',skillId:'skill.athletics',milestone:1};
    assert.equal((await app.inject({url:'/api/v1/progression/proficiencies',headers})).json().options.length,4);
    assert.equal((await app.inject({method:'POST',url:'/api/v1/progression/proficiencies',headers,payload})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:'/api/v1/progression/proficiencies',headers,payload:{...payload,rank:'LEGENDARY'}})).statusCode,400);
    assert.equal((await app.inject({url:'/api/v1/progression/proficiencies'})).statusCode,401);assert.deepEqual(await proficiencyView(db.pool,other.account),{selected:[],choices:[],options:[]});
    const writer=await requireLogin(db.pool,'skill_reader','a substantial skill fixture password','Writer');
    const write=await app.inject({method:'POST',url:'/api/v1/progression/proficiencies',headers:{authorization:`Bearer ${writer.token}`},payload});assert.equal(write.statusCode,200);assert.equal(write.json().rank,'NOVICE');
  }finally{await app?.close();await db.close();}
});
test('restricted runtime advances twice but cannot edit history or delete ranks',async()=>{
  const db=await testDatabase(),role=`probe_${randomUUID().replaceAll('-','')}`;let created=false;try{
    const f=await fixture(db.pool);await f.levels(2);await db.pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);created=true;
    await db.pool.query(`GRANT USAGE ON SCHEMA ${db.schema} TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA ${db.schema} TO ${role}; GRANT UPDATE(security_epoch) ON accounts TO ${role}; GRANT UPDATE ON runs,run_skill_ranks,run_builds,discoveries TO ${role}; GRANT INSERT ON run_proficiency_choices,run_skill_ranks,action_receipts,audit_events,outbox_events TO ${role}`);
    const client=await db.pool.connect();try{
      await client.query(`SET ROLE ${role}`);const restricted={connect:async()=>({query:client.query.bind(client),release:()=>{}})} as unknown as pg.Pool;
      await choose(restricted,f,f.bump(),1);await choose(restricted,f,f.bump(),3);
      await assert.rejects(client.query('DELETE FROM run_skill_ranks'),(e:{code?:string})=>e.code==='42501');await assert.rejects(client.query('UPDATE run_proficiency_choices SET milestone=5'),(e:{code?:string})=>e.code==='42501');
      await assert.rejects(client.query('UPDATE run_skill_ranks SET rank=5'),/immutable choice/);
    }finally{await client.query('RESET ROLE');client.release();}
    assert.equal((await integrityReport(db.pool)).proficiencyMismatches,0);
  }finally{if(created){await db.pool.query(`DROP OWNED BY ${role}`);await db.pool.query(`DROP ROLE ${role}`);}await db.close();}
});
test('upgrade preserves historical builds and inventories without fabricating proficiency ranks',async()=>{
  const db=await testDatabase(false);try{
    await db.pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql') && n<'019').sort()){
      const sql=await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8');await db.pool.query(sql);await db.pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
    }
    const release=await publishContent(db.pool,buildPackage),f=await actor(db.pool,release);const before=(await db.pool.query('SELECT * FROM run_progression')).rows;
    await migrate(db.pool);assert.deepEqual((await db.pool.query('SELECT * FROM run_progression')).rows,before);assert.deepEqual(await proficiencyView(db.pool,f.account),{selected:[],choices:[],options:[]});
    assert.equal((await integrityReport(db.pool)).proficiencyMismatches,0);
  }finally{await db.close();}
});
test('audit detects corrupted rank projections and missing ranks',async()=>{
  const db=await testDatabase();try{
    const f=await fixture(db.pool);await choose(db.pool,f,f.bump(),1);await db.pool.query('ALTER TABLE run_skill_ranks DISABLE TRIGGER USER');await db.pool.query('UPDATE run_skill_ranks SET rank=3');
    assert.equal((await integrityReport(db.pool)).proficiencyMismatches,1);await db.pool.query('DELETE FROM run_skill_ranks');assert.equal((await integrityReport(db.pool)).proficiencyMismatches,1);
  }finally{await db.close();}
});
test('SQL rejects foreign owner receipts, wrong action/source, terminal and unconfigured runs',async()=>{
  const db=await testDatabase();try{
    const f=await fixture(db.pool),other=await actor(db.pool);const insert=(c:{client:pg.PoolClient;actionId:string})=>c.client.query("INSERT INTO run_proficiency_choices(run_id,action_id,rules_id,skill_id,milestone) VALUES($1,$2,'rules.skills','skill.athletics',1)",[f.run,c.actionId]);
    await assert.rejects(executeAction(db.pool,other.account,env(0),{},async c=>{await insert(c);return {ok:true};}),/inconsistent/);
    await assert.rejects(executeAction(db.pool,f.account,env(f.next(),'WRONG_TYPE'),{},async c=>{await insert(c);return {ok:true};}),/inconsistent/);
    await assert.rejects(executeAction(db.pool,f.account,{...env(f.next()),authorizationSource:'AUTOMATION'},{},async c=>{await insert(c);return {ok:true};}),/inconsistent/);
    await assert.rejects(choose(db.pool,other,0,1),/BUILD_NOT_CONFIGURED/);
    await db.pool.query("UPDATE runs SET status='ABANDONED' WHERE id=$1",[f.run]);await assert.rejects(db.pool.query("INSERT INTO run_proficiency_choices(run_id,action_id,rules_id,skill_id,milestone) VALUES($1,$2,'rules.skills','skill.athletics',1)",[f.run,randomUUID()]),/configured normal run/);
  }finally{await db.close();}
});
test('publication rejects invalid ranks, implicit Luck, missing references, impossible budgets and late milestones',()=>{
  validateContent(content());
  const mutations=[(p:ContentPackage)=>{p.entities.find(e=>e.id==='skill.athletics')!.definition.mechanics!.skill={version:1,family:'PHYSICAL',defaultAttribute:'luck',maximumRank:5,access:'DISCOVERED'};},(p:ContentPackage)=>{p.entities.find(e=>e.id==='rules.skills')!.definition.dependencies=['rules.build'];},(p:ContentPackage)=>{(p.entities.find(e=>e.id==='rules.skills')!.definition.mechanics!.proficiencyRules as {milestones:number[]}).milestones=[3,1];},(p:ContentPackage)=>{(p.entities.find(e=>e.id==='rules.skills')!.definition.mechanics!.proficiencyRules as {milestones:number[]}).milestones=[999];},(p:ContentPackage)=>{(p.entities.find(e=>e.id==='rules.skills')!.definition.mechanics!.proficiencyRules as {milestones:number[]}).milestones=[1,2,3,4,5,6,7,8];},(p:ContentPackage)=>{(p.entities.find(e=>e.id==='skill.athletics')!.definition.mechanics!.skill as {maximumRank:number}).maximumRank=6;}];
  for(const mutate of mutations){const p=content();mutate(p);assert.throws(()=>validateContent(p));}
});
