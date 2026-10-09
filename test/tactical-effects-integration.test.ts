import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { testDatabase,actor } from './helpers.js';
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
function effectsPackage(){
 const p=tacticalPackage();p.version='round-effects-fixture';
 const m=(id:string)=>p.entities.find(e=>e.id===id)!.definition.mechanics!;
 const spec=json(m('encounter.tactical').tacticalCombat);spec.rules.roundEffects={version:1};spec.rules.roundLimit=20;
 json(m('monster.tactical').tacticalUnit).stats.maxHealth=60;json(m('monster.tactical').tacticalUnit).stats.armor=6;
 json(m('npc.ally').tacticalUnit).stats.maxHealth=100;
 for(const [id,stat,amount] of [['exposed','armor',-4],['shaken','evasion',-2],['weapon','armor',-1],['frayed','armor',-2]] as const)p.entities.push({id:`effect.${id}`,kind:'EFFECT',revision:1,schemaVersion:1,definition:{name:`Test ${id}`,dependencies:[],public:{},mechanics:{tacticalRoundEffect:{version:1,clock:'ROUNDS',tick:'OWNER_END',family:id,stacking:'REFRESH',rounds:2,polarity:'HARMFUL',tags:['condition','physical'],modifiers:[{stat,amount}]}}}});
 for(const [source,id,level] of [['class.one','exposed',1],['feat.vigor','shaken',0],['item.sword','weapon',0],['monster.tactical','frayed',0]] as const){m(source).tacticalOnHitEffects={version:1,minimumNativeLevel:level,effectIds:[`effect.${id}`]};p.entities.find(e=>e.id===source)!.definition.dependencies.push(`effect.${id}`);}
 return p;
}
async function battle(pool:pg.Pool,f:any){let v=json(await startTacticalCombat(pool,f.account,envelope(f.revision,'START_TACTICAL'),'encounter.tactical'));return {get:()=>v,act:async(command:TacticalCommand)=>{v=json(await takeTacticalAction(pool,f.account,envelope(v.revision),v.instanceId,v.encounterRevision,v.tacticalRevision,command));return v;}};}
const clean=async(pool:pg.Pool)=>assert.ok(Object.values(await integrityReport(pool)).every(n=>n===0));
test('pinned class, feat, active gear and creature conditions execute, reconnect and independently replay',async()=>{
 const db=await testDatabase();try{
  const p=effectsPackage(),f=await tacticalFixture(db.pool,p),b=await battle(db.pool,f);
  assert.deepEqual(b.get().partyCapabilities[0].onHitEffects.map((g:any)=>g.effectId).sort(),['effect.exposed','effect.shaken','effect.weapon']);
  const first=await b.act({actorId:'hero',kind:'ATTACK',targetId:'enemy'});assert.equal(first.units[2].health,58);assert.equal(first.units[2].effects.length,3);
  const origin=(await db.pool.query('SELECT initial_checkpoint FROM tactical_encounter_origins')).rows[0].initial_checkpoint;
  const sources=origin.state.units[0].onHitEffects;assert.ok(sources.some((g:any)=>g.sourceId==='item.sword'&&g.sourceInstanceId===f.gear.sword));assert.ok(sources.every((g:any)=>g.effectRevision===1&&g.sourceRevision===1));
  const newer=structuredClone(p);newer.version='round-effects-fixture-2';for(const e of newer.entities)e.revision=2;json(newer.entities.find(e=>e.id==='effect.exposed')!.definition.mechanics!.tacticalRoundEffect).modifiers[0].amount=-99;await publishContent(db.pool,newer);
  const resumed=json(await tacticalView(db.pool,f.account,first.instanceId));assert.deepEqual(resumed,projection(first));
  assert.ok(resumed.units.every((u:any)=>!Object.hasOwn(u,'onHitEffects')));assert.ok(!JSON.stringify(resumed).includes('sourceRevision'));assert.ok(!JSON.stringify(resumed).includes('sourceInstanceId'));
  await b.act({actorId:'hero',kind:'END'});const second=await b.act({actorId:'ally',kind:'ATTACK',targetId:'enemy'});assert.equal(second.units[2].health,55);
  await b.act({actorId:'ally',kind:'END'});assert.equal(b.get().units[2].effects[0].remaining,1);assert.equal(b.get().units[0].health,30);assert.equal(b.get().units[0].effects[0].effectId,'effect.frayed');
  await b.act({actorId:'hero',kind:'ATTACK',targetId:'enemy'});const refreshed=b.get().units[2].effects;assert.ok(refreshed.every((e:any)=>e.remaining===2));assert.equal(refreshed[0].modifiers[0].amount,-4);
  await clean(db.pool);
 }finally{await db.close();}
});
test('duplicate requests tick duration once; stale and illegal intents leave draws, receipts and effects unchanged',async()=>{
 const db=await testDatabase();try{
  const f=await tacticalFixture(db.pool,effectsPackage()),b=await battle(db.pool,f);await b.act({actorId:'hero',kind:'ATTACK',targetId:'enemy'});await b.act({actorId:'hero',kind:'END'});
  const v=b.get(),request=envelope(v.revision),command={actorId:'ally',kind:'END' as const};
  const results=await Promise.all([0,1,2].map(()=>takeTacticalAction(db.pool,f.account,request,v.instanceId,v.encounterRevision,v.tacticalRevision,command)));
  assert.equal(results.filter(r=>!r.replayed).length,1);const after=json(await tacticalView(db.pool,f.account,v.instanceId));assert.ok(after.units[2].effects.every((e:any)=>e.remaining===1));
  const before=(await db.pool.query('SELECT checkpoint FROM encounter_records WHERE instance_id=$1',[v.instanceId])).rows;
  await assert.rejects(takeTacticalAction(db.pool,f.account,envelope(after.revision),v.instanceId,v.encounterRevision,v.tacticalRevision,{actorId:'ally',kind:'END'}),/STALE/);
  await assert.rejects(takeTacticalAction(db.pool,f.account,envelope(after.revision),after.instanceId,after.encounterRevision,after.tacticalRevision,{actorId:'hero',kind:'ATTACK',targetId:'hero'}),/ILLEGAL/);
  assert.deepEqual((await db.pool.query('SELECT checkpoint FROM encounter_records WHERE instance_id=$1',[v.instanceId])).rows,before);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM action_receipts WHERE request_id=$1',[request.requestId])).rows[0].n,1);
  await clean(db.pool);
 }finally{await db.close();}
});
test('late failure rolls back conditions and draws; immutable history and replay detect forged effect evidence',async()=>{
 const db=await testDatabase();try{
  const f=await tacticalFixture(db.pool,effectsPackage()),b=await battle(db.pool,f),before=b.get();
  await db.pool.query("CREATE FUNCTION fail_effect() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Late effect failure'; END $$; CREATE TRIGGER fail_effect BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_effect()");
  await assert.rejects(b.act({actorId:'hero',kind:'ATTACK',targetId:'enemy'}),/Late effect failure/);assert.deepEqual(json(await tacticalView(db.pool,f.account,before.instanceId)),projection(before));
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM tactical_steps')).rows[0].n,0);assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM encounter_draws WHERE stream='tactical'")).rows[0].n,0);
  await db.pool.query('DROP TRIGGER fail_effect ON audit_events');await b.act({actorId:'hero',kind:'ATTACK',targetId:'enemy'});await clean(db.pool);
  await assert.rejects(db.pool.query('UPDATE tactical_steps SET evidence=evidence'),/Immutable/);
  await db.pool.query('ALTER TABLE tactical_steps DISABLE TRIGGER tactical_step_immutable');await db.pool.query("UPDATE tactical_steps SET evidence=jsonb_set(evidence,'{effectEvents,0,remaining}','99'::jsonb)");await db.pool.query('ALTER TABLE tactical_steps ENABLE TRIGGER tactical_step_immutable');assert.ok((await integrityReport(db.pool)).tacticalMismatches>0);
 }finally{await db.close();}
});
test('locked class levels, unselected subclasses and inactive equipment do not grant effects; ambiguous owned families reject start atomically',async()=>{
 const db=await testDatabase();try{
  const p=effectsPackage(),m=(id:string)=>p.entities.find(e=>e.id===id)!.definition.mechanics!;
  json(m('class.one').tacticalOnHitEffects).minimumNativeLevel=5;
  m('subclass.guard').tacticalOnHitEffects={version:1,minimumNativeLevel:0,effectIds:['effect.frayed']};p.entities.find(e=>e.id==='subclass.guard')!.definition.dependencies.push('effect.frayed');
  const f=await tacticalFixture(db.pool,p);await setEquipment(db.pool,f.account,envelope(f.revision,'SET_EQUIPMENT'),{activeSet:'B',slots:[{set:'A',slot:'MAIN_HAND',itemId:f.gear.sword!},{set:'A',slot:'OFF_HAND',itemId:f.gear.shield!}]});f.revision++;
  const b=await battle(db.pool,f);assert.deepEqual(b.get().partyCapabilities[0].onHitEffects.map((g:any)=>g.effectId),['effect.shaken']);await clean(db.pool);
  const ambiguous=effectsPackage();ambiguous.entities.find(e=>e.id==='item.shield')!.definition.mechanics!.tacticalOnHitEffects={version:1,minimumNativeLevel:0,effectIds:['effect.exposed']};ambiguous.entities.find(e=>e.id==='item.shield')!.definition.dependencies.push('effect.exposed');
  for(const e of ambiguous.entities)e.revision=2;const other=await tacticalFixture(db.pool,{...ambiguous,version:'ambiguous-effects'}),count=(await db.pool.query('SELECT count(*)::int AS n FROM encounter_records')).rows[0].n;
  await assert.rejects(battle(db.pool,other),/CONFLICTING_TACTICAL_EFFECT_GRANTS/);assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM encounter_records')).rows[0].n,count);
 }finally{await db.close();}
});
test('terminal settlement retains immutable effects but starts the next fight with none, without duplicate rewards',async()=>{
 const db=await testDatabase();try{
  const f=await tacticalFixture(db.pool,effectsPackage()),b=await battle(db.pool,f);
  for(let n=0;n<100&&b.get().outcome===null;n++){
   const v=b.get(),id=v.currentActor;await b.act(v.budgets[id].main===1?{actorId:id,kind:'ATTACK',targetId:'enemy'}:{actorId:id,kind:'END'});
  }
  assert.equal(b.get().outcome,'VICTORY');const ended=b.get();assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM encounter_reward_claims')).rows[0].n,1);
  const next=await battle(db.pool,{...f,revision:ended.revision});assert.ok(next.get().units.every((u:any)=>u.effects.length===0));assert.deepEqual(json(await tacticalView(db.pool,f.account,ended.instanceId)),{...projection(ended),revision:next.get().revision});await clean(db.pool);
 }finally{await db.close();}
});
test('publication rejects missing dependencies, invalid sources, family-policy conflicts and unsupported hooks',()=>{
 const good=effectsPackage();assert.doesNotThrow(()=>validateContent(good));
 for(const mutate of [(p:typeof good)=>{p.entities.find(e=>e.id==='class.one')!.definition.dependencies=[];},(p:typeof good)=>{p.entities.find(e=>e.id==='effect.exposed')!.kind='ITEM';},(p:typeof good)=>{p.entities.find(e=>e.id==='item.ore')!.definition.mechanics!.tacticalOnHitEffects={version:1,minimumNativeLevel:0,effectIds:['effect.exposed']};},(p:typeof good)=>{json(p.entities.find(e=>e.id==='effect.weapon')!.definition.mechanics!.tacticalRoundEffect).family='exposed';json(p.entities.find(e=>e.id==='effect.weapon')!.definition.mechanics!.tacticalRoundEffect).stacking='REPLACE';},(p:typeof good)=>{json(p.entities.find(e=>e.id==='effect.exposed')!.definition.mechanics!.tacticalRoundEffect).clock='ADVENTURE_TURNS';},(p:typeof good)=>{json(p.entities.find(e=>e.id==='effect.exposed')!.definition.mechanics!.tacticalRoundEffect).control='STUN';}]){const p=structuredClone(good);mutate(p);assert.throws(()=>validateContent(p));}
});
test('authenticated API rejects effect injection, enemy control and foreign reads while disclosing active clocks',async()=>{
 const db=await testDatabase(),app=buildApp(db.pool,{mode:'sessions',throttleKey:'e'.repeat(64)});try{
  const f=await tacticalFixture(db.pool,effectsPackage()),password='Test effects password 55!';await enrollPassword(db.pool,f.account,'effects_user',password);const login=await requireLogin(db.pool,'effects_user',password,'Effects'),headers={authorization:`Bearer ${login.token}`};
  const v=json(await startTacticalCombat(db.pool,f.account,envelope(f.revision,'START_TACTICAL'),'encounter.tactical')),payload={...envelope(v.revision),instanceId:v.instanceId,expectedEncounterRevision:v.encounterRevision,expectedTacticalRevision:v.tacticalRevision,command:{actorId:'hero',kind:'ATTACK',targetId:'enemy'}};
  assert.equal((await app.inject({method:'POST',url:'/api/v1/tactical/actions',headers,payload:{...payload,command:{...payload.command,effectIds:['effect.exposed']}}})).statusCode,400);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/tactical/actions',headers,payload:{...payload,command:{actorId:'enemy',kind:'END'}}})).statusCode,403);
  const done=await app.inject({method:'POST',url:'/api/v1/tactical/actions',headers,payload});assert.equal(done.statusCode,200,done.body);assert.equal(done.json().units[2].effects[0].tick,'OWNER_END');assert.equal(done.json().units[2].effects[0].remaining,2);
  const foreign=await actor(db.pool,f.release);await assert.rejects(tacticalView(db.pool,foreign.account,v.instanceId),/NOT_FOUND/);await clean(db.pool);
 }finally{await app.close();await db.close();}
});
test('restricted runtime executes and settles effects with existing journal permissions',async()=>{
 const db=await testDatabase(),role=`effects_${randomUUID().replaceAll('-','')}`;let created=false;try{
  const f=await tacticalFixture(db.pool,effectsPackage());await db.pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);created=true;
  await db.pool.query(`GRANT USAGE ON SCHEMA ${db.schema} TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA ${db.schema} TO ${role}; GRANT UPDATE(security_epoch) ON accounts TO ${role}; GRANT UPDATE ON runs,run_builds,run_progression,instances,state_scopes,inventory_containers,encounter_records,tactical_run_state,inventory_items TO ${role}; GRANT INSERT ON instances,instance_participants,state_scopes,encounter_records,encounter_draws,character_encounter_snapshots,encounter_reward_plans,encounter_reward_claims,encounter_reward_items,encounter_xp_plans,run_xp_awards,tactical_run_state,tactical_encounter_origins,tactical_steps,tactical_recoveries,action_receipts,turn_ledger,audit_events,outbox_events,inventory_items,inventory_quantity_operations TO ${role}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ${db.schema} TO ${role}`);
  const client=await db.pool.connect();try{
   await client.query(`SET ROLE ${role}`);const pool={query:client.query.bind(client),connect:async()=>({query:client.query.bind(client),release:()=>{}})} as unknown as pg.Pool,b=await battle(pool,f);
   for(let n=0;n<100&&b.get().outcome===null;n++){const v=b.get(),id=v.currentActor;await b.act(v.budgets[id].main===1?{actorId:id,kind:'ATTACK',targetId:'enemy'}:{actorId:id,kind:'END'});}assert.equal(b.get().outcome,'VICTORY');
   await assert.rejects(client.query('DELETE FROM tactical_steps'),e=>(e as {code:string}).code==='42501');
  }finally{await client.query('RESET ROLE');client.release();}await clean(db.pool);
 }finally{if(created){await db.pool.query(`DROP OWNED BY ${role}`);await db.pool.query(`DROP ROLE ${role}`);}await db.close();}
});
