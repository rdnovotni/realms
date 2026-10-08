import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import type pg from 'pg';
import { buildApp } from '../src/app.js';
import { actor,testDatabase } from './helpers.js';
import { publishContent,validateContent,type ContentPackage } from '../src/domains/content.js';
import { executeAction,advanceRevision } from '../src/foundation/action.js';
import { grantItem } from '../src/domains/item-accounting.js';
import { setEquipment,emptyEquipment,type EquipmentPlan } from '../src/domains/equipment.js';
import { setItemLock,itemLockView } from '../src/domains/item-locks.js';
import { moveItem } from '../src/domains/inventory.js';
import { ascend } from '../src/domains/lifecycle.js';
import { beginAuthoredEncounter,settleAuthoredVictory } from '../src/domains/loot.js';
import { integrityReport,unindexedForeignKeys } from '../src/foundation/integrity.js';
const gear=(name:string,version:number,policy:string,slot='MAIN_HAND')=>({id:`item.${name}`,kind:'ITEM' as const,revision:1,schemaVersion:1,definition:{name,dependencies:[],public:{},mechanics:{inventory:{version:1,storageMode:'INSTANCE',category:'EQUIPMENT'},equipment:{version,slots:[slot],hands:slot==='HEAD'?0:1,minimumLevel:1,bindingPolicy:policy}}}});
const pkg:ContentPackage={version:'binding-fixture',engineVersion:'foundation-1',entities:[gear('sword',2,'ACCOUNT_ON_ACTIVE_EQUIP'),gear('helm',2,'ACCOUNT_ON_ACTIVE_EQUIP','HEAD'),gear('ordinary',1,'PRESERVE'),gear('preserved',2,'PRESERVE')]};
const env=(expectedRevision:number,actionType='SET_EQUIPMENT')=>({requestId:randomUUID(),expectedRevision,actionType});
const plan=(itemId:string,activeSet:'A'|'B'='A',set:'A'|'B'='A'):EquipmentPlan=>({activeSet,slots:[{set,slot:'MAIN_HAND',itemId}]});
async function fixture(pool:Awaited<ReturnType<typeof testDatabase>>['pool'],binding:'TRADEABLE'|'ACCOUNT_BOUND'|'RUN_BOUND'='TRADEABLE'){
 const release=await publishContent(pool,pkg),f=await actor(pool,release,5,'CASUAL');const container=(await pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE run_id=$1 RETURNING id",[f.run])).rows[0].id;
 const items:Record<string,string>={};await executeAction(pool,f.account,env(0,'BINDING_FIXTURE'),{},async c=>{for(const e of pkg.entities)items[e.id]=(await grantItem(c,e.id,{containerId:container,definitionId:e.id,quantity:'1',sourceCode:'FIXTURE',binding},'FIXTURE')).itemId;return {revision:await advanceRevision(c)};});return {...f,release,container,items};
}
async function row(pool:Awaited<ReturnType<typeof testDatabase>>['pool'],id:string){return (await pool.query('SELECT binding,bound_account_id,bound_run_id FROM inventory_items WHERE id=$1',[id])).rows[0];}
test('inactive prepared gear stays tradeable; activation binds once with duplicate-safe history',async()=>{
 const db=await testDatabase();try{const f=await fixture(db.pool),id=f.items['item.sword']!;
 const inactive=await setEquipment(db.pool,f.account,env(1),plan(id,'A','B'));assert.deepEqual(inactive.boundItemIds,[]);assert.equal((await row(db.pool,id)).binding,'TRADEABLE');
 const request=env(2),results=await Promise.all([setEquipment(db.pool,f.account,request,plan(id,'B','B')),setEquipment(db.pool,f.account,request,plan(id,'B','B'))]);assert.equal(results.filter(r=>!r.replayed).length,1);assert.deepEqual(results[0]!.boundItemIds,[id]);assert.equal((await row(db.pool,id)).bound_account_id,f.account);
 assert.deepEqual((await setEquipment(db.pool,f.account,env(3),plan(id,'B','B'))).boundItemIds,[]);await setEquipment(db.pool,f.account,env(3),emptyEquipment());assert.equal((await row(db.pool,id)).binding,'ACCOUNT_BOUND');assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM item_binding_events')).rows[0].n,1);assert.deepEqual(await unindexedForeignKeys(db.pool),[]);assert.equal((await integrityReport(db.pool)).itemBindingHistoryMismatches,0);
 }finally{await db.close();}
});
test('ordinary and preserve-policy gear retain tradeability; existing account and run bonds are never weakened',async()=>{
 const db=await testDatabase();try{const f=await fixture(db.pool);await setEquipment(db.pool,f.account,env(1),plan(f.items['item.ordinary']!));await setEquipment(db.pool,f.account,env(2),plan(f.items['item.preserved']!));assert.equal((await row(db.pool,f.items['item.ordinary']!)).binding,'TRADEABLE');assert.equal((await row(db.pool,f.items['item.preserved']!)).binding,'TRADEABLE');
 for(const binding of ['ACCOUNT_BOUND','RUN_BOUND'] as const){const bound=await fixture(db.pool,binding);await setEquipment(db.pool,bound.account,env(1),plan(bound.items['item.sword']!));assert.equal((await row(db.pool,bound.items['item.sword']!)).binding,binding);}assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM item_binding_events')).rows[0].n,0);
 }finally{await db.close();}
});
test('worn locked gear binds without clearing its lock and remains bound through storage and Ascension',async()=>{
 const db=await testDatabase();try{const f=await fixture(db.pool),id=f.items['item.helm']!;await setItemLock(db.pool,f.account,env(1,'SET_ITEM_LOCK'),id,true);await setEquipment(db.pool,f.account,env(2),{activeSet:'A',slots:[{set:'WORN',slot:'HEAD',itemId:id}]});
 await db.pool.query("UPDATE runs SET status='AFTERCORE' WHERE id=$1",[f.run]);await ascend(db.pool,f.account,env(3,'ASCEND'));assert.equal((await row(db.pool,id)).bound_account_id,f.account);assert.equal((await itemLockView(db.pool,f.account,id)).locked,true);assert.equal((await integrityReport(db.pool)).itemBindingHistoryMismatches,0);
 const home=(await db.pool.query("INSERT INTO inventory_containers(scope_id,kind,label) SELECT id,'HOME','binding-test' FROM state_scopes WHERE account_id=$1 RETURNING id",[f.account])).rows[0].id;await moveItem(db.pool,f.account,env(0,'MOVE_ITEM'),id,home);assert.equal((await row(db.pool,id)).binding,'ACCOUNT_BOUND');
 }finally{await db.close();}
});
test('late failure rolls back binding, equipment projections and receipt together',async()=>{
 const db=await testDatabase();try{const f=await fixture(db.pool),id=f.items['item.sword']!;
 await db.pool.query("CREATE FUNCTION fail_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Forced binding failure'; END $$; CREATE TRIGGER fail_binding BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_binding()");const request=env(1);await assert.rejects(setEquipment(db.pool,f.account,request,plan(id)),/Forced binding failure/);assert.equal((await row(db.pool,id)).binding,'TRADEABLE');assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM item_binding_events')).rows[0].n,0);assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM equipment_events')).rows[0].n,0);
 await db.pool.query('DROP TRIGGER fail_binding ON audit_events');await setEquipment(db.pool,f.account,request,plan(id));assert.equal((await row(db.pool,id)).binding,'ACCOUNT_BOUND');
 }finally{await db.close();}
});
test('direct binding edits, rewritten history and forged inactive-set events fail at SQL boundaries',async()=>{
 const db=await testDatabase();try{const f=await fixture(db.pool),id=f.items['item.sword']!;await setEquipment(db.pool,f.account,env(1),plan(id,'A','B'));
 await assert.rejects(db.pool.query("UPDATE inventory_items SET binding='ACCOUNT_BOUND',bound_account_id=$1 WHERE id=$2",[f.account,id]),/immutable/);
 await assert.rejects(db.pool.query("INSERT INTO item_binding_events(item_id,equipment_event_id,action_id,run_id,bound_account_id,previous_binding,binding) SELECT $1,id,action_id,run_id,$2,'TRADEABLE','ACCOUNT_BOUND' FROM equipment_events WHERE run_id=$3",[id,f.account,f.run]),/Invalid active-equipment/);
 await setEquipment(db.pool,f.account,env(2),plan(id,'B','B'));await assert.rejects(db.pool.query("UPDATE inventory_items SET binding='TRADEABLE',bound_account_id=NULL WHERE id=$1",[id]),/immutable/);
 for(const sql of ['UPDATE item_binding_events SET created_at=now()','DELETE FROM item_binding_events'])await assert.rejects(db.pool.query(sql),/Immutable record/);
 }finally{await db.close();}
});
test('binding preserves original authored loot commitment and later reward audits remain valid',async()=>{
 const db=await testDatabase();try{const p=structuredClone(pkg);p.version='binding-loot';p.entities.push({id:'loot.gear',kind:'LOOT_TABLE',revision:1,schemaVersion:1,definition:{name:'Gear',dependencies:['item.sword'],public:{},mechanics:{loot:{version:1,commitment:'ENCOUNTER_START',groups:[{key:'gear',chance:{numerator:1,denominator:1},entries:[{itemId:'item.sword',weight:1,min:1,max:1,binding:'TRADEABLE',quality:'1'}]}]}}}},{id:'encounter.gear',kind:'ENCOUNTER',revision:1,schemaVersion:1,definition:{name:'Gear encounter',dependencies:['loot.gear'],public:{},mechanics:{encounter:{version:2,turnCost:1,lootTableId:'loot.gear'}}}});
 const release=await publishContent(db.pool,p),f=await actor(db.pool,release);await db.pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE run_id=$1",[f.run]);const started=await executeAction(db.pool,f.account,env(0,'LOOT_FIXTURE'),{},async c=>({...await beginAuthoredEncounter(c,'encounter.gear',{}),revision:await advanceRevision(c)}));await executeAction(db.pool,f.account,env(1,'LOOT_FIXTURE'),{},async c=>({...await settleAuthoredVictory(c,started.instanceId as string,0),revision:await advanceRevision(c)}));
 const id=(await db.pool.query("SELECT id FROM inventory_items WHERE definition_id='item.sword'")).rows[0].id;await setEquipment(db.pool,f.account,env(2),plan(id));assert.equal((await row(db.pool,id)).binding,'ACCOUNT_BOUND');assert.equal((await integrityReport(db.pool)).rewardMismatches,0);assert.equal((await db.pool.query('SELECT inventory_issue_binding($1) AS binding',[id])).rows[0].binding,'TRADEABLE');
 }finally{await db.close();}
});
test('restricted runtime can bind gear but cannot erase history or remove a permanent bond',async()=>{
 const db=await testDatabase(),role=`probe_${randomUUID().replaceAll('-','')}`;let created=false;try{const f=await fixture(db.pool);await db.pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);created=true;
 await db.pool.query(`GRANT USAGE ON SCHEMA ${db.schema} TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA ${db.schema} TO ${role}; GRANT UPDATE(security_epoch) ON accounts TO ${role}; GRANT UPDATE ON runs,run_progression,inventory_items,inventory_containers,state_scopes TO ${role}; GRANT INSERT ON equipment_events,item_binding_events,action_receipts,audit_events,outbox_events TO ${role}; GRANT INSERT,UPDATE ON run_equipment TO ${role}; GRANT INSERT,DELETE ON equipment_slots TO ${role}`);
 const client=await db.pool.connect();try{await client.query(`SET ROLE ${role}`);const restricted={connect:async()=>({query:client.query.bind(client),release:()=>{}})} as unknown as pg.Pool;await setEquipment(restricted,f.account,env(1),plan(f.items['item.sword']!));await assert.rejects(client.query('DELETE FROM item_binding_events'),(e:{code?:string})=>e.code==='42501');}finally{await client.query('RESET ROLE');client.release();}assert.equal((await integrityReport(db.pool)).itemBindingHistoryMismatches,0);
 }finally{if(created){await db.pool.query(`DROP OWNED BY ${role}`);await db.pool.query(`DROP ROLE ${role}`);}await db.close();}
});
test('binding policies are versioned and pinned releases cannot change old gear behavior',async()=>{
 const db=await testDatabase();try{const invalid=structuredClone(pkg);(invalid.entities[0]!.definition.mechanics!.equipment as {version:number}).version=1;assert.throws(()=>validateContent(invalid),/INVALID_EQUIPMENT_SPEC/);
 const f=await fixture(db.pool),newer=structuredClone(pkg);newer.version='binding-newer';newer.entities[2]!.revision=2;newer.entities[2]!.definition.mechanics!.equipment={version:2,slots:['MAIN_HAND'],hands:1,minimumLevel:1,bindingPolicy:'ACCOUNT_ON_ACTIVE_EQUIP'};await publishContent(db.pool,newer);await setEquipment(db.pool,f.account,env(1),plan(f.items['item.ordinary']!));assert.equal((await row(db.pool,f.items['item.ordinary']!)).binding,'TRADEABLE');
 }finally{await db.close();}
});
test('SQL rejects an active setup without its required bond and the audit detects corrupted bond state',async()=>{
 const db=await testDatabase();try{const f=await fixture(db.pool),id=f.items['item.sword']!;await db.pool.query('ALTER TABLE equipment_events DISABLE TRIGGER z_equipment_binding_apply');await assert.rejects(setEquipment(db.pool,f.account,env(1),plan(id)),/Equipment state or history is inconsistent/);assert.equal((await row(db.pool,id)).binding,'TRADEABLE');
 await db.pool.query('ALTER TABLE equipment_events ENABLE TRIGGER z_equipment_binding_apply');await setEquipment(db.pool,f.account,env(1),plan(id));await setEquipment(db.pool,f.account,env(2),emptyEquipment());
 await db.pool.query('ALTER TABLE inventory_items DISABLE TRIGGER item_accounting; ALTER TABLE inventory_items DISABLE TRIGGER item_binding_history_integrity');await db.pool.query("UPDATE inventory_items SET binding='TRADEABLE',bound_account_id=NULL WHERE id=$1",[id]);assert.equal((await integrityReport(db.pool)).itemBindingHistoryMismatches,1);
 }finally{await db.close();}
});
test('read-only players can preview owned binding policy without hidden mechanics or foreign identities',async()=>{
 const db=await testDatabase();try{const f=await fixture(db.pool),other=await fixture(db.pool),token='rs1_'+randomBytes(32).toString('base64url');await db.pool.query(`INSERT INTO auth_sessions(account_id,token_digest,security_epoch,scopes,device_label,expires_at) SELECT id,$2,security_epoch,ARRAY['GAME_READ'],'Binding preview',now()+interval '1 hour' FROM accounts WHERE id=$1`,[f.account,createHash('sha256').update(token).digest('hex')]);
 const app=buildApp(db.pool,{mode:'sessions',throttleKey:'binding-throttle-key-long-enough'}),headers={authorization:`Bearer ${token}`};try{const url=`/api/v1/inventory/${f.items['item.sword']}/binding`,response=await app.inject({method:'GET',url,headers});assert.equal(response.statusCode,200);assert.deepEqual(response.json(),{itemId:f.items['item.sword'],binding:'TRADEABLE',bindingPolicy:'ACCOUNT_ON_ACTIVE_EQUIP',bindsOnActiveEquip:true});assert.equal((await app.inject({method:'GET',url:`/api/v1/inventory/${other.items['item.sword']}/binding`,headers})).statusCode,404);assert.equal((await app.inject({method:'GET',url})).statusCode,401);assert.equal((await app.inject({method:'POST',url:'/api/v1/equipment',headers,payload:{...env(1),...plan(f.items['item.sword']!),binding:'TRADEABLE'}})).statusCode,400);
 }finally{await app.close();}
 }finally{await db.close();}
});
