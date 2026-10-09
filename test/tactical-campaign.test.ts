import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { testDatabase } from './helpers.js';
import { tacticalFixture,tacticalPackage,envelope } from './tactical-fixture.js';
import { validateContent,publishContent } from '../src/domains/content.js';
import { startTacticalCombat,takeTacticalAction,tacticalView } from '../src/domains/tactical-combat.js';
import { ascend } from '../src/domains/lifecycle.js';
import { integrityReport,unindexedForeignKeys } from '../src/foundation/integrity.js';
import { migrate } from '../src/database.js';
import type { TacticalSpec } from '../src/domains/tactical-content.js';
import type pg from 'pg';
const json=(x:unknown)=>x as any;
function campaignPackage(required=true){
 const p=tacticalPackage();p.version='tactical-campaign-fixture';
 const first=p.entities.find(e=>e.id==='encounter.tactical')!;
 (first.definition.mechanics!.tacticalCombat as unknown as TacticalSpec).allies=[];
 (p.entities.find(e=>e.id==='monster.tactical')!.definition.mechanics!.tacticalUnit as any).stats.maxHealth=6;
 const final=structuredClone(first);final.id='encounter.finale';final.definition.name='Finale';
 (final.definition.mechanics!.tacticalCombat as unknown as TacticalSpec).campaignId='campaign.tactical';final.definition.dependencies.push('campaign.tactical');
 p.entities.push(final,{id:'campaign.tactical',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'Campaign',dependencies:required?['encounter.tactical']:[],public:{},mechanics:{tacticalCampaign:{version:1,ruleset:'TACTICAL_CAMPAIGN_V1',finalEncounterId:'encounter.finale',requiresEncounterIds:required?['encounter.tactical']:[]}}}});
 return p;
}
async function fixture(pool:pg.Pool,p=campaignPackage()){
 const f=await tacticalFixture(pool,p);
 await pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,'encounter.finale','DISCOVERED')",[f.account]);return f;
}
async function win(pool:pg.Pool,account:string,revision:number,definitionId='encounter.tactical'){
 const started=json(await startTacticalCombat(pool,account,envelope(revision,'START_TACTICAL'),definitionId));
 const request=envelope(started.revision),intent={actorId:'hero',kind:'ATTACK' as const,targetId:'enemy'};
 const result=json(await takeTacticalAction(pool,account,request,started.instanceId,started.encounterRevision,started.tacticalRevision,intent));assert.equal(result.outcome,'VICTORY');
 return {started,request,intent,result};
}
test('authored tactical campaign requires prior victories, settles exact evidence once, and voluntarily ascends',async()=>{
 const db=await testDatabase();try{
  const f=await fixture(db.pool);
  await assert.rejects(startTacticalCombat(db.pool,f.account,envelope(f.revision,'START_TACTICAL'),'encounter.finale'),/PREREQUISITES_MISSING/);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM encounter_records')).rows[0].n,0);
  const first=await win(db.pool,f.account,f.revision);
  await assert.rejects(db.pool.query("UPDATE runs SET status='AFTERCORE' WHERE id=$1",[f.run]),/completion evidence/);
  await assert.rejects(db.pool.query("UPDATE runs SET completion_policy='LEGACY' WHERE id=$1",[f.run]),/cannot be bypassed/);
  await assert.rejects(ascend(db.pool,f.account,envelope(first.result.revision,'ASCEND')),/ASCENSION_NOT_READY/);
  const started=json(await startTacticalCombat(db.pool,f.account,envelope(first.result.revision,'START_TACTICAL'),'encounter.finale'));
  const request=envelope(started.revision),intent={actorId:'hero',kind:'ATTACK' as const,targetId:'enemy'};
  const results=await Promise.all([0,1,2].map(()=>takeTacticalAction(db.pool,f.account,request,started.instanceId,started.encounterRevision,started.tacticalRevision,intent)));
  assert.equal(results.filter(r=>!r.replayed).length,1);assert.equal(results[0]!.campaignCompleted,true);
  assert.equal(json(await tacticalView(db.pool,f.account,started.instanceId)).campaignCompleted,true);
  const proof=(await db.pool.query('SELECT * FROM run_completions')).rows[0];assert.equal(proof.ruleset,'TACTICAL_CAMPAIGN_V1');assert.equal(proof.final_instance_id,started.instanceId);
  const evidence=(await db.pool.query('SELECT * FROM tactical_campaign_prerequisites')).rows[0];assert.equal(evidence.instance_id,first.started.instanceId);assert.equal(evidence.finish_action_id,first.result.actionId);
  assert.equal((await db.pool.query('SELECT status FROM runs WHERE id=$1',[f.run])).rows[0].status,'AFTERCORE');
  await assert.rejects(startTacticalCombat(db.pool,f.account,envelope(json(results[0]).revision,'START_TACTICAL'),'encounter.finale'),/CAMPAIGN_ALREADY_COMPLETE/);
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));assert.deepEqual(await unindexedForeignKeys(db.pool),[]);
  const ascension=envelope(json(results[0]).revision,'ASCEND'),next=json(await ascend(db.pool,f.account,ascension));assert.equal((await ascend(db.pool,f.account,ascension)).replayed,true);
  assert.equal((await db.pool.query('SELECT status FROM runs WHERE id=$1',[f.run])).rows[0].status,'ARCHIVED');
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM tactical_campaign_prerequisites')).rows[0].n,1);
  await assert.rejects(db.pool.query("UPDATE runs SET status='AFTERCORE' WHERE id=$1",[next.runId]),/completion evidence/);
  assert.equal((await takeTacticalAction(db.pool,f.account,request,started.instanceId,started.encounterRevision,started.tacticalRevision,intent)).replayed,true);
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{await db.close();}
});
test('foreign and previous-life victories cannot satisfy this run; publication cannot rewrite pinned campaign requirements',async()=>{
 const db=await testDatabase();try{
  const p=campaignPackage(),f=await fixture(db.pool,p),other=await fixture(db.pool,p);await win(db.pool,other.account,other.revision);
  await assert.rejects(startTacticalCombat(db.pool,f.account,envelope(f.revision,'START_TACTICAL'),'encounter.finale'),/PREREQUISITES_MISSING/);
  const first=await win(db.pool,f.account,f.revision);
  const newer=structuredClone(p);newer.version='tactical-campaign-new';for(const e of newer.entities)e.revision=2;
  (newer.entities.find(e=>e.id==='campaign.tactical')!.definition.mechanics!.tacticalCampaign as any).requiresEncounterIds=[];
  await publishContent(db.pool,newer);
  const final=await win(db.pool,f.account,first.result.revision,'encounter.finale');
  assert.equal((await db.pool.query('SELECT definition_revision FROM run_completions WHERE run_id=$1',[f.run])).rows[0].definition_revision,1);
  const next=json(await ascend(db.pool,f.account,envelope(final.result.revision,'ASCEND')));
  const {startBuild}=await import('../src/domains/builds.js');await startBuild(db.pool,f.account,envelope(0,'START_BUILD'),'class.one','balanced');
  await assert.rejects(startTacticalCombat(db.pool,f.account,envelope(1,'START_TACTICAL'),'encounter.finale'),/PREREQUISITES_MISSING/);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_completions WHERE run_id=$1',[next.runId])).rows[0].n,0);
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{await db.close();}
});
test('retreat, defeat and round-limit failure never create campaign proofs or unlock Ascension',async()=>{
 for(const outcome of ['RETREAT','DEFEAT','FAILED_FORWARD']){const db=await testDatabase();try{
  const p=campaignPackage(false),spec=p.entities.find(e=>e.id==='encounter.finale')!.definition.mechanics!.tacticalCombat as unknown as TacticalSpec;
  const enemy=p.entities.find(e=>e.id==='monster.tactical')!.definition.mechanics!.tacticalUnit as any;enemy.stats.maxHealth=1000;
  if(outcome==='DEFEAT'){enemy.stats.attackMin=100;enemy.stats.attackMax=100;}if(outcome==='FAILED_FORWARD')spec.rules.roundLimit=1;
  const f=await fixture(db.pool,p),start=json(await startTacticalCombat(db.pool,f.account,envelope(f.revision,'START_TACTICAL'),'encounter.finale'));
  const end=json(await takeTacticalAction(db.pool,f.account,envelope(start.revision),start.instanceId,start.encounterRevision,start.tacticalRevision,{actorId:'hero',kind:outcome==='RETREAT'?'RETREAT':'END'}));
  assert.equal(end.outcome,outcome);assert.equal(end.campaignCompleted,false);assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_completions')).rows[0].n,0);
  await assert.rejects(ascend(db.pool,f.account,envelope(end.revision,'ASCEND')),/ASCENSION_NOT_READY/);
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{await db.close();}}
});
test('late prerequisite-proof failure rolls back final rolls, loot, XP, recovery, status and receipt; retry settles once',async()=>{
 const db=await testDatabase();try{
  const f=await fixture(db.pool),first=await win(db.pool,f.account,f.revision),s=json(await startTacticalCombat(db.pool,f.account,envelope(first.result.revision,'START_TACTICAL'),'encounter.finale'));
  const request=envelope(s.revision),intent={actorId:'hero',kind:'ATTACK' as const,targetId:'enemy'},act=()=>takeTacticalAction(db.pool,f.account,request,s.instanceId,s.encounterRevision,s.tacticalRevision,intent);
  await db.pool.query("CREATE FUNCTION fail_campaign() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Late campaign failure'; END $$; CREATE TRIGGER fail_campaign BEFORE INSERT ON tactical_campaign_prerequisites FOR EACH ROW EXECUTE FUNCTION fail_campaign()");
  await assert.rejects(act(),/Late campaign failure/);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM run_completions')).rows[0].n,0);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM encounter_reward_claims')).rows[0].n,1);
  assert.equal((await db.pool.query('SELECT xp::text FROM run_progression WHERE run_id=$1',[f.run])).rows[0].xp,'100');
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM tactical_steps WHERE instance_id=$1',[s.instanceId])).rows[0].n,0);
  assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM encounter_draws WHERE instance_id=$1 AND stream='tactical'",[s.instanceId])).rows[0].n,0);
  assert.equal((await db.pool.query('SELECT status FROM runs WHERE id=$1',[f.run])).rows[0].status,'ACTIVE');
  await db.pool.query('DROP TRIGGER fail_campaign ON tactical_campaign_prerequisites');assert.equal((await act()).campaignCompleted,true);assert.equal((await act()).replayed,true);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM encounter_reward_claims')).rows[0].n,2);
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{await db.close();}
});
test('SQL rejects non-final completion and immutable proof edits; audit detects missing prerequisite evidence',async()=>{
 const db=await testDatabase();try{
  const f=await fixture(db.pool),first=await win(db.pool,f.account,f.revision);
  const client=await db.pool.connect();try{
   await client.query('BEGIN');
   await client.query("INSERT INTO run_completions(run_id,release_id,campaign_id,definition_revision,final_instance_id,action_id,ruleset) VALUES($1,$2,'campaign.tactical',1,$3,$4,'TACTICAL_CAMPAIGN_V1')",[f.run,f.release,first.started.instanceId,first.result.actionId]);
   await client.query("UPDATE runs SET status='AFTERCORE' WHERE id=$1",[f.run]);await assert.rejects(client.query('COMMIT'),/completion evidence/);
  }finally{await client.query('ROLLBACK');client.release();}
  await win(db.pool,f.account,first.result.revision,'encounter.finale');
  await assert.rejects(db.pool.query('UPDATE tactical_campaign_prerequisites SET finish_action_id=finish_action_id'),/Immutable/);
  await assert.rejects(db.pool.query('DELETE FROM run_completions'),/Immutable/);
  await db.pool.query('ALTER TABLE tactical_campaign_prerequisites DISABLE TRIGGER tactical_campaign_proof_immutable');await db.pool.query('DELETE FROM tactical_campaign_prerequisites');await db.pool.query('ALTER TABLE tactical_campaign_prerequisites ENABLE TRIGGER tactical_campaign_proof_immutable');
  assert.ok((await integrityReport(db.pool)).completionMismatches>0);
 }finally{await db.close();}
});
test('publication rejects ambiguous, cross-profile, recursive or missing campaign references',()=>{
 const good=campaignPackage();assert.doesNotThrow(()=>validateContent(good));
 for(const mutate of [(p:typeof good)=>{(p.entities.find(e=>e.id==='campaign.tactical')!.definition.mechanics!.tacticalCampaign as any).requiresEncounterIds=['encounter.finale'];},(p:typeof good)=>{p.entities.find(e=>e.id==='campaign.tactical')!.definition.dependencies=[];},(p:typeof good)=>{p.entities.find(e=>e.id==='encounter.finale')!.definition.dependencies=[];},(p:typeof good)=>{(p.entities.find(e=>e.id==='encounter.tactical')!.definition.mechanics!.tacticalCombat as any).campaignId='campaign.tactical';},(p:typeof good)=>{p.entities.find(e=>e.id==='encounter.tactical')!.definition.mechanics!.characterProfileId='rules.other';},(p:typeof good)=>{(p.entities.find(e=>e.id==='campaign.tactical')!.definition.mechanics!.tacticalCampaign as any).forceAscension=true;}]){
  const p=structuredClone(good);mutate(p);assert.throws(()=>validateContent(p));
 }
});
test('migration preserves all original run fields and creates no historical tactical completion evidence',async()=>{
 const db=await testDatabase(false);try{
  await db.pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')&&n<'023').sort()){
   const sql=await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8');await db.pool.query(sql);await db.pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
  }
  const p=tacticalPackage();p.version='campaign-upgrade';
  const hit={numerator:1,denominator:1},fighter={version:1,maxHealth:20,attack:{min:10,max:10,hit},armor:0,resistanceBps:0};
  p.entities.push(
   {id:'profile.basic',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'Basic profile',dependencies:[],public:{},mechanics:{combatProfile:{...fighter,recoveryHealth:5}}}},
   {id:'monster.basic',kind:'MONSTER',revision:1,schemaVersion:1,definition:{name:'Basic monster',dependencies:[],public:{},mechanics:{combatMonster:{...fighter,maxHealth:5}}}},
   {id:'campaign.basic',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'Basic campaign',dependencies:[],public:{},mechanics:{campaign:{version:1,finalEncounterId:'encounter.basic',requiresEncounterIds:[]}}}},
   {id:'encounter.basic',kind:'ENCOUNTER',revision:1,schemaVersion:1,definition:{name:'Basic final',dependencies:['profile.basic','monster.basic','campaign.basic','loot.tactical'],public:{},mechanics:{encounter:{version:2,turnCost:1,lootTableId:'loot.tactical'},combat:{version:1,ruleset:'BASIC_DUEL_V1',access:'DISCOVERED_REPEATABLE',profileId:'profile.basic',monsterId:'monster.basic',roundLimit:5,retreat:hit,failure:{kind:'RETURN_HOME',turnCost:1},campaignId:'campaign.basic'}}}}
  );
  const f=await tacticalFixture(db.pool,p);await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,'encounter.basic','DISCOVERED')",[f.account]);
  const {startCombat,takeCombatAction}=await import('../src/domains/combat.js');
  const opened=await startCombat(db.pool,f.account,envelope(f.revision,'START_COMBAT'),'encounter.basic');
  await takeCombatAction(db.pool,f.account,envelope(Number(opened.revision),'COMBAT_ACTION'),opened.instanceId as string,0,'ATTACK');
  const before=(await db.pool.query('SELECT to_jsonb(r) AS state FROM runs r WHERE id=$1',[f.run])).rows;
  const oldProof=(await db.pool.query('SELECT to_jsonb(p) AS state FROM run_completions p')).rows;
  await migrate(db.pool);assert.deepEqual((await db.pool.query('SELECT to_jsonb(r) AS state FROM runs r WHERE id=$1',[f.run])).rows,before);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM tactical_campaign_prerequisites')).rows[0].n,0);
  assert.deepEqual((await db.pool.query("SELECT to_jsonb(p)-'ruleset' AS state FROM run_completions p")).rows,oldProof);
  assert.equal((await db.pool.query('SELECT ruleset FROM run_completions')).rows[0].ruleset,'BASIC_DUEL_V1');
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{await db.close();}
});

test('restricted runtime completes a tactical campaign while completion/evidence edits remain denied',async()=>{
 const db=await testDatabase(),role=`campaign_${randomUUID().replaceAll('-','')}`;let created=false;
 try{
  const f=await fixture(db.pool);
  await db.pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);created=true;
  await db.pool.query(`GRANT USAGE ON SCHEMA ${db.schema} TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA ${db.schema} TO ${role};
   GRANT UPDATE(security_epoch) ON accounts TO ${role}; GRANT UPDATE ON runs,run_builds,run_progression,instances,state_scopes,inventory_containers,encounter_records,tactical_run_state,inventory_items TO ${role};
   GRANT INSERT ON instances,instance_participants,state_scopes,encounter_records,encounter_draws,character_encounter_snapshots,encounter_reward_plans,encounter_reward_claims,encounter_reward_items,encounter_xp_plans,run_xp_awards,tactical_run_state,tactical_encounter_origins,tactical_steps,tactical_recoveries,action_receipts,turn_ledger,audit_events,outbox_events,inventory_items,inventory_quantity_operations,run_completions,tactical_campaign_prerequisites TO ${role};
   GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ${db.schema} TO ${role}`);
  const client=await db.pool.connect();try{
   await client.query(`SET ROLE ${role}`);
   const pool={query:client.query.bind(client),connect:async()=>({query:client.query.bind(client),release:()=>{}})} as unknown as pg.Pool;
   const first=await win(pool,f.account,f.revision),final=await win(pool,f.account,first.result.revision,'encounter.finale');assert.equal(final.result.campaignCompleted,true);
   for(const sql of ['DELETE FROM run_completions','UPDATE run_completions SET ruleset=ruleset','DELETE FROM tactical_campaign_prerequisites','UPDATE tactical_campaign_prerequisites SET finish_action_id=finish_action_id'])await assert.rejects(client.query(sql),e=>(e as {code?:string}).code==='42501');
  }finally{await client.query('RESET ROLE');client.release();}
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{if(created){await db.pool.query(`DROP OWNED BY ${role}`);await db.pool.query(`DROP ROLE ${role}`);}await db.close();}
});
