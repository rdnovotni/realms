import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { actor,testDatabase } from './helpers.js';
import { publishContent,validateContent,contentView,type ContentPackage } from '../src/domains/content.js';
import { executeAction } from '../src/foundation/action.js';
import { transferGold } from '../src/domains/economy.js';
import { createInstance,getInstanceView } from '../src/domains/instances.js';
import { moveItem } from '../src/domains/inventory.js';
import { applyRollover,ascend } from '../src/domains/lifecycle.js';
import { registerContract,writeState } from '../src/domains/state.js';
import { enqueue,claimJob,finishJob,reapExhaustedJobs,dispatchOutbox } from '../src/domains/jobs.js';
import { transaction } from '../src/foundation/transaction.js';
import { assertSchema,migrate } from '../src/database.js';
import { spendTurns } from '../src/actions.js';
const packageV1:ContentPackage={version:'fixture-1',engineVersion:'foundation-1',entities:[{id:'item.fixture',kind:'ITEM',revision:1,schemaVersion:1,definition:{name:'Fixture',dependencies:[],public:{description:'Known item'},advanced:{hint:'Advanced hint'},mechanics:{power:10},secrets:{dropRate:0.03}}}]};
const envelope=(type:string,revision=0)=>({requestId:randomUUID(),actionType:type,expectedRevision:revision});

test('migration, sealed content, knowledge boundary and validated state contracts',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    await migrate(pool);await assertSchema(pool);
    const release=await publishContent(pool,packageV1),user=await actor(pool,release);
    assert.equal(await publishContent(pool,structuredClone(packageV1)),release);
    const changed=structuredClone(packageV1);changed.entities[0]!.definition.mechanics={power:11};
    await assert.rejects(publishContent(pool,changed),/CONTENT_VERSION_REUSED/);
    changed.version='fixture-2';await assert.rejects(publishContent(pool,changed),/CONTENT_REVISION_REUSED/);
    const missing=structuredClone(packageV1);missing.entities[0]!.definition.dependencies=['item.missing'];
    assert.throws(()=>validateContent(missing),/MISSING_CONTENT_DEPENDENCY/);
    missing.entities[0]!.definition.dependencies=['item.fixture'];assert.throws(()=>validateContent(missing),/CYCLIC_CONTENT_DEPENDENCY/);
    await assert.rejects(pool.query('UPDATE content_versions SET definition=$1',[{}]),/Immutable record/);
    await assert.rejects(pool.query('INSERT INTO release_entries(release_id,entity_id,revision) VALUES($1,$2,1)',[release,'item.fixture']),/sealed/);
    await assert.rejects(contentView(pool,user.account,release,'item.fixture'),/CONTENT_NOT_KNOWN/);
    await pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,'item.fixture','DISCOVERED')",[user.account]);
    const view=await contentView(pool,user.account,release,'item.fixture');
    assert.equal(view.advanced,null);assert.ok(!JSON.stringify(view).includes('dropRate'));assert.ok(!JSON.stringify(view).includes('power'));
    await pool.query("UPDATE discoveries SET knowledge_level='ADVANCED' WHERE account_id=$1",[user.account]);
    assert.deepEqual((await contentView(pool,user.account,release,'item.fixture')).advanced,{hint:'Advanced hint'});
    const scope=(await pool.query('SELECT id FROM state_scopes WHERE run_id=$1',[user.run])).rows[0].id;
    await transaction(pool,async client=>{
      await registerContract(client,{key:'quest.daily.v1',ownerModule:'quests',scopeKind:'RUN',resetPolicy:'RESET_AT_ROLLOVER',schema:{type:'integer',minimum:0},defaultValue:0});
      assert.equal(await writeState(client,'quests',scope,'quest.daily.v1',3,null),'0');
      await assert.rejects(writeState(client,'quests',scope,'quest.daily.v1',-1,'0'),/INVALID_STATE_VALUE/);
      await assert.rejects(writeState(client,'inventory',scope,'quest.daily.v1',1,'0'),/INVALID_STATE_SCOPE/);
      assert.equal(await writeState(client,'quests',scope,'quest.daily.v1',4,'0'),'1');
      await assert.rejects(writeState(client,'quests',scope,'quest.daily.v1',5,'0'),/STALE_STATE_REVISION/);
    });
    const accountScope=(await pool.query('SELECT id FROM state_scopes WHERE account_id=$1',[user.account])).rows[0].id;
    await assert.rejects(pool.query("INSERT INTO scoped_state(scope_id,scope_kind,key,value) VALUES($1,'ACCOUNT','quest.daily.v1','0')",[accountScope]),/foreign key/);
  }finally{await db.close();}
});

test('currency conservation, concurrent spending, ledger immutability and rollback',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const user=await actor(pool,null,3,'CASUAL');
    const scope=(await pool.query('SELECT id FROM state_scopes WHERE account_id=$1',[user.account])).rows[0].id;
    const world=randomUUID();await pool.query("INSERT INTO worlds(id,name) VALUES($1,'economy-test')",[world]);
    const worldScope=(await pool.query('SELECT id FROM state_scopes WHERE world_id=$1',[world])).rows[0].id;
    const from=randomUUID(),to=randomUUID(),faucet=randomUUID();
    await pool.query("INSERT INTO wallets(id,scope_id,currency_id,purpose) VALUES($1,$4,'GOLD','PLAYER'),($2,$5,'GOLD','TREASURY'),($3,$5,'GOLD','FAUCET_SINK')",[from,to,faucet,scope,worldScope]);
    await assert.rejects(pool.query('UPDATE wallets SET balance=100 WHERE id=$1',[from]),/transfers only/);
    await executeAction(pool,user.account,envelope('FIXTURE_GRANT'),{},async context=>{
      await context.client.query("INSERT INTO currency_transfers(action_id,currency_id,from_wallet_id,to_wallet_id,amount,reason) VALUES($1,'GOLD',$2,$3,10,'FIXTURE')",[context.actionId,faucet,from]);return {fixture:true};
    });
    const outcomes=await Promise.allSettled([transferGold(pool,user.account,envelope('TRANSFER_GOLD'),from,to,'7'),transferGold(pool,user.account,envelope('TRANSFER_GOLD'),from,to,'7')]);
    assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);
    assert.equal((await pool.query('SELECT sum(balance)::text AS total FROM wallets')).rows[0].total,'0');
    assert.equal((await pool.query('SELECT balance::text FROM wallets WHERE id=$1',[from])).rows[0].balance,'3');
    assert.equal(await dispatchOutbox(pool),2);assert.equal(await dispatchOutbox(pool),0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM durable_jobs')).rows[0].n,2);
    await assert.rejects(pool.query('DELETE FROM currency_transfers'),/Immutable record/);
    const before=(await pool.query('SELECT count(*)::int AS n FROM currency_transfers')).rows[0].n;
    await assert.rejects(executeAction(pool,user.account,envelope('ROLLBACK_FIXTURE',1),{},async context=>{
      await context.client.query("INSERT INTO currency_transfers(action_id,currency_id,from_wallet_id,to_wallet_id,amount,reason) VALUES($1,'GOLD',$2,$3,1,'ROLLBACK')",[context.actionId,from,to]);throw new Error('Forced failure');
    }),/Forced failure/);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM currency_transfers')).rows[0].n,before);
    assert.equal((await pool.query('SELECT balance::text FROM wallets WHERE id=$1',[from])).rows[0].balance,'3');
  }finally{await db.close();}
});

test('inventory custody, encounter privacy, rollover deferral and Ascension lifetimes',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const release=await publishContent(pool,packageV1),user=await actor(pool,release,390),other=await actor(pool,release);
    // Make the actor eligible for a rollover that is due at the time the test runs.
    await pool.query("UPDATE accounts SET created_at=now()-interval '2 days' WHERE id=$1",[user.account]);
    await pool.query("INSERT INTO rollover_epochs VALUES(1,now()-interval '1 day',100,400)");
    const created=await createInstance(pool,user.account,envelope('CREATE_INSTANCE'),release,'COMBAT');
    const view=await getInstanceView(pool,user.account,created.instanceId as string);
    assert.ok(!('seed' in view));assert.ok(!('state' in view));
    await assert.rejects(getInstanceView(pool,other.account,created.instanceId as string),/INSTANCE_NOT_FOUND/);
    assert.deepEqual(await applyRollover(pool,user.account),{applied:0,deferred:true});
    await pool.query("UPDATE instances SET lifecycle='RESOLVED' WHERE id=$1",[created.instanceId]);
    await pool.query('UPDATE run_consumption SET fullness=5,drunkenness=3 WHERE run_id=$1',[user.run]);
    assert.deepEqual(await applyRollover(pool,user.account),{applied:1,deferred:false});
    assert.deepEqual(await applyRollover(pool,user.account),{applied:0,deferred:false});
    assert.equal((await pool.query('SELECT turns FROM runs WHERE id=$1',[user.run])).rows[0].turns,400);
    const scope=(await pool.query('SELECT id FROM state_scopes WHERE run_id=$1',[user.run])).rows[0].id;
    const containers=await pool.query("INSERT INTO inventory_containers(scope_id,kind,label) VALUES($1,'CARRIED','a'),($1,'CARRIED','b') RETURNING id",[scope]);
    const item=randomUUID();
    await pool.query("INSERT INTO inventory_items(id,container_id,definition_id,release_id,definition_revision,storage_mode,quantity,binding,bound_run_id,source_code) VALUES($1,$2,'item.fixture',$3,1,'INSTANCE',1,'RUN_BOUND',$4,'TEST')",[item,containers.rows[0].id,release,user.run]);
    const moved=await moveItem(pool,user.account,envelope('MOVE_ITEM',2),item,containers.rows[1].id);assert.equal(moved.revision,3);
    await assert.rejects(pool.query('UPDATE inventory_items SET quantity=2 WHERE id=$1',[item]),/check constraint/);
    const ordinary=randomUUID();
    await pool.query("INSERT INTO inventory_items(id,container_id,definition_id,release_id,definition_revision,storage_mode,quantity,source_code) VALUES($1,$2,'item.fixture',$3,1,'INSTANCE',1,'TEST')",[ordinary,containers.rows[0].id,release]);
    await pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,'item.fixture','LEARNED')",[user.account]);
    await pool.query("UPDATE runs SET status='AFTERCORE' WHERE id=$1",[user.run]);
    await pool.query('UPDATE run_consumption SET fullness=6 WHERE run_id=$1',[user.run]);
    const request=envelope('ASCEND',3),next=await ascend(pool,user.account,request);
    assert.equal(next.turns,400);assert.equal((await ascend(pool,user.account,request)).replayed,true);
    assert.equal((await pool.query('SELECT lifecycle FROM state_scopes WHERE run_id=$1',[user.run])).rows[0].lifecycle,'ARCHIVED');
    assert.equal((await pool.query('SELECT fullness FROM run_consumption WHERE run_id=$1',[next.runId])).rows[0].fullness,6);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM discoveries WHERE account_id=$1',[user.account])).rows[0].n,1);
    assert.equal((await pool.query(`SELECT s.account_id FROM inventory_items i JOIN inventory_containers c ON c.id=i.container_id JOIN state_scopes s ON s.id=c.scope_id WHERE i.id=$1`,[ordinary])).rows[0].account_id,user.account);
    await assert.rejects(pool.query("UPDATE runs SET rules_version='unexpected' WHERE id=$1",[next.runId]),/immutable/);
    assert.deepEqual(await applyRollover(pool,user.account),{applied:0,deferred:false});
    await pool.query('UPDATE runs SET turns=450 WHERE id=$1',[next.runId]);
    await pool.query("INSERT INTO rollover_epochs VALUES(2,now()-interval '1 hour',100,400)");
    await applyRollover(pool,user.account);
    assert.equal((await pool.query('SELECT turns FROM runs WHERE id=$1',[next.runId])).rows[0].turns,450);
    assert.equal((await pool.query('SELECT turn_grant FROM run_rollovers WHERE epoch=2')).rows[0].turn_grant,0);
  }finally{await db.close();}
});

test('durable worker leases fence stale workers and exhaust retries',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const id=await enqueue(pool,'unique-task','MAIL',{message:'fixture'});
    assert.equal(await enqueue(pool,'unique-task','MAIL',{message:'fixture'}),id);
    await assert.rejects(enqueue(pool,'unique-task','MAIL',{message:'changed'}),/different work/);
    const claims=await Promise.all([claimJob(pool),claimJob(pool)]),first=claims.find(Boolean);
    assert.equal(claims.filter(Boolean).length,1);
    await pool.query("UPDATE durable_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[id]);
    const second=await claimJob(pool);assert.notEqual(first.lease_token,second.lease_token);
    assert.equal(await finishJob(pool,id,first.lease_token,true),false);
    assert.equal(await finishJob(pool,id,second.lease_token,false),true);
    await pool.query("UPDATE durable_jobs SET available_at=now()-interval '1 second' WHERE id=$1",[id]);
    assert.ok(await claimJob(pool));
    await pool.query("UPDATE durable_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[id]);
    await reapExhaustedJobs(pool);assert.equal((await pool.query('SELECT status FROM durable_jobs WHERE id=$1',[id])).rows[0].status,'FAILED');
  }finally{await db.close();}
});

test('existing prototype receipts remain replayable after migration',async()=>{
  const db=await testDatabase(false),pool=db.pool;
  try{
    const original=await readFile(new URL('../migrations/001_foundation.sql',import.meta.url),'utf8');
    await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    await pool.query(original);
    await pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',['001_foundation.sql',createHash('sha256').update(original).digest('hex')]);
    const user={account:randomUUID(),character:randomUUID(),run:randomUUID()},requestId=randomUUID();
    await pool.query('INSERT INTO accounts(id) VALUES($1)',[user.account]);
    await pool.query('INSERT INTO characters(id,account_id) VALUES($1,$2)',[user.character,user.account]);
    await pool.query('INSERT INTO runs(id,character_id,turns) VALUES($1,$2,3)',[user.run,user.character]);
    const hash=createHash('sha256').update(JSON.stringify(['SPEND_TURNS',1,0])).digest('hex');
    await pool.query('INSERT INTO action_receipts(account_id,request_id,payload_hash,result) VALUES($1,$2,$3,$4)',[user.account,requestId,hash,{runId:user.run,turns:2,revision:1}]);
    await migrate(pool);await assertSchema(pool);
    const result=await spendTurns(pool,user.account,{requestId,actionType:'SPEND_TURNS',amount:1,expectedRevision:0});
    assert.equal(result.replayed,true);assert.equal((await pool.query('SELECT turns FROM runs WHERE id=$1',[user.run])).rows[0].turns,3);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM state_scopes')).rows[0].n,3);
    await pool.query("UPDATE schema_migrations SET checksum='corrupted' WHERE name='001_foundation.sql'");
    await assert.rejects(assertSchema(pool),/checksum mismatch/);
    await assert.rejects(migrate(pool),/Applied migration changed/);
  }finally{await db.close();}
});
