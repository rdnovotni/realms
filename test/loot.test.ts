import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { actor,testDatabase } from './helpers.js';
import { publishContent,validateContent,type ContentPackage } from '../src/domains/content.js';
import { beginAuthoredEncounter,settleAuthoredVictory } from '../src/domains/loot.js';
import { beginEncounter,finishEncounter } from '../src/domains/encounters.js';
import { executeAction,advanceRevision,type ActionContext } from '../src/foundation/action.js';
import { integrityReport,unindexedForeignKeys } from '../src/foundation/integrity.js';
import { getInstanceView } from '../src/domains/instances.js';
const pkg:ContentPackage={version:'loot-fixture',engineVersion:'foundation-1',entities:[
  {id:'item.ore',kind:'ITEM',revision:1,schemaVersion:1,definition:{name:'Ore',dependencies:[],public:{},mechanics:{inventory:{version:1,storageMode:'STACK',category:'MATERIAL'}}}},
  {id:'item.sword',kind:'ITEM',revision:1,schemaVersion:1,definition:{name:'Sword',dependencies:[],public:{},mechanics:{inventory:{version:1,storageMode:'INSTANCE',category:'EQUIPMENT'}}}},
  {id:'loot.test',kind:'LOOT_TABLE',revision:1,schemaVersion:1,definition:{name:'Rewards',dependencies:['item.ore','item.sword'],public:{},mechanics:{loot:{version:1,commitment:'ENCOUNTER_START',groups:[
    {key:'material',chance:{numerator:1,denominator:1},entries:[{itemId:'item.ore',weight:2,min:2,max:5,binding:'RUN_BOUND',quality:'1'}]},
    {key:'gear',chance:{numerator:1,denominator:1},entries:[{itemId:'item.sword',weight:1,min:1,max:1,binding:'ACCOUNT_BOUND',quality:'30.5'}]},
    {key:'never',chance:{numerator:0,denominator:1},entries:[{itemId:'item.ore',weight:1,min:1,max:1,binding:'TRADEABLE',quality:'1'}]}
  ]}}}},
  {id:'encounter.loot',kind:'ENCOUNTER',revision:1,schemaVersion:1,definition:{name:'Encounter',dependencies:['loot.test'],public:{},mechanics:{encounter:{version:2,turnCost:1,lootTableId:'loot.test'}}}}
]};
const env=(revision=0)=>({requestId:randomUUID(),actionType:'LOOT_FIXTURE',expectedRevision:revision});
async function fixture(pool:Awaited<ReturnType<typeof testDatabase>>['pool'],carried=true){
  const release=await publishContent(pool,pkg),user=await actor(pool,release,5);
  if(carried) await pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE run_id=$1",[user.run]);
  const request=env(),start=()=>executeAction(pool,user.account,request,{},async c=>({...await beginAuthoredEncounter(c,'encounter.loot',{}),revision:await advanceRevision(c)}));
  return {...user,release,start};
}

test('authored loot commits at start, replays without reroll and grants the exact plan once',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const f=await fixture(pool),starts=await Promise.all(Array.from({length:4},f.start)),id=starts[0]!.instanceId as string;
    assert.equal(starts.filter(r=>!r.replayed).length,1);
    const plan=(await pool.query('SELECT * FROM encounter_reward_plans')).rows[0];
    assert.equal(plan.rewards.length,2);assert.ok(plan.rewards.every((r:{key:string})=>r.key!=='never'));
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM inventory_items')).rows[0].n,0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM encounter_draws')).rows[0].n,7);
    const publicView=await getInstanceView(pool,f.account,id);assert.equal(publicView.rewards,undefined);
    const request=env(1),settle=()=>executeAction(pool,f.account,request,{id},async c=>({...await settleAuthoredVictory(c,id,0),revision:await advanceRevision(c)}));
    const results=await Promise.all(Array.from({length:5},settle));assert.equal(results.filter(r=>!r.replayed).length,1);
    const issued=(await pool.query(`SELECT line.reward_key,op.quantity::text,item.definition_id,item.binding,item.quality::text FROM encounter_reward_items line
      JOIN inventory_quantity_operations op ON op.id=line.operation_id JOIN inventory_items item ON item.id=op.to_item_id ORDER BY line.reward_key`)).rows;
    assert.equal(issued.length,2);
    for(const reward of plan.rewards){const item=issued.find(i=>i.reward_key===reward.key)!;assert.equal(item.quantity,reward.quantity);assert.equal(item.definition_id,reward.itemId);assert.equal(item.binding,reward.binding);assert.equal(Number(item.quality),Number(reward.quality));}
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM encounter_reward_claims')).rows[0].n,1);
    assert.equal((await integrityReport(pool)).rewardMismatches,0);assert.deepEqual(await unindexedForeignKeys(pool),[]);
    await assert.rejects(executeAction(pool,f.account,env(2),{},c=>settleAuthoredVictory(c,id,1)),/ENCOUNTER_RESOLVED/);
  }finally{await db.close();}
});

test('late failure rolls back every grant and claim while retaining the original committed plan',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const f=await fixture(pool),id=(await f.start()).instanceId as string,before=(await pool.query('SELECT * FROM encounter_reward_plans')).rows;
    await assert.rejects(executeAction(pool,f.account,env(1),{},async c=>{await settleAuthoredVictory(c,id,0);throw new Error('Forced late failure');}),/Forced late failure/);
    assert.deepEqual((await pool.query('SELECT * FROM encounter_reward_plans')).rows,before);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM inventory_items')).rows[0].n,0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM encounter_reward_claims')).rows[0].n,0);
    assert.equal((await pool.query('SELECT outcome FROM encounter_records')).rows[0].outcome,null);
    await executeAction(pool,f.account,env(1),{},async c=>({...await settleAuthoredVictory(c,id,0),revision:await advanceRevision(c)}));
    assert.equal((await integrityReport(pool)).rewardMismatches,0);
  }finally{await db.close();}
});

test('retreat and defeat never claim victory loot; foreign accounts and missing custody are denied',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const f=await fixture(pool,false),id=(await f.start()).instanceId as string,other=await actor(pool,f.release);
    await assert.rejects(executeAction(pool,other.account,env(),{},c=>settleAuthoredVictory(c,id,0)),/ENCOUNTER_NOT_FOUND/);
    await assert.rejects(executeAction(pool,f.account,env(1),{},c=>settleAuthoredVictory(c,id,0)),/REWARD_CONTAINER_MISSING/);
    await executeAction(pool,f.account,env(1),{},async c=>({...await finishEncounter(c,id,0,'RETREAT',async()=>({})),revision:await advanceRevision(c)}));
    const next=await executeAction(pool,f.account,env(2),{},async c=>({...await beginAuthoredEncounter(c,'encounter.loot',{}),revision:await advanceRevision(c)}));
    await executeAction(pool,f.account,env(3),{},async c=>({...await finishEncounter(c,next.instanceId as string,0,'DEFEAT',async()=>({})),revision:await advanceRevision(c)}));
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM encounter_reward_claims')).rows[0].n,0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM inventory_items')).rows[0].n,0);
    assert.equal((await pool.query('SELECT turns FROM runs WHERE id=$1',[f.run])).rows[0].turns,3);
  }finally{await db.close();}
});

test('SQL requires creation-time commitment, exact victory claim and immutable reward history',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const f=await fixture(pool);
    await assert.rejects(executeAction(pool,f.account,env(),{},c=>beginEncounter(c,'encounter.loot',{})),/commitment or claim/);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM instances')).rows[0].n,0);
    const id=(await f.start()).instanceId as string;
    await assert.rejects(executeAction(pool,f.account,env(1),{},c=>finishEncounter(c,id,0,'VICTORY',async()=>({}))),/commitment or claim/);
    await assert.rejects(pool.query("UPDATE encounter_reward_plans SET rewards='[]'"),/Immutable record/);
    await assert.rejects(pool.query('DELETE FROM encounter_reward_plans'),/Immutable record/);
    await executeAction(pool,f.account,env(1),{},async c=>({...await settleAuthoredVictory(c,id,0),revision:await advanceRevision(c)}));
    await assert.rejects(pool.query('DELETE FROM encounter_reward_items'),/Immutable record/);
    await pool.query('ALTER TABLE encounter_reward_items DISABLE TRIGGER immutable_reward_item');
    await pool.query('DELETE FROM encounter_reward_items WHERE reward_key=$1',['material']);
    await pool.query('ALTER TABLE encounter_reward_items ENABLE TRIGGER immutable_reward_item');
    assert.equal((await integrityReport(pool)).rewardMismatches,1);
  }finally{await db.close();}
});

test('publication rejects malformed odds, ranges, wrong references and stacked equipment',()=>{
  validateContent(pkg);
  const edits:((p:ContentPackage)=>void)[]=[
    p=>{p.entities[2]!.definition.mechanics!.loot={version:1,commitment:'CLIENT',groups:[]};},
    p=>{p.entities[3]!.definition.mechanics!.encounter={version:2,turnCost:1,lootTableId:'item.ore'};},
    p=>{p.entities[2]!.definition.dependencies=[];},
    p=>{const loot=p.entities[2]!.definition.mechanics!.loot as {groups:{chance:{numerator:number}}[]};loot.groups[0]!.chance.numerator=2;},
    p=>{const loot=p.entities[2]!.definition.mechanics!.loot as {groups:{entries:{max:number}[]}[]};loot.groups[1]!.entries[0]!.max=2;},
    p=>{const loot=p.entities[2]!.definition.mechanics!.loot as {groups:{entries:{min:number;max:number}[]}[]};loot.groups[0]!.entries[0]!.min=6;}
  ];
  for(const edit of edits){const bad=structuredClone(pkg);edit(bad);assert.throws(()=>validateContent(bad));}
});

test('restricted runtime can commit authored plans and issue their ledger-backed claims',async()=>{
  const db=await testDatabase(),pool=db.pool,role=`probe_${randomUUID().replaceAll('-','')}`;let created=false;
  try{
    const f=await fixture(pool);await pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);created=true;
    await pool.query(`GRANT USAGE ON SCHEMA ${db.schema} TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA ${db.schema} TO ${role};
      GRANT INSERT,UPDATE ON instances,instance_participants,state_scopes,encounter_records,inventory_items TO ${role};
      GRANT UPDATE ON runs,inventory_containers TO ${role};
      GRANT INSERT ON action_receipts,turn_ledger,encounter_draws,inventory_quantity_operations,encounter_reward_plans,encounter_reward_claims,encounter_reward_items TO ${role};
      GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ${db.schema} TO ${role}`);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');await client.query(`SET LOCAL ROLE ${role}`);
      const actionId=randomUUID(),requestId=randomUUID(),run=(await client.query('SELECT * FROM runs WHERE id=$1 FOR UPDATE',[f.run])).rows[0];
      await client.query('INSERT INTO action_receipts(account_id,request_id,payload_hash,result,action_id,envelope_version) VALUES($1,$2,$3,$4,$5,2)',[f.account,requestId,'0'.repeat(64),{probe:true},actionId]);
      const c:ActionContext={client,accountId:f.account,actionId,requestId,run},started=await beginAuthoredEncounter(c,'encounter.loot',{});
      await settleAuthoredVictory(c,started.instanceId,0);await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      for(const sql of ['UPDATE encounter_reward_plans SET rewards=rewards','DELETE FROM encounter_reward_claims','DELETE FROM encounter_reward_items']){
        await client.query('SAVEPOINT denied');await assert.rejects(client.query(sql),(e:{code?:string})=>e.code==='42501');await client.query('ROLLBACK TO denied');
      }
    }finally{await client.query('ROLLBACK');client.release();}
  }finally{if(created){await pool.query(`DROP OWNED BY ${role}`);await pool.query(`DROP ROLE ${role}`);}await db.close();}
});

test('empty loot plans still settle victory exactly once without requiring an item container',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const empty=structuredClone(pkg);empty.version='empty-loot-fixture';
    const loot=empty.entities[2]!.definition.mechanics!.loot as {groups:{chance:{numerator:number}}[]};
    for(const group of loot.groups) group.chance.numerator=0;
    const release=await publishContent(pool,empty),f=await actor(pool,release,2);
    const start=await executeAction(pool,f.account,env(),{},async c=>({...await beginAuthoredEncounter(c,'encounter.loot',{}),revision:await advanceRevision(c)}));
    assert.deepEqual((await pool.query('SELECT rewards FROM encounter_reward_plans')).rows[0].rewards,[]);
    const request=env(1),settle=()=>executeAction(pool,f.account,request,{},async c=>({...await settleAuthoredVictory(c,start.instanceId as string,0),revision:await advanceRevision(c)}));
    await settle();assert.equal((await settle()).replayed,true);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM encounter_reward_claims')).rows[0].n,1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM inventory_items')).rows[0].n,0);
    assert.equal((await integrityReport(pool)).rewardMismatches,0);
  }finally{await db.close();}
});

test('publishing newer loot cannot change an existing encounter plan or its pinned item grants',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const f=await fixture(pool),id=(await f.start()).instanceId as string,before=(await pool.query('SELECT * FROM encounter_reward_plans')).rows;
    const next=structuredClone(pkg);next.version='loot-fixture-2';next.entities[2]!.revision=2;
    const loot=next.entities[2]!.definition.mechanics!.loot as {groups:{entries:{min:number;max:number}[]}[]};
    loot.groups[0]!.entries[0]!.min=90;loot.groups[0]!.entries[0]!.max=90;
    const newRelease=await publishContent(pool,next);assert.notEqual(newRelease,f.release);
    await executeAction(pool,f.account,env(1),{},async c=>({...await settleAuthoredVictory(c,id,0),revision:await advanceRevision(c)}));
    assert.deepEqual((await pool.query('SELECT * FROM encounter_reward_plans')).rows,before);
    const quantity=(await pool.query("SELECT op.quantity::int AS quantity,item.release_id FROM encounter_reward_items line JOIN inventory_quantity_operations op ON op.id=line.operation_id JOIN inventory_items item ON item.id=op.to_item_id WHERE line.reward_key='material'")).rows[0];
    assert.ok(quantity.quantity>=2 && quantity.quantity<=5);assert.equal(quantity.release_id,f.release);
    assert.equal((await integrityReport(pool)).rewardMismatches,0);
  }finally{await db.close();}
});
