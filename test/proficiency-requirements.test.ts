import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import type pg from 'pg';
import { actor,testDatabase } from './helpers.js';
import { buildPackage } from './build-fixture.js';
import { publishContent,validateContent,type ContentPackage } from '../src/domains/content.js';
import { startBuild,levelUp } from '../src/domains/builds.js';
import { advanceProficiency } from '../src/domains/proficiencies.js';
import { chooseFeat,featView } from '../src/domains/feats.js';
import { setEquipment,equipmentView,emptyEquipment,type EquipmentPlan } from '../src/domains/equipment.js';
import { saveLoadout,applyLoadout } from '../src/domains/loadouts.js';
import { executeAction,advanceRevision } from '../src/foundation/action.js';
import { beginEncounter,finishEncounter } from '../src/domains/encounters.js';
import { grantItem } from '../src/domains/item-accounting.js';
import { ascend } from '../src/domains/lifecycle.js';
import { integrityReport,unindexedForeignKeys } from '../src/foundation/integrity.js';
import { migrate } from '../src/database.js';
import { buildApp } from '../src/app.js';
const env=(expectedRevision:number,actionType:string)=>({requestId:randomUUID(),expectedRevision,actionType});
function content():ContentPackage{
 const p=structuredClone(buildPackage);p.version='rank-gates-fixture';
 for(const e of p.entities.filter(e=>e.kind==='CLASS'))(e.definition.mechanics!.classProgression as {maximumNativeLevel:number}).maximumNativeLevel=25;
 (p.entities.find(e=>e.id==='encounter.build')!.definition.mechanics!.resolutionXP as {amount:string}).amount='2400';
 for(const id of ['skill.physical','skill.care'])p.entities.push({id,kind:'SKILL',revision:1,schemaVersion:1,definition:{name:id,dependencies:[],public:{},mechanics:{skill:{version:1,family:'PHYSICAL',defaultAttribute:'strength',maximumRank:5,access:'DISCOVERED'}}}});
 p.entities.push({id:'rules.skills',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'Skills',dependencies:['rules.build','skill.physical','skill.care'],public:{},mechanics:{proficiencyRules:{version:1,ruleset:'PROFICIENCY_CHOICES_V1',buildRulesId:'rules.build',skillIds:['skill.physical','skill.care'],milestones:[1,2,3,4,5,6,7,8]}}}});
 p.entities.push({id:'rules.feats',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'Feats',dependencies:['rules.build'],public:{},mechanics:{featRules:{version:1,ruleset:'FEAT_CHOICES_V1',buildRulesId:'rules.build',milestones:[1,3,5]}}}});
 for(const [id,skills,prior] of [['feat.trained',[{skillId:'skill.physical',minimumRank:2}],[]],['feat.master',[{skillId:'skill.physical',minimumRank:4}],['feat.trained']],['feat.multi',[{skillId:'skill.physical',minimumRank:2},{skillId:'skill.care',minimumRank:1}],[]]] as [string,{skillId:string;minimumRank:number}[],string[]][])
 p.entities.push({id,kind:'ABILITY',revision:1,schemaVersion:1,definition:{name:id,dependencies:['rules.feats',...skills.map(s=>s.skillId),...prior],public:{},mechanics:{feat:{version:1,rulesId:'rules.feats',access:'DISCOVERED',antiTaxReview:'PASS',prerequisites:{classes:[],feats:prior}},proficiencyRequirements:{version:1,skills}}}});
 for(const [id,policy] of [['item.tool','PRESERVE'],['item.bond','ACCOUNT_ON_ACTIVE_EQUIP']] as const)
 p.entities.push({id,kind:'ITEM',revision:1,schemaVersion:1,definition:{name:id,dependencies:['skill.physical'],public:{},mechanics:{inventory:{version:1,storageMode:'INSTANCE',category:'EQUIPMENT'},equipment:{version:policy==='PRESERVE'?1:2,slots:['MAIN_HAND'],hands:1,minimumLevel:1,bindingPolicy:policy},proficiencyRequirements:{version:1,skills:[{skillId:'skill.physical',minimumRank:2}]}}}});
 return p;
}
async function fixture(pool:pg.Pool){
 const release=await publishContent(pool,content()),f=await actor(pool,release,10,'CASUAL');
 for(const id of ['class.one','skill.physical','skill.care','feat.trained','feat.master','feat.multi'])await pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,$2,'DISCOVERED')",[f.account,id]);
 await startBuild(pool,f.account,env(0,'START_BUILD'),'class.one','balanced');
 const begin=await executeAction(pool,f.account,env(1,'GATE_FIXTURE'),{},async c=>({...await beginEncounter(c,'encounter.build',{}),revision:await advanceRevision(c)}));
 await executeAction(pool,f.account,env(2,'GATE_FIXTURE'),{},async c=>({...await finishEncounter(c,begin.instanceId as string,0,'VICTORY',async()=>({})),revision:await advanceRevision(c)}));
 const container=(await pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE run_id=$1 RETURNING id",[f.run])).rows[0].id;
 const items:Record<string,string>={};await executeAction(pool,f.account,env(3,'GATE_FIXTURE'),{},async c=>{for(const id of ['item.tool','item.bond'])items[id]=(await grantItem(c,id,{containerId:container,definitionId:id,quantity:'1',sourceCode:'FIXTURE'},'FIXTURE')).itemId;return {revision:await advanceRevision(c)};});
 let revision=4;return {...f,items,next:()=>revision,bump:()=>revision++,levels:async(n:number)=>{for(let i=0;i<n;i++)await levelUp(pool,f.account,env(revision++,'LEVEL_UP'),'class.one');},rank:async(m:number,id='skill.physical')=>advanceProficiency(pool,f.account,env(revision++,'ADVANCE_PROFICIENCY'),'rules.skills',id,m)};
}
const plan=(id:string,set:'A'|'B'='A'):EquipmentPlan=>({activeSet:'A',slots:[{set,slot:'MAIN_HAND',itemId:id}]});
test('feat rank gates use actual ranks and immutable proof, with duplicate-safe choice',async()=>{
 const db=await testDatabase();try{
  const f=await fixture(db.pool);await assert.rejects(chooseFeat(db.pool,f.account,env(f.next(),'CHOOSE_FEAT'),'feat.trained',1),/FEAT_PROFICIENCY_NOT_MET/);
  assert.equal((await featView(db.pool,f.account)).options.find(o=>o.featId==='feat.trained')!.eligibility,'PROFICIENCY_NOT_MET');
  await f.levels(1);await f.rank(1);await assert.rejects(chooseFeat(db.pool,f.account,env(f.next(),'CHOOSE_FEAT'),'feat.trained',1),/FEAT_PROFICIENCY_NOT_MET/);
  await f.rank(2);const request=env(f.bump(),'CHOOSE_FEAT'),r=await Promise.all(Array.from({length:3},()=>chooseFeat(db.pool,f.account,request,'feat.trained',1)));
  assert.equal(r.filter(x=>!x.replayed).length,1);const proof=(await db.pool.query('SELECT proficiency_evidence FROM run_feat_choices')).rows[0].proficiency_evidence;
  assert.equal(proof[0].rank,2);assert.equal(proof[0].minimumRank,2);assert.ok(proof[0].choiceId);assert.deepEqual(await unindexedForeignKeys(db.pool),[]);
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{await db.close();}
});
test('all skill requirements combine with original class and feat prerequisites',async()=>{
 const db=await testDatabase();try{
  const f=await fixture(db.pool);await f.levels(3);await f.rank(1);await f.rank(2);await assert.rejects(chooseFeat(db.pool,f.account,env(f.next(),'CHOOSE_FEAT'),'feat.multi',1),/FEAT_PROFICIENCY_NOT_MET/);
  await f.rank(3,'skill.care');await chooseFeat(db.pool,f.account,env(f.bump(),'CHOOSE_FEAT'),'feat.multi',1);
  await f.rank(4);await f.levels(1);await f.rank(5);await assert.rejects(chooseFeat(db.pool,f.account,env(f.next(),'CHOOSE_FEAT'),'feat.master',3),/FEAT_PREREQUISITES_NOT_MET/);
  await chooseFeat(db.pool,f.account,env(f.bump(),'CHOOSE_FEAT'),'feat.trained',3);await chooseFeat(db.pool,f.account,env(f.bump(),'CHOOSE_FEAT'),'feat.master',5);
  assert.equal((await integrityReport(db.pool)).proficiencyRequirementMismatches,0);
 }finally{await db.close();}
});
test('equipment gates both prepared sets before binding, and earned qualification permits normal setup',async()=>{
 const db=await testDatabase();try{
  const f=await fixture(db.pool);for(const set of ['A','B'] as const)await assert.rejects(setEquipment(db.pool,f.account,env(f.next(),'SET_EQUIPMENT'),plan(f.items['item.bond']!,set)),/EQUIPMENT_PROFICIENCY_NOT_MET/);
  assert.equal((await db.pool.query("SELECT binding FROM inventory_items WHERE id=$1",[f.items['item.bond']])).rows[0].binding,'TRADEABLE');
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM equipment_events')).rows[0].n,0);
  await f.levels(1);await f.rank(1);await f.rank(2);const p=plan(f.items['item.bond']!,'B');await setEquipment(db.pool,f.account,env(f.bump(),'SET_EQUIPMENT'),p);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM item_binding_events')).rows[0].n,0);
  await setEquipment(db.pool,f.account,env(f.bump(),'SET_EQUIPMENT'),{...p,activeSet:'B'});assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM item_binding_events')).rows[0].n,1);
  const rows=(await db.pool.query('SELECT proficiency_evidence FROM equipment_events ORDER BY revision')).rows;assert.equal(rows[0].proficiency_evidence[f.items['item.bond']!][0].rank,2);
  assert.equal((await integrityReport(db.pool)).proficiencyRequirementMismatches,0);
 }finally{await db.close();}
});
test('saved loadouts use the same rank gate and proof; sharing an item records one proof',async()=>{
 const db=await testDatabase();try{
  const f=await fixture(db.pool);await f.levels(1);await f.rank(1);await f.rank(2);
  const p:EquipmentPlan={activeSet:'A',slots:[{set:'A',slot:'MAIN_HAND',itemId:f.items['item.tool']!},{set:'B',slot:'MAIN_HAND',itemId:f.items['item.tool']!}]};
  await setEquipment(db.pool,f.account,env(f.bump(),'SET_EQUIPMENT'),p);await saveLoadout(db.pool,f.account,env(f.bump(),'SAVE_LOADOUT'),'trained','Trained tool');await setEquipment(db.pool,f.account,env(f.bump(),'SET_EQUIPMENT'),emptyEquipment());
  await applyLoadout(db.pool,f.account,env(f.bump(),'SET_EQUIPMENT'),'trained');assert.equal((await equipmentView(db.pool,f.account)).slots.length,2);
  const evidence=(await db.pool.query('SELECT proficiency_evidence FROM equipment_events ORDER BY revision DESC LIMIT 1')).rows[0].proficiency_evidence;assert.equal(Object.keys(evidence).length,1);
 }finally{await db.close();}
});
test('later proficiency gains leave original evidence unchanged and Ascension retains it',async()=>{
 const db=await testDatabase();try{
  const f=await fixture(db.pool);await f.levels(2);await f.rank(1);await f.rank(2);await chooseFeat(db.pool,f.account,env(f.bump(),'CHOOSE_FEAT'),'feat.trained',1);await setEquipment(db.pool,f.account,env(f.bump(),'SET_EQUIPMENT'),plan(f.items['item.tool']!));
  const prior=(await db.pool.query('SELECT proficiency_evidence FROM run_feat_choices')).rows;await f.rank(3);assert.deepEqual((await db.pool.query('SELECT proficiency_evidence FROM run_feat_choices')).rows,prior);
  await db.pool.query("UPDATE runs SET status='AFTERCORE' WHERE id=$1",[f.run]);await ascend(db.pool,f.account,env(f.bump(),'ASCEND'));assert.deepEqual((await equipmentView(db.pool,f.account)).slots,[]);
  assert.deepEqual((await db.pool.query('SELECT proficiency_evidence FROM run_feat_choices')).rows,prior);assert.equal((await integrityReport(db.pool)).proficiencyRequirementMismatches,0);
 }finally{await db.close();}
});
test('SQL requires earned ranks and refuses caller-supplied evidence for feat and equipment events',async()=>{
 const db=await testDatabase();try{
  const f=await fixture(db.pool);
  await assert.rejects(executeAction(db.pool,f.account,env(f.next(),'CHOOSE_FEAT'),{},async c=>{await c.client.query("INSERT INTO run_feat_choices(run_id,action_id,feat_id,milestone) VALUES($1,$2,'feat.trained',1)",[f.run,c.actionId]);return {ok:true};}),/Proficiency requirements/);
  const insert=(proof?:object)=>executeAction(db.pool,f.account,env(f.next(),'SET_EQUIPMENT'),{},async c=>{await c.client.query("INSERT INTO equipment_events(action_id,run_id,revision,before_state,after_state,reason,proficiency_evidence) VALUES($1,$2,1,equipment_snapshot($2),$3,'PLAYER_SETUP',$4)",[c.actionId,f.run,plan(f.items['item.tool']!),proof??null]);return {ok:true};});
  await assert.rejects(insert(),/Proficiency requirements/);await assert.rejects(insert({}),/server-derived/);
  await assert.rejects(db.pool.query("INSERT INTO run_feat_choices(run_id,action_id,feat_id,milestone,proficiency_evidence) VALUES($1,$2,'feat.trained',1,'[]')",[f.run,randomUUID()]),/server-derived/);
 }finally{await db.close();}
});
test('late failures roll back equipment proof, binding, setup and receipts together',async()=>{
 const db=await testDatabase();try{
  const f=await fixture(db.pool);await f.levels(1);await f.rank(1);await f.rank(2);const request=env(f.next(),'SET_EQUIPMENT');
  await db.pool.query("CREATE FUNCTION fail_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Late gate failure'; END $$; CREATE TRIGGER fail_gate BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_gate()");
  await assert.rejects(setEquipment(db.pool,f.account,request,plan(f.items['item.bond']!)),/Late gate failure/);assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM equipment_events')).rows[0].n,0);assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM item_binding_events')).rows[0].n,0);
  await db.pool.query('DROP TRIGGER fail_gate ON audit_events');await setEquipment(db.pool,f.account,request,plan(f.items['item.bond']!));assert.equal((await integrityReport(db.pool)).proficiencyRequirementMismatches,0);
 }finally{await db.close();}
});
test('new content cannot change pinned requirements, and hidden skill requirements are not leaked by feat reads',async()=>{
 const db=await testDatabase();try{
  const f=await fixture(db.pool),p=content();p.version='gates-newer';const e=p.entities.find(e=>e.id==='feat.trained')!;e.revision=2;(e.definition.mechanics!.proficiencyRequirements as {skills:{minimumRank:number}[]}).skills[0]!.minimumRank=1;await publishContent(db.pool,p);
  await f.rank(1);await assert.rejects(chooseFeat(db.pool,f.account,env(f.next(),'CHOOSE_FEAT'),'feat.trained',1),/FEAT_PROFICIENCY_NOT_MET/);
  await db.pool.query("DELETE FROM discoveries WHERE account_id=$1 AND entity_id='skill.care'",[f.account]);const view=await featView(db.pool,f.account);assert.ok(!JSON.stringify(view).includes('skill.care'));
 }finally{await db.close();}
});
test('restricted runtime enforces gates and records SQL-derived evidence without new write privileges',async()=>{
 const db=await testDatabase(),role=`probe_${randomUUID().replaceAll('-','')}`;let created=false;try{
  const f=await fixture(db.pool);await f.levels(1);await f.rank(1);await f.rank(2);await db.pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);created=true;
  await db.pool.query(`GRANT USAGE ON SCHEMA ${db.schema} TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA ${db.schema} TO ${role}; GRANT UPDATE(security_epoch) ON accounts TO ${role}; GRANT UPDATE ON runs,run_builds,discoveries,inventory_items,inventory_containers,state_scopes,run_progression TO ${role}; GRANT INSERT ON run_feat_choices,run_feats,equipment_events,item_binding_events,action_receipts,audit_events,outbox_events TO ${role}; GRANT INSERT,UPDATE ON run_equipment TO ${role}; GRANT INSERT,DELETE ON equipment_slots TO ${role}`);
  const client=await db.pool.connect();try{await client.query(`SET ROLE ${role}`);const restricted={connect:async()=>({query:client.query.bind(client),release:()=>{}})} as unknown as pg.Pool;
   await chooseFeat(restricted,f.account,env(f.bump(),'CHOOSE_FEAT'),'feat.trained',1);await setEquipment(restricted,f.account,env(f.bump(),'SET_EQUIPMENT'),plan(f.items['item.bond']!));await assert.rejects(client.query("UPDATE equipment_events SET proficiency_evidence='{}'"),(e:{code?:string})=>e.code==='42501');
  }finally{await client.query('RESET ROLE');client.release();}assert.equal((await integrityReport(db.pool)).proficiencyRequirementMismatches,0);
 }finally{if(created){await db.pool.query(`DROP OWNED BY ${role}`);await db.pool.query(`DROP ROLE ${role}`);}await db.close();}
});
test('audit detects missing, foreign, malformed or rewritten prerequisite evidence',async()=>{
 const db=await testDatabase();try{
  const f=await fixture(db.pool);await f.levels(1);await f.rank(1);await f.rank(2);await chooseFeat(db.pool,f.account,env(f.bump(),'CHOOSE_FEAT'),'feat.trained',1);
  const original=(await db.pool.query('SELECT proficiency_evidence FROM run_feat_choices')).rows[0].proficiency_evidence;
  await db.pool.query('ALTER TABLE run_feat_choices DISABLE TRIGGER USER');for(const evidence of [null,[],[{...original[0],rank:5}],[{...original[0],choiceId:randomUUID()}],[{...original[0],extra:true}]]){await db.pool.query('UPDATE run_feat_choices SET proficiency_evidence=$1',[evidence===null?null:JSON.stringify(evidence)]);assert.equal((await integrityReport(db.pool)).proficiencyRequirementMismatches,1);}
 }finally{await db.close();}
});
test('upgrade preserves old event fields and leaves historical evidence unknown',async()=>{
 const db=await testDatabase(false);try{
  await db.pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql') && n<'020').sort()){const sql=await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8');await db.pool.query(sql);await db.pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);}
  const p=content();for(const e of p.entities)if(e.definition.mechanics)delete e.definition.mechanics.proficiencyRequirements;
  const release=await publishContent(db.pool,p),f=await actor(db.pool,release);await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,'class.one','DISCOVERED'),($1,'feat.trained','DISCOVERED')",[f.account]);await startBuild(db.pool,f.account,env(0,'START_BUILD'),'class.one','balanced');await chooseFeat(db.pool,f.account,env(1,'CHOOSE_FEAT'),'feat.trained',1);
  const before=(await db.pool.query('SELECT to_jsonb(f) AS row FROM run_feat_choices f')).rows;await migrate(db.pool);assert.deepEqual((await db.pool.query("SELECT to_jsonb(f)-'proficiency_evidence' AS row FROM run_feat_choices f")).rows,before);assert.equal((await db.pool.query('SELECT proficiency_evidence FROM run_feat_choices')).rows[0].proficiency_evidence,null);
  assert.equal((await integrityReport(db.pool)).proficiencyRequirementMismatches,0);
 }finally{await db.close();}
});
test('publication rejects malformed, undeclared and unreachable gates, including incompatible feat-family budgets',()=>{
 validateContent(content());const mutations=[(p:ContentPackage)=>{(p.entities.find(e=>e.id==='feat.trained')!.definition.mechanics!.proficiencyRequirements as {skills:{minimumRank:number}[]}).skills[0]!.minimumRank=6;},(p:ContentPackage)=>{p.entities.find(e=>e.id==='feat.trained')!.definition.dependencies=['rules.feats'];},(p:ContentPackage)=>{(p.entities.find(e=>e.id==='rules.skills')!.definition.mechanics!.proficiencyRules as {skillIds:string[]}).skillIds=['skill.care'];},(p:ContentPackage)=>{(p.entities.find(e=>e.id==='rules.skills')!.definition.mechanics!.proficiencyRules as {milestones:number[]}).milestones=[1];},(p:ContentPackage)=>{p.entities.find(e=>e.id==='class.one')!.definition.mechanics!.proficiencyRequirements={version:1,skills:[{skillId:'skill.physical',minimumRank:1}]};}];
 for(const mutate of mutations){const p=content();mutate(p);assert.throws(()=>validateContent(p));}
 const family=content();(family.entities.find(e=>e.id==='rules.skills')!.definition.mechanics!.proficiencyRules as {milestones:number[]}).milestones=[1,2,3,4,5];const master=family.entities.find(e=>e.id==='feat.master')!;master.definition.dependencies.push('skill.care');(master.definition.mechanics!.proficiencyRequirements as {skills:{skillId:string;minimumRank:number}[]}).skills=[{skillId:'skill.care',minimumRank:4}];assert.throws(()=>validateContent(family),/UNREACHABLE_PROFICIENCY_REQUIREMENT/);
});
test('HTTP returns safe prerequisite failures and rejects forged evidence without granting ranks',async()=>{
 const db=await testDatabase();let app:ReturnType<typeof buildApp>|undefined;try{
  const f=await fixture(db.pool),token='gate-fixture-private-token-'.repeat(2);app=buildApp(db.pool,{mode:'development',accountId:f.account,token});const headers={authorization:`Bearer ${token}`};
  const feat={...env(f.next(),'CHOOSE_FEAT'),featId:'feat.trained',milestone:1},equipment={...env(f.next(),'SET_EQUIPMENT'),...plan(f.items['item.tool']!)};
  const denied=await app.inject({method:'POST',url:'/api/v1/progression/feats',headers,payload:feat});assert.equal(denied.statusCode,409);assert.equal(denied.json().error,'FEAT_PROFICIENCY_NOT_MET');
  const gear=await app.inject({method:'POST',url:'/api/v1/equipment',headers,payload:equipment});assert.equal(gear.statusCode,409);assert.equal(gear.json().error,'EQUIPMENT_PROFICIENCY_NOT_MET');
  for(const [url,payload] of [['/api/v1/progression/feats',feat],['/api/v1/equipment',equipment]] as const)assert.equal((await app.inject({method:'POST',url,headers,payload:{...payload,proficiency_evidence:[]}})).statusCode,400);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_skill_ranks')).rows[0].n,0);assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM equipment_events')).rows[0].n,0);
 }finally{await app?.close();await db.close();}
});
test('a feat without its own gate still requires a reachable union of its prerequisite-family ranks',()=>{
 const p=content();p.entities=p.entities.filter(e=>e.id!=='feat.multi');const rules=p.entities.find(e=>e.id==='rules.skills')!.definition.mechanics!.proficiencyRules as {skillIds:string[];milestones:number[]};rules.skillIds=['skill.physical'];rules.milestones=[1,2,3,4,5];
 p.entities.push({id:'rules.care',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'Care schedule',dependencies:['rules.build','skill.care'],public:{},mechanics:{proficiencyRules:{version:1,ruleset:'PROFICIENCY_CHOICES_V1',buildRulesId:'rules.build',skillIds:['skill.care'],milestones:[1,2,3,4,5]}}}});
 p.entities.push({id:'feat.care',kind:'ABILITY',revision:1,schemaVersion:1,definition:{name:'Care feat',dependencies:['rules.feats','skill.care'],public:{},mechanics:{feat:{version:1,rulesId:'rules.feats',access:'DISCOVERED',antiTaxReview:'PASS',prerequisites:{classes:[],feats:[]}},proficiencyRequirements:{version:1,skills:[{skillId:'skill.care',minimumRank:2}]}}}});
 validateContent(p);
 p.entities.push({id:'feat.joint',kind:'ABILITY',revision:1,schemaVersion:1,definition:{name:'Joint feat',dependencies:['rules.feats','feat.care','feat.trained'],public:{},mechanics:{feat:{version:1,rulesId:'rules.feats',access:'DISCOVERED',antiTaxReview:'PASS',prerequisites:{classes:[],feats:['feat.care','feat.trained']}}}}});
 assert.throws(()=>validateContent(p),/UNREACHABLE_PROFICIENCY_REQUIREMENT/);
});
