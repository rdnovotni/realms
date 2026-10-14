import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase,actor } from './helpers.js';
import { inventoryPackage } from './inventory-fixture.js';
import { publishContent } from '../src/domains/content.js';
import { executeAction,advanceRevision } from '../src/foundation/action.js';
import { grantItem } from '../src/domains/item-accounting.js';
import { inventoryView,setInventoryPreferences } from '../src/domains/inventory-browser.js';
import { moveToPersonalStorage } from '../src/domains/inventory.js';
import { beginEncounter } from '../src/domains/encounters.js';
import { integrityReport } from '../src/foundation/integrity.js';
const env=(expectedRevision:number,actionType:string)=>({requestId:randomUUID(),expectedRevision,actionType});
test('inventory pages preserve complete load totals, filter safely, and restrict ownership/custody',async()=>{
 const db=await testDatabase();try{
  const pkg=inventoryPackage();const otherItem=structuredClone(pkg.entities[0]!);otherItem.id='item.other';otherItem.definition.name='Another material';pkg.entities.push(otherItem);
  const release=await publishContent(db.pool,pkg),f=await actor(db.pool,release,10),other=await actor(db.pool,release,10);
  const container=(await db.pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE run_id=$1 RETURNING id",[f.run])).rows[0].id;
  const ids:string[]=[];
  await executeAction(db.pool,f.account,env(0,'INVENTORY_FIXTURE'),{},async c=>{for(let i=0;i<60;i++)ids.push((await grantItem(c,'ore.'+i,{containerId:container,definitionId:'item.ore',quantity:'1',sourceCode:'FIXTURE'},'Test material')).itemId);return {revision:await advanceRevision(c)};});
  const page=await inventoryView(db.pool,f.account,{grouped:false});assert.equal(page.total,60);assert.equal(page.items.length,48);assert.equal(page.carry.weight,'120');assert.equal(page.carry.state,'OVERLOADED');
  assert.equal((await inventoryView(db.pool,f.account,{offset:48,expectedRevision:1})).items.length,12);
  const grouped=await inventoryView(db.pool,f.account,{grouped:true});assert.equal(grouped.total,1);assert.equal(grouped.items[0].copies,60);assert.equal(grouped.items[0].groupQuantity,'60');
  for(const secret of ['privateMarker','not-for-clients','sourceCode','inventoryRules'])assert.ok(!JSON.stringify(page).includes(secret),secret);
  assert.equal((await inventoryView(db.pool,f.account,{search:'%'})).total,0);
  assert.equal((await inventoryView(db.pool,f.account,{search:'COPPER',category:'MATERIAL'})).total,60);
  await assert.rejects(inventoryView(db.pool,other.account,{container}),/CONTAINER_NOT_OWNED/);
  await assert.rejects(executeAction(db.pool,f.account,env(1,'INVENTORY_FIXTURE'),{},async c=>({...await beginEncounter(c,'encounter.inventory',{}),revision:await advanceRevision(c)})),/INVENTORY_OVERLOADED/);
  assert.equal((await db.pool.query('SELECT revision FROM runs WHERE id=$1',[f.run])).rows[0].revision,1);
  await moveToPersonalStorage(db.pool,f.account,env(1,'MOVE_INVENTORY'),ids[0]!,'HOME');
  await assert.rejects(inventoryView(db.pool,f.account,{expectedRevision:1}),/STALE_REVISION/);
  assert.equal((await inventoryView(db.pool,f.account)).total,59);
  assert.equal((await inventoryView(db.pool,f.account,{container:'ALL'})).total,60);
  await executeAction(db.pool,f.account,env(2,'INVENTORY_FIXTURE'),{},async c=>{await grantItem(c,'other',{containerId:container,definitionId:'item.other',quantity:'1',sourceCode:'FIXTURE'},'Newest base');return {revision:await advanceRevision(c)};});
  assert.equal((await inventoryView(db.pool,f.account,{grouped:true,sort:'NEWEST',direction:'DESC'})).items[0].definitionId,'item.other');
  assert.equal((await inventoryView(db.pool,f.account,{grouped:true,sort:'QUANTITY',direction:'DESC'})).items[0].definitionId,'item.ore');
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{await db.close();}
});
test('configured auto-storage conserves huge grants and preferences replay once',async()=>{
 const db=await testDatabase();try{
  const release=await publishContent(db.pool,inventoryPackage()),f=await actor(db.pool,release,10);
  const container=(await db.pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE run_id=$1 RETURNING id",[f.run])).rows[0].id;
  const request=env(0,'SET_INVENTORY_PREFERENCES');await setInventoryPreferences(db.pool,f.account,request,{autoStoreMaterials:true,autoOverflow:false});assert.equal((await setInventoryPreferences(db.pool,f.account,request,{autoStoreMaterials:true,autoOverflow:false})).replayed,true);
  await executeAction(db.pool,f.account,env(1,'INVENTORY_FIXTURE'),{},async c=>{await grantItem(c,'ore',{containerId:container,definitionId:'item.ore',quantity:'9223372036854775807',sourceCode:'FIXTURE'},'Test material');return {revision:await advanceRevision(c)};});
  const page=await inventoryView(db.pool,f.account,{container:'ALL'});assert.equal(page.items[0].kind,'MATERIAL_VAULT');assert.equal(page.items[0].totalWeight,'18446744073709551614');assert.equal(page.carry.weight,'0');
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{await db.close();}
});

test('encumbrance is pinned into tactical evidence and reconciles after later consumption and storage',async()=>{
 const db=await testDatabase();try{
  const {tacticalPackage,tacticalFixture,envelope}=await import('./tactical-fixture.js');
  const {startTacticalCombat}=await import('../src/domains/tactical-combat.js');
  const {consumeItem}=await import('../src/domains/item-accounting.js');
  const p=tacticalPackage();p.version='inventory-tactical-fixture';
  const policy=inventoryPackage().entities.find(e=>e.id==='rules.inventory')!;
  policy.definition.mechanics!.inventoryRules={...(policy.definition.mechanics!.inventoryRules as Record<string,any>),baseWeight:20,baseBulk:20};p.entities.push(policy);
  for(const item of p.entities.filter(e=>e.kind==='ITEM')){const spec=item.definition.mechanics?.inventory as Record<string,any>|undefined;if(spec)item.definition.mechanics!.inventory={...spec,version:2,unitWeight:spec.category==='MATERIAL'?20:10,unitBulk:1,mundane:true};}
  const unused=structuredClone(p.entities.find(e=>e.id==='item.sword')!);unused.id='item.unowned';unused.definition.mechanics!.inventoryCapacity={version:1,weight:50,bulk:50,minimumNativeLevel:0};p.entities.push(unused);
  const f=await tacticalFixture(db.pool,p);const container=(await db.pool.query("SELECT c.id FROM inventory_containers c JOIN state_scopes s ON s.id=c.scope_id WHERE s.run_id=$1 AND c.kind='CARRIED'",[f.run])).rows[0].id;
  let ore='';await executeAction(db.pool,f.account,envelope(f.revision,'INVENTORY_FIXTURE'),{},async c=>{ore=(await grantItem(c,'ore',{containerId:container,definitionId:'item.ore',quantity:'1',sourceCode:'FIXTURE'},'Test weight')).itemId;return {revision:await advanceRevision(c)};});
  const carried=await inventoryView(db.pool,f.account);assert.equal(carried.carry.weightCapacity,'32');assert.equal(carried.carry.state,'BURDENED');
  const start=await startTacticalCombat(db.pool,f.account,envelope(f.revision+1,'START_TACTICAL'),'encounter.tactical');
  const snapshot=(await db.pool.query("SELECT inputs,derived,(character_snapshot_derived_before_inventory(inputs)->'stats'->>'initiative')::integer original FROM character_encounter_snapshots WHERE instance_id=$1",[start.instanceId])).rows[0];
  assert.equal(snapshot.inputs.inventory.weight,'40');assert.equal(snapshot.derived.stats.initiative,snapshot.original-1);
  await assert.rejects(moveToPersonalStorage(db.pool,f.account,envelope(f.revision+2,'MOVE_INVENTORY'),ore,'HOME'),/INSTANCE_STILL_ACTIVE/);
  await executeAction(db.pool,f.account,envelope(f.revision+2,'INVENTORY_FIXTURE'),{},async c=>{await consumeItem(c,'ore',ore,'1','Fixture consumption');return {revision:await advanceRevision(c)};});
  assert.equal((await inventoryView(db.pool,f.account)).carry.weight,'20');
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
  const client=await db.pool.connect();try{await client.query('BEGIN');await client.query('ALTER TABLE character_encounter_snapshots DISABLE TRIGGER immutable_character_snapshot');
   await client.query(`UPDATE character_encounter_snapshots SET inputs=jsonb_set(jsonb_set(jsonb_set(inputs,'{inventory,weight}','"0"'),'{inventory,state}','"COMFORTABLE"'),'{inventory,penalties}','{"initiative":0,"stealth":0,"mobility":0}') WHERE instance_id=$1`,[start.instanceId]);
   await client.query('UPDATE character_encounter_snapshots SET derived=character_snapshot_derived(inputs) WHERE instance_id=$1',[start.instanceId]);
   assert.equal((await client.query('SELECT count(*)::integer n FROM character_snapshot_integrity_issues WHERE instance_id=$1',[start.instanceId])).rows[0].n,1);
   const forged=structuredClone(snapshot.inputs);forged.inventory.sources=[{id:'item.unowned',revision:1,itemId:randomUUID(),name:unused.definition.name,weight:'50',bulk:'50'}];forged.inventory.weightCapacity='82';forged.inventory.bulkCapacity='82';forged.inventory.state='COMFORTABLE';forged.inventory.penalties={initiative:0,stealth:0,mobility:0};
   await client.query('UPDATE character_encounter_snapshots SET inputs=$2,derived=character_snapshot_derived($2) WHERE instance_id=$1',[start.instanceId,forged]);
   assert.equal((await client.query('SELECT count(*)::integer n FROM character_snapshot_integrity_issues WHERE instance_id=$1',[start.instanceId])).rows[0].n,1,'coherent forged capacity still fails historical ownership');
  }finally{await client.query('ROLLBACK');client.release();}
 }finally{await db.close();}
});

test('inventory HTTP intents preserve receipts, safe history, locks and session write authority',async()=>{
 const {buildApp}=await import('../src/app.js');
 const {enrollPassword,requireLogin}=await import('../src/auth/sessions.js');
 const db=await testDatabase(),app=buildApp(db.pool,{mode:'sessions',throttleKey:'d'.repeat(64)});try{
  const release=await publishContent(db.pool,inventoryPackage()),f=await actor(db.pool,release),other=await actor(db.pool,release);
  const container=(await db.pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE run_id=$1 RETURNING id",[f.run])).rows[0].id;
  let item='';await executeAction(db.pool,f.account,env(0,'INVENTORY_FIXTURE'),{},async c=>{item=(await grantItem(c,'ore',{containerId:container,definitionId:'item.ore',quantity:'10',sourceCode:'PRIVATE_FIXTURE'},'Private staff reason')).itemId;return {revision:await advanceRevision(c)};});
  await enrollPassword(db.pool,f.account,'inventory_http','A secure test password 47!');await enrollPassword(db.pool,other.account,'inventory_other','A secure test password 47!');
  const login=await requireLogin(db.pool,'inventory_http','A secure test password 47!','Grid'),headers={authorization:`Bearer ${login.token}`};
  const ro=await requireLogin(db.pool,'inventory_http','A secure test password 47!','Read only',true),foreign=await requireLogin(db.pool,'inventory_other','A secure test password 47!','Other');
  assert.equal((await app.inject('/api/v1/inventory')).statusCode,401);
  const page=await app.inject({url:'/api/v1/inventory?grouped=false&offset=0&expectedRevision=1&search=..',headers});assert.equal(page.statusCode,200,page.body);assert.equal(page.json().total,0);
  for(const url of ['/api/v1/inventory?offset=-1','/api/v1/inventory?sort=quantity;DROP','/api/v1/inventory?grouped=1','/api/v1/inventory?extra=true'])assert.equal((await app.inject({url,headers})).statusCode,400,url);
  const split={...env(1,'SPLIT_STACK'),itemId:item,quantity:'3'};
  assert.equal((await app.inject({method:'POST',url:'/api/v1/inventory/split',headers:{authorization:`Bearer ${ro.token}`},payload:split})).statusCode,403);
  const r=await app.inject({method:'POST',url:'/api/v1/inventory/split',headers,payload:split});assert.equal(r.statusCode,200,r.body);const child=r.json().splitItemId;
  assert.equal((await app.inject({method:'POST',url:'/api/v1/inventory/split',headers,payload:split})).json().replayed,true);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/inventory/split',headers,payload:{...split,quantity:'2'}})).statusCode,409);
  let revision=2;
  async function post(url:string,type:string,fields:Record<string,unknown>){const response=await app.inject({method:'POST',url,headers,payload:{...env(revision,type),...fields}});assert.equal(response.statusCode,200,response.body);revision++;return response.json();}
  await post('/api/v1/inventory/merge','MERGE_STACKS',{sourceId:child,targetId:item});
  await post('/api/v1/inventory/lock','SET_ITEM_LOCK',{itemId:item,locked:true});
  assert.equal((await app.inject({method:'POST',url:'/api/v1/inventory/split',headers,payload:{...env(revision,'SPLIT_STACK'),itemId:item,quantity:'1'}})).statusCode,409);
  await post('/api/v1/inventory/lock','SET_ITEM_LOCK',{itemId:item,locked:false});
  await post('/api/v1/inventory/move','MOVE_INVENTORY',{itemId:item,kind:'MATERIAL_VAULT'});
  const history=await app.inject({url:`/api/v1/inventory/${item}/history?expectedRevision=${revision}`,headers});assert.equal(history.statusCode,200,history.body);
  for(const kind of ['GRANT','SPLIT_OUT','MERGE_IN','LOCK','UNLOCK','MOVE'])assert.ok(history.json().events.some((e:{kind:string})=>e.kind===kind),kind);
  for(const secret of ['PRIVATE_FIXTURE','Private staff reason',f.account,'operationId','sourceCode'])assert.ok(!history.body.includes(secret),secret);
  assert.equal((await app.inject({url:`/api/v1/inventory/${child}/history`,headers})).statusCode,200,'retired stack history remains owned');
  assert.equal((await app.inject({url:`/api/v1/inventory/${item}/history`,headers:{authorization:`Bearer ${foreign.token}`}})).statusCode,404);
  assert.equal((await app.inject({url:`/api/v1/inventory/${item}/history?expectedRevision=0`,headers})).statusCode,409);
  assert.equal((await app.inject({url:'/api/v1/inventory?container=ALL',headers})).json().items[0].quantity,'10');
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{await app.close();await db.close();}
});

test('capacity counts an active physical item once and refuses unmeasured opted-in entry',async()=>{
 const {tacticalPackage,tacticalFixture,envelope}=await import('./tactical-fixture.js');const {setEquipment}=await import('../src/domains/equipment.js');
 const db=await testDatabase();try{
  const p=tacticalPackage();p.version='inventory-capacity-fixture';p.entities.push(inventoryPackage().entities.find(e=>e.id==='rules.inventory')!);
  for(const item of p.entities.filter(e=>e.kind==='ITEM')){const spec=item.definition.mechanics?.inventory as Record<string,any>|undefined;if(spec)item.definition.mechanics!.inventory={...spec,version:2,unitWeight:1,unitBulk:1,mundane:true};}
  for(const [id,weight] of [['item.sword',30],['item.shield',100]] as const)p.entities.find(e=>e.id===id)!.definition.mechanics!.inventoryCapacity={version:1,weight,bulk:10,minimumNativeLevel:0};
  // A deliberately old unmeasured item remains valid content, but cannot be ignored by new carrying policy.
  p.entities.push({...structuredClone(inventoryPackage().entities[0]!),id:'item.old',definition:{name:'Unmeasured old item',dependencies:[],public:{},mechanics:{inventory:{version:1,storageMode:'STACK',category:'MATERIAL'}}}});
  const f=await tacticalFixture(db.pool,p);
  await setEquipment(db.pool,f.account,envelope(f.revision,'SET_EQUIPMENT'),{activeSet:'A',slots:[{set:'A',slot:'MAIN_HAND',itemId:f.gear.sword!},{set:'B',slot:'MAIN_HAND',itemId:f.gear.sword!},{set:'B',slot:'OFF_HAND',itemId:f.gear.shield!}]});
  let page=await inventoryView(db.pool,f.account);assert.equal(page.carry.weightCapacity,'52');assert.equal(page.carry.sources.length,1);assert.equal(page.carry.sources[0]!.itemId,f.gear.sword);
  const container=page.items[0].containerId;
  let old='';await executeAction(db.pool,f.account,envelope(f.revision+1,'INVENTORY_FIXTURE'),{},async c=>{old=(await grantItem(c,'old',{containerId:container,definitionId:'item.old',quantity:'1',sourceCode:'FIXTURE'},'Unmeasured test')).itemId;return {revision:await advanceRevision(c)};});
  page=await inventoryView(db.pool,f.account);assert.equal(page.carry.state,'UNMEASURED');assert.equal(page.carry.unmeasuredItems,1);
  await assert.rejects(executeAction(db.pool,f.account,envelope(f.revision+2,'INVENTORY_FIXTURE'),{},async c=>({...await beginEncounter(c,'encounter.tactical',{}),revision:await advanceRevision(c)})),/INVENTORY_UNMEASURED/);
  await moveToPersonalStorage(db.pool,f.account,envelope(f.revision+2,'MOVE_INVENTORY'),old,'MATERIAL_VAULT');assert.equal((await inventoryView(db.pool,f.account)).carry.state,'COMFORTABLE');
  await assert.rejects(moveToPersonalStorage(db.pool,f.account,envelope(f.revision+3,'MOVE_INVENTORY'),f.gear.shield!,'MATERIAL_VAULT'),/ITEM_EQUIPPED/);
  const {startTacticalCombat}=await import('../src/domains/tactical-combat.js');
  const started=await startTacticalCombat(db.pool,f.account,envelope(f.revision+3,'START_TACTICAL'),'encounter.tactical');
  const saved=(await db.pool.query('SELECT inputs FROM character_encounter_snapshots WHERE instance_id=$1',[started.instanceId])).rows[0].inputs;
  assert.equal(saved.inventory.sources.length,1);assert.equal(saved.inventory.sources[0].itemId,f.gear.sword);
  assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{await db.close();}
});
