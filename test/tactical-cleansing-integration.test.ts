import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { testDatabase } from './helpers.js';
import { tacticalPackage,tacticalFixture,envelope } from './tactical-fixture.js';
import { validateContent,publishContent } from '../src/domains/content.js';
import { startTacticalCombat,takeTacticalAction,tacticalView } from '../src/domains/tactical-combat.js';
import { integrityReport } from '../src/foundation/integrity.js';
import { setEquipment } from '../src/domains/equipment.js';
import { buildApp } from '../src/app.js';
import { enrollPassword,requireLogin } from '../src/auth/sessions.js';
import type { TacticalCommand } from '../src/domains/tactical-encounters.js';
const json=(v:unknown)=>v as any;
const projection=(v:any)=>{const {actionId,requestId,rulesVersion,replayed,...rest}=v;return rest;};
const kit=(minimumNativeLevel=1)=>({version:1,minimumNativeLevel,method:'CURE',tags:['poison'],strength:4,manaCost:2,range:0,targetSide:'ALLY'});
function cleansingPackage(){
 const p=tacticalPackage();p.version='cleansing-fixture';const m=(id:string)=>p.entities.find(e=>e.id===id)!.definition.mechanics!;
 const spec=json(m('encounter.tactical').tacticalCombat);spec.rules.roundEffects={version:3};spec.rules.typedDamage={version:1,types:['fire','slashing'],defaultType:'slashing',resistanceStacking:'SUM_CAPPED'};spec.allies=[];
 json(m('monster.tactical').tacticalUnit).stats.maxHealth=100;
 p.entities.push({id:'effect.poisoned',kind:'EFFECT',revision:1,schemaVersion:1,definition:{name:'Test poison',dependencies:[],public:{},mechanics:{tacticalRoundEffect:{version:3,clock:'ROUNDS',tick:'OWNER_END',family:'poisoned',stacking:'REFRESH',rounds:3,polarity:'HARMFUL',tags:['poison','condition'],modifiers:[],periodic:{kind:'DAMAGE',timing:'OWNER_END',amount:6,damageType:'fire',armor:'BYPASS',penetration:0},removal:{method:'CURE',difficulty:4}}}}});
 m('class.one').tacticalCleansing=kit();m('monster.tactical').tacticalOnHitEffects={version:1,minimumNativeLevel:0,effectIds:['effect.poisoned']};p.entities.find(e=>e.id==='monster.tactical')!.definition.dependencies.push('effect.poisoned');return p;
}
const cure={actorId:'hero',kind:'CLEANSE' as const,targetId:'hero',abilityId:'class.one',effectId:'effect.poisoned'};
async function battle(pool:pg.Pool,f:any){let v=json(await startTacticalCombat(pool,f.account,envelope(f.revision,'START_TACTICAL'),'encounter.tactical'));return {get:()=>v,act:async(command:TacticalCommand)=>{v=json(await takeTacticalAction(pool,f.account,envelope(v.revision),v.instanceId,v.encounterRevision,v.tacticalRevision,command));return v;}};}
const clean=async(pool:pg.Pool)=>assert.ok(Object.values(await integrityReport(pool)).every(n=>n===0));
test('owned typed Cure removes a selected poison once, preserves source history, stops its pulse and pins capability across publication/reconnect',async()=>{
 const db=await testDatabase();try{
  const p=cleansingPackage(),f=await tacticalFixture(db.pool,p),b=await battle(db.pool,f);await b.act({actorId:'hero',kind:'END'});assert.equal(b.get().units[0].health,30);assert.equal(b.get().units[0].effects[0].removal.method,'CURE');
  const newer=structuredClone(p);newer.version='cleansing-fixture-2';for(const e of newer.entities)e.revision=2;json(newer.entities.find(e=>e.id==='class.one')!.definition.mechanics!.tacticalCleansing).strength=99;await publishContent(db.pool,newer);
  const v=b.get(),request=envelope(v.revision);const results=await Promise.all([0,1,2].map(()=>takeTacticalAction(db.pool,f.account,request,v.instanceId,v.encounterRevision,v.tacticalRevision,cure)));assert.equal(results.filter(r=>!r.replayed).length,1);const after=json(results[0]);assert.deepEqual(after.units[0].effects,[]);assert.equal(after.units[0].mana,4);assert.equal(after.budgets.hero.main,0);assert.equal(after.partyCapabilities[0].cleansingAbilities[0].strength,4);
  assert.deepEqual(json(await tacticalView(db.pool,f.account,v.instanceId)),projection(after));assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM encounter_draws WHERE stream='tactical'")).rows[0].n,2);
  const evidence=(await db.pool.query("SELECT evidence->'cleansingEvents'->0 AS e FROM tactical_steps WHERE intent->>'kind'='CLEANSE'")).rows[0].e;assert.equal(evidence.abilityRevision,1);assert.equal(evidence.removed.sourceId,'monster.tactical');assert.equal(evidence.removed.sourceUnitId,'enemy');assert.equal(evidence.removed.effectRevision,1);assert.equal(evidence.removed.remaining,3);
  await takeTacticalAction(db.pool,f.account,envelope(after.revision),v.instanceId,after.encounterRevision,after.tacticalRevision,{actorId:'hero',kind:'END'});const now=json(await tacticalView(db.pool,f.account,v.instanceId));assert.equal(now.units[0].health,25);await clean(db.pool);
 }finally{await db.close();}
});
test('server enemy self-cleansing obeys the same channel, Main and mana costs and independently replays its decision',async()=>{
 const db=await testDatabase();try{
  const p=cleansingPackage(),m=(id:string)=>p.entities.find(e=>e.id===id)!.definition.mechanics!;
  m('monster.tactical').tacticalCleansing=kit(0);m('class.one').tacticalOnHitEffects={version:1,minimumNativeLevel:1,effectIds:['effect.poisoned']};p.entities.find(e=>e.id==='class.one')!.definition.dependencies.push('effect.poisoned');
  const f=await tacticalFixture(db.pool,p),b=await battle(db.pool,f);await b.act({actorId:'hero',kind:'ATTACK',targetId:'enemy'});await b.act({actorId:'hero',kind:'END'});assert.equal(b.get().units[1].health,92);assert.equal(b.get().units[1].mana,4);assert.deepEqual(b.get().units[1].effects,[]);assert.equal(b.get().units[0].health,35);
  const step=(await db.pool.query("SELECT control,intent,state,evidence FROM tactical_steps WHERE intent->>'kind'='CLEANSE'")).rows[0];assert.equal(step.control,'SERVER');assert.equal(step.intent.abilityId,'monster.tactical');assert.equal(step.state.budgets.enemy.main,0);assert.equal(step.evidence.cleansingEvents[0].removed.sourceUnitId,'hero');await clean(db.pool);
 }finally{await db.close();}
});
test('active defensive gear dispels an authored enemy ward with pinned item provenance and cannot chain another Main action',async()=>{
 const db=await testDatabase();try{
  const p=cleansingPackage();p.entities.push({id:'effect.ward',kind:'EFFECT',revision:1,schemaVersion:1,definition:{name:'Test enemy ward',dependencies:[],public:{},mechanics:{tacticalRoundEffect:{version:3,clock:'ROUNDS',tick:'OWNER_END',family:'ward',stacking:'REFRESH',rounds:3,polarity:'BENEFICIAL',tags:['magical'],modifiers:[{stat:'armor',amount:4}],removal:{method:'DISPEL',difficulty:4}}}}});
  // This fixture's authored on-hit ward supplies a visible enemy buff to counter.
  const cls=p.entities.find(e=>e.id==='class.one')!;cls.definition.mechanics!.tacticalOnHitEffects={version:1,minimumNativeLevel:1,effectIds:['effect.ward']};cls.definition.dependencies.push('effect.ward');p.entities.find(e=>e.id==='item.shield')!.definition.mechanics!.tacticalCleansing={...kit(0),method:'DISPEL',tags:['magical'],targetSide:'ENEMY'};
  const f=await tacticalFixture(db.pool,p),b=await battle(db.pool,f);await b.act({actorId:'hero',kind:'ATTACK',targetId:'enemy'});await b.act({actorId:'hero',kind:'END'});
  await b.act({actorId:'hero',kind:'CLEANSE',targetId:'enemy',abilityId:'item.shield',effectId:'effect.ward'});assert.deepEqual(b.get().units[1].effects,[]);assert.equal(b.get().units[0].mana,4);await assert.rejects(b.act(cure),/ILLEGAL/);
  const e=(await db.pool.query("SELECT evidence->'cleansingEvents'->0 AS e FROM tactical_steps WHERE intent->>'kind'='CLEANSE'")).rows[0].e;assert.deepEqual(e.abilityInstanceIds,[f.gear.shield]);assert.equal(e.method,'DISPEL');await clean(db.pool);
 }finally{await db.close();}
});
test('locked native classes, unselected subclasses and inactive gear cannot grant cleansing abilities or bypass ownership',async()=>{
 const db=await testDatabase();try{
  const p=cleansingPackage();p.entities.find(e=>e.id==='class.one')!.definition.mechanics!.tacticalCleansing=kit(5);p.entities.find(e=>e.id==='subclass.guard')!.definition.mechanics!.tacticalCleansing=kit(0);p.entities.find(e=>e.id==='item.shield')!.definition.mechanics!.tacticalCleansing=kit(0);
  const f=await tacticalFixture(db.pool,p);await setEquipment(db.pool,f.account,envelope(f.revision,'SET_EQUIPMENT'),{activeSet:'B',slots:[{set:'A',slot:'MAIN_HAND',itemId:f.gear.sword!},{set:'A',slot:'OFF_HAND',itemId:f.gear.shield!}]});f.revision++;
  const b=await battle(db.pool,f);assert.deepEqual(b.get().partyCapabilities[0].cleansingAbilities,[]);for(const abilityId of ['class.one','subclass.guard','item.shield'])await assert.rejects(b.act({...cure,abilityId}),/ILLEGAL/);assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM tactical_steps')).rows[0].n,0);await clean(db.pool);
 }finally{await db.close();}
});
test('late cleansing failure rolls back removal, mana, budgets and receipt; retry succeeds and audit detects altered removed-source evidence',async()=>{
 const db=await testDatabase();try{
  const f=await tacticalFixture(db.pool,cleansingPackage()),b=await battle(db.pool,f);await b.act({actorId:'hero',kind:'END'});const before=b.get(),request=envelope(before.revision),count=(await db.pool.query('SELECT count(*)::int AS n FROM tactical_steps')).rows[0].n;
  await db.pool.query("CREATE FUNCTION fail_cleanse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Late cleanse failure'; END $$; CREATE TRIGGER fail_cleanse BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_cleanse()");
  const act=()=>takeTacticalAction(db.pool,f.account,request,before.instanceId,before.encounterRevision,before.tacticalRevision,cure);await assert.rejects(act(),/Late cleanse failure/);assert.deepEqual(json(await tacticalView(db.pool,f.account,before.instanceId)),projection(before));assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM tactical_steps')).rows[0].n,count);assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM action_receipts WHERE request_id=$1',[request.requestId])).rows[0].n,0);
  await db.pool.query('DROP TRIGGER fail_cleanse ON audit_events');assert.equal(json(await act()).units[0].mana,4);assert.equal((await act()).replayed,true);await clean(db.pool);await assert.rejects(db.pool.query('UPDATE tactical_steps SET evidence=evidence'),/Immutable/);
  await db.pool.query('ALTER TABLE tactical_steps DISABLE TRIGGER tactical_step_immutable');await db.pool.query("UPDATE tactical_steps SET evidence=jsonb_set(evidence,'{cleansingEvents,0,removed,sourceRevision}','999'::jsonb) WHERE intent->>'kind'='CLEANSE'");await db.pool.query('ALTER TABLE tactical_steps ENABLE TRIGGER tactical_step_immutable');assert.ok((await integrityReport(db.pool)).tacticalMismatches>0);
 }finally{await db.close();}
});
test('publication rejects untyped/free cleansing, invalid source gates, ambiguous removal and older effect contracts with new metadata',()=>{
 const good=cleansingPackage();assert.doesNotThrow(()=>validateContent(good));
 for(const mutate of [(p:typeof good)=>{json(p.entities.find(e=>e.id==='class.one')!.definition.mechanics!.tacticalCleansing).manaCost=0;},(p:typeof good)=>{json(p.entities.find(e=>e.id==='class.one')!.definition.mechanics!.tacticalCleansing).minimumNativeLevel=100;},(p:typeof good)=>{p.entities.find(e=>e.id==='item.ore')!.definition.mechanics!.tacticalCleansing=kit(0);},(p:typeof good)=>{json(p.entities.find(e=>e.id==='effect.poisoned')!.definition.mechanics!.tacticalRoundEffect).removal={method:'NONE',difficulty:4};},(p:typeof good)=>{json(p.entities.find(e=>e.id==='effect.poisoned')!.definition.mechanics!.tacticalRoundEffect).version=2;},(p:typeof good)=>{json(p.entities.find(e=>e.id==='encounter.tactical')!.definition.mechanics!.tacticalCombat).rules.roundEffects.version=2;},(p:typeof good)=>{json(p.entities.find(e=>e.id==='class.one')!.definition.mechanics!.tacticalCleansing).method='REMOVE_CURSE';}]){const p=structuredClone(good);mutate(p);assert.throws(()=>validateContent(p));}
});
test('authenticated API accepts only owned ability/effect choices and rejects forged strength, enemy control and read-only writes',async()=>{
 const db=await testDatabase(),app=buildApp(db.pool,{mode:'sessions',throttleKey:'c'.repeat(64)});try{
  const f=await tacticalFixture(db.pool,cleansingPackage()),password='Test cleanse password 77!';await enrollPassword(db.pool,f.account,'cleanse_user',password);const login=await requireLogin(db.pool,'cleanse_user',password,'Cleanse'),headers={authorization:`Bearer ${login.token}`},b=await battle(db.pool,f);await b.act({actorId:'hero',kind:'END'});const v=b.get(),payload={...envelope(v.revision),instanceId:v.instanceId,expectedEncounterRevision:v.encounterRevision,expectedTacticalRevision:v.tacticalRevision,command:cure};
  for(const command of [{...cure,strength:999},{...cure,manaCost:0},{...cure,removedEffect:{}}])assert.equal((await app.inject({method:'POST',url:'/api/v1/tactical/actions',headers,payload:{...payload,command}})).statusCode,400);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/tactical/actions',headers,payload:{...payload,command:{...cure,actorId:'enemy'}}})).statusCode,403);
  const reader=await requireLogin(db.pool,'cleanse_user',password,'Reader',true);assert.equal((await app.inject({method:'POST',url:'/api/v1/tactical/actions',headers:{authorization:`Bearer ${reader.token}`},payload})).statusCode,403);
  const accepted=await app.inject({method:'POST',url:'/api/v1/tactical/actions',headers,payload});assert.equal(accepted.statusCode,200,accepted.body);assert.deepEqual(accepted.json().units[0].effects,[]);assert.ok(!accepted.body.includes('cleansingEvents'));assert.ok(!accepted.body.includes('sourceRevision'));await clean(db.pool);
 }finally{await app.close();await db.close();}
});
test('restricted runtime executes cleansing and terminal recovery using existing journal permissions',async()=>{
 const db=await testDatabase(),role=`cleanse_${randomUUID().replaceAll('-','')}`;let created=false;try{
  const f=await tacticalFixture(db.pool,cleansingPackage());await db.pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);created=true;await db.pool.query(`GRANT USAGE ON SCHEMA ${db.schema} TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA ${db.schema} TO ${role}; GRANT UPDATE(security_epoch) ON accounts TO ${role}; GRANT UPDATE ON runs,run_builds,run_progression,instances,state_scopes,inventory_containers,encounter_records,tactical_run_state,inventory_items TO ${role}; GRANT INSERT ON instances,instance_participants,state_scopes,encounter_records,encounter_draws,character_encounter_snapshots,encounter_reward_plans,encounter_reward_claims,encounter_reward_items,encounter_xp_plans,run_xp_awards,tactical_run_state,tactical_encounter_origins,tactical_steps,tactical_recoveries,action_receipts,turn_ledger,audit_events,outbox_events,inventory_items,inventory_quantity_operations TO ${role}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ${db.schema} TO ${role}`);
  const client=await db.pool.connect();try{await client.query(`SET ROLE ${role}`);const pool={query:client.query.bind(client),connect:async()=>({query:client.query.bind(client),release:()=>{}})} as unknown as pg.Pool,b=await battle(pool,f);await b.act({actorId:'hero',kind:'END'});await b.act(cure);await b.act({actorId:'hero',kind:'END'});await b.act({actorId:'hero',kind:'RETREAT'});assert.equal(b.get().outcome,'RETREAT');assert.equal(b.get().recovery.mana,4);await assert.rejects(client.query('DELETE FROM tactical_steps'),e=>(e as {code:string}).code==='42501');}finally{await client.query('RESET ROLE');client.release();}await clean(db.pool);
 }finally{if(created){await db.pool.query(`DROP OWNED BY ${role}`);await db.pool.query(`DROP ROLE ${role}`);}await db.close();}
});
