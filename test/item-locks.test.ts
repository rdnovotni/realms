import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import type pg from 'pg';
import { testDatabase,actor } from './helpers.js';
import { publishContent,type ContentPackage } from '../src/domains/content.js';
import { executeAction,advanceRevision } from '../src/foundation/action.js';
import { grantItem,consumeItem,splitStack,mergeStacks } from '../src/domains/item-accounting.js';
import { setItemLock,itemLockView } from '../src/domains/item-locks.js';
import { craftRoutine } from '../src/domains/crafting.js';
import { moveItem } from '../src/domains/inventory.js';
import { ascend } from '../src/domains/lifecycle.js';
import { buildApp } from '../src/app.js';
import { integrityReport,unindexedForeignKeys } from '../src/foundation/integrity.js';
const pkg:ContentPackage={version:'locks-fixture',engineVersion:'foundation-1',entities:[
 ...['ore','bar'].map(name=>({id:`item.${name}`,kind:'ITEM' as const,revision:1,schemaVersion:1,definition:{name,dependencies:[],public:{},mechanics:{inventory:{version:1,storageMode:'STACK',category:'MATERIAL'}}}})),
 {id:'recipe.bar',kind:'RECIPE',revision:1,schemaVersion:1,definition:{name:'Bar',dependencies:['item.ore','item.bar'],public:{},mechanics:{routineRecipe:{version:1,ruleset:'TRIVIAL_PROCESSING_V1',access:'DISCOVERED_CURRENT_RUN',turnCost:0,maxBatch:10,inputs:[{itemId:'item.ore',quantity:2}],output:{itemId:'item.bar',quantity:1}}}}}
]};
const env=(revision:number,actionType='SET_ITEM_LOCK')=>({requestId:randomUUID(),expectedRevision:revision,actionType});
async function fixture(pool:Awaited<ReturnType<typeof testDatabase>>['pool'],mode='STANDARD'){
 const release=await publishContent(pool,pkg),f=await actor(pool,release,5,mode);
 const container=(await pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE run_id=$1 RETURNING id",[f.run])).rows[0].id;
 await pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,'recipe.bar','LEARNED')",[f.account]);
 const grant=await executeAction(pool,f.account,env(0,'MATERIAL_FIXTURE'),{},async c=>({...await grantItem(c,'ore',{containerId:container,definitionId:'item.ore',quantity:'20',sourceCode:'FIXTURE'},'FIXTURE'),revision:await advanceRevision(c)}));
 return {...f,release,container,itemId:grant.itemId as string};
}
test('locks are durable, duplicate-safe and explicit unlock restores ordinary consumption',async()=>{
 const db=await testDatabase(),pool=db.pool;try{const f=await fixture(pool);assert.equal((await itemLockView(pool,f.account,f.itemId)).locked,false);
 const request=env(1),results=await Promise.all(Array.from({length:4},()=>setItemLock(pool,f.account,request,f.itemId,true)));assert.equal(results.filter(x=>!x.replayed).length,1);
 assert.equal(results[0]!.protectionRevision,'1');assert.equal((await itemLockView(pool,f.account,f.itemId)).locked,true);
 await assert.rejects(executeAction(pool,f.account,env(2,'CONSUME_FIXTURE'),{},c=>consumeItem(c,'use',f.itemId,'1','FIXTURE')),/ITEM_LOCKED/);
 const noop=await setItemLock(pool,f.account,env(2),f.itemId,true);assert.equal(noop.changed,false);assert.equal(noop.revision,2);
 await setItemLock(pool,f.account,env(2),f.itemId,false);
 await executeAction(pool,f.account,env(3,'CONSUME_FIXTURE'),{},async c=>({...await consumeItem(c,'use',f.itemId,'1','FIXTURE'),revision:await advanceRevision(c)}));
 assert.equal((await pool.query('SELECT quantity::text FROM inventory_items WHERE id=$1',[f.itemId])).rows[0].quantity,'19');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM inventory_lock_events')).rows[0].n,2);
 assert.equal((await integrityReport(pool)).itemLockMismatches,0);assert.deepEqual(await unindexedForeignKeys(pool),[]);
 }finally{await db.close();}
});
test('locked inputs stop crafting atomically and both sides of stack transfers are protected',async()=>{
 const db=await testDatabase(),pool=db.pool;try{const f=await fixture(pool),split=await splitStack(pool,f.account,env(1,'SPLIT_STACK'),f.itemId,'5'),child=split.splitItemId as string;
 await setItemLock(pool,f.account,env(2),f.itemId,true);
 await assert.rejects(splitStack(pool,f.account,env(3,'SPLIT_STACK'),f.itemId,'1'),/ITEM_LOCKED/);
 await assert.rejects(mergeStacks(pool,f.account,env(3,'MERGE_STACKS'),child,f.itemId),/ITEM_LOCKED/);
 await assert.rejects(mergeStacks(pool,f.account,env(3,'MERGE_STACKS'),f.itemId,child),/ITEM_LOCKED/);
 await assert.rejects(craftRoutine(pool,f.account,env(3,'CRAFT_ROUTINE'),'recipe.bar',1,[f.itemId]),/ITEM_LOCKED/);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM craft_records')).rows[0].n,0);
 await setItemLock(pool,f.account,env(3),f.itemId,false);await mergeStacks(pool,f.account,env(4,'MERGE_STACKS'),child,f.itemId);
 assert.equal((await pool.query('SELECT quantity::text FROM inventory_items WHERE id=$1',[f.itemId])).rows[0].quantity,'20');
 }finally{await db.close();}
});
test('locks follow storage and Ascension while ownership, run mode and automation cannot bypass them',async()=>{
 const db=await testDatabase(),pool=db.pool;try{const f=await fixture(pool,'CASUAL'),other=await fixture(pool);
 await setItemLock(pool,f.account,env(1),f.itemId,true);
 await assert.rejects(setItemLock(pool,other.account,env(1),f.itemId,false),/CONTAINER_NOT_OWNED/);await assert.rejects(itemLockView(pool,other.account,f.itemId),/ITEM_NOT_FOUND/);
 assert.throws(()=>setItemLock(pool,f.account,{...env(2),authorizationSource:'AUTOMATION'},f.itemId,false),/EXPLICIT_ITEM_LOCK_ACTION_REQUIRED/);
 const home=(await pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'HOME' FROM state_scopes WHERE run_id=$1 RETURNING id",[f.run])).rows[0].id;
 await moveItem(pool,f.account,env(2,'MOVE_ITEM'),f.itemId,home);assert.equal((await itemLockView(pool,f.account,f.itemId)).locked,true);
 await pool.query("UPDATE runs SET status='AFTERCORE' WHERE id=$1",[f.run]);await ascend(pool,f.account,env(3,'ASCEND'));assert.equal((await itemLockView(pool,f.account,f.itemId)).locked,true);
 await setItemLock(pool,f.account,env(0),f.itemId,false);assert.equal((await integrityReport(pool)).itemLockMismatches,0);
 const standard=await fixture(pool);const storage=(await pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'HOME' FROM state_scopes WHERE account_id=$1 RETURNING id",[standard.account])).rows[0].id;
 await pool.query('UPDATE inventory_items SET container_id=$1 WHERE id=$2',[storage,standard.itemId]);await assert.rejects(setItemLock(pool,standard.account,env(1),standard.itemId,true),/LEGACY_ACCESS_RESTRICTED/);
 }finally{await db.close();}
});
test('SQL blocks unrecorded edits, rewritten history, incorrect chains and consuming locked items',async()=>{
 const db=await testDatabase(),pool=db.pool;try{const f=await fixture(pool);await setItemLock(pool,f.account,env(1),f.itemId,true);
 for(const sql of ['UPDATE inventory_item_locks SET locked=false','DELETE FROM inventory_item_locks','UPDATE inventory_lock_events SET locked=false','DELETE FROM inventory_lock_events'])await assert.rejects(pool.query(sql),/recorded lock events|Immutable record/);
 await assert.rejects(executeAction(pool,f.account,env(2,'CONSUME_FIXTURE'),{},async c=>{await c.client.query("INSERT INTO inventory_quantity_operations(action_id,operation_key,kind,from_item_id,quantity,reason) VALUES($1,'bypass','CONSUME',$2,1,'FIXTURE')",[c.actionId,f.itemId]);return {ok:true};}),/Locked item/);
 await assert.rejects(executeAction(pool,f.account,env(2),{},async c=>{await c.client.query('INSERT INTO inventory_lock_events(item_id,action_id,run_id,revision,previous_locked,locked) VALUES($1,$2,$3,4,true,false)',[f.itemId,c.actionId,f.run]);return {ok:true};}),/consecutively/);
 await assert.rejects(executeAction(pool,f.account,{...env(2),authorizationSource:'AUTOMATION'}, {},async c=>{await c.client.query('INSERT INTO inventory_lock_events(item_id,action_id,run_id,revision,previous_locked,locked) VALUES($1,$2,$3,2,true,false)',[f.itemId,c.actionId,f.run]);return {ok:true};}),/inconsistent/);
 }finally{await db.close();}
});
test('late failure rolls back lock state and history; competing requests obey run revisions',async()=>{
 const db=await testDatabase(),pool=db.pool;try{const f=await fixture(pool);
 await pool.query("CREATE FUNCTION fail_lock() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Forced lock failure'; END $$; CREATE TRIGGER fail_lock BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_lock()");
 const request=env(1);await assert.rejects(setItemLock(pool,f.account,request,f.itemId,true),/Forced lock failure/);
 assert.equal((await itemLockView(pool,f.account,f.itemId)).locked,false);assert.equal((await pool.query('SELECT count(*)::int AS n FROM inventory_lock_events')).rows[0].n,0);
 await pool.query('DROP TRIGGER fail_lock ON audit_events');
 const attempts=await Promise.allSettled([setItemLock(pool,f.account,request,f.itemId,true),setItemLock(pool,f.account,env(1),f.itemId,true)]);assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM inventory_lock_events')).rows[0].n,1);
 }finally{await db.close();}
});
test('HTTP accepts lock intents only, derives identity, and read-only sessions cannot change locks',async()=>{
 const db=await testDatabase(),pool=db.pool;try{const f=await fixture(pool),token='rs1_'+randomBytes(32).toString('base64url');
 await pool.query(`INSERT INTO auth_sessions(account_id,token_digest,security_epoch,scopes,device_label,expires_at) SELECT id,$2,security_epoch,ARRAY['GAME_READ'],'Read only',now()+interval '1 hour' FROM accounts WHERE id=$1`,[f.account,createHash('sha256').update(token).digest('hex')]);
 const app=buildApp(pool,{mode:'sessions',throttleKey:'locks-throttle-key-long-enough'}),headers={authorization:`Bearer ${token}`};try{
 assert.equal((await app.inject({method:'GET',url:`/api/v1/inventory/${f.itemId}/lock`,headers})).statusCode,200);
 const payload={...env(1),itemId:f.itemId,locked:true};assert.equal((await app.inject({method:'POST',url:'/api/v1/inventory/lock',headers,payload})).statusCode,403);
 assert.equal((await app.inject({method:'POST',url:'/api/v1/inventory/lock',headers,payload:{...payload,accountId:f.account}})).statusCode,400);
 assert.equal((await app.inject({method:'GET',url:`/api/v1/inventory/${f.itemId}/lock`})).statusCode,401);
 }finally{await app.close();}
 }finally{await db.close();}
});
test('restricted runtime records locks and denies destructive writes or erased histories',async()=>{
 const db=await testDatabase(),pool=db.pool,role=`probe_${randomUUID().replaceAll('-','')}`;let created=false;
 try{const f=await fixture(pool);await pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);created=true;
 await pool.query(`GRANT USAGE ON SCHEMA ${db.schema} TO ${role};GRANT SELECT ON ALL TABLES IN SCHEMA ${db.schema} TO ${role};
 GRANT UPDATE ON accounts,runs,inventory_items,inventory_containers,state_scopes TO ${role};GRANT INSERT,UPDATE ON inventory_item_locks TO ${role};
 GRANT INSERT ON inventory_lock_events,inventory_quantity_operations,action_receipts,audit_events,outbox_events TO ${role}`);
 const client=await pool.connect();try{await client.query(`SET ROLE ${role}`);const asRole={connect:async()=>({query:client.query.bind(client),release:()=>{}})} as unknown as pg.Pool;
 await setItemLock(asRole,f.account,env(1),f.itemId,true);
 await assert.rejects(executeAction(asRole,f.account,env(2,'CONSUME_FIXTURE'),{},c=>consumeItem(c,'use',f.itemId,'1','FIXTURE')),/ITEM_LOCKED/);
 for(const sql of ['DELETE FROM inventory_lock_events','DELETE FROM inventory_item_locks'])await assert.rejects(client.query(sql),(e:{code?:string})=>e.code==='42501');
 await setItemLock(asRole,f.account,env(2),f.itemId,false);
 }finally{await client.query('RESET ROLE');client.release();}
 assert.equal((await integrityReport(pool)).itemLockMismatches,0);
 }finally{if(created){await pool.query(`DROP OWNED BY ${role}`);await pool.query(`DROP ROLE ${role}`);}await db.close();}
});
test('read-only audit detects projection corruption without exposing private histories',async()=>{
 const db=await testDatabase(),pool=db.pool;try{const f=await fixture(pool);await setItemLock(pool,f.account,env(1),f.itemId,true);
 await pool.query('ALTER TABLE inventory_item_locks DISABLE TRIGGER item_lock_projection; ALTER TABLE inventory_item_locks DISABLE TRIGGER item_lock_projection_integrity');
 await pool.query('UPDATE inventory_item_locks SET locked=false');assert.equal((await integrityReport(pool)).itemLockMismatches,1);
 }finally{await db.close();}
});
