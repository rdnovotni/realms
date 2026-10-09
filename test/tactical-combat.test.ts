import test from 'node:test';
import assert from 'node:assert/strict';
import { actor,testDatabase } from './helpers.js';
import { tacticalPackage,tacticalFixture,envelope } from './tactical-fixture.js';
import { validateContent } from '../src/domains/content.js';
import { startTacticalCombat,takeTacticalAction,tacticalView } from '../src/domains/tactical-combat.js';
import { integrityReport,unindexedForeignKeys } from '../src/foundation/integrity.js';
import type { TacticalCommand } from '../src/domains/tactical-encounters.js';
import type { TacticalSpec } from '../src/domains/tactical-content.js';
import { buildApp } from '../src/app.js';
import { enrollPassword,requireLogin } from '../src/auth/sessions.js';
const json=(x:unknown)=>x as any;
async function fight(pool:any,f:any){let view=json(await startTacticalCombat(pool,f.account,envelope(f.revision,'START_TACTICAL'),'encounter.tactical'));return {get:()=>view,act:async(command:TacticalCommand)=>{view=json(await takeTacticalAction(pool,f.account,envelope(view.revision),view.instanceId,view.encounterRevision,view.tacticalRevision,command));return view;}};}
const specOf=(p:ReturnType<typeof tacticalPackage>)=>p.entities.find(e=>e.id==='encounter.tactical')!.definition.mechanics!.tacticalCombat as unknown as TacticalSpec;

test('playable authored party fight executes gear/feat/class stats, saves reconnect, and settles loot/XP once',async()=>{
 const db=await testDatabase();try{
  const f=await tacticalFixture(db.pool),battle=await fight(db.pool,f);
  assert.equal(battle.get().units[0].maxHealth,35);
  const first=await battle.act({actorId:'hero',kind:'ATTACK',targetId:'enemy'});assert.equal(first.units[2].health,4);
  const read=json(await tacticalView(db.pool,f.account,first.instanceId));assert.equal(read.tacticalRevision,first.tacticalRevision);assert.deepEqual(read.units,first.units);
  await battle.act({actorId:'hero',kind:'END'});
  const request=envelope(battle.get().revision),v=battle.get(),command={actorId:'ally',kind:'ATTACK' as const,targetId:'enemy'};
  const results=await Promise.all(Array.from({length:3},()=>takeTacticalAction(db.pool,f.account,request,v.instanceId,v.encounterRevision,v.tacticalRevision,command)));
  assert.equal(results.filter(r=>!r.replayed).length,1);assert.equal(results[0]!.outcome,'VICTORY');
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM encounter_reward_claims')).rows[0].n,1);
  assert.equal((await db.pool.query('SELECT xp::text FROM run_progression WHERE run_id=$1',[f.run])).rows[0].xp,'100');
  assert.equal((await db.pool.query("SELECT quantity::text FROM inventory_items WHERE definition_id='item.ore'")).rows[0].quantity,'2');
  assert.deepEqual(await unindexedForeignKeys(db.pool),[]);assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{await db.close();}
});
test('guard spends Quick and a defensive Reaction; healing spends mana; enemies obey the same turn budgets',async()=>{
 const db=await testDatabase();try{
  const p=tacticalPackage();(p.entities.find(e=>e.id==='npc.ally')!.definition.mechanics!.tacticalUnit as any).stats.maxHealth=50;
  const f=await tacticalFixture(db.pool,p),b=await fight(db.pool,f);
  await b.act({actorId:'hero',kind:'GUARD'});await b.act({actorId:'hero',kind:'END'});
  await b.act({actorId:'ally',kind:'END'});assert.equal(b.get().units[0].health,34);
  const guarded=(await db.pool.query("SELECT evidence,state FROM tactical_steps WHERE intent->>'kind'='ATTACK' AND control='SERVER' ORDER BY revision LIMIT 1")).rows[0];
  assert.equal(guarded.evidence.attack.effectiveArmor,8);assert.equal(guarded.state.budgets.hero.reaction,0);
  assert.equal(b.get().currentActor,'hero');
  await b.act({actorId:'hero',kind:'HEAL',targetId:'hero'});assert.equal(b.get().units[0].mana,4);
  await b.act({actorId:'hero',kind:'END'});await b.act({actorId:'ally',kind:'END'});
  const events=(await db.pool.query("SELECT control,intent FROM tactical_steps WHERE intent->>'actorId'='enemy' ORDER BY revision")).rows;
  assert.ok(events.some(e=>e.control==='SERVER'&&e.intent.kind==='ATTACK'));assert.ok(events.some(e=>e.intent.kind==='END'));
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{await db.close();}
});
test('failed-forward and retreat have disclosed recovery, preserve pools and never grant victory loot',async()=>{
 for(const retreat of [false,true]){const db=await testDatabase();try{
  const p=tacticalPackage();specOf(p).rules.roundLimit=1;
  const f=await tacticalFixture(db.pool,p),b=await fight(db.pool,f);
  if(retreat)await b.act({actorId:'hero',kind:'RETREAT'});
  else {await b.act({actorId:'hero',kind:'END'});await b.act({actorId:'ally',kind:'END'});}
  assert.equal(b.get().outcome,retreat?'RETREAT':'FAILED_FORWARD');
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM encounter_reward_claims')).rows[0].n,0);
  const recovery=(await db.pool.query('SELECT * FROM tactical_recoveries')).rows[0];assert.equal(recovery.turn_cost,retreat?0:2);
  const next=json(await startTacticalCombat(db.pool,f.account,envelope(b.get().revision,'START_TACTICAL'),'encounter.tactical'));
  assert.equal(next.units[0].health,recovery.health);assert.equal(next.units[0].mana,recovery.mana);
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{await db.close();}}
});
test('terminal party defeat recovers at Home once and bounded costs cannot overdraw remaining Turns',async()=>{
 const db=await testDatabase();try{
  const p=tacticalPackage();specOf(p).allies=[];const monster=p.entities.find(e=>e.id==='monster.tactical')!.definition.mechanics!.tacticalUnit as any;
  monster.stats.attackMin=100;monster.stats.attackMax=100;
  const f=await tacticalFixture(db.pool,p,2),b=await fight(db.pool,f);
  await b.act({actorId:'hero',kind:'END'});assert.equal(b.get().outcome,'DEFEAT');
  const recovery=(await db.pool.query('SELECT * FROM tactical_recoveries')).rows[0];assert.equal(recovery.health,5);assert.equal(recovery.turn_cost,1);assert.equal(recovery.destination,'HOME');
  assert.equal((await db.pool.query('SELECT turns FROM runs WHERE id=$1',[f.run])).rows[0].turns,0);
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{await db.close();}
});
test('API rejects client rolls, enemy control, foreign reads and read-only writes; reconnect hides mechanics',async()=>{
 const db=await testDatabase(),app=buildApp(db.pool,{mode:'sessions',throttleKey:'t'.repeat(64)});try{
  const f=await tacticalFixture(db.pool),password='Test tactical password 47!';await enrollPassword(db.pool,f.account,'tactical_user',password);
  const login=await requireLogin(db.pool,'tactical_user',password,'Tactical'),headers={authorization:`Bearer ${login.token}`};
  const start=await app.inject({method:'POST',url:'/api/v1/tactical/start',headers,payload:{...envelope(f.revision,'START_TACTICAL'),definitionId:'encounter.tactical'}});assert.equal(start.statusCode,200,start.body);
  const v=start.json(),payload={...envelope(v.revision),instanceId:v.instanceId,expectedEncounterRevision:v.encounterRevision,expectedTacticalRevision:v.tacticalRevision,command:{actorId:'hero',kind:'ATTACK',targetId:'enemy'}};
  assert.equal((await app.inject({method:'POST',url:'/api/v1/tactical/actions',headers,payload:{...payload,command:{...payload.command,roll:20}}})).statusCode,400);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/tactical/actions',headers,payload:{...payload,command:{actorId:'enemy',kind:'END'}}})).statusCode,403);
  const reader=await requireLogin(db.pool,'tactical_user',password,'Read',true);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/tactical/actions',headers:{authorization:`Bearer ${reader.token}`},payload})).statusCode,403);
  const foreign=await actor(db.pool,f.release);await assert.rejects(tacticalView(db.pool,foreign.account,v.instanceId),/NOT_FOUND/);
  const read=await app.inject({url:`/api/v1/tactical/${v.instanceId}`,headers});assert.equal(read.statusCode,200);
  for(const hidden of ['seed','sources','stats','initial_checkpoint','rawDamage','tacticalKit','spec'])assert.ok(!read.body.includes(`"${hidden}"`));
  assert.equal((await app.inject({method:'POST',url:'/api/v1/tactical/actions',headers,payload})).statusCode,200);
 }finally{await app.close();await db.close();}
});
test('late action failure rolls back journals, random draws, checkpoint, receipt and rewards',async()=>{
 const db=await testDatabase();try{
  const f=await tacticalFixture(db.pool),b=await fight(db.pool,f),before=b.get();
  await db.pool.query("CREATE FUNCTION fail_tactical() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Late tactical failure'; END $$; CREATE TRIGGER fail_tactical BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_tactical()");
  await assert.rejects(b.act({actorId:'hero',kind:'ATTACK',targetId:'enemy'}),/Late tactical failure/);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM tactical_steps')).rows[0].n,0);
  assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM encounter_draws WHERE stream='tactical'")).rows[0].n,0);
  const view=json(await tacticalView(db.pool,f.account,before.instanceId));assert.equal(view.tacticalRevision,0);
  await db.pool.query('DROP TRIGGER fail_tactical ON audit_events');await b.act({actorId:'hero',kind:'ATTACK',targetId:'enemy'});
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{await db.close();}
});
test('immutable tactical evidence cannot be edited and independent replay detects tampered history',async()=>{
 const db=await testDatabase();try{
  const f=await tacticalFixture(db.pool),b=await fight(db.pool,f);await b.act({actorId:'hero',kind:'ATTACK',targetId:'enemy'});
  await assert.rejects(db.pool.query('UPDATE tactical_run_state SET mana=mana+1'),/pool/);
  await assert.rejects(db.pool.query("INSERT INTO tactical_recoveries(instance_id,action_id,health,mana,turn_cost,destination) SELECT o.instance_id,e.start_action_id,10,6,0,'FIELD' FROM tactical_encounter_origins o JOIN encounter_records e ON e.instance_id=o.instance_id"),/Tactical recovery/);
  await assert.rejects(db.pool.query('UPDATE tactical_steps SET evidence=evidence'),/Immutable/);await assert.rejects(db.pool.query('DELETE FROM tactical_encounter_origins'),/Immutable/);
  await db.pool.query('ALTER TABLE tactical_steps DISABLE TRIGGER tactical_step_immutable');
  await db.pool.query("UPDATE tactical_steps SET evidence=jsonb_set(evidence,'{attack,damage}','999'::jsonb)");
  await db.pool.query('ALTER TABLE tactical_steps ENABLE TRIGGER tactical_step_immutable');
  assert.ok((await integrityReport(db.pool)).tacticalMismatches>0);
 }finally{await db.close();}
});
test('publication rejects malformed rules, hidden unit injection, missing dependencies, and unsupported kits',()=>{
 const good=tacticalPackage();assert.doesNotThrow(()=>validateContent(good));
 for(const mutate of [(p:typeof good)=>{(specOf(p).rules as any).freeAction=true;},(p:typeof good)=>{specOf(p).enemies[0]!.id='hero';},(p:typeof good)=>{p.entities.find(e=>e.id==='encounter.tactical')!.definition.dependencies=[];},(p:typeof good)=>{p.entities.find(e=>e.id==='item.ore')!.definition.mechanics!.tacticalKit={version:1,minimumNativeLevel:0,heal:true,guard:true};}]){
  const p=structuredClone(good);mutate(p);assert.throws(()=>validateContent(p));
 }
});

test('illegal attacks and stale requests leave draws and journal unchanged; authored range controls movement',async()=>{
 const db=await testDatabase();try{
  const f=await tacticalFixture(db.pool),b=await fight(db.pool,f),initial=b.get();
  await b.act({actorId:'hero',kind:'MOVE',zone:'balcony'});
  const v=b.get(),bad=envelope(v.revision);
  await assert.rejects(takeTacticalAction(db.pool,f.account,bad,v.instanceId,v.encounterRevision,v.tacticalRevision,{actorId:'hero',kind:'ATTACK',targetId:'enemy'}),/ILLEGAL_TACTICAL_ATTACK/);
  assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM encounter_draws WHERE stream='tactical'")).rows[0].n,0);
  await assert.rejects(takeTacticalAction(db.pool,f.account,bad,v.instanceId,initial.encounterRevision,initial.tacticalRevision,{actorId:'hero',kind:'END'}),/STALE_ENCOUNTER_REVISION/);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM tactical_steps')).rows[0].n,1);
  await b.act({actorId:'hero',kind:'END'});await b.act({actorId:'ally',kind:'MOVE',zone:'balcony'});await b.act({actorId:'ally',kind:'END'});
  assert.equal(b.get().units[2].zone,'balcony');
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{await db.close();}
});
test('a late loot failure rolls back the terminal transition and retries settle once with the same rolls',async()=>{
 const db=await testDatabase();try{
  const f=await tacticalFixture(db.pool),b=await fight(db.pool,f);await b.act({actorId:'hero',kind:'ATTACK',targetId:'enemy'});await b.act({actorId:'hero',kind:'END'});
  const v=b.get(),request=envelope(v.revision),command={actorId:'ally',kind:'ATTACK' as const,targetId:'enemy'};
  const act=()=>takeTacticalAction(db.pool,f.account,request,v.instanceId,v.encounterRevision,v.tacticalRevision,command);
  const before=(await db.pool.query('SELECT count(*)::int AS n FROM encounter_draws')).rows[0].n;
  await db.pool.query("CREATE FUNCTION fail_tactical_reward() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Late tactical reward failure'; END $$; CREATE TRIGGER fail_tactical_reward BEFORE INSERT ON encounter_reward_items FOR EACH ROW EXECUTE FUNCTION fail_tactical_reward()");
  await assert.rejects(act(),/Late tactical reward failure/);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM encounter_draws')).rows[0].n,before);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM tactical_recoveries')).rows[0].n,0);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM encounter_reward_claims')).rows[0].n,0);
  assert.equal(json(await tacticalView(db.pool,f.account,v.instanceId)).outcome,null);
  await db.pool.query('DROP TRIGGER fail_tactical_reward ON encounter_reward_items');
  assert.equal((await act()).outcome,'VICTORY');assert.equal((await act()).replayed,true);
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{await db.close();}
});
test('Main action limits prevent a free retreat after healing and new fights retain spent mana',async()=>{
 const db=await testDatabase();try{
  const f=await tacticalFixture(db.pool),b=await fight(db.pool,f);
  await b.act({actorId:'hero',kind:'HEAL',targetId:'hero'});assert.equal(b.get().units[0].mana,4);
  await b.act({actorId:'hero',kind:'RETREAT'}).catch(error=>{assert.match(String(error),/ILLEGAL_TACTICAL_RETREAT/);});
  await b.act({actorId:'hero',kind:'END'});await b.act({actorId:'ally',kind:'RETREAT'});
  assert.equal(b.get().outcome,'RETREAT');
  const next=json(await startTacticalCombat(db.pool,f.account,envelope(b.get().revision,'START_TACTICAL'),'encounter.tactical'));
  assert.equal(next.units[0].mana,4);
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{await db.close();}
});
test('a legitimately unlocked subclass changes damage in a playable fight and preserves its source evidence',async()=>{
 const {beginEncounter,finishEncounter}=await import('../src/domains/encounters.js');
 const {executeAction,advanceRevision}=await import('../src/foundation/action.js');
 const {levelUp}=await import('../src/domains/builds.js');const {chooseSubclass}=await import('../src/domains/subclasses.js');
 const db=await testDatabase();try{
  const p=tacticalPackage();specOf(p).allies=[];const f=await tacticalFixture(db.pool,p);let revision=f.revision;
  const opened=await executeAction(db.pool,f.account,envelope(revision++,'FIXTURE_XP'),{},async c=>({...await beginEncounter(c,'encounter.build',{}),revision:await advanceRevision(c)}));
  await executeAction(db.pool,f.account,envelope(revision++,'FIXTURE_XP'),{},async c=>({...await finishEncounter(c,opened.instanceId as string,0,'VICTORY',async()=>({})),revision:await advanceRevision(c)}));
  for(let n=0;n<4;n++)await levelUp(db.pool,f.account,envelope(revision++,'LEVEL_UP'),'class.one');
  await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,'subclass.guard','DISCOVERED')",[f.account]);
  await chooseSubclass(db.pool,f.account,envelope(revision++,'CHOOSE_SUBCLASS'),'subclass.guard');
  const b=await fight(db.pool,{...f,revision});await b.act({actorId:'hero',kind:'END'});
  assert.equal(b.get().units[0].health,34);
  const snapshot=(await db.pool.query('SELECT derived FROM character_encounter_snapshots WHERE instance_id=$1',[b.get().instanceId])).rows[0].derived;
  assert.equal(snapshot.stats.armor,7);assert.ok(snapshot.sources.some((s:any)=>s.entityId==='subclass.guard'&&s.amount===4));
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{await db.close();}
});
test('enemy-first fights advance with a separate request and can settle defeat without colliding Turn costs',async()=>{
 const db=await testDatabase();try{
  const p=tacticalPackage();specOf(p).allies=[];const enemy=p.entities.find(e=>e.id==='monster.tactical')!.definition.mechanics!.tacticalUnit as any;
  enemy.stats.initiative=10;enemy.stats.attackMin=100;enemy.stats.attackMax=100;
  const f=await tacticalFixture(db.pool,p),v=json(await startTacticalCombat(db.pool,f.account,envelope(f.revision,'START_TACTICAL'),'encounter.tactical'));
  assert.equal(v.currentActor,'enemy');
  const result=await takeTacticalAction(db.pool,f.account,envelope(v.revision),v.instanceId,v.encounterRevision,v.tacticalRevision,{actorId:'hero',kind:'CONTINUE'});
  assert.equal(result.outcome,'DEFEAT');assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM turn_ledger WHERE run_id=$1',[f.run])).rows[0].n,2);
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{await db.close();}
});
test('restricted runtime can play and settle tactical combat while journal edits remain denied',async()=>{
 const {randomUUID}=await import('node:crypto');const role=`tactical_${randomUUID().replaceAll('-','')}`;
 const db=await testDatabase();let created=false;try{
  const f=await tacticalFixture(db.pool);
  await db.pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);created=true;
  await db.pool.query(`GRANT USAGE ON SCHEMA ${db.schema} TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA ${db.schema} TO ${role};
   GRANT UPDATE(security_epoch) ON accounts TO ${role}; GRANT UPDATE ON runs,run_builds,run_progression,instances,state_scopes,inventory_containers,encounter_records,tactical_run_state,inventory_items TO ${role};
   GRANT INSERT ON instances,instance_participants,state_scopes,encounter_records,encounter_draws,character_encounter_snapshots,encounter_reward_plans,encounter_reward_claims,encounter_reward_items,encounter_xp_plans,run_xp_awards,tactical_run_state,tactical_encounter_origins,tactical_steps,tactical_recoveries,action_receipts,turn_ledger,audit_events,outbox_events,inventory_items,inventory_quantity_operations TO ${role};
   GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ${db.schema} TO ${role}`);
  const client=await db.pool.connect();try{
   await client.query(`SET ROLE ${role}`);
   const pool={query:client.query.bind(client),connect:async()=>({query:client.query.bind(client),release:()=>{}})} as unknown as import('pg').Pool;
   const b=await fight(pool,f);await b.act({actorId:'hero',kind:'ATTACK',targetId:'enemy'});await b.act({actorId:'hero',kind:'END'});await b.act({actorId:'ally',kind:'ATTACK',targetId:'enemy'});
   assert.equal(b.get().outcome,'VICTORY');
   for(const table of ['tactical_encounter_origins','tactical_steps','tactical_recoveries'])await assert.rejects(client.query(`DELETE FROM ${table}`),error=>(error as {code:string}).code==='42501');
  }finally{await client.query('RESET ROLE');client.release();}
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{await db.close();if(created){const admin=(await import('../src/database.js')).poolFor(process.env.TEST_DATABASE_URL!);try{await admin.query(`DROP ROLE ${role}`);}finally{await admin.end();}}}
});

function typedPackage(){
 const p=tacticalPackage();p.version='typed-damage-fixture';
 specOf(p).rules.typedDamage={version:1,types:['slashing','fire','cold'],defaultType:'slashing',resistanceStacking:'SUM_CAPPED'};
 const mechanics=(id:string)=>p.entities.find(e=>e.id===id)!.definition.mechanics!;
 mechanics('class.one').tacticalDamageTraits={version:1,minimumNativeLevel:1,penetration:1,resistances:{fire:1000}};
 mechanics('feat.vigor').tacticalDamageTraits={version:1,minimumNativeLevel:0,resistances:{fire:1000}};
 mechanics('item.sword').tacticalDamageTraits={version:1,minimumNativeLevel:0,attackType:'fire',penetration:2};
 mechanics('item.shield').tacticalDamageTraits={version:1,minimumNativeLevel:0,resistances:{fire:4000}};
 // Keep the hero the lowest-health active party target for the enemy-pipeline assertion.
 (mechanics('npc.ally').tacticalUnit as any).stats.maxHealth=50;
 const enemy=mechanics('monster.tactical').tacticalUnit as any;enemy.stats.armor=5;
 enemy.damageTraits={version:1,minimumNativeLevel:0,attackType:'fire',penetration:2,resistances:{fire:5000,cold:10000}};
 return p;
}
test('typed traits from pinned class/feat/active gear execute, reconnect and independently replay; enemy defense stays hidden',async()=>{
 const db=await testDatabase();try{
  const p=typedPackage(),f=await tacticalFixture(db.pool,p),b=await fight(db.pool,f);
  const profile=b.get().partyCapabilities[0].damageProfile;
  assert.equal(profile.attackType,'fire');assert.equal(profile.penetration,3);assert.equal(profile.resistances.fire,6000);
  const republished=structuredClone(p);republished.version='typed-damage-new';for(const e of republished.entities)e.revision=2;
  republished.entities.find(e=>e.id==='item.sword')!.definition.mechanics!.tacticalDamageTraits={version:1,minimumNativeLevel:0,attackType:'cold',penetration:20};
  await (await import('../src/domains/content.js')).publishContent(db.pool,republished);
  const read=json(await tacticalView(db.pool,f.account,b.get().instanceId));assert.deepEqual(read.partyCapabilities,b.get().partyCapabilities);
  assert.ok(read.units.every((u:any)=>!Object.hasOwn(u,'damageProfile')));
  const request=envelope(b.get().revision),v=b.get(),command={actorId:'hero',kind:'ATTACK' as const,targetId:'enemy'};
  const results=await Promise.all([0,1,2].map(()=>takeTacticalAction(db.pool,f.account,request,v.instanceId,v.encounterRevision,v.tacticalRevision,command)));
  assert.equal(results.filter(r=>!r.replayed).length,1);
  const step=(await db.pool.query('SELECT evidence,state FROM tactical_steps ORDER BY revision LIMIT 1')).rows[0];
  assert.equal(step.evidence.damageType,'fire');assert.equal(step.evidence.attack.effectiveArmor,2);assert.equal(step.evidence.attack.damage,3);assert.equal(step.state.units[2].health,9);
  const now=json(await tacticalView(db.pool,f.account,v.instanceId));
  const end=async(actorId:string)=>{const n=json(await tacticalView(db.pool,f.account,v.instanceId));return takeTacticalAction(db.pool,f.account,envelope(n.revision),n.instanceId,n.encounterRevision,n.tacticalRevision,{actorId,kind:'END'});};
  assert.equal(now.tacticalRevision,1);await end('hero');await end('ally');
  const enemyStep=(await db.pool.query("SELECT evidence,state FROM tactical_steps WHERE control='SERVER' AND intent->>'kind'='ATTACK'")).rows[0];
  assert.equal(enemyStep.evidence.damageType,'fire');assert.equal(enemyStep.evidence.attack.effectiveArmor,1);assert.equal(enemyStep.evidence.attack.damage,2);assert.equal(enemyStep.state.units[0].health,33);
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
  await db.pool.query('ALTER TABLE tactical_steps DISABLE TRIGGER tactical_step_immutable');
  await db.pool.query("UPDATE tactical_steps SET evidence=jsonb_set(evidence,'{damageType}','\"cold\"'::jsonb) WHERE revision=1");
  await db.pool.query('ALTER TABLE tactical_steps ENABLE TRIGGER tactical_step_immutable');
  assert.ok((await integrityReport(db.pool)).tacticalMismatches>0);
 }finally{await db.close();}
});
test('conflicting owned attack types reject start atomically and native-level traits stay locked',async()=>{
 const db=await testDatabase();try{
  const p=typedPackage();p.entities.find(e=>e.id==='class.one')!.definition.mechanics!.tacticalDamageTraits={version:1,minimumNativeLevel:1,attackType:'cold'};
  const f=await tacticalFixture(db.pool,p);const before=(await db.pool.query('SELECT turns,revision FROM runs WHERE id=$1',[f.run])).rows[0];
  await assert.rejects(startTacticalCombat(db.pool,f.account,envelope(f.revision,'START_TACTICAL'),'encounter.tactical'),/CONFLICTING_TACTICAL_ATTACK_TYPES/);
  assert.deepEqual((await db.pool.query('SELECT turns,revision FROM runs WHERE id=$1',[f.run])).rows[0],before);
  for(const table of ['encounter_records','tactical_encounter_origins','character_encounter_snapshots','encounter_reward_plans'])assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,0);
  const gated=typedPackage();gated.version='typed-damage-gated';for(const e of gated.entities)e.revision=2;
  gated.entities.find(e=>e.id==='class.one')!.definition.mechanics!.tacticalDamageTraits={version:1,minimumNativeLevel:5,attackType:'cold',penetration:100};
  const fresh=await tacticalFixture(db.pool,gated),b=await fight(db.pool,fresh);
  assert.equal(b.get().partyCapabilities[0].damageProfile.attackType,'fire');assert.equal(b.get().partyCapabilities[0].damageProfile.penetration,2);
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{await db.close();}
});
test('typed publication rejects undeclared template types, invalid traits/sources/gates and implicit stacking',()=>{
 const good=typedPackage();assert.doesNotThrow(()=>validateContent(good));
 for(const mutate of [(p:typeof good)=>{(specOf(p).rules.typedDamage as any).resistanceStacking='AUTO';},(p:typeof good)=>{(p.entities.find(e=>e.id==='monster.tactical')!.definition.mechanics!.tacticalUnit as any).damageTraits.attackType='psychic';},(p:typeof good)=>{p.entities.find(e=>e.id==='item.ore')!.definition.mechanics!.tacticalDamageTraits={version:1,minimumNativeLevel:0,penetration:3};},(p:typeof good)=>{(p.entities.find(e=>e.id==='item.shield')!.definition.mechanics!.tacticalDamageTraits as any).minimumNativeLevel=1;},(p:typeof good)=>{(p.entities.find(e=>e.id==='item.shield')!.definition.mechanics!.tacticalDamageTraits as any).resistances.fire=10001;},(p:typeof good)=>{delete p.entities.find(e=>e.id==='item.sword')!.definition.mechanics!.combatModifiers;}]){
  const p=structuredClone(good);mutate(p);assert.throws(()=>validateContent(p));
 }
});
