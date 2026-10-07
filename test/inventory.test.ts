import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { testDatabase,actor } from './helpers.js';
import { publishContent,type ContentPackage,validateContent } from '../src/domains/content.js';
import { grantItem,consumeItem,splitStack,mergeStacks,type ItemGrant } from '../src/domains/item-accounting.js';
import { executeAction,advanceRevision,type ActionContext } from '../src/foundation/action.js';
import { integrityReport,unindexedForeignKeys } from '../src/foundation/integrity.js';
import { moveItem } from '../src/domains/inventory.js';
import { ascend } from '../src/domains/lifecycle.js';
import { migrate } from '../src/database.js';
const envelope=(type:string,revision=0)=>({requestId:randomUUID(),actionType:type,expectedRevision:revision});
const pkg:ContentPackage={version:'inventory-fixture-1',engineVersion:'foundation-1',entities:[
  {id:'item.ore',kind:'ITEM',revision:1,schemaVersion:1,definition:{name:'Ore',dependencies:[],public:{},mechanics:{inventory:{version:1,storageMode:'STACK',category:'MATERIAL'}}}},
  {id:'item.sword',kind:'ITEM',revision:1,schemaVersion:1,definition:{name:'Sword',dependencies:[],public:{},mechanics:{inventory:{version:1,storageMode:'INSTANCE',category:'EQUIPMENT'}}}}
]};
async function fixture(pool:Awaited<ReturnType<typeof testDatabase>>['pool'],mode='STANDARD'){
  const release=await publishContent(pool,pkg),user=await actor(pool,release,5,mode);
  const container=(await pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE run_id=$1 RETURNING id",[user.run])).rows[0].id as string;
  return {...user,release,container};
}
const ore=(containerId:string,amount='10'):ItemGrant=>({containerId,definitionId:'item.ore',quantity:amount,sourceCode:'FIXTURE',metadata:{provenance:{maker:'fixture'}}});
async function grant(pool:Awaited<ReturnType<typeof testDatabase>>['pool'],account:string,input:ItemGrant,revision=0){
  return executeAction(pool,account,envelope('FIXTURE_GRANT',revision),{input},async context=>grantItem(context,'ore',input,'FIXTURE'));
}

test('reward grants replay once; stacks split and merge without losing provenance or quantity',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const f=await fixture(pool),request=envelope('REWARD'),input=ore(f.container);
    const reward=()=>executeAction(pool,f.account,request,{input},async context=>({...await grantItem(context,'reward',input,'QUEST_REWARD'),revision:await advanceRevision(context)}));
    const results=await Promise.all(Array.from({length:6},reward));
    assert.equal(results.filter(r=>!r.replayed).length,1);assert.ok(results.every(r=>r.itemId===results[0]!.itemId));
    const item=results[0]!.itemId as string,splitRequest=envelope('SPLIT_STACK',1);
    const split=await splitStack(pool,f.account,splitRequest,item.toUpperCase(),'4');
    assert.equal((await splitStack(pool,f.account,splitRequest,item,'4')).replayed,true);
    const child=split.splitItemId as string;
    assert.deepEqual((await pool.query('SELECT quantity::text FROM inventory_items ORDER BY quantity')).rows,[{quantity:'4'},{quantity:'6'}]);
    assert.ok((await pool.query('SELECT metadata FROM inventory_items')).rows.every(i=>JSON.stringify(i.metadata)===JSON.stringify(input.metadata)));
    const merged=await mergeStacks(pool,f.account,envelope('MERGE_STACKS',2),child,item);assert.equal(merged.quantity,'10');
    assert.equal((await pool.query('SELECT quantity::text FROM inventory_items WHERE id=$1',[child])).rows[0].quantity,'0');
    await assert.rejects(moveItem(pool,f.account,envelope('MOVE_ITEM',3),child,f.container),/ITEM_NOT_FOUND/);
    assert.equal((await integrityReport(pool)).itemQuantityMismatches,0);assert.deepEqual(await unindexedForeignKeys(pool),[]);
  }finally{await db.close();}
});

test('crafting inputs, Turn cost, output, receipts and history commit or roll back together',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const f=await fixture(pool),material=(await grant(pool,f.account,ore(f.container))).itemId as string;
    const before=(await pool.query('SELECT count(*)::int AS n FROM inventory_quantity_operations')).rows[0].n;
    const attempt=(request:ReturnType<typeof envelope>,fail:boolean)=>executeAction(pool,f.account,request,{material,fail},async context=>{
      await consumeItem(context,'materials',material,'6','CRAFT_INPUT');
      await context.client.query('UPDATE runs SET turns=turns-1 WHERE id=$1',[f.run]);
      await context.client.query("INSERT INTO turn_ledger(run_id,request_id,delta,reason) VALUES($1,$2,-1,'CRAFT_FIXTURE')",[f.run,context.requestId]);
      const output=await grantItem(context,'output',{containerId:f.container,definitionId:'item.sword',quantity:'1',sourceCode:'CRAFT_FIXTURE',quality:'87',binding:'RUN_BOUND'},'CRAFT_OUTPUT');
      if(fail) throw new Error('Forced crafting failure');
      return {...output,revision:await advanceRevision(context)};
    });
    await assert.rejects(attempt(envelope('CRAFT'),true),/Forced crafting failure/);
    assert.equal((await pool.query('SELECT quantity::text FROM inventory_items WHERE id=$1',[material])).rows[0].quantity,'10');
    assert.deepEqual((await pool.query('SELECT turns,revision FROM runs WHERE id=$1',[f.run])).rows[0],{turns:5,revision:0});
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM inventory_quantity_operations')).rows[0].n,before);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM inventory_items')).rows[0].n,1);
    const request=envelope('CRAFT'),crafted=await attempt(request,false);assert.equal((await attempt(request,false)).replayed,true);
    const sword=(await pool.query('SELECT quantity::text,quality::text,binding,bound_run_id FROM inventory_items WHERE id=$1',[crafted.itemId])).rows[0];
    assert.deepEqual(sword,{quantity:'1',quality:'87.0000',binding:'RUN_BOUND',bound_run_id:f.run});
    assert.equal((await pool.query('SELECT turns FROM runs WHERE id=$1',[f.run])).rows[0].turns,4);
    assert.equal((await integrityReport(pool)).itemQuantityMismatches,0);
  }finally{await db.close();}
});

test('concurrent consumption cannot double-spend; foreign and inaccessible custody is denied',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const f=await fixture(pool),item=(await grant(pool,f.account,ore(f.container))).itemId as string,other=await actor(pool,f.release);
    const spend=(account:string,amount:string)=>executeAction(pool,account,envelope('USE_MATERIAL'),{item,amount},async context=>consumeItem(context,'consume',item,amount,'FIXTURE'));
    await assert.rejects(spend(other.account,'1'),/CONTAINER_NOT_OWNED/);
    const results=await Promise.allSettled([spend(f.account,'7'),spend(f.account,'7')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal((await pool.query('SELECT quantity::text FROM inventory_items WHERE id=$1',[item])).rows[0].quantity,'3');
    await spend(f.account,'3');await assert.rejects(spend(f.account,'1'),/ITEM_NOT_FOUND/);
    const legacy=(await pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'HOME' FROM state_scopes WHERE account_id=$1 RETURNING id",[f.account])).rows[0].id;
    await assert.rejects(grant(pool,f.account,ore(legacy)),/LEGACY_ACCESS_RESTRICTED/);
    const escrow=(await pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'ESCROW' FROM state_scopes WHERE run_id=$1 RETURNING id",[f.run])).rows[0].id;
    await assert.rejects(grant(pool,f.account,ore(escrow)),/CONTAINER_NOT_OWNED/);
  }finally{await db.close();}
});

test('incompatible stacks and overflowing quantities do not mutate history',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const f=await fixture(pool),a=(await grant(pool,f.account,ore(f.container,'9223372036854775807'))).itemId as string;
    const b=(await grant(pool,f.account,ore(f.container,'1'))).itemId as string;
    await assert.rejects(mergeStacks(pool,f.account,envelope('MERGE'),b,a),/ITEM_QUANTITY_OVERFLOW/);
    const different=ore(f.container);different.metadata={provenance:{maker:'other'}};
    const c=(await grant(pool,f.account,different)).itemId as string;
    await assert.rejects(mergeStacks(pool,f.account,envelope('MERGE'),c,b),/INCOMPATIBLE_STACKS/);
    await assert.rejects(splitStack(pool,f.account,envelope('SPLIT'),b,'1'),/INVALID_STACK_SPLIT/);
    await assert.rejects(grant(pool,f.account,{...ore(f.container),definitionId:'item.sword',quantity:'2'}),/INSTANCE_QUANTITY_REQUIRED/);
    await assert.rejects(grant(pool,f.account,ore(f.container,'9223372036854775808')),/INVALID_ITEM_QUANTITY/);
    await assert.rejects(grant(pool,f.account,{...ore(f.container),definitionId:'item.missing'}),/ITEM_NOT_IN_RULES_SNAPSHOT/);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM inventory_quantity_operations')).rows[0].n,3);
  }finally{await db.close();}
});

test('SQL denies direct quantity changes, provenance edits, deletion, unissued rows and resurrection',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const f=await fixture(pool),result=await grant(pool,f.account,ore(f.container)),item=result.itemId as string;
    await assert.rejects(pool.query('UPDATE inventory_items SET quantity=11 WHERE id=$1',[item]),/ledger operations/);
    await assert.rejects(pool.query('UPDATE inventory_items SET metadata=$1 WHERE id=$2',[{forged:true},item]),/provenance are immutable/);
    await assert.rejects(pool.query('DELETE FROM inventory_items WHERE id=$1',[item]),/cannot be deleted/);
    await assert.rejects(pool.query('DELETE FROM inventory_quantity_operations'),/Immutable record/);
    await assert.rejects(pool.query("INSERT INTO inventory_quantity_operations(operation_key,kind,to_item_id,quantity,reason) VALUES('opening','OPENING',$1,1,'FORGED')",[item]),/migration-only/);
    await assert.rejects(pool.query(`INSERT INTO inventory_items(container_id,definition_id,release_id,definition_revision,storage_mode,quantity,source_code) VALUES($1,'item.ore',$2,1,'STACK',0,'UNISSUED')`,[f.container,f.release]),/requires an issuance/);
    await executeAction(pool,f.account,envelope('RETIRE'),{item},async context=>consumeItem(context,'consume',item,'10','FIXTURE'));
    await assert.rejects(executeAction(pool,f.account,envelope('REISSUE'),{item},async context=>{
      await context.client.query("INSERT INTO inventory_quantity_operations(action_id,operation_key,kind,to_item_id,quantity,reason) VALUES($1,'reissue','GRANT',$2,1,'FORGED')",[context.actionId,item]);return {ok:true};
    }),/cannot be reissued/);
  }finally{await db.close();}
});

test('quantity reconciliation detects corruption; Ascension moves live materials and leaves tombstones',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const f=await fixture(pool),live=(await grant(pool,f.account,ore(f.container))).itemId as string;
    const dead=(await grant(pool,f.account,ore(f.container,'2'))).itemId as string;
    await executeAction(pool,f.account,envelope('RETIRE'),{dead},async context=>consumeItem(context,'consume',dead,'2','FIXTURE'));
    await pool.query('ALTER TABLE inventory_items DISABLE TRIGGER item_accounting');
    await pool.query('UPDATE inventory_items SET quantity=quantity+1 WHERE id=$1',[live]);
    await pool.query('ALTER TABLE inventory_items ENABLE TRIGGER item_accounting');
    assert.equal((await integrityReport(pool)).itemQuantityMismatches,1);
    await pool.query('ALTER TABLE inventory_items DISABLE TRIGGER item_accounting');
    await pool.query('UPDATE inventory_items SET quantity=quantity-1 WHERE id=$1',[live]);
    await pool.query('ALTER TABLE inventory_items ENABLE TRIGGER item_accounting');
    await pool.query("UPDATE runs SET status='AFTERCORE' WHERE id=$1",[f.run]);
    await ascend(pool,f.account,envelope('ASCEND'));
    assert.equal((await pool.query('SELECT c.kind FROM inventory_items i JOIN inventory_containers c ON c.id=i.container_id WHERE i.id=$1',[live])).rows[0].kind,'MATERIAL_VAULT');
    assert.equal((await pool.query('SELECT container_id FROM inventory_items WHERE id=$1',[dead])).rows[0].container_id,f.container);
    assert.equal((await integrityReport(pool)).itemQuantityMismatches,0);
  }finally{await db.close();}
});

test('upgrade establishes opening history without changing any legacy item',async()=>{
  const db=await testDatabase(false),pool=db.pool;
  try{
    await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    for(const name of ['001_foundation.sql','002_domain_foundation.sql','003_integrity_hardening.sql']){
      const sql=await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8');await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
    }
    const f=await fixture(pool),id=randomUUID();
    await pool.query("INSERT INTO inventory_items(id,container_id,definition_id,release_id,definition_revision,storage_mode,quantity,source_code,metadata) VALUES($1,$2,'item.ore',$3,1,'STACK',37,'LEGACY',$4)",[id,f.container,f.release,{maker:'legacy'}]);
    const before=(await pool.query('SELECT * FROM inventory_items')).rows;
    await migrate(pool);assert.deepEqual((await pool.query('SELECT * FROM inventory_items')).rows,before);
    assert.deepEqual((await pool.query('SELECT kind,to_item_id,quantity::text,action_id FROM inventory_quantity_operations')).rows,[{kind:'OPENING',to_item_id:id,quantity:'37',action_id:null}]);
    assert.equal((await integrityReport(pool)).itemQuantityMismatches,0);
  }finally{await db.close();}
});

test('typed inventory declarations reject incompatible equipment storage',()=>{
  const bad=structuredClone(pkg);bad.entities[1]!.definition.mechanics!.inventory={version:1,storageMode:'STACK',category:'EQUIPMENT'};
  assert.throws(()=>validateContent(bad),/INVALID_ITEM_INVENTORY_SPEC/);
});

test('restricted runtime can issue and consume items but cannot rewrite quantity history',async()=>{
  const db=await testDatabase(),pool=db.pool,role=`probe_${randomUUID().replaceAll('-','')}`;
  let created=false;
  try{
    const f=await fixture(pool);await pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);created=true;
    await pool.query(`GRANT USAGE ON SCHEMA ${db.schema} TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA ${db.schema} TO ${role};
      GRANT INSERT,UPDATE ON inventory_items TO ${role}; GRANT UPDATE ON inventory_containers,state_scopes TO ${role};
      GRANT INSERT ON inventory_quantity_operations,action_receipts TO ${role}`);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');await client.query(`SET LOCAL ROLE ${role}`);
      const run=(await client.query('SELECT * FROM runs WHERE id=$1',[f.run])).rows[0],actionId=randomUUID(),requestId=randomUUID();
      await client.query('INSERT INTO action_receipts(account_id,request_id,payload_hash,result,action_id,envelope_version) VALUES($1,$2,$3,$4,$5,2)',[f.account,requestId,'0'.repeat(64),{probe:true},actionId]);
      const context:ActionContext={client,accountId:f.account,actionId,requestId,run};
      const item=await grantItem(context,'grant',ore(f.container),'PERMISSION_PROBE');
      await consumeItem(context,'consume',item.itemId,'10','PERMISSION_PROBE');await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      await client.query('SAVEPOINT denied');
      await assert.rejects(client.query('DELETE FROM inventory_quantity_operations'),(error:{code?:string})=>error.code==='42501');
      await client.query('ROLLBACK TO denied');
    }finally{await client.query('ROLLBACK');client.release();}
  }finally{if(created){await pool.query(`DROP OWNED BY ${role}`);await pool.query(`DROP ROLE ${role}`);}await db.close();}
});
