import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { testDatabase } from './helpers.js';
import { tacticalPackage,tacticalFixture,envelope } from './tactical-fixture.js';
import { publishContent,validateContent } from '../src/domains/content.js';
import { startTacticalCombat,takeTacticalAction,tacticalView } from '../src/domains/tactical-combat.js';
import { integrityReport } from '../src/foundation/integrity.js';
import { buildApp } from '../src/app.js';
import { enrollPassword,requireLogin } from '../src/auth/sessions.js';
import type { TacticalCommand } from '../src/domains/tactical-encounters.js';
const json=(v:unknown)=>v as any;
const projection=(v:any)=>{const {actionId,requestId,rulesVersion,replayed,...rest}=v;return rest;};
function periodicPackage(){
 const p=tacticalPackage();p.version='periodic-fixture';const m=(id:string)=>p.entities.find(e=>e.id===id)!.definition.mechanics!;
 const spec=json(m('encounter.tactical').tacticalCombat);spec.rules.roundEffects={version:2};spec.rules.typedDamage={version:1,types:['slashing','fire'],defaultType:'slashing',resistanceStacking:'SUM_CAPPED'};spec.allies=[];
 for(const kind of ['DAMAGE','HEAL'] as const){const id=kind==='DAMAGE'?'effect.burning':'effect.regeneration';p.entities.push({id,kind:'EFFECT',revision:1,schemaVersion:1,definition:{name:`Test ${kind}`,dependencies:[],public:{},mechanics:{tacticalRoundEffect:{version:2,clock:'ROUNDS',tick:'OWNER_END',family:kind==='DAMAGE'?'burning':'regeneration',stacking:'REFRESH',rounds:2,polarity:kind==='DAMAGE'?'HARMFUL':'BENEFICIAL',tags:['condition'],modifiers:[],periodic:kind==='DAMAGE'?{kind,timing:'OWNER_END',amount:6,damageType:'fire',armor:'BYPASS',penetration:0}:{kind,timing:'OWNER_START',amount:5}}}}});}
 m('class.one').tacticalOnHitEffects={version:1,minimumNativeLevel:1,effectIds:['effect.burning']};m('class.one').tacticalOnHealEffects={version:1,minimumNativeLevel:1,effectIds:['effect.regeneration']};p.entities.find(e=>e.id==='class.one')!.definition.dependencies.push('effect.burning','effect.regeneration');return p;
}
const specOf=(p:ReturnType<typeof periodicPackage>)=>json(p.entities.find(e=>e.id==='encounter.tactical')!.definition.mechanics!.tacticalCombat);
async function battle(pool:pg.Pool,f:any,definitionId='encounter.tactical'){let v=json(await startTacticalCombat(pool,f.account,envelope(f.revision,'START_TACTICAL'),definitionId));return {get:()=>v,act:async(command:TacticalCommand)=>{v=json(await takeTacticalAction(pool,f.account,envelope(v.revision),v.instanceId,v.encounterRevision,v.tacticalRevision,command));return v;}};}
const clean=async(pool:pg.Pool)=>assert.ok(Object.values(await integrityReport(pool)).every(n=>n===0));
test('DoT victory settles during the response turn, journals source and mitigation, and concurrent retries do not pulse/reward twice',async()=>{
 const db=await testDatabase();try{
  const f=await tacticalFixture(db.pool,periodicPackage()),b=await battle(db.pool,f);await b.act({actorId:'hero',kind:'ATTACK',targetId:'enemy'});assert.equal(b.get().units[1].health,4);assert.equal(b.get().outcome,null);
  const v=b.get(),request=envelope(v.revision),cmd={actorId:'hero',kind:'END' as const};const results=await Promise.all([0,1,2].map(()=>takeTacticalAction(db.pool,f.account,request,v.instanceId,v.encounterRevision,v.tacticalRevision,cmd)));
  assert.equal(results.filter(r=>!r.replayed).length,1);const result=json(results[0]);assert.equal(result.outcome,'VICTORY');assert.equal(result.units[0].health,30);
  const pulses=(await db.pool.query("SELECT evidence->'periodicEvents' AS pulses,intent FROM tactical_steps WHERE jsonb_array_length(evidence->'periodicEvents')>0")).rows;assert.equal(pulses.length,1);assert.equal(pulses[0].intent.actorId,'enemy');const pulse=pulses[0].pulses[0];assert.equal(pulse.amount,6);assert.equal(pulse.sourceUnitId,'hero');assert.equal(pulse.sourceId,'class.one');assert.equal(pulse.damageType,'fire');assert.equal(pulse.healthAfter,0);
  assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM encounter_draws WHERE stream='tactical'")).rows[0].n,4);assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM encounter_reward_claims')).rows[0].n,1);assert.equal((await db.pool.query('SELECT xp::text FROM run_progression WHERE run_id=$1',[f.run])).rows[0].xp,'100');await clean(db.pool);
 }finally{await db.close();}
});
test('HoT is applied by owned healing, pulses at turn start, survives reconnect/publication pins, and free reads cannot heal',async()=>{
 const db=await testDatabase();try{
  const p=periodicPackage(),monster=json(p.entities.find(e=>e.id==='monster.tactical')!.definition.mechanics!.tacticalUnit);monster.stats.maxHealth=100;monster.stats.attackMin=10;monster.stats.attackMax=10;
  const f=await tacticalFixture(db.pool,p),b=await battle(db.pool,f);await b.act({actorId:'hero',kind:'END'});assert.equal(b.get().units[0].health,28);
  await b.act({actorId:'hero',kind:'HEAL',targetId:'hero'});assert.equal(b.get().units[0].health,33);assert.equal(b.get().units[0].effects[0].periodic.kind,'HEAL');
  const before=b.get();for(let n=0;n<3;n++)assert.deepEqual(json(await tacticalView(db.pool,f.account,before.instanceId)),projection(before));
  const newer=structuredClone(p);newer.version='periodic-fixture-2';for(const e of newer.entities)e.revision=2;json(newer.entities.find(e=>e.id==='effect.regeneration')!.definition.mechanics!.tacticalRoundEffect).periodic.amount=99;await publishContent(db.pool,newer);
  const after=await b.act({actorId:'hero',kind:'END'});assert.equal(after.units[0].health,31);assert.equal(after.units[0].effects[0].remaining,1);assert.equal(after.units[0].effects[0].periodic.amount,5);assert.equal(after.units[0].mana,4);
  const pulse=(await db.pool.query("SELECT evidence->'periodicEvents'->0 AS pulse FROM tactical_steps WHERE evidence->'periodicEvents'->0->>'kind'='HEAL'")).rows[0].pulse;assert.equal(pulse.healthBefore,26);assert.equal(pulse.healthAfter,31);assert.equal(pulse.effectRevision,1);assert.equal(pulse.sourceRevision,1);await clean(db.pool);
 }finally{await db.close();}
});
test('a lethal enemy DoT settles defeat and bounded recovery once; the next encounter carries pools but no effects',async()=>{
 const db=await testDatabase();try{
  const p=periodicPackage(),monster=p.entities.find(e=>e.id==='monster.tactical')!;monster.definition.mechanics!.tacticalOnHitEffects={version:1,minimumNativeLevel:0,effectIds:['effect.burning']};monster.definition.dependencies.push('effect.burning');json(p.entities.find(e=>e.id==='effect.burning')!.definition.mechanics!.tacticalRoundEffect).periodic.amount=100;
  const f=await tacticalFixture(db.pool,p,5),b=await battle(db.pool,f);await b.act({actorId:'hero',kind:'END'});assert.equal(b.get().units[0].effects.length,1);await b.act({actorId:'hero',kind:'END'});assert.equal(b.get().outcome,'DEFEAT');assert.equal(b.get().recovery.health,5);assert.equal(b.get().recovery.turnCost,2);assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM encounter_reward_claims')).rows[0].n,0);
  const next=await battle(db.pool,{...f,revision:b.get().revision});assert.equal(next.get().units[0].health,5);assert.ok(next.get().units.every((u:any)=>u.effects.length===0));await clean(db.pool);
 }finally{await db.close();}
});
test('late periodic victory failure rolls back pulse, enemy draws, settlement and receipt; retry succeeds exactly once',async()=>{
 const db=await testDatabase();try{
  const f=await tacticalFixture(db.pool,periodicPackage()),b=await battle(db.pool,f);await b.act({actorId:'hero',kind:'ATTACK',targetId:'enemy'});const before=b.get(),request=envelope(before.revision),cmd={actorId:'hero',kind:'END' as const};
  await db.pool.query("CREATE FUNCTION fail_periodic() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Late periodic failure'; END $$; CREATE TRIGGER fail_periodic BEFORE INSERT ON encounter_reward_claims FOR EACH ROW EXECUTE FUNCTION fail_periodic()");
  const act=()=>takeTacticalAction(db.pool,f.account,request,before.instanceId,before.encounterRevision,before.tacticalRevision,cmd);await assert.rejects(act(),/Late periodic failure/);assert.deepEqual(json(await tacticalView(db.pool,f.account,before.instanceId)),projection(before));
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM tactical_steps')).rows[0].n,1);assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM encounter_draws WHERE stream='tactical'")).rows[0].n,2);assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM action_receipts WHERE request_id=$1',[request.requestId])).rows[0].n,0);
  await db.pool.query('DROP TRIGGER fail_periodic ON encounter_reward_claims');assert.equal((await act()).outcome,'VICTORY');assert.equal((await act()).replayed,true);await clean(db.pool);
  await assert.rejects(db.pool.query('UPDATE tactical_steps SET evidence=evidence'),/Immutable/);await db.pool.query('ALTER TABLE tactical_steps DISABLE TRIGGER tactical_step_immutable');await db.pool.query("UPDATE tactical_steps SET evidence=jsonb_set(evidence,'{periodicEvents,0,amount}','99'::jsonb) WHERE jsonb_array_length(evidence->'periodicEvents')>0");await db.pool.query('ALTER TABLE tactical_steps ENABLE TRIGGER tactical_step_immutable');assert.ok((await integrityReport(db.pool)).tacticalMismatches>0);
 }finally{await db.close();}
});
test('periodic final victory creates a campaign completion proof and Aftercore with pinned prerequisite wins',async()=>{
 const db=await testDatabase();try{
  const p=periodicPackage(),final=structuredClone(p.entities.find(e=>e.id==='encounter.tactical')!);final.id='encounter.finale';json(final.definition.mechanics!.tacticalCombat).campaignId='campaign.periodic';final.definition.dependencies.push('campaign.periodic');p.entities.push(final,{id:'campaign.periodic',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'Test periodic campaign',dependencies:['encounter.tactical'],public:{},mechanics:{tacticalCampaign:{version:1,ruleset:'TACTICAL_CAMPAIGN_V1',finalEncounterId:'encounter.finale',requiresEncounterIds:['encounter.tactical']}}}});
  const f=await tacticalFixture(db.pool,p);await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,'encounter.finale','DISCOVERED')",[f.account]);const first=await battle(db.pool,f);await first.act({actorId:'hero',kind:'ATTACK',targetId:'enemy'});await first.act({actorId:'hero',kind:'END'});
  const last=await battle(db.pool,{...f,revision:first.get().revision},'encounter.finale');await last.act({actorId:'hero',kind:'ATTACK',targetId:'enemy'});await last.act({actorId:'hero',kind:'END'});assert.equal(last.get().outcome,'VICTORY');assert.equal(last.get().campaignCompleted,true);assert.equal((await db.pool.query('SELECT status FROM runs WHERE id=$1',[f.run])).rows[0].status,'AFTERCORE');assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM tactical_campaign_prerequisites')).rows[0].n,1);await clean(db.pool);
 }finally{await db.close();}
});
test('publication rejects unsupported timing, mitigation/trigger ambiguity, undeclared types and v1 periodic template grants',()=>{
 const good=periodicPackage();assert.doesNotThrow(()=>validateContent(good));
 for(const mutate of [(p:typeof good)=>{json(p.entities.find(e=>e.id==='effect.burning')!.definition.mechanics!.tacticalRoundEffect).periodic.timing='OWNER_START';},(p:typeof good)=>{json(p.entities.find(e=>e.id==='effect.burning')!.definition.mechanics!.tacticalRoundEffect).periodic.penetration=1;},(p:typeof good)=>{json(p.entities.find(e=>e.id==='class.one')!.definition.mechanics!.tacticalOnHealEffects).effectIds=['effect.burning'];},(p:typeof good)=>{const m=p.entities.find(e=>e.id==='monster.tactical')!;m.definition.dependencies.push('effect.burning');m.definition.mechanics!.tacticalOnHitEffects={version:1,minimumNativeLevel:0,effectIds:['effect.burning']};specOf(p).rules.roundEffects.version=1;},(p:typeof good)=>{const m=p.entities.find(e=>e.id==='monster.tactical')!;m.definition.dependencies.push('effect.burning');m.definition.mechanics!.tacticalOnHitEffects={version:1,minimumNativeLevel:0,effectIds:['effect.burning']};specOf(p).rules.typedDamage.types=['slashing'];}]){const p=structuredClone(good);mutate(p);assert.throws(()=>validateContent(p));}
});
test('public commands cannot inject periodic pulses or change their snapshotted strength',async()=>{
 const db=await testDatabase(),app=buildApp(db.pool,{mode:'sessions',throttleKey:'p'.repeat(64)});try{
  const f=await tacticalFixture(db.pool,periodicPackage()),password='Test periodic password 65!';await enrollPassword(db.pool,f.account,'periodic_user',password);const login=await requireLogin(db.pool,'periodic_user',password,'Periodic'),headers={authorization:`Bearer ${login.token}`},b=await battle(db.pool,f),v=b.get();
  const payload={...envelope(v.revision),instanceId:v.instanceId,expectedEncounterRevision:v.encounterRevision,expectedTacticalRevision:v.tacticalRevision,command:{actorId:'hero',kind:'ATTACK',targetId:'enemy'}};
  for(const command of [{...payload.command,periodic:{amount:999}},{actorId:'hero',kind:'PULSE'},{...payload.command,sourceUnitId:'enemy'}])assert.equal((await app.inject({method:'POST',url:'/api/v1/tactical/actions',headers,payload:{...payload,command}})).statusCode,400);
  const accepted=await app.inject({method:'POST',url:'/api/v1/tactical/actions',headers,payload});assert.equal(accepted.statusCode,200,accepted.body);assert.equal(accepted.json().units[1].effects[0].periodic.amount,6);assert.ok(!accepted.body.includes('sourceRevision'));assert.ok(!accepted.body.includes('periodicEvents'));await clean(db.pool);
 }finally{await app.close();await db.close();}
});
test('restricted runtime settles periodic victory using existing immutable journals and permissions',async()=>{
 const db=await testDatabase(),role=`periodic_${randomUUID().replaceAll('-','')}`;let created=false;try{
  const f=await tacticalFixture(db.pool,periodicPackage());await db.pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);created=true;
  await db.pool.query(`GRANT USAGE ON SCHEMA ${db.schema} TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA ${db.schema} TO ${role}; GRANT UPDATE(security_epoch) ON accounts TO ${role}; GRANT UPDATE ON runs,run_builds,run_progression,instances,state_scopes,inventory_containers,encounter_records,tactical_run_state,inventory_items TO ${role}; GRANT INSERT ON instances,instance_participants,state_scopes,encounter_records,encounter_draws,character_encounter_snapshots,encounter_reward_plans,encounter_reward_claims,encounter_reward_items,encounter_xp_plans,run_xp_awards,tactical_run_state,tactical_encounter_origins,tactical_steps,tactical_recoveries,action_receipts,turn_ledger,audit_events,outbox_events,inventory_items,inventory_quantity_operations TO ${role}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ${db.schema} TO ${role}`);
  const client=await db.pool.connect();try{await client.query(`SET ROLE ${role}`);const pool={query:client.query.bind(client),connect:async()=>({query:client.query.bind(client),release:()=>{}})} as unknown as pg.Pool,b=await battle(pool,f);await b.act({actorId:'hero',kind:'ATTACK',targetId:'enemy'});await b.act({actorId:'hero',kind:'END'});assert.equal(b.get().outcome,'VICTORY');await assert.rejects(client.query('DELETE FROM tactical_steps'),e=>(e as {code:string}).code==='42501');}finally{await client.query('RESET ROLE');client.release();}await clean(db.pool);
 }finally{if(created){await db.pool.query(`DROP OWNED BY ${role}`);await db.pool.query(`DROP ROLE ${role}`);}await db.close();}
});
