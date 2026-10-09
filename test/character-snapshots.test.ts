import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import type pg from 'pg';
import { actor,testDatabase } from './helpers.js';
import { buildPackage } from './build-fixture.js';
import { publishContent,validateContent,type ContentPackage } from '../src/domains/content.js';
import { startBuild,levelUp } from '../src/domains/builds.js';
import { chooseFeat } from '../src/domains/feats.js';
import { chooseSubclass } from '../src/domains/subclasses.js';
import { allocateAttributes } from '../src/domains/attributes.js';
import { setEquipment } from '../src/domains/equipment.js';
import { grantItem } from '../src/domains/item-accounting.js';
import { executeAction,advanceRevision } from '../src/foundation/action.js';
import { beginEncounter,finishEncounter,saveEncounterCheckpoint } from '../src/domains/encounters.js';
import { readCharacterSnapshot } from '../src/domains/character-snapshots.js';
import { integrityReport,unindexedForeignKeys } from '../src/foundation/integrity.js';
import { migrate } from '../src/database.js';
const env=(expectedRevision:number,actionType='SNAPSHOT_FIXTURE')=>({requestId:randomUUID(),expectedRevision,actionType});
function content():ContentPackage {
  const p=structuredClone(buildPackage);p.version='character-snapshot-fixture';
  const one=p.entities.find(e=>e.id==='class.one')!;
  (one.definition.mechanics!.classProgression as {maximumNativeLevel:number}).maximumNativeLevel=25;
  one.definition.mechanics!.combatModifiers={version:1,modifiers:[{stat:'armor',amount:2,minimumNativeLevel:1},{stat:'armor',amount:5,minimumNativeLevel:2}]};
  p.entities.push({id:'rules.character',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'Character profile',dependencies:['rules.build'],public:{},mechanics:{characterProfile:{version:1,ruleset:'CHARACTER_STATS_V1',buildRulesId:'rules.build',base:{maxHealth:100,maxMana:20,accuracy:5,evasion:12,armor:2,initiative:3,attackMin:4,attackMax:8},scaling:[{attribute:'strength',stat:'accuracy',baseline:10,divisor:2,amount:1}]}}}},
    {id:'encounter.character',kind:'ENCOUNTER',revision:1,schemaVersion:1,definition:{name:'Character encounter',dependencies:['rules.character'],public:{},mechanics:{encounter:{version:1,turnCost:1},characterProfileId:'rules.character'}}},
    {id:'rules.feats',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'Feat policy',dependencies:['rules.build'],public:{},mechanics:{featRules:{version:1,ruleset:'FEAT_CHOICES_V1',buildRulesId:'rules.build',milestones:[1]}}}},
    {id:'feat.vigor',kind:'ABILITY',revision:1,schemaVersion:1,definition:{name:'Vigor',dependencies:['rules.feats'],public:{},mechanics:{feat:{version:1,rulesId:'rules.feats',access:'DISCOVERED',antiTaxReview:'PASS',prerequisites:{classes:[],feats:[]}},combatModifiers:{version:1,modifiers:[{stat:'maxHealth',amount:20,minimumNativeLevel:0}]}}}},
    {id:'subclass.guard',kind:'ABILITY',revision:1,schemaVersion:1,definition:{name:'Guard',dependencies:['class.one'],public:{},mechanics:{subclass:{version:1,ruleset:'SUBCLASS_CHOICE_V1',classId:'class.one',unlockNativeLevel:5,access:'DISCOVERED'},combatModifiers:{version:1,modifiers:[{stat:'armor',amount:4,minimumNativeLevel:0}]}}}},
    {id:'rules.attributes',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'Attributes',dependencies:['rules.build'],public:{},mechanics:{attributeRules:{version:1,ruleset:'ATTRIBUTE_MILESTONES_V1',buildRulesId:'rules.build',maximumScores:{strength:30,dexterity:30,constitution:30,intelligence:30,wisdom:30,charisma:30,luck:30},milestones:[{level:1,points:2,allowedAttributes:['strength']}]}}}});
  for(const [name,slots,hands,modifiers] of [
    ['sword',['MAIN_HAND'],2,[{stat:'attackMin',amount:2,minimumNativeLevel:0},{stat:'attackMax',amount:2,minimumNativeLevel:0}]],
    ['backup',['MAIN_HAND'],2,[{stat:'accuracy',amount:100,minimumNativeLevel:0}]],
    ['ring',['RING_1','RING_2'],0,[{stat:'maxHealth',amount:5,minimumNativeLevel:0}]]
  ] as [string,string[],number,{stat:string;amount:number;minimumNativeLevel:number}[]][])p.entities.push({id:`item.${name}`,kind:'ITEM',revision:1,schemaVersion:1,definition:{name,dependencies:[],public:{},mechanics:{inventory:{version:1,storageMode:'INSTANCE',category:'EQUIPMENT'},equipment:{version:1,slots,hands,minimumLevel:1,bindingPolicy:'PRESERVE'},combatModifiers:{version:1,modifiers}}}});
  return p;
}
async function fixture(pool:pg.Pool,pkg=content()) {
  const release=await publishContent(pool,pkg),f=await actor(pool,release,20);
  for(const id of ['class.one','feat.vigor','subclass.guard'])await pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,$2,'DISCOVERED')",[f.account,id]);
  let revision=0;const next=(type='SNAPSHOT_FIXTURE')=>env(revision++,type);
  await startBuild(pool,f.account,next('START_BUILD'),'class.one','balanced');
  await chooseFeat(pool,f.account,next('CHOOSE_FEAT'),'feat.vigor',1);
  const container=(await pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE run_id=$1 RETURNING id",[f.run])).rows[0].id;
  const items:Record<string,string>={};
  await executeAction(pool,f.account,next(),{},async c=>{for(const key of ['sword','backup','ring1','ring2'])items[key]=(await grantItem(c,key,{containerId:container,definitionId:`item.${key.startsWith('ring')?'ring':key}`,quantity:'1',sourceCode:'FIXTURE'},'FIXTURE')).itemId;return {revision:await advanceRevision(c)};});
  await setEquipment(pool,f.account,next('SET_EQUIPMENT'),{activeSet:'A',slots:[{set:'A',slot:'MAIN_HAND',itemId:items.sword!},{set:'B',slot:'MAIN_HAND',itemId:items.backup!},{set:'WORN',slot:'RING_1',itemId:items.ring1!},{set:'WORN',slot:'RING_2',itemId:items.ring2!}]});
  await allocateAttributes(pool,f.account,next('ALLOCATE_ATTRIBUTES'),'rules.attributes',1,{strength:2});
  return {...f,release,items,next,current:()=>revision};
}
const begin=(pool:pg.Pool,f:{account:string},request:ReturnType<typeof env>,id='encounter.character')=>executeAction(pool,f.account,request,{},async c=>({...await beginEncounter(c,id,{}),revision:await advanceRevision(c)}));
async function snapshot(pool:pg.Pool,id:string,run:string){const client=await pool.connect();try{return await readCharacterSnapshot(client,id,run);}finally{client.release();}}
test('encounter start freezes grown attributes, selected feat/class and active/worn item effects',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool),request=f.next();
    const results=await Promise.all(Array.from({length:3},()=>begin(db.pool,f,request)));
    assert.equal(results.filter(r=>!r.replayed).length,1);
    const id=results[0]!.instanceId as string,s=await snapshot(db.pool,id,f.run);
    assert.equal(s.derived.stats.maxHealth,130);assert.equal(s.derived.stats.accuracy,7);assert.equal(s.derived.stats.armor,4);assert.equal(s.derived.stats.attackMin,6);
    assert.equal(s.inputs.attributes.strength,14);assert.ok(s.inputs.attributeChoiceId);assert.ok(s.inputs.equipmentEventId);
    assert.equal(s.inputs.sources.filter(x=>x.entityId==='item.ring').length,2);assert.equal(s.inputs.sources.filter(x=>x.entityId==='item.backup').length,0);
    await executeAction(db.pool,f.account,f.next(),{},async c=>({...await saveEncounterCheckpoint(c,id,0,{round:1}),revision:await advanceRevision(c)}));
    assert.deepEqual(await snapshot(db.pool,id,f.run),s);
    assert.deepEqual(await unindexedForeignKeys(db.pool),[]);assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
  }finally{await db.close();}
});
test('snapshots remain immutable and SQL rejects forged derived totals, sources and foreign runs',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool),started=await begin(db.pool,f,f.next()),id=started.instanceId as string,s=await snapshot(db.pool,id,f.run);
    await assert.rejects(db.pool.query('UPDATE character_encounter_snapshots SET derived=derived'),/Immutable record/);
    await assert.rejects(db.pool.query('DELETE FROM character_encounter_snapshots'),/Immutable record/);
    await assert.rejects(db.pool.query('INSERT INTO character_encounter_snapshots(instance_id,run_id,profile_id,inputs,derived) VALUES($1,$2,$3,$4,$5)',[id,f.run,'rules.character',s.inputs,{...s.derived,stats:{...s.derived.stats,maxHealth:999}}]),/stats are server-derived/);
    await assert.rejects(db.pool.query('INSERT INTO character_encounter_snapshots(instance_id,run_id,profile_id,inputs,derived) VALUES($1,$2,$3,$4,$5)',[id,f.run,'rules.character',{...s.inputs,sources:[]},s.derived]),/inputs are server-derived/);
    const other=await actor(db.pool,f.release);
    await assert.rejects(snapshot(db.pool,id,other.run),/CHARACTER_SNAPSHOT_NOT_FOUND/);
    await assert.rejects(db.pool.query('INSERT INTO character_encounter_snapshots(instance_id,run_id,profile_id,inputs,derived) VALUES($1,$2,$3,$4,$5)',[id,other.run,'rules.character',s.inputs,s.derived]),/match its opted-in encounter/);
  }finally{await db.close();}
});
test('late failure rolls back snapshot, encounter, Turn spend and receipt together',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool),request=f.next(),turns=(await db.pool.query('SELECT turns FROM runs WHERE id=$1',[f.run])).rows[0].turns;
    await db.pool.query("CREATE FUNCTION fail_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Late snapshot failure'; END $$; CREATE TRIGGER fail_snapshot BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_snapshot()");
    await assert.rejects(begin(db.pool,f,request),/Late snapshot failure/);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM character_encounter_snapshots')).rows[0].n,0);
    assert.equal((await db.pool.query('SELECT turns FROM runs WHERE id=$1',[f.run])).rows[0].turns,turns);
    await db.pool.query('DROP TRIGGER fail_snapshot ON audit_events');await begin(db.pool,f,request);
  }finally{await db.close();}
});
test('old snapshots survive newer publications and later class/subclass progression',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool),started=await begin(db.pool,f,f.next()),id=started.instanceId as string,old=await snapshot(db.pool,id,f.run);
    await executeAction(db.pool,f.account,f.next(),{},async c=>({...await finishEncounter(c,id,0,'RETREAT',async()=>({})),revision:await advanceRevision(c)}));
    const earned=await begin(db.pool,f,f.next(),'encounter.build');await executeAction(db.pool,f.account,f.next(),{},async c=>({...await finishEncounter(c,earned.instanceId as string,0,'VICTORY',async()=>({})),revision:await advanceRevision(c)}));
    for(let i=0;i<4;i++)await levelUp(db.pool,f.account,f.next('LEVEL_UP'),'class.one');
    await chooseSubclass(db.pool,f.account,f.next('CHOOSE_SUBCLASS'),'subclass.guard');
    const newer=content();newer.version='character-newer';const profile=newer.entities.find(e=>e.id==='rules.character')!;profile.revision=2;(profile.definition.mechanics!.characterProfile as {base:{maxHealth:number}}).base.maxHealth=500;
    await publishContent(db.pool,newer);
    const next=await begin(db.pool,f,f.next()),current=await snapshot(db.pool,next.instanceId as string,f.run);
    assert.equal(current.derived.stats.armor,13);assert.equal(current.derived.stats.maxHealth,130);assert.equal(current.inputs.profileRevision,1);
    assert.deepEqual(await snapshot(db.pool,id,f.run),old);assert.equal((await integrityReport(db.pool)).characterSnapshotMismatches,0);
  }finally{await db.close();}
});
test('unconfigured runs cannot start opted-in encounters while ordinary encounters stay unchanged',async()=>{
  const db=await testDatabase();try {
    const release=await publishContent(db.pool,content()),f=await actor(db.pool,release);
    await assert.rejects(begin(db.pool,f,env(0)),/configured normal run/);
    await begin(db.pool,f,env(0),'encounter.build');assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM character_encounter_snapshots')).rows[0].n,0);
  }finally{await db.close();}
});
test('independent replay audit detects corrupted derived evidence',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool),started=await begin(db.pool,f,f.next());
    await db.pool.query('ALTER TABLE character_encounter_snapshots DISABLE TRIGGER immutable_character_snapshot');
    await db.pool.query("UPDATE character_encounter_snapshots SET derived=jsonb_set(derived,'{stats,maxHealth}','999')");
    assert.equal((await integrityReport(db.pool)).characterSnapshotMismatches,1);
    await assert.rejects(snapshot(db.pool,started.instanceId as string,f.run),/CHARACTER_SNAPSHOT_MISMATCH/);
  }finally{await db.close();}
});
test('publication validates character profile formulas, dependencies and basic-duel separation',()=>{
  validateContent(content());
  for(const mode of ['divisor','dependency','kind','basic'] as const){const p=content(),profile=p.entities.find(e=>e.id==='rules.character')!,enc=p.entities.find(e=>e.id==='encounter.character')!;
    if(mode==='divisor')(profile.definition.mechanics!.characterProfile as {scaling:{divisor:number}[]}).scaling[0]!.divisor=0;
    if(mode==='dependency')profile.definition.dependencies=[];
    if(mode==='kind')profile.kind='NPC';
    if(mode==='basic')enc.definition.mechanics!.combat={};
    assert.throws(()=>validateContent(p));
  }
});
test('shared prepared weapons count once and switching the active set changes only future snapshots',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);
    await setEquipment(db.pool,f.account,f.next('SET_EQUIPMENT'),{activeSet:'A',slots:[{set:'A',slot:'MAIN_HAND',itemId:f.items.sword!},{set:'B',slot:'MAIN_HAND',itemId:f.items.sword!}]});
    const first=await begin(db.pool,f,f.next()),id=first.instanceId as string,old=await snapshot(db.pool,id,f.run);
    assert.equal(old.inputs.sources.filter(s=>s.entityId==='item.sword').length,1);
    await executeAction(db.pool,f.account,f.next(),{},async c=>({...await finishEncounter(c,id,0,'RETREAT',async()=>({})),revision:await advanceRevision(c)}));
    await setEquipment(db.pool,f.account,f.next('SET_EQUIPMENT'),{activeSet:'B',slots:[{set:'A',slot:'MAIN_HAND',itemId:f.items.sword!},{set:'B',slot:'MAIN_HAND',itemId:f.items.backup!}]});
    const second=await begin(db.pool,f,f.next()),current=await snapshot(db.pool,second.instanceId as string,f.run);
    assert.equal(current.derived.stats.accuracy,107);assert.equal(current.derived.stats.attackMin,4);assert.deepEqual(await snapshot(db.pool,id,f.run),old);
  }finally{await db.close();}
});
test('an opted-in encounter cannot commit without its snapshot',async()=>{
  const db=await testDatabase();try {
    const f=await fixture(db.pool);
    await db.pool.query('ALTER TABLE character_encounter_snapshots DISABLE TRIGGER immutable_character_snapshot');
    await assert.rejects(executeAction(db.pool,f.account,f.next(),{},async c=>{const result=await beginEncounter(c,'encounter.character',{});await c.client.query('DELETE FROM character_encounter_snapshots WHERE instance_id=$1',[result.instanceId]);return {...result,revision:await advanceRevision(c)};}),/requires its character snapshot/);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM encounter_records')).rows[0].n,0);
  }finally{await db.close();}
});
test('restricted runtime captures snapshots but cannot change or delete them',async()=>{
  const db=await testDatabase(),role=`probe_${randomUUID().replaceAll('-','')}`;let created=false;try {
    const f=await fixture(db.pool);await db.pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);created=true;
    await db.pool.query(`GRANT USAGE ON SCHEMA ${db.schema} TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA ${db.schema} TO ${role}; GRANT UPDATE(security_epoch) ON accounts TO ${role}; GRANT UPDATE ON runs,run_builds TO ${role}; GRANT INSERT,UPDATE ON instances,instance_participants,state_scopes,encounter_records TO ${role}; GRANT INSERT ON character_encounter_snapshots,action_receipts,turn_ledger,audit_events,outbox_events TO ${role}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ${db.schema} TO ${role}`);
    const client=await db.pool.connect();try {
      await client.query(`SET ROLE ${role}`);const restricted={connect:async()=>({query:client.query.bind(client),release:()=>{}})} as unknown as pg.Pool;
      await begin(restricted,f,f.next());
      await assert.rejects(client.query('UPDATE character_encounter_snapshots SET derived=derived'),(e:{code?:string})=>e.code==='42501');
      await assert.rejects(client.query('DELETE FROM character_encounter_snapshots'),(e:{code?:string})=>e.code==='42501');
    }finally{await client.query('RESET ROLE');client.release();}
  }finally{if(created){await db.pool.query(`DROP OWNED BY ${role}`);await db.pool.query(`DROP ROLE ${role}`);}await db.close();}
});
test('migration preserves ordinary encounter history and fabricates no character snapshots',async()=>{
  const db=await testDatabase(false);try {
    await db.pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql') && n<'021').sort()) {
      const sql=await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8');await db.pool.query(sql);await db.pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
    }
    const f=await fixture(db.pool);await begin(db.pool,f,f.next(),'encounter.build');
    const before=(await db.pool.query('SELECT to_jsonb(e) AS state FROM encounter_records e')).rows;
    await migrate(db.pool);assert.deepEqual((await db.pool.query('SELECT to_jsonb(e) AS state FROM encounter_records e')).rows,before);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM character_encounter_snapshots')).rows[0].n,0);
  }finally{await db.close();}
});
test('invalid scaled totals reject atomically in both independent evaluators',async()=>{
  const db=await testDatabase();try {
    const p=content(),profile=p.entities.find(e=>e.id==='rules.character')!.definition.mechanics!.characterProfile as {scaling:{attribute:string;stat:string;baseline:number;divisor:number;amount:number}[]};
    profile.scaling.push({attribute:'strength',stat:'maxHealth',baseline:0,divisor:1,amount:-1000});
    const f=await fixture(db.pool,p);await assert.rejects(begin(db.pool,f,f.next()),/INVALID_DERIVED_STATS/);
    await assert.rejects(db.pool.query("SELECT character_snapshot_derived(character_snapshot_inputs($1,'rules.character'))",[f.run]),/Invalid attribute-scaled character stats/);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM encounter_records')).rows[0].n,0);
  }finally{await db.close();}
});

test('tactical adapter pins character stats, journals rolls, resumes and rejects replayed or foreign intents',async()=>{
 const {beginTacticalEncounter,executeTacticalCommand}=await import('../src/domains/tactical-encounters.js');
 const {stepTactical}=await import('../src/domains/tactical-engine.js');
 const db=await testDatabase();try {
  const f=await fixture(db.pool);
  const rules={damage:{version:1 as const,ruleset:'TACTICAL_DAMAGE_V1' as const,check:{version:1 as const,ruleset:'D20_CHECK_V1' as const,attributeDivisor:2,attributeBaseline:10,proficiencyPerRank:2,natural20:'SUCCESS' as const,natural1:'NORMAL' as const},criticalOn20:false,criticalMultiplierBps:20000,minimumConnectedDamage:1 as const},zones:['floor'],edges:[] as [string,string][],attackRange:0,healRange:0,healAmount:5,roundLimit:10};
  const enemy={id:'enemy',side:'ENEMY' as const,zone:'floor',health:100,strikes:0,state:'ACTIVE' as const,stats:{maxHealth:100,maxMana:0,accuracy:2,evasion:10,armor:0,initiative:0,attackMin:1,attackMax:3}};
  const started=await executeAction(db.pool,f.account,f.next(),{},async c=>{
   const result=await beginTacticalEncounter(c,'encounter.character',rules,{id:'hero',zone:'floor'},[enemy],['hero']);
   return {...result,state:result.state as unknown as import('../src/foundation/json.js').Json,revision:await advanceRevision(c)};
  });
  const id=started.instanceId as string;
  const before=(await db.pool.query('SELECT checkpoint FROM encounter_records WHERE instance_id=$1',[id])).rows[0].checkpoint;
  assert.equal(before.state.units[0].stats.maxHealth,130);
  const request=f.next(),command={actorId:'hero',kind:'ATTACK' as const,targetId:'enemy'};
  const act=()=>executeAction(db.pool,f.account,request,{id,command},async c=>{
   const result=await executeTacticalCommand(c,id,1,0,command);
   return {result:result as unknown as import('../src/foundation/json.js').Json,revision:await advanceRevision(c)};
  });
  const first=await act(),retry=await act();assert.equal(retry.replayed,true);assert.deepEqual(retry.result,first.result);
  const after=(await db.pool.query('SELECT checkpoint,revision FROM encounter_records WHERE instance_id=$1',[id])).rows[0];
  assert.equal(after.revision,2);assert.equal(after.checkpoint.state.revision,1);
  const result=first.result as unknown as Awaited<ReturnType<typeof executeTacticalCommand>>;
  assert.deepEqual(stepTactical(rules,before.state,0,result.evidence.intent).state,after.checkpoint.state);
  assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM encounter_draws WHERE instance_id=$1 AND stream='tactical'",[id])).rows[0].n,2);
  const invalidRequest=f.next();
  await assert.rejects(executeAction(db.pool,f.account,invalidRequest,{},async c=>{
   await executeTacticalCommand(c,id,1,0,{actorId:'hero',kind:'END'});return {revision:await advanceRevision(c)};
  }),/STALE_ENCOUNTER_REVISION/);
  const other=await actor(db.pool,f.release);
  await assert.rejects(executeAction(db.pool,other.account,env(0),{},async c=>{
   await executeTacticalCommand(c,id,2,1,{actorId:'hero',kind:'END'});return {revision:await advanceRevision(c)};
  }),/ENCOUNTER_NOT_FOUND/);
  await assert.rejects(executeAction(db.pool,f.account,invalidRequest,{},async c=>{
   await executeTacticalCommand(c,id,2,1,command);return {revision:await advanceRevision(c)};
  }),/MAIN_SPENT/);
  assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM encounter_draws WHERE instance_id=$1 AND stream='tactical'",[id])).rows[0].n,2);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM action_receipts WHERE request_id=$1',[invalidRequest.requestId])).rows[0].n,0);
  await assert.rejects(executeAction(db.pool,f.account,invalidRequest,{},async c=>{
   await executeTacticalCommand(c,id,2,1,{actorId:'enemy',kind:'END'});return {revision:await advanceRevision(c)};
  }),/NOT_CONTROLLED/);
 }finally{await db.close();}
});
