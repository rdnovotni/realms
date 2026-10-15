import { readFile } from 'node:fs/promises';
import { saveLoadout,applyLoadout } from '../src/domains/loadouts.js';
import { clientEquipmentView } from '../src/domains/client-equipment-view.js';
import { inventoryView } from '../src/domains/inventory-browser.js';
import { test } from 'node:test';
import { buildPackage } from './build-fixture.js';
import { startBuild,levelUp } from '../src/domains/builds.js';
import { beginEncounter,finishEncounter } from '../src/domains/encounters.js';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import type pg from 'pg';
import { buildApp } from '../src/app.js';
import { createInstance } from '../src/domains/instances.js';
import { actor,testDatabase } from './helpers.js';
import { publishContent,type ContentPackage } from '../src/domains/content.js';
import { executeAction,advanceRevision } from '../src/foundation/action.js';
import { grantItem,consumeItem } from '../src/domains/item-accounting.js';
import { setEquipment,equipmentView,emptyEquipment,type EquipmentPlan } from '../src/domains/equipment.js';
import { setItemLock,itemLockView } from '../src/domains/item-locks.js';
import { moveItem } from '../src/domains/inventory.js';
import { ascend } from '../src/domains/lifecycle.js';
import { integrityReport,unindexedForeignKeys } from '../src/foundation/integrity.js';
const definitions=[['sword',['MAIN_HAND','OFF_HAND'],1,1],['shield',['OFF_HAND'],1,1],['greatsword',['MAIN_HAND'],2,1],['ring',['RING_1','RING_2'],0,1],['helm',['HEAD'],0,2],['charm',['TRINKET'],0,1]] as const;
const pkg:ContentPackage={version:'equipment-fixture',engineVersion:'foundation-1',entities:[...buildPackage.entities,...definitions.map(([name,slots,hands,minimumLevel])=>({id:`item.${name}`,kind:'ITEM' as const,revision:1,schemaVersion:1,definition:{name,dependencies:[],public:{},mechanics:{inventory:{version:1,storageMode:'INSTANCE',category:'EQUIPMENT'},equipment:{version:1,slots:[...slots],hands,minimumLevel,bindingPolicy:'PRESERVE'}}}}))]};
const env=(expectedRevision:number,actionType='SET_EQUIPMENT')=>({requestId:randomUUID(),expectedRevision,actionType});
async function fixture(pool:Awaited<ReturnType<typeof testDatabase>>['pool'],content:ContentPackage=pkg){
 const release=await publishContent(pool,content),f=await actor(pool,release,5,'CASUAL');
 const container=(await pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE run_id=$1 RETURNING id",[f.run])).rows[0].id;
 const items:Record<string,string>={};await executeAction(pool,f.account,env(0,'GEAR_FIXTURE'),{},async c=>{for(const [name] of definitions)items[name]=(await grantItem(c,name,{containerId:container,definitionId:`item.${name}`,quantity:'1',sourceCode:'FIXTURE'},'FIXTURE')).itemId;return {revision:await advanceRevision(c)};});
 return {...f,container,items};
}
const sword=(id:string):EquipmentPlan=>({activeSet:'A',slots:[{set:'A',slot:'MAIN_HAND',itemId:id}]});
test('equipment retries, canonical noops and sharing one weapon across prepared sets preserve identity',async()=>{
 const db=await testDatabase();try{const f=await fixture(db.pool),plan:EquipmentPlan={activeSet:'B',slots:[{set:'B',slot:'MAIN_HAND',itemId:f.items.sword!},{set:'A',slot:'MAIN_HAND',itemId:f.items.sword!},{set:'WORN',slot:'RING_1',itemId:f.items.ring!}]};
 const request=env(1),results=await Promise.all([setEquipment(db.pool,f.account,request,plan),setEquipment(db.pool,f.account,request,plan)]);assert.equal(results.filter(r=>!r.replayed).length,1);
 assert.equal((await setEquipment(db.pool,f.account,env(2),plan)).changed,false);assert.equal((await equipmentView(db.pool,f.account)).equipmentRevision,'1');
 assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM equipment_events')).rows[0].n,1);assert.equal((await integrityReport(db.pool)).equipmentMismatches,0);assert.deepEqual(await unindexedForeignKeys(db.pool),[]);
 }finally{await db.close();}
});
test('two handed conflicts, level requirements and duplicated rings fail atomically',async()=>{
 const db=await testDatabase();try{const f=await fixture(db.pool);
 const plans:EquipmentPlan[]=[{activeSet:'A',slots:[{set:'A',slot:'MAIN_HAND',itemId:f.items.greatsword!},{set:'A',slot:'OFF_HAND',itemId:f.items.shield!}]},{activeSet:'A',slots:[{set:'WORN',slot:'HEAD',itemId:f.items.helm!}]},{activeSet:'A',slots:[{set:'WORN',slot:'RING_1',itemId:f.items.ring!},{set:'WORN',slot:'RING_2',itemId:f.items.ring!}]}];
 for(const p of plans)await assert.rejects(setEquipment(db.pool,f.account,env(1),p),/TWO_HANDED_CONFLICT|EQUIPMENT_REQUIREMENT_NOT_MET|EQUIPMENT_DUPLICATE_IDENTITY/);
 assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM equipment_events')).rows[0].n,0);
 await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,'class.one','DISCOVERED')",[f.account]);
 await startBuild(db.pool,f.account,env(1,'START_BUILD'),'class.one','balanced');
 const encounter=await executeAction(db.pool,f.account,env(2,'GEAR_FIXTURE'),{},async c=>({...await beginEncounter(c,'encounter.build',{}),revision:await advanceRevision(c)}));
 await executeAction(db.pool,f.account,env(3,'GEAR_FIXTURE'),{},async c=>({...await finishEncounter(c,encounter.instanceId as string,0,'VICTORY',async()=>({})),revision:await advanceRevision(c)}));
 await levelUp(db.pool,f.account,env(4,'LEVEL_UP'),'class.one');await setEquipment(db.pool,f.account,env(5),plans[1]!);
 await assert.rejects(db.pool.query('UPDATE run_progression SET level=1 WHERE run_id=$1',[f.run]),/inconsistent/);
 }finally{await db.close();}
});
test('foreign gear and stored gear cannot be equipped',async()=>{
 const db=await testDatabase();try{const f=await fixture(db.pool),other=await fixture(db.pool);await assert.rejects(setEquipment(db.pool,other.account,env(1),sword(f.items.sword!)),/EQUIPMENT_NOT_OWNED/);
 const home=(await db.pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'HOME' FROM state_scopes WHERE run_id=$1 RETURNING id",[f.run])).rows[0].id;
 await moveItem(db.pool,f.account,env(1,'MOVE_ITEM'),f.items.sword!,home);await assert.rejects(setEquipment(db.pool,f.account,env(2),sword(f.items.sword!)),/EQUIPMENT_NOT_OWNED/);
 }finally{await db.close();}
});
test('equipped gear blocks consumption and custody at both service and database boundaries',async()=>{
 const db=await testDatabase();try{const f=await fixture(db.pool);await setEquipment(db.pool,f.account,env(1),sword(f.items.sword!));
 const home=(await db.pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'HOME' FROM state_scopes WHERE run_id=$1 RETURNING id",[f.run])).rows[0].id;
 await assert.rejects(moveItem(db.pool,f.account,env(2,'MOVE_ITEM'),f.items.sword!,home),/ITEM_EQUIPPED/);
 await assert.rejects(executeAction(db.pool,f.account,env(2,'USE_FIXTURE'),{},c=>consumeItem(c,'use',f.items.sword!,'1','FIXTURE')),/ITEM_EQUIPPED/);
 await assert.rejects(db.pool.query('UPDATE inventory_items SET container_id=$1 WHERE id=$2',[home,f.items.sword]),/unequipped/);
 await assert.rejects(executeAction(db.pool,f.account,env(2,'USE_FIXTURE'),{},async c=>{await c.client.query("INSERT INTO inventory_quantity_operations(action_id,operation_key,kind,from_item_id,quantity,reason) VALUES($1,'use','CONSUME',$2,1,'FIXTURE')",[c.actionId,f.items.sword]);return {ok:true};}),/Equipped item/);
 await setEquipment(db.pool,f.account,env(2),emptyEquipment());await moveItem(db.pool,f.account,env(3,'MOVE_ITEM'),f.items.sword!,home);
 }finally{await db.close();}
});
test('Ascension clears equipment in its receipt while manual locks remain on the stored item',async()=>{
 const db=await testDatabase();try{const f=await fixture(db.pool);await setItemLock(db.pool,f.account,env(1,'SET_ITEM_LOCK'),f.items.sword!,true);await setEquipment(db.pool,f.account,env(2),sword(f.items.sword!));
 await db.pool.query("UPDATE runs SET status='AFTERCORE' WHERE id=$1",[f.run]);await ascend(db.pool,f.account,env(3,'ASCEND'));
 assert.deepEqual((await equipmentView(db.pool,f.account)).slots,[]);assert.equal((await itemLockView(db.pool,f.account,f.items.sword!)).locked,true);
 assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM equipment_events e JOIN run_history h ON h.action_id=e.action_id WHERE e.reason='ASCENSION_CLEAR'")).rows[0].n,1);assert.equal((await integrityReport(db.pool)).equipmentMismatches,0);
 }finally{await db.close();}
});
test('equipment history and projections reject direct edits and late failures roll back the complete setup',async()=>{
 const db=await testDatabase();try{const f=await fixture(db.pool);
 await db.pool.query("CREATE FUNCTION fail_equipment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Forced equipment failure'; END $$; CREATE TRIGGER fail_equipment BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_equipment()");
 await assert.rejects(setEquipment(db.pool,f.account,env(1),sword(f.items.sword!)),/Forced equipment failure/);assert.deepEqual((await equipmentView(db.pool,f.account)).slots,[]);
 await db.pool.query('DROP TRIGGER fail_equipment ON audit_events');await setEquipment(db.pool,f.account,env(1),sword(f.items.sword!));
 for(const sql of ['DELETE FROM equipment_slots','UPDATE run_equipment SET active_set=\'B\'','DELETE FROM equipment_events'])await assert.rejects(db.pool.query(sql),/recorded events|Immutable record/);
 }finally{await db.close();}
});
test('published equipment rejects incompatible storage and illegal hand declarations',async()=>{
 const db=await testDatabase();try{for(const mutate of [(m:any)=>{m.inventory.storageMode='STACK';},(m:any)=>{m.equipment.hands=2;m.equipment.slots=['OFF_HAND'];},(m:any)=>{m.equipment.minimumLevel=0;}]){const p=structuredClone(pkg);mutate(p.entities.find(e=>e.id==='item.sword')!.definition.mechanics);await assert.rejects(publishContent(db.pool,p));}}finally{await db.close();}
});
test('active instances prevent setup changes and selecting another prepared set',async()=>{
 const db=await testDatabase();try{const f=await fixture(db.pool);await setEquipment(db.pool,f.account,env(1),sword(f.items.sword!));
 const release=(await db.pool.query('SELECT content_release_id FROM runs WHERE id=$1',[f.run])).rows[0].content_release_id;await createInstance(db.pool,f.account,env(2,'INSTANCE_FIXTURE'),release,'COMBAT');
 await assert.rejects(setEquipment(db.pool,f.account,env(3),emptyEquipment()),/INSTANCE_STILL_ACTIVE/);await assert.rejects(setEquipment(db.pool,f.account,env(3),{...sword(f.items.sword!),activeSet:'B'}),/INSTANCE_STILL_ACTIVE/);
 }finally{await db.close();}
});
test('HTTP derives ownership, rejects forged stats and requires write scope for equipment changes',async()=>{
 const db=await testDatabase();try{const f=await fixture(db.pool),token='rs1_'+randomBytes(32).toString('base64url');
 await db.pool.query(`INSERT INTO auth_sessions(account_id,token_digest,security_epoch,scopes,device_label,expires_at) SELECT id,$2,security_epoch,ARRAY['GAME_READ'],'Equipment test',now()+interval '1 hour' FROM accounts WHERE id=$1`,[f.account,createHash('sha256').update(token).digest('hex')]);
 const app=buildApp(db.pool,{mode:'sessions',throttleKey:'equipment-throttle-key-long-enough'}),headers={authorization:`Bearer ${token}`};try{
 assert.equal((await app.inject({method:'GET',url:'/api/v1/equipment',headers})).statusCode,200);
 const choices=await app.inject({url:'/api/v1/inventory?equipmentSlot=TRINKET&grouped=false&expectedRevision=1',headers});assert.equal(choices.statusCode,200);assert.equal(choices.json().total,2);assert.equal((await app.inject({url:'/api/v1/inventory?equipmentSlot=INVALID',headers})).statusCode,400);
 const preview=await app.inject({url:'/api/v1/equipment/preview?expectedRevision=1',headers});assert.equal(preview.statusCode,200);assert.equal(preview.json().current,null);assert.equal((await app.inject({url:'/api/v1/equipment/preview?expectedRevision=1&plan=bad',headers})).statusCode,400);assert.equal((await app.inject({url:'/api/v1/equipment/preview?expectedRevision=0',headers})).statusCode,409);
 const payload={...env(1),...sword(f.items.sword!)};assert.equal((await app.inject({method:'POST',url:'/api/v1/equipment',headers,payload})).statusCode,403);
 assert.equal((await app.inject({method:'POST',url:'/api/v1/equipment',headers,payload:{...payload,attack:999}})).statusCode,400);
 assert.equal((await app.inject({method:'GET',url:'/api/v1/equipment'})).statusCode,401);
 }finally{await app.close();}
 }finally{await db.close();}
});
test('restricted runtime can replace event-maintained equipment while destructive history access is denied',async()=>{
 const db=await testDatabase(),role=`probe_${randomUUID().replaceAll('-','')}`;let created=false;try{const f=await fixture(db.pool);
 await db.pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);created=true;
 await db.pool.query(`GRANT USAGE ON SCHEMA ${db.schema} TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA ${db.schema} TO ${role}; GRANT UPDATE(security_epoch) ON accounts TO ${role}; GRANT UPDATE ON runs,run_progression,inventory_items,inventory_containers,state_scopes TO ${role}; GRANT INSERT ON equipment_events,item_binding_events,action_receipts,audit_events,outbox_events TO ${role}; GRANT INSERT,UPDATE ON run_equipment TO ${role}; GRANT INSERT,DELETE ON equipment_slots TO ${role}`);
 const client=await db.pool.connect();try{await client.query(`SET ROLE ${role}`);const restricted={connect:async()=>({query:client.query.bind(client),on:client.on.bind(client),removeListener:client.removeListener.bind(client),release:()=>{}})} as unknown as pg.Pool;
 await setEquipment(restricted,f.account,env(1),sword(f.items.sword!));await setEquipment(restricted,f.account,env(2),emptyEquipment());await assert.rejects(client.query('DELETE FROM equipment_events'),(e:{code?:string})=>e.code==='42501');
 }finally{await client.query('RESET ROLE');client.release();}
 assert.equal((await integrityReport(db.pool)).equipmentMismatches,0);
 }finally{if(created){await db.pool.query(`DROP OWNED BY ${role}`);await db.pool.query(`DROP ROLE ${role}`);}await db.close();}
});
test('deferred SQL rejects forged ownership and Ascension clears without actual run history',async()=>{
 const db=await testDatabase();try{const f=await fixture(db.pool),other=await fixture(db.pool);
 await assert.rejects(executeAction(db.pool,f.account,env(1),{},async c=>{await c.client.query("INSERT INTO equipment_events(action_id,run_id,revision,before_state,after_state,reason) VALUES($1,$2,1,$3,$4,'PLAYER_SETUP')",[c.actionId,f.run,emptyEquipment(),sword(other.items.sword!)]);return {ok:true};}),/inconsistent/);
 await setEquipment(db.pool,f.account,env(1),sword(f.items.sword!));
 await assert.rejects(executeAction(db.pool,f.account,env(2,'ASCEND'),{},async c=>{await c.client.query("INSERT INTO equipment_events(action_id,run_id,revision,before_state,after_state,reason) VALUES($1,$2,2,$3,$4,'ASCENSION_CLEAR')",[c.actionId,f.run,sword(f.items.sword!),emptyEquipment()]);return {ok:true};}),/inconsistent/);
 assert.equal((await equipmentView(db.pool,f.account)).equipmentRevision,'1');
 }finally{await db.close();}
});
test('the integrity audit detects equipment projection corruption without changing game data',async()=>{
 const db=await testDatabase();try{const f=await fixture(db.pool);await setEquipment(db.pool,f.account,env(1),sword(f.items.sword!));
 await db.pool.query('ALTER TABLE run_equipment DISABLE TRIGGER equipment_header_projection; ALTER TABLE run_equipment DISABLE TRIGGER equipment_header_integrity');await db.pool.query("UPDATE run_equipment SET active_set='B'");assert.equal((await integrityReport(db.pool)).equipmentMismatches,1);
 }finally{await db.close();}
});


test('trinket compatibility migration preserves old equipment and loadouts while allowing any three distinct accessories',async()=>{
 const db=await testDatabase();try{
  const old=await readFile(new URL('../migrations/012_item_binding_transitions.sql',import.meta.url),'utf8');
  await db.pool.query(old.slice(old.indexOf('CREATE OR REPLACE VIEW equipment_integrity_issues'),old.indexOf('CREATE VIEW item_binding_integrity_issues')));
  await db.pool.query('DROP FUNCTION equipment_eligible_slots(jsonb)');
  const f=await fixture(db.pool);let revision=1;
  const original:EquipmentPlan={activeSet:'A',slots:[{set:'WORN',slot:'RING_1',itemId:f.items.ring!},{set:'WORN',slot:'TRINKET',itemId:f.items.charm!}]};
  await setEquipment(db.pool,f.account,env(revision++),original);
  await saveLoadout(db.pool,f.account,env(revision++,'SAVE_LOADOUT'),'accessories','Accessories');
  const historyBefore=(await db.pool.query('SELECT jsonb_agg(to_jsonb(e) ORDER BY revision) AS data FROM equipment_events e')).rows[0].data;
  const loadoutBefore=(await db.pool.query('SELECT state FROM equipment_loadouts')).rows[0].state;
  await db.pool.query(await readFile(new URL('../migrations/033_interchangeable_trinkets.sql',import.meta.url),'utf8'));
  assert.deepEqual((await db.pool.query('SELECT jsonb_agg(to_jsonb(e) ORDER BY revision) AS data FROM equipment_events e')).rows[0].data,historyBefore);
  assert.deepEqual((await db.pool.query('SELECT state FROM equipment_loadouts')).rows[0].state,loadoutBefore);
  let third='';await executeAction(db.pool,f.account,env(revision++,'GEAR_FIXTURE'),{},async c=>{third=(await grantItem(c,'third',{containerId:f.container,definitionId:'item.ring',quantity:'1',sourceCode:'FIXTURE'},'FIXTURE')).itemId;return {revision:await advanceRevision(c)};});
  const slots=['RING_1','RING_2','TRINKET'] as const,ids=[f.items.ring!,f.items.charm!,third];
  for(let shift=0;shift<3;shift++)await setEquipment(db.pool,f.account,env(revision++),{activeSet:'A',slots:slots.map((slot,i)=>({set:'WORN',slot,itemId:ids[(i+shift)%3]!}))});
  await assert.rejects(setEquipment(db.pool,f.account,env(revision),{activeSet:'A',slots:slots.map(slot=>({set:'WORN',slot,itemId:f.items.ring!}))}),/EQUIPMENT_DUPLICATE_IDENTITY/);
  const view=await inventoryView(db.pool,f.account,{grouped:false});for(const item of view.items.filter(i=>[f.items.ring,f.items.charm,third].includes(i.id)))assert.deepEqual(item.equipment.slots,slots);
  const client=await db.pool.connect();try{const projected=await clientEquipmentView(client,f.run,f.account);for(const item of projected.gear.filter(i=>ids.includes(i.id)))assert.deepEqual(item.slots,slots);}finally{client.release();}
  await applyLoadout(db.pool,f.account,env(revision++),'accessories');
  assert.equal((await integrityReport(db.pool)).equipmentMismatches,0);
 }finally{await db.close();}
});


test('equipment search reaches beyond 100 items, filters true eligibility, and retains saved references outside the quick list',async()=>{
 const db=await testDatabase();try{
  const content=structuredClone(pkg);content.version='large-equipment';content.entities.find(e=>e.id==='item.charm')!.definition.mechanics!.prerequisite={op:'FACT',key:'level',test:'GTE',value:99};
  const f=await fixture(db.pool,content),extra:string[]=[];
  await executeAction(db.pool,f.account,env(1,'GEAR_FIXTURE'),{},async c=>{for(let i=0;i<130;i++)extra.push((await grantItem(c,'many.'+i,{containerId:f.container,definitionId:'item.ring',quantity:'1',sourceCode:'FIXTURE'},'FIXTURE')).itemId);return {revision:await advanceRevision(c)};});
  const client=await db.pool.connect();let summary;try{summary=await clientEquipmentView(client,f.run,f.account);}finally{client.release();}
  assert.equal(summary.gear.length,100);
  const seen=new Set<string>();let beyond='';for(let offset=0;offset<131;offset+=48){const page=await inventoryView(db.pool,f.account,{equipmentSlot:'TRINKET',search:'ring',offset,expectedRevision:2,grouped:false});assert.equal(page.total,131);assert.ok(page.items.length<=48);for(const item of page.items){assert.ok(!seen.has(item.id));seen.add(item.id);if(!summary.gear.some(g=>g.id===item.id))beyond=item.id;}}
  assert.equal(seen.size,131);assert.ok(beyond);
  assert.equal((await inventoryView(db.pool,f.account,{equipmentSlot:'HEAD'})).total,0);
  assert.equal((await inventoryView(db.pool,f.account,{equipmentSlot:'TRINKET',search:'charm'})).total,0);
  await assert.rejects(setEquipment(db.pool,f.account,env(2),{activeSet:'A',slots:[{set:'WORN',slot:'TRINKET',itemId:f.items.charm!}]}),/PREREQUISITE_NOT_MET/);
  await setEquipment(db.pool,f.account,env(2),{activeSet:'A',slots:[{set:'WORN',slot:'TRINKET',itemId:beyond}]});
  await saveLoadout(db.pool,f.account,env(3,'SAVE_LOADOUT'),'large','Large pack');await setEquipment(db.pool,f.account,env(4),emptyEquipment());
  const conn=await db.pool.connect();try{assert.ok((await clientEquipmentView(conn,f.run,f.account)).gear.some(g=>g.id===beyond));}finally{conn.release();}
  await applyLoadout(db.pool,f.account,env(5),'large');
  await assert.rejects(inventoryView(db.pool,f.account,{equipmentSlot:'TRINKET',expectedRevision:2}),/STALE_REVISION/);
  assert.throws(()=>inventoryView(db.pool,f.account,{equipmentSlot:'NOT_A_SLOT'}),/INVALID_INVENTORY_QUERY/);
  const release=(await db.pool.query('SELECT content_release_id FROM runs WHERE id=$1',[f.run])).rows[0].content_release_id,other=await actor(db.pool,release);
  assert.equal((await inventoryView(db.pool,other.account,{equipmentSlot:'TRINKET'})).total,0);
  assert.equal((await inventoryView(db.pool,f.account,{equipmentSlot:'TRINKET',search:'%'})).total,0);
  assert.equal((await integrityReport(db.pool)).equipmentMismatches,0);
 }finally{await db.close();}
});

test('read-only equipment previews match committed encounter snapshots and leave no receipts or binding',async()=>{
 const { tacticalFixture,tacticalPackage }=await import('./tactical-fixture.js');const { equipmentPreview }=await import('../src/domains/equipment-preview.js');const { readCharacterSnapshot }=await import('../src/domains/character-snapshots.js');
 const db=await testDatabase();try{
  const p=tacticalPackage(),spec=p.entities.find(e=>e.id==='encounter.tactical')!.definition.mechanics!.tacticalCombat as any;spec.rules.roundEffects={version:1};spec.rules.statusDefense={version:2,tags:['poison']};p.entities.find(e=>e.id==='item.shield')!.definition.mechanics!.tacticalStatusTraits={version:2,minimumNativeLevel:0,immuneTags:['poison'],durationReductionBps:{}};spec.rules.typedDamage={version:1,types:['physical','fire'],defaultType:'physical',resistanceStacking:'SUM_CAPPED'};
  p.entities.find(e=>e.id==='item.shield')!.definition.mechanics!.tacticalDamageTraits={version:1,minimumNativeLevel:0,resistances:{fire:2500}};
  const { inventoryPackage }=await import('./inventory-fixture.js');p.entities.push(inventoryPackage().entities.find(e=>e.id==='rules.inventory')!);for(const item of p.entities.filter(e=>e.kind==='ITEM'&&e.definition.mechanics?.inventory)){item.definition.mechanics!.inventory={...(item.definition.mechanics!.inventory as any),version:2,unitWeight:1,unitBulk:1,mundane:true};}p.entities.find(e=>e.id==='item.shield')!.definition.mechanics!.inventoryCapacity={version:1,weight:50,bulk:20,minimumNativeLevel:0};
  const f=await tacticalFixture(db.pool,p),before=(await db.pool.query('SELECT count(*) n FROM action_receipts')).rows[0].n;
  const draft:EquipmentPlan={activeSet:'B',slots:[{set:'A',slot:'MAIN_HAND',itemId:f.gear.sword!},{set:'A',slot:'OFF_HAND',itemId:f.gear.shield!}]};
  const concealed=await equipmentPreview(db.pool,f.account,f.revision,draft);assert.equal(concealed.current,null);assert.equal(concealed.preview,null);assert.match(concealed.reason!,/Assess/);assert.equal((await equipmentPreview(db.pool,f.account,f.revision,{activeSet:'A',slots:[]})).current,null);
  for(const id of ['item.sword','item.shield'])await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,$2,'ADVANCED') ON CONFLICT(account_id,entity_id) DO UPDATE SET knowledge_level='ADVANCED'",[f.account,id]);
  const view=await equipmentPreview(db.pool,f.account,f.revision,draft);assert.equal(view.current!.stats.armor,3);assert.equal(view.preview!.stats.armor,2);assert.equal(view.current!.damage!.resistances.fire,2500);assert.equal(view.preview!.damage!.resistances.fire,0);assert.equal(view.current!.capabilities.guard,true);assert.equal(view.preview!.capabilities.guard,false);assert.equal(view.preview!.stats.attackMin,6);assert.deepEqual(view.current!.status!.immuneTags,['poison']);assert.deepEqual(view.preview!.status!.immuneTags,[]);assert.equal(view.current!.carry.weightCapacity,'72');assert.equal(view.preview!.carry.weightCapacity,'22');assert.equal(view.current!.carry.weight,view.preview!.carry.weight);
  assert.equal((await db.pool.query('SELECT count(*) n FROM action_receipts')).rows[0].n,before);assert.equal((await equipmentView(db.pool,f.account)).activeSet,'A');
  await assert.rejects(equipmentPreview(db.pool,f.account,f.revision-1,draft),/STALE_REVISION/);await assert.rejects(equipmentPreview(db.pool,f.account,f.revision,draft,'encounter.secret'),/STAT_CONTEXT_NOT_FOUND/);
  await setEquipment(db.pool,f.account,env(f.revision),draft);const after=await equipmentPreview(db.pool,f.account,f.revision+1);assert.deepEqual(after.current,view.preview);
  const { startTacticalCombat }=await import('../src/domains/tactical-combat.js');const result=await startTacticalCombat(db.pool,f.account,env(f.revision+1,'START_TACTICAL'),'encounter.tactical');
  const client=await db.pool.connect();try{assert.deepEqual((await readCharacterSnapshot(client,result.instanceId as string,f.run)).derived.stats,view.preview!.stats);}finally{client.release();}
 }finally{await db.close();}
});

test('equipment and condition filters apply before grouping and pagination',async()=>{
 const db=await testDatabase();try{
  const p=structuredClone(pkg);p.entities.find(e=>e.id==='item.sword')!.definition.mechanics!.tacticalDurability={version:1,maximum:250};const f=await fixture(db.pool,p);
  await setEquipment(db.pool,f.account,env(1),sword(f.items.sword!));
  assert.equal((await inventoryView(db.pool,f.account,{equipmentState:'EQUIPPED'})).total,1);
  assert.equal((await inventoryView(db.pool,f.account,{slot:'MAIN_HAND',equipmentState:'EQUIPPED'})).items[0].id,f.items.sword);
  assert.equal((await inventoryView(db.pool,f.account,{condition:'FULL'})).total,1);assert.equal((await inventoryView(db.pool,f.account,{condition:'NEEDS_REPAIR'})).total,0);assert.equal((await inventoryView(db.pool,f.account,{condition:'BROKEN'})).total,0);
  assert.equal((await inventoryView(db.pool,f.account,{equipmentState:'USABLE',slot:'HEAD'})).total,0);
  assert.throws(()=>inventoryView(db.pool,f.account,{slot:'WRONG'}),/INVALID_INVENTORY_QUERY/);
 }finally{await db.close();}
});
