import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { migrate } from '../src/database.js';
import { createInstance } from '../src/domains/instances.js';
import { randomUUID,createHash } from 'node:crypto';
import { testDatabase,actor } from './helpers.js';
import { publishContent,validateContent,type ContentPackage } from '../src/domains/content.js';
import { executeAction,advanceRevision,type ActionContext } from '../src/foundation/action.js';
import { beginEncounter,drawEncounter,encounterCheckpoint,saveEncounterCheckpoint,finishEncounter } from '../src/domains/encounters.js';
import { grantItem } from '../src/domains/item-accounting.js';
import { getInstanceView } from '../src/domains/instances.js';
import { randomInteger } from '../src/foundation/rng.js';
import { unindexedForeignKeys,integrityReport } from '../src/foundation/integrity.js';
const pkg:ContentPackage={version:'encounter-fixture',engineVersion:'foundation-1',entities:[
  {id:'encounter.test',kind:'ENCOUNTER',revision:1,schemaVersion:1,definition:{name:'Test',dependencies:['item.ore'],public:{},mechanics:{encounter:{version:1,turnCost:1}}}},
  {id:'item.ore',kind:'ITEM',revision:1,schemaVersion:1,definition:{name:'Ore',dependencies:[],public:{},mechanics:{inventory:{version:1,storageMode:'STACK',category:'MATERIAL'}}}}
]};
const env=(revision=0)=>({requestId:randomUUID(),actionType:'ENCOUNTER_FIXTURE',expectedRevision:revision});
async function fixture(pool:Awaited<ReturnType<typeof testDatabase>>['pool'],turns=3){
  const release=await publishContent(pool,pkg),user=await actor(pool,release,turns);
  const container=(await pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE run_id=$1 RETURNING id",[user.run])).rows[0].id as string;
  const request=env(),start=()=>executeAction(pool,user.account,request,{},async c=>({...await beginEncounter(c,'encounter.test',{round:0,hidden:'fixture'}),revision:await advanceRevision(c)}));
  return {...user,release,container,request,start};
}

test('encounter start commits one Turn and snapshot once; disconnect cannot replace the open encounter',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const f=await fixture(pool),results=await Promise.all(Array.from({length:5},f.start));
    assert.equal(results.filter(r=>!r.replayed).length,1);
    assert.ok(results.every(r=>r.instanceId===results[0]!.instanceId));
    assert.deepEqual((await pool.query('SELECT turns,revision FROM runs WHERE id=$1',[f.run])).rows[0],{turns:2,revision:1});
    await assert.rejects(executeAction(pool,f.account,env(1),{},c=>beginEncounter(c,'encounter.test',{})),/ENCOUNTER_ALREADY_OPEN/);
    const view=await getInstanceView(pool,f.account,results[0]!.instanceId as string);
    assert.equal(view.kind,'ENCOUNTER');assert.equal(view.seed,undefined);assert.equal(view.checkpoint,undefined);assert.equal(view.state,undefined);
    assert.deepEqual(await unindexedForeignKeys(pool),[]);
  }finally{await db.close();}
});

test('draw keys persist, streams are isolated, checkpoint retries are stable and foreign access fails',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const f=await fixture(pool),id=(await f.start()).instanceId as string;
    const request=env(1),draw=()=>executeAction(pool,f.account,request,{id},async c=>{
      const loot=await drawEncounter(c,id,'loot','reward',1000);
      await drawEncounter(c,id,'cosmetic','description',1000);
      const combat=await drawEncounter(c,id,'combat','round.one',1000);
      return {loot,combat,...await saveEncounterCheckpoint(c,id,0,{round:1}),revision:await advanceRevision(c)};
    });
    const result=await draw();assert.equal((await draw()).replayed,true);
    const seed=(await pool.query('SELECT seed FROM instances WHERE id=$1',[id])).rows[0].seed;
    assert.equal(result.loot,randomInteger(seed,'loot',0n,1000));assert.equal(result.combat,randomInteger(seed,'combat',0n,1000));
    await executeAction(pool,f.account,env(2),{},async c=>{
      assert.equal(await drawEncounter(c,id,'loot','reward',1000),result.loot);
      assert.deepEqual(await encounterCheckpoint(c,id),{definitionId:'encounter.test',definitionRevision:1,revision:1,checkpoint:{round:1}});
      return {revision:await advanceRevision(c)};
    });
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM encounter_draws')).rows[0].n,3);
    await assert.rejects(executeAction(pool,f.account,env(3),{},async c=>({v:await drawEncounter(c,id,'loot','reward',2)})),/DRAW_KEY_REUSED/);
    await assert.rejects(executeAction(pool,f.account,env(3),{},c=>saveEncounterCheckpoint(c,id,0,{})),/STALE_ENCOUNTER_REVISION/);
    const other=await actor(pool,f.release);
    await assert.rejects(executeAction(pool,other.account,env(),{},c=>saveEncounterCheckpoint(c,id,1,{})),/ENCOUNTER_NOT_FOUND/);
    await assert.rejects(getInstanceView(pool,other.account,id),/INSTANCE_NOT_FOUND/);
  }finally{await db.close();}
});

test('failed settlement rolls back draws and rewards; concurrent resolution cannot duplicate loot',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const f=await fixture(pool),id=(await f.start()).instanceId as string;
    const settle=async(c:ActionContext)=>{
      const amount=await drawEncounter(c,id,'loot','final',10)+1;
      return grantItem(c,'reward',{containerId:f.container,definitionId:'item.ore',quantity:String(amount),sourceCode:'ENCOUNTER_FIXTURE'},'ENCOUNTER_REWARD');
    };
    await assert.rejects(executeAction(pool,f.account,env(1),{},c=>finishEncounter(c,id,0,'VICTORY',async c=>{await settle(c);throw new Error('Forced reward failure');})),/Forced reward failure/);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM inventory_items')).rows[0].n,0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM encounter_draws')).rows[0].n,0);
    assert.equal((await pool.query('SELECT outcome FROM encounter_records')).rows[0].outcome,null);
    const request=env(1),finish=()=>executeAction(pool,f.account,request,{id},async c=>({...await finishEncounter(c,id,0,'VICTORY',settle),revision:await advanceRevision(c)}));
    const results=await Promise.all(Array.from({length:5},finish));assert.equal(results.filter(r=>!r.replayed).length,1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM inventory_items')).rows[0].n,1);
    await assert.rejects(executeAction(pool,f.account,env(2),{},c=>finishEncounter(c,id,1,'VICTORY',settle)),/ENCOUNTER_RESOLVED/);
    assert.equal((await pool.query('SELECT lifecycle FROM instances WHERE id=$1',[id])).rows[0].lifecycle,'RESOLVED');
    assert.equal((await integrityReport(pool)).itemQuantityMismatches,0);
  }finally{await db.close();}
});

test('retreat preserves committed Turn cost and permits a new encounter',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const f=await fixture(pool),id=(await f.start()).instanceId as string;
    await executeAction(pool,f.account,env(1),{},async c=>({...await finishEncounter(c,id,0,'RETREAT',async()=>({recovery:'HOME'})),revision:await advanceRevision(c)}));
    assert.equal((await pool.query('SELECT turns FROM runs WHERE id=$1',[f.run])).rows[0].turns,2);
    await executeAction(pool,f.account,env(2),{},async c=>({...await beginEncounter(c,'encounter.test',{}),revision:await advanceRevision(c)}));
    assert.equal((await pool.query('SELECT turns FROM runs WHERE id=$1',[f.run])).rows[0].turns,1);
    await assert.rejects(pool.query('UPDATE encounter_records SET outcome=$1 WHERE instance_id=$2',['VICTORY',id]),/terminal/);
    await assert.rejects(pool.query("UPDATE instances SET lifecycle='ACTIVE',revision=revision+1 WHERE id=$1",[id]),/immutable after resolution/);
    await assert.rejects(pool.query('DELETE FROM encounter_records WHERE instance_id=$1',[id]),/cannot be deleted/);
  }finally{await db.close();}
});

test('SQL rejects skipped counters, rewritten draws and journal/instance lifetime divergence',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const f=await fixture(pool),id=(await f.start()).instanceId as string;
    await assert.rejects(pool.query("INSERT INTO encounter_draws(instance_id,stream,draw_key,counter,bound,value,action_id) SELECT $1,'loot','skip',3,10,1,start_action_id FROM encounter_records WHERE instance_id=$1",[id]),/consecutive/);
    await executeAction(pool,f.account,env(1),{},async c=>({draw:await drawEncounter(c,id,'loot','first',10),revision:await advanceRevision(c)}));
    await assert.rejects(pool.query('UPDATE encounter_draws SET value=2'),/Immutable record/);
    await assert.rejects(pool.query("UPDATE instances SET lifecycle='RESOLVED',revision=revision+1 WHERE id=$1",[id]),/lifetime does not match/);
    await assert.rejects(pool.query("UPDATE state_scopes SET lifecycle='ARCHIVED' WHERE instance_id=$1",[id]),/lifetime does not match/);
  }finally{await db.close();}
});

test('missing definitions, unavailable Turns and unbudgeted free encounters are rejected',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const f=await fixture(pool,0);await assert.rejects(f.start(),/INSUFFICIENT_TURNS/);
    await assert.rejects(executeAction(pool,f.account,env(),{},c=>beginEncounter(c,'encounter.missing',{})),/ENCOUNTER_NOT_IN_RULES_SNAPSHOT/);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM instances')).rows[0].n,0);
    const bad=structuredClone(pkg);bad.entities[0]!.definition.mechanics!.encounter={version:1,turnCost:0};
    assert.throws(()=>validateContent(bad),/INVALID_ENCOUNTER_SPEC/);
  }finally{await db.close();}
});


test('upgrade preserves preexisting generic encounters without inventing outcomes or costs',async()=>{
  const db=await testDatabase(false),pool=db.pool;
  try{
    await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    for(const name of ['001_foundation.sql','002_domain_foundation.sql','003_integrity_hardening.sql','004_inventory_accounting.sql','005_account_sessions.sql']){
      const sql=await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8');await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
    }
    const f=await fixture(pool);await createInstance(pool,f.account,env(),f.release,'ENCOUNTER');
    const before=(await pool.query('SELECT * FROM instances')).rows;
    await migrate(pool);assert.deepEqual((await pool.query('SELECT * FROM instances')).rows,before);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM encounter_records')).rows[0].n,0);
    assert.equal((await pool.query('SELECT turns FROM runs WHERE id=$1',[f.run])).rows[0].turns,3);
    assert.equal((await integrityReport(pool)).encounterMismatches,0);
  }finally{await db.close();}
});

test('restricted runtime can start, draw and settle; it cannot erase or rewrite encounter history',async()=>{
  const db=await testDatabase(),pool=db.pool,role=`probe_${randomUUID().replaceAll('-','')}`;
  let created=false;
  try{
    const f=await fixture(pool);await pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);created=true;
    await pool.query(`GRANT USAGE ON SCHEMA ${db.schema} TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA ${db.schema} TO ${role};
      GRANT INSERT,UPDATE ON instances,instance_participants,state_scopes,encounter_records,inventory_items TO ${role};
      GRANT UPDATE ON runs,inventory_containers TO ${role};
      GRANT INSERT ON action_receipts,turn_ledger,encounter_draws,inventory_quantity_operations TO ${role};
      GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ${db.schema} TO ${role}`);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');await client.query(`SET LOCAL ROLE ${role}`);
      const run=(await client.query('SELECT * FROM runs WHERE id=$1 FOR UPDATE',[f.run])).rows[0],actionId=randomUUID(),requestId=randomUUID();
      await client.query('INSERT INTO action_receipts(account_id,request_id,payload_hash,result,action_id,envelope_version) VALUES($1,$2,$3,$4,$5,2)',[f.account,requestId,'0'.repeat(64),{probe:true},actionId]);
      const c:ActionContext={client,accountId:f.account,actionId,requestId,run};
      const start=await beginEncounter(c,'encounter.test',{});
      await drawEncounter(c,start.instanceId,'loot','probe',10);
      await finishEncounter(c,start.instanceId,0,'VICTORY',c=>grantItem(c,'reward',{containerId:f.container,definitionId:'item.ore',quantity:'1',sourceCode:'FIXTURE'},'PERMISSION_PROBE'));
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      for(const sql of ['DELETE FROM encounter_records','UPDATE encounter_draws SET value=value']){
        await client.query('SAVEPOINT denied');
        await assert.rejects(client.query(sql),(e:{code?:string})=>e.code==='42501');await client.query('ROLLBACK TO denied');
      }
    }finally{await client.query('ROLLBACK');client.release();}
  }finally{if(created){await pool.query(`DROP OWNED BY ${role}`);await pool.query(`DROP ROLE ${role}`);}await db.close();}
});
