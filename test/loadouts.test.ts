import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import type pg from 'pg';
import { actor,testDatabase } from './helpers.js';
import { publishContent,type ContentPackage } from '../src/domains/content.js';
import { executeAction,advanceRevision } from '../src/foundation/action.js';
import { grantItem,consumeItem } from '../src/domains/item-accounting.js';
import { setEquipment,emptyEquipment,type EquipmentPlan } from '../src/domains/equipment.js';
import { saveLoadout,setLoadoutProtection,deleteLoadout,applyLoadout,loadoutsView,itemProtectionView } from '../src/domains/loadouts.js';
import { setItemLock } from '../src/domains/item-locks.js';
import { moveItem } from '../src/domains/inventory.js';
import { ascend } from '../src/domains/lifecycle.js';
import { createInstance } from '../src/domains/instances.js';
import { buildApp } from '../src/app.js';
import { integrityReport,unindexedForeignKeys } from '../src/foundation/integrity.js';
const pkg:ContentPackage={version:'loadout-fixture',engineVersion:'foundation-1',entities:['sword','spare'].map(name=>({id:`item.${name}`,kind:'ITEM',revision:1,schemaVersion:1,definition:{name,dependencies:[],public:{},mechanics:{inventory:{version:1,storageMode:'INSTANCE',category:'EQUIPMENT'},equipment:{version:1,slots:['MAIN_HAND'],hands:1,minimumLevel:1,bindingPolicy:'PRESERVE'}}}}))};
const env=(expectedRevision:number,actionType='SAVE_LOADOUT')=>({requestId:randomUUID(),expectedRevision,actionType});
const plan=(id:string):EquipmentPlan=>({activeSet:'A',slots:[{set:'A',slot:'MAIN_HAND',itemId:id},{set:'B',slot:'MAIN_HAND',itemId:id}]});
async function fixture(pool:Awaited<ReturnType<typeof testDatabase>>['pool']){const release=await publishContent(pool,pkg),f=await actor(pool,release,5,'CASUAL'),items:Record<string,string>={};const container=(await pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE run_id=$1 RETURNING id",[f.run])).rows[0].id;
 await executeAction(pool,f.account,env(0,'LOADOUT_FIXTURE'),{},async c=>{for(const e of pkg.entities)items[e.id]=(await grantItem(c,e.id,{containerId:container,definitionId:e.id,quantity:'1',sourceCode:'FIXTURE'},'FIXTURE')).itemId;return {revision:await advanceRevision(c)};});return {...f,release,container,items};}
async function setup(pool:Awaited<ReturnType<typeof testDatabase>>['pool']){const f=await fixture(pool);await setEquipment(pool,f.account,env(1,'SET_EQUIPMENT'),plan(f.items['item.sword']!));return f;}
test('saved setups deduplicate shared weapons, replay once and preserve canonical noops',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool),request=env(2);const results=await Promise.all([saveLoadout(db.pool,f.account,request,'travel','Travel'),saveLoadout(db.pool,f.account,request,'travel','Travel')]);assert.equal(results.filter(r=>!r.replayed).length,1);assert.equal((await saveLoadout(db.pool,f.account,env(3),'travel','Travel')).changed,false);assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM equipment_loadout_items')).rows[0].n,1);
 assert.deepEqual((await itemProtectionView(db.pool,f.account,f.items['item.sword']!)).protectedLoadouts,['travel']);assert.deepEqual((await loadoutsView(db.pool,f.account)).loadouts[0]!.plan,plan(f.items['item.sword']!));assert.equal((await integrityReport(db.pool)).loadoutMismatches,0);assert.deepEqual(await unindexedForeignKeys(db.pool),[]);
 }finally{await db.close();}
});
test('unequipped loadout gear requires explicit protection release; manual locks remain independent',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool),id=f.items['item.sword']!;await saveLoadout(db.pool,f.account,env(2),'travel','Travel');await setEquipment(db.pool,f.account,env(3,'SET_EQUIPMENT'),emptyEquipment());
 await assert.rejects(executeAction(db.pool,f.account,env(4,'USE_FIXTURE'),{},c=>consumeItem(c,'use',id,'1','FIXTURE')),/ITEM_LOADOUT_PROTECTED/);await setItemLock(db.pool,f.account,env(4,'SET_ITEM_LOCK'),id,true);await setLoadoutProtection(db.pool,f.account,env(5,'SET_LOADOUT_PROTECTION'),'travel',false);
 await assert.rejects(executeAction(db.pool,f.account,env(6,'USE_FIXTURE'),{},c=>consumeItem(c,'use',id,'1','FIXTURE')),/ITEM_LOCKED/);await setItemLock(db.pool,f.account,env(6,'SET_ITEM_LOCK'),id,false);await executeAction(db.pool,f.account,env(7,'USE_FIXTURE'),{},async c=>({...await consumeItem(c,'use',id,'1','FIXTURE'),revision:await advanceRevision(c)}));
 await assert.rejects(setLoadoutProtection(db.pool,f.account,env(8,'SET_LOADOUT_PROTECTION'),'travel',true),/inconsistent/);assert.equal((await loadoutsView(db.pool,f.account)).loadouts[0]!.protectItems,false);
 }finally{await db.close();}
});
test('applying a saved setup restores gear and retries replay the original result after template deletion',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool);await saveLoadout(db.pool,f.account,env(2),'travel','Travel');await setEquipment(db.pool,f.account,env(3,'SET_EQUIPMENT'),emptyEquipment());const request=env(4,'SET_EQUIPMENT'),applied=await applyLoadout(db.pool,f.account,request,'travel');assert.deepEqual(applied.slots,plan(f.items['item.sword']!).slots);await deleteLoadout(db.pool,f.account,env(5,'DELETE_LOADOUT'),'travel');const replay=await applyLoadout(db.pool,f.account,request,'travel');assert.equal(replay.replayed,true);assert.equal(replay.loadoutRevision,'1');assert.deepEqual(replay.slots,applied.slots);assert.deepEqual((await loadoutsView(db.pool,f.account)).loadouts,[]);
 await assert.rejects(applyLoadout(db.pool,f.account,env(6,'SET_EQUIPMENT'),'travel'),/LOADOUT_NOT_FOUND/);
 }finally{await db.close();}
});
test('shared template protection survives overwrite until all references are explicitly released',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool);await saveLoadout(db.pool,f.account,env(2),'travel','Travel');await saveLoadout(db.pool,f.account,env(3),'battle','Battle');await setEquipment(db.pool,f.account,env(4,'SET_EQUIPMENT'),plan(f.items['item.spare']!));await saveLoadout(db.pool,f.account,env(5),'travel','Travel');assert.deepEqual((await itemProtectionView(db.pool,f.account,f.items['item.sword']!)).protectedLoadouts,['battle']);await deleteLoadout(db.pool,f.account,env(6,'DELETE_LOADOUT'),'battle');assert.equal((await itemProtectionView(db.pool,f.account,f.items['item.sword']!)).protected,false);assert.deepEqual((await itemProtectionView(db.pool,f.account,f.items['item.spare']!)).protectedLoadouts,['travel']);assert.equal((await deleteLoadout(db.pool,f.account,env(7,'DELETE_LOADOUT'),'battle')).changed,false);
 }finally{await db.close();}
});
test('loadouts follow stored item identity across Ascension but never bypass current-run custody',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool),id=f.items['item.sword']!;await saveLoadout(db.pool,f.account,env(2),'travel','Travel');await db.pool.query("UPDATE runs SET status='AFTERCORE' WHERE id=$1",[f.run]);await ascend(db.pool,f.account,env(3,'ASCEND'));assert.deepEqual((await itemProtectionView(db.pool,f.account,id)).protectedLoadouts,['travel']);await assert.rejects(applyLoadout(db.pool,f.account,env(0,'SET_EQUIPMENT'),'travel'),/EQUIPMENT_NOT_OWNED/);
 const carried=(await db.pool.query("SELECT b.id FROM inventory_containers b JOIN state_scopes s ON s.id=b.scope_id JOIN runs r ON r.id=s.run_id WHERE r.character_id=$1 AND r.status='ACTIVE' AND b.kind='CARRIED' AND b.label='' ",[f.character])).rows[0].id;await moveItem(db.pool,f.account,env(0,'MOVE_ITEM'),id,carried);await applyLoadout(db.pool,f.account,env(1,'SET_EQUIPMENT'),'travel');assert.equal((await integrityReport(db.pool)).loadoutMismatches,0);
 }finally{await db.close();}
});
test('foreign templates and active instances cannot restore equipment',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool),other=await fixture(db.pool);await saveLoadout(db.pool,f.account,env(2),'travel','Travel');await assert.rejects(applyLoadout(db.pool,other.account,env(1,'SET_EQUIPMENT'),'travel'),/LOADOUT_NOT_FOUND/);await createInstance(db.pool,f.account,env(3,'INSTANCE_FIXTURE'),f.release,'COMBAT');await assert.rejects(applyLoadout(db.pool,f.account,env(4,'SET_EQUIPMENT'),'travel'),/INSTANCE_STILL_ACTIVE/);
 }finally{await db.close();}
});
test('SQL blocks protected consumption, direct projections, rewritten history and foreign custody',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool),other=await fixture(db.pool),id=f.items['item.sword']!;await saveLoadout(db.pool,f.account,env(2),'travel','Travel');await setEquipment(db.pool,f.account,env(3,'SET_EQUIPMENT'),emptyEquipment());
 await assert.rejects(executeAction(db.pool,f.account,env(4,'USE_FIXTURE'),{},async c=>{await c.client.query("INSERT INTO inventory_quantity_operations(action_id,operation_key,kind,from_item_id,quantity,reason) VALUES($1,'use','CONSUME',$2,1,'FIXTURE')",[c.actionId,id]);return {ok:true};}),/Loadout item/);
 for(const sql of ['DELETE FROM equipment_loadout_items','UPDATE equipment_loadouts SET state=NULL','DELETE FROM equipment_loadout_events'])await assert.rejects(db.pool.query(sql),/recorded events|Immutable record/);await assert.rejects(db.pool.query('UPDATE inventory_items SET container_id=$1 WHERE id=$2',[other.container,id]),/inconsistent/);
 }finally{await db.close();}
});
test('late failures roll back template history and automation cannot silently release protection',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool);await db.pool.query("CREATE FUNCTION fail_loadout() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Forced loadout failure'; END $$; CREATE TRIGGER fail_loadout BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_loadout()");const request=env(2);await assert.rejects(saveLoadout(db.pool,f.account,request,'travel','Travel'),/Forced loadout failure/);assert.deepEqual((await loadoutsView(db.pool,f.account)).loadouts,[]);await db.pool.query('DROP TRIGGER fail_loadout ON audit_events');await saveLoadout(db.pool,f.account,request,'travel','Travel');assert.throws(()=>setLoadoutProtection(db.pool,f.account,{...env(3,'SET_LOADOUT_PROTECTION'),authorizationSource:'AUTOMATION'},'travel',false),/EXPLICIT_LOADOUT/);
 await assert.rejects(executeAction(db.pool,f.account,{...env(3,'SET_LOADOUT_PROTECTION'),authorizationSource:'AUTOMATION'}, {},async c=>{await c.client.query("INSERT INTO equipment_loadout_events(loadout_id,character_id,template_key,run_id,action_id,revision,before_state,after_state,reason) SELECT id,character_id,template_key,$1,$2,revision+1,state,state||'{\"protectItems\":false}'::jsonb,'SET_LOADOUT_PROTECTION' FROM equipment_loadouts",[f.run,c.actionId]);return {ok:true};}),/inconsistent/);
 }finally{await db.close();}
});
test('template limits preserve existing records and retiring one releases capacity',async()=>{
 const db=await testDatabase();try{const f=await fixture(db.pool);for(let i=0;i<32;i++)await saveLoadout(db.pool,f.account,env(i+1),`set_${i}`,`Set ${i}`);await assert.rejects(saveLoadout(db.pool,f.account,env(33),'extra','Extra'),/LOADOUT_LIMIT_REACHED/);await deleteLoadout(db.pool,f.account,env(33,'DELETE_LOADOUT'),'set_0');await saveLoadout(db.pool,f.account,env(34),'extra','Extra');assert.equal((await loadoutsView(db.pool,f.account)).loadouts.length,32);
 }finally{await db.close();}
});
test('read-only sessions see owned protection but cannot save, override or inject a template plan',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool),other=await fixture(db.pool);await saveLoadout(db.pool,f.account,env(2),'travel','Travel');const token='rs1_'+randomBytes(32).toString('base64url');await db.pool.query(`INSERT INTO auth_sessions(account_id,token_digest,security_epoch,scopes,device_label,expires_at) SELECT id,$2,security_epoch,ARRAY['GAME_READ'],'Loadout test',now()+interval '1 hour' FROM accounts WHERE id=$1`,[f.account,createHash('sha256').update(token).digest('hex')]);const app=buildApp(db.pool,{mode:'sessions',throttleKey:'loadout-throttle-key-long-enough'}),headers={authorization:`Bearer ${token}`};try{assert.equal((await app.inject({method:'GET',url:'/api/v1/equipment/loadouts',headers})).json().loadouts.length,1);assert.equal((await app.inject({method:'GET',url:`/api/v1/inventory/${f.items['item.sword']}/protection`,headers})).json().protected,true);assert.equal((await app.inject({method:'GET',url:`/api/v1/inventory/${other.items['item.sword']}/protection`,headers})).statusCode,404);
 const payload={...env(3),key:'other',name:'Other'};assert.equal((await app.inject({method:'POST',url:'/api/v1/equipment/loadouts/save',headers,payload})).statusCode,403);assert.equal((await app.inject({method:'POST',url:'/api/v1/equipment/loadouts/save',headers,payload:{...payload,plan:emptyEquipment()}})).statusCode,400);assert.equal((await app.inject({method:'GET',url:'/api/v1/equipment/loadouts'})).statusCode,401);
 }finally{await app.close();}
 }finally{await db.close();}
});
test('restricted runtime can save, release protection and restore setups while histories remain append-only',async()=>{
 const db=await testDatabase(),role=`probe_${randomUUID().replaceAll('-','')}`;let created=false;try{const f=await setup(db.pool);await db.pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);created=true;await db.pool.query(`GRANT USAGE ON SCHEMA ${db.schema} TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA ${db.schema} TO ${role}; GRANT UPDATE(security_epoch) ON accounts TO ${role}; GRANT UPDATE ON runs,run_progression,inventory_items,inventory_containers,state_scopes TO ${role}; GRANT INSERT ON equipment_events,item_binding_events,equipment_loadout_events,action_receipts,audit_events,outbox_events TO ${role}; GRANT INSERT,UPDATE ON run_equipment,equipment_loadouts TO ${role}; GRANT INSERT,DELETE ON equipment_slots,equipment_loadout_items TO ${role}`);
 const client=await db.pool.connect();try{await client.query(`SET ROLE ${role}`);const restricted={connect:async()=>({query:client.query.bind(client),release:()=>{}})} as unknown as pg.Pool;await saveLoadout(restricted,f.account,env(2),'travel','Travel');await setEquipment(restricted,f.account,env(3,'SET_EQUIPMENT'),emptyEquipment());await applyLoadout(restricted,f.account,env(4,'SET_EQUIPMENT'),'travel');await setLoadoutProtection(restricted,f.account,env(5,'SET_LOADOUT_PROTECTION'),'travel',false);await assert.rejects(client.query('DELETE FROM equipment_loadout_events'),(e:{code?:string})=>e.code==='42501');}finally{await client.query('RESET ROLE');client.release();}assert.equal((await integrityReport(db.pool)).loadoutMismatches,0);
 }finally{if(created){await db.pool.query(`DROP OWNED BY ${role}`);await db.pool.query(`DROP ROLE ${role}`);}await db.close();}
});
test('read-only audit detects erased template protection',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool);await saveLoadout(db.pool,f.account,env(2),'travel','Travel');await db.pool.query('ALTER TABLE equipment_loadout_items DISABLE TRIGGER loadout_item_projection; ALTER TABLE equipment_loadout_items DISABLE TRIGGER loadout_item_integrity');await db.pool.query('DELETE FROM equipment_loadout_items');assert.equal((await integrityReport(db.pool)).loadoutMismatches,1);
 }finally{await db.close();}
});
test('concurrent SQL saves cannot exceed the character template limit',async()=>{
 const db=await testDatabase();try{const f=await fixture(db.pool);for(let i=0;i<31;i++)await saveLoadout(db.pool,f.account,env(i+1),`set_${i}`,`Set ${i}`);
 let release!:()=>void,arrivals=0;const barrier=new Promise<void>(resolve=>{release=resolve;});
 const write=async(index:number)=>{const client=await db.pool.connect(),actionId=randomUUID();try{await client.query('BEGIN');await client.query('SELECT id FROM runs WHERE id=$1 FOR KEY SHARE',[f.run]);if(++arrivals===2)release();await barrier;await client.query("INSERT INTO equipment_loadout_events(loadout_id,character_id,template_key,run_id,action_id,revision,before_state,after_state,reason) VALUES($1,$2,$3,$4,$5,1,NULL,$6,'SAVE_LOADOUT')",[randomUUID(),f.character,`race_${index}`,f.run,actionId,{name:`Race ${index}`,plan:emptyEquipment(),protectItems:true}]);await client.query("INSERT INTO action_receipts(account_id,request_id,payload_hash,result,action_id,action_type,envelope_version) VALUES($1,$2,$3,'{}',$4,'SAVE_LOADOUT',2)",[f.account,randomUUID(),'0'.repeat(64),actionId]);await client.query('COMMIT');return true;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}};
 const results=await Promise.allSettled([write(0),write(1)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const rejected=results.find(r=>r.status==='rejected');assert.ok(rejected&&rejected.status==='rejected');assert.equal(rejected.reason.code,'P0001');assert.match(rejected.reason.message,/Loadout limit reached/);assert.equal((await loadoutsView(db.pool,f.account)).loadouts.length,32);assert.equal((await integrityReport(db.pool)).loadoutMismatches,0);
 }finally{await db.close();}
});
