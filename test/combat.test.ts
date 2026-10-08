import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import type pg from 'pg';
import { actor,testDatabase } from './helpers.js';
import { publishContent,validateContent,type ContentPackage } from '../src/domains/content.js';
import { startCombat,takeCombatAction,combatView } from '../src/domains/combat.js';
import { beginAuthoredEncounter,settleAuthoredVictory } from '../src/domains/loot.js';
import { grantItem } from '../src/domains/item-accounting.js';
import { executeAction,advanceRevision } from '../src/foundation/action.js';
import { ascend } from '../src/domains/lifecycle.js';
import { integrityReport,unindexedForeignKeys } from '../src/foundation/integrity.js';
import { buildApp } from '../src/app.js';
const hit={numerator:1,denominator:1};
const fighter=(health=20,damage=10)=>({version:1,maxHealth:health,attack:{min:damage,max:damage,hit},armor:0,resistanceBps:0});
const encounter=(campaign=false)=>({version:1,ruleset:'BASIC_DUEL_V1',access:'DISCOVERED_REPEATABLE',profileId:'profile.test',monsterId:'monster.test',roundLimit:20,retreat:hit,failure:{kind:'RETURN_HOME',turnCost:2},gold:{worldName:'development',amount:10},...(campaign?{campaignId:'campaign.test'}:{})});
const pkg:ContentPackage={version:'combat-fixture',engineVersion:'foundation-1',entities:[
 {id:'profile.test',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'Test profile',dependencies:[],public:{},mechanics:{combatProfile:{...fighter(),recoveryHealth:5}}}},
 {id:'monster.test',kind:'MONSTER',revision:1,schemaVersion:1,definition:{name:'Test monster',dependencies:[],public:{},mechanics:{combatMonster:fighter(5,1)}}},
 {id:'item.ore',kind:'ITEM',revision:1,schemaVersion:1,definition:{name:'Ore',dependencies:[],public:{},mechanics:{inventory:{version:1,storageMode:'STACK',category:'MATERIAL'}}}},
 {id:'loot.test',kind:'LOOT_TABLE',revision:1,schemaVersion:1,definition:{name:'Loot',dependencies:['item.ore'],public:{},mechanics:{loot:{version:1,commitment:'ENCOUNTER_START',groups:[{key:'ore',chance:hit,entries:[{itemId:'item.ore',weight:1,min:2,max:2,binding:'TRADEABLE',quality:'1'}]}]}}}},
 {id:'encounter.first',kind:'ENCOUNTER',revision:1,schemaVersion:1,definition:{name:'First',dependencies:['profile.test','monster.test','loot.test'],public:{},mechanics:{encounter:{version:2,turnCost:1,lootTableId:'loot.test'},combat:encounter()}}},
 {id:'campaign.test',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'Campaign',dependencies:['encounter.first'],public:{},mechanics:{campaign:{version:1,finalEncounterId:'encounter.final',requiresEncounterIds:['encounter.first']}}}},
 {id:'encounter.final',kind:'ENCOUNTER',revision:1,schemaVersion:1,definition:{name:'Final',dependencies:['profile.test','monster.test','loot.test','campaign.test'],public:{},mechanics:{encounter:{version:2,turnCost:1,lootTableId:'loot.test'},combat:encounter(true)}}}
]};
const env=(revision=0,type='COMBAT_ACTION')=>({requestId:randomUUID(),actionType:type,expectedRevision:revision});
async function fixture(pool:pg.Pool,custom:ContentPackage=pkg,turns=10){
 const release=await publishContent(pool,custom),f=await actor(pool,release,turns);
 await pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE run_id=$1",[f.run]);
 await pool.query("INSERT INTO worlds(name) VALUES('development') ON CONFLICT DO NOTHING");
 await pool.query("INSERT INTO wallets(scope_id,currency_id,purpose) SELECT s.id,'GOLD','FAUCET_SINK' FROM state_scopes s JOIN worlds w ON w.id=s.world_id WHERE w.name='development' ON CONFLICT DO NOTHING");
 for(const id of ['encounter.first','encounter.final'])await pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,$2,'DISCOVERED')",[f.account,id]);
 return {...f,release};
}

test('server-resolved campaign wins settle items and Gold once, enter Aftercore and ascend without losing wealth',async()=>{
 const db=await testDatabase(),pool=db.pool;
 try{
  const f=await fixture(pool);await assert.rejects(startCombat(pool,f.account,env(0,'START_COMBAT'),'encounter.final'),/CAMPAIGN_PREREQUISITES_MISSING/);
  const request=env(0,'START_COMBAT'),starts=await Promise.all(Array.from({length:4},()=>startCombat(pool,f.account,request,'encounter.first'))),id=starts[0]!.instanceId as string;
  assert.equal(starts.filter(r=>!r.replayed).length,1);
  const winRequest=env(1),wins=await Promise.all(Array.from({length:4},()=>takeCombatAction(pool,f.account,winRequest,id,0,'ATTACK')));
  assert.equal(wins.filter(r=>!r.replayed).length,1);assert.equal(wins[0]!.outcome,'VICTORY');
  assert.equal((await pool.query('SELECT status FROM runs WHERE id=$1',[f.run])).rows[0].status,'ACTIVE');
  await assert.rejects(ascend(pool,f.account,env(2,'ASCEND')),/ASCENSION_NOT_READY/);
  const final=await startCombat(pool,f.account,env(2,'START_COMBAT'),'encounter.final');await takeCombatAction(pool,f.account,env(3),final.instanceId as string,0,'ATTACK');
  assert.equal((await pool.query('SELECT status FROM runs WHERE id=$1',[f.run])).rows[0].status,'AFTERCORE');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM run_completions')).rows[0].n,1);
  assert.equal((await pool.query("SELECT balance::text FROM wallets w JOIN state_scopes s ON s.id=w.scope_id WHERE s.run_id=$1 AND w.currency_id='GOLD'",[f.run])).rows[0].balance,'20');
  const ascendRequest=env(4,'ASCEND'),next=await ascend(pool,f.account,ascendRequest);assert.equal((await ascend(pool,f.account,ascendRequest)).replayed,true);
  assert.equal((await pool.query("SELECT balance::text FROM wallets w JOIN state_scopes s ON s.id=w.scope_id WHERE s.account_id=$1 AND w.currency_id='GOLD'",[f.account])).rows[0].balance,'20');
  assert.equal((await pool.query("SELECT sum(i.quantity)::text AS quantity FROM inventory_items i JOIN inventory_containers c ON c.id=i.container_id WHERE c.kind='MATERIAL_VAULT'")).rows[0].quantity,'4');
  assert.equal((await pool.query('SELECT turns,completion_policy,status FROM runs WHERE id=$1',[next.runId])).rows[0].completion_policy,'CAMPAIGN');
  await assert.rejects(pool.query("UPDATE runs SET status='AFTERCORE' WHERE id=$1",[next.runId]),/completion evidence/);
  assert.ok(Object.values(await integrityReport(pool)).every(n=>n===0));assert.deepEqual(await unindexedForeignKeys(pool),[]);
 }finally{await db.close();}
});

test('rounds and health survive reconnects; stale/concurrent commands and foreign accounts cannot change combat',async()=>{
 const db=await testDatabase(),pool=db.pool;
 try{
  const custom=structuredClone(pkg);custom.entities[1]!.definition.mechanics!.combatMonster=fighter(25,4);
  const f=await fixture(pool,custom),start=await startCombat(pool,f.account,env(0,'START_COMBAT'),'encounter.first'),id=start.instanceId as string;
  const round=await takeCombatAction(pool,f.account,env(1),id,0,'ATTACK');assert.equal(round.playerHealth,16);assert.equal(round.enemyHealth,15);
  const view=await combatView(pool,f.account,id);assert.equal(view.round,1);assert.equal(view.playerHealth,16);assert.equal(view.seed,undefined);assert.equal(view.rewards,undefined);
  await assert.rejects(takeCombatAction(pool,f.account,env(2),id,0,'ATTACK'),/STALE_COMBAT_ROUND/);
  const other=await actor(pool,f.release);await assert.rejects(takeCombatAction(pool,other.account,env(),id,1,'ATTACK'),/COMBAT_NOT_FOUND/);await assert.rejects(combatView(pool,other.account,id),/COMBAT_NOT_FOUND/);
  const attempts=await Promise.allSettled([takeCombatAction(pool,f.account,env(2),id,1,'GUARD'),takeCombatAction(pool,f.account,env(2),id,1,'ATTACK')]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  const state=(await pool.query('SELECT * FROM combat_states WHERE instance_id=$1',[id])).rows[0];assert.equal(state.round,2);
  await takeCombatAction(pool,f.account,env(3),id,2,'RETREAT');
  const again=await startCombat(pool,f.account,env(4,'START_COMBAT'),'encounter.first');assert.ok((again.playerHealth as number)<20);
 }finally{await db.close();}
});

test('solo defeat returns functional health at Home with capped Turn loss and no loot, XP loss or gear deletion',async()=>{
 const db=await testDatabase(),pool=db.pool;
 try{
  const custom=structuredClone(pkg);custom.entities[1]!.definition.mechanics!.combatMonster=fighter(50,100);
  custom.entities.push({id:'item.test_gear',kind:'ITEM',revision:1,schemaVersion:1,definition:{name:'Existing gear',dependencies:[],public:{},mechanics:{inventory:{version:1,storageMode:'INSTANCE',category:'EQUIPMENT'}}}});
  const f=await fixture(pool,custom,2);await pool.query('UPDATE run_progression SET xp=37 WHERE run_id=$1',[f.run]);
  const container=(await pool.query("SELECT c.id FROM inventory_containers c JOIN state_scopes s ON s.id=c.scope_id WHERE s.run_id=$1",[f.run])).rows[0].id;
  const gear=await executeAction(pool,f.account,env(0,'FIXTURE_GEAR'),{},async c=>({...await grantItem(c,'gear',{containerId:container,definitionId:'item.test_gear',quantity:'1',quality:'10',sourceCode:'FIXTURE'},'FIXTURE'),revision:await advanceRevision(c)}));
  const start=await startCombat(pool,f.account,env(1,'START_COMBAT'),'encounter.first');
  const defeat=await takeCombatAction(pool,f.account,env(2),start.instanceId as string,0,'ATTACK');assert.equal(defeat.outcome,'DEFEAT');assert.equal(defeat.location,'HOME');assert.equal(defeat.health,5);assert.equal(defeat.recoveryTurnCost,1);
  assert.deepEqual((await pool.query('SELECT turns FROM runs WHERE id=$1',[f.run])).rows[0],{turns:0});
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inventory_items')).rows[0].n,1);assert.equal((await pool.query('SELECT quantity::text FROM inventory_items WHERE id=$1',[gear.itemId])).rows[0].quantity,'1');assert.equal((await pool.query('SELECT count(*)::int AS n FROM combat_gold_claims')).rows[0].n,0);
  assert.equal((await combatView(pool,f.account,start.instanceId as string)).recoveryHealth,5);
  assert.equal((await pool.query('SELECT xp::text FROM run_progression WHERE run_id=$1',[f.run])).rows[0].xp,'37');
  assert.ok(Object.values(await integrityReport(pool)).every(n=>n===0));
 }finally{await db.close();}
});

test('retreat preserves start cost, and authored round limits fail forward with Home recovery',async()=>{
 const db=await testDatabase(),pool=db.pool;
 try{
  const custom=structuredClone(pkg);const combat=custom.entities[4]!.definition.mechanics!.combat as {roundLimit:number};combat.roundLimit=2;
  const f=await fixture(pool,custom),start=await startCombat(pool,f.account,env(0,'START_COMBAT'),'encounter.first');
  const retreat=await takeCombatAction(pool,f.account,env(1),start.instanceId as string,0,'RETREAT');assert.equal(retreat.outcome,'RETREAT');assert.equal(retreat.recoveryTurnCost,0);
  assert.equal((await pool.query('SELECT turns FROM runs WHERE id=$1',[f.run])).rows[0].turns,9);
  const second=await startCombat(pool,f.account,env(2,'START_COMBAT'),'encounter.first');await takeCombatAction(pool,f.account,env(3),second.instanceId as string,0,'GUARD');
  const timeout=await takeCombatAction(pool,f.account,env(4),second.instanceId as string,1,'GUARD');assert.equal(timeout.outcome,'FAILED_FORWARD');assert.equal(timeout.health,5);assert.equal(timeout.location,'HOME');
  assert.ok(Object.values(await integrityReport(pool)).every(n=>n===0));
 }finally{await db.close();}
});

test('failed Gold settlement rolls back the round, draws, item grants, outcome and receipt',async()=>{
 const db=await testDatabase(),pool=db.pool;
 try{
  const f=await fixture(pool),start=await startCombat(pool,f.account,env(0,'START_COMBAT'),'encounter.first'),id=start.instanceId as string;
  const before=(await pool.query("SELECT count(*)::int AS n FROM encounter_draws WHERE stream='combat'")).rows[0].n;
  await pool.query("UPDATE state_scopes SET lifecycle='ARCHIVED' WHERE world_id IS NOT NULL");
  await assert.rejects(takeCombatAction(pool,f.account,env(1),id,0,'ATTACK'),/INVALID_TRANSFER_WALLET/);
  assert.equal((await pool.query('SELECT round FROM combat_states WHERE instance_id=$1',[id])).rows[0].round,0);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inventory_items')).rows[0].n,0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM encounter_draws WHERE stream='combat'")).rows[0].n,before);
  assert.equal((await pool.query('SELECT outcome FROM encounter_records WHERE instance_id=$1',[id])).rows[0].outcome,null);
 }finally{await db.close();}
});

test('database rejects bypassed combat, forged wins, health edits, policy rollback and rewritten history',async()=>{
 const db=await testDatabase(),pool=db.pool;
 try{
  const f=await fixture(pool);
  await assert.rejects(executeAction(pool,f.account,env(),{},c=>beginAuthoredEncounter(c,'encounter.first',{})),/Combat state/);
  const start=await startCombat(pool,f.account,env(0,'START_COMBAT'),'encounter.first'),id=start.instanceId as string;
  await assert.rejects(executeAction(pool,f.account,env(1),{},c=>settleAuthoredVictory(c,id,0)),/Combat state/);
  await assert.rejects(pool.query('UPDATE combat_run_state SET health=1 WHERE run_id=$1',[f.run]),/health or location/);
  await assert.rejects(pool.query("UPDATE runs SET completion_policy='LEGACY' WHERE id=$1",[f.run]),/cannot be bypassed/);
  await takeCombatAction(pool,f.account,env(1),id,0,'ATTACK');
  await assert.rejects(pool.query('DELETE FROM combat_steps'),/Immutable record/);await assert.rejects(pool.query('UPDATE combat_states SET enemy_health=5 WHERE instance_id=$1',[id]),/terminal/);
 }finally{await db.close();}
});

test('combat HTTP accepts intents only, resumes safely and derives account identity from authentication',async()=>{
 const db=await testDatabase(),pool=db.pool;
 try{
  const f=await fixture(pool),token='combat-test-token-long-enough',app=buildApp(pool,{mode:'development',token,accountId:f.account}),headers={authorization:`Bearer ${token}`};
  const bad=await app.inject({method:'POST',url:'/api/v1/combat/start',headers,payload:{...env(0,'START_COMBAT'),definitionId:'encounter.first',outcome:'VICTORY'}});assert.equal(bad.statusCode,400);
  const start=await app.inject({method:'POST',url:'/api/v1/combat/start',headers,payload:{...env(0,'START_COMBAT'),definitionId:'encounter.first'}});assert.equal(start.statusCode,200);
  const id=start.json().instanceId;
  assert.equal((await app.inject({method:'GET',url:`/api/v1/combat/${id}`})).statusCode,401);
  const view=await app.inject({method:'GET',url:`/api/v1/combat/${id}`,headers});assert.equal(view.statusCode,200);assert.equal(view.json().seed,undefined);assert.equal(view.json().rewards,undefined);
  const action=await app.inject({method:'POST',url:'/api/v1/combat/actions',headers,payload:{...env(1),instanceId:id,expectedRound:0,intent:'ATTACK'}});assert.equal(action.statusCode,200);assert.equal(action.json().outcome,'VICTORY');
  assert.equal((await app.inject({method:'POST',url:'/api/v1/ascend',headers,payload:env(2,'ASCEND')})).statusCode,409);
  await app.close();
 }finally{await db.close();}
});

test('combat publication rejects invalid profiles, failure budgets, references and campaign cycles',()=>{
 validateContent(pkg);
 const changes:((p:ContentPackage)=>void)[]=[
  p=>{p.entities[0]!.definition.mechanics!.combatProfile={...fighter(),recoveryHealth:30};},
  p=>{const c=p.entities[4]!.definition.mechanics!.combat as {profileId:string};c.profileId='item.ore';},
  p=>{const c=p.entities[4]!.definition.mechanics!.combat as {failure:{turnCost:number}};c.failure.turnCost=10;},
  p=>{const c=p.entities[5]!.definition.mechanics!.campaign as {requiresEncounterIds:string[]};c.requiresEncounterIds=['encounter.final'];},
  p=>{p.entities[5]!.definition.dependencies=[];}
 ];for(const change of changes){const bad=structuredClone(pkg);change(bad);assert.throws(()=>validateContent(bad));}
});

test('restricted runtime completes combat, currency, campaign and Ascension while history stays append-only',async()=>{
 const db=await testDatabase(),pool=db.pool,role=`probe_${randomUUID().replaceAll('-','')}`;let created=false;
 try{
  const f=await fixture(pool);await pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);created=true;
  await pool.query(`GRANT USAGE ON SCHEMA ${db.schema} TO ${role};GRANT SELECT ON ALL TABLES IN SCHEMA ${db.schema} TO ${role};
    GRANT UPDATE(security_epoch) ON accounts TO ${role};
    GRANT INSERT,UPDATE ON runs,state_scopes,run_progression,run_consumption,inventory_containers,inventory_items,wallets,instances,instance_participants,encounter_records,combat_run_state,combat_states TO ${role};
    GRANT INSERT ON action_receipts,turn_ledger,currency_transfers,inventory_movements,inventory_quantity_operations,run_history,audit_events,outbox_events,encounter_draws,encounter_reward_plans,encounter_reward_claims,encounter_reward_items,combat_steps,combat_recoveries,combat_gold_plans,combat_gold_claims,run_completions TO ${role};
    GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ${db.schema} TO ${role}`);
  const client=await pool.connect();
  try{
   await client.query(`SET ROLE ${role}`);const asRole={connect:async()=>({query:client.query.bind(client),release:()=>{}})} as unknown as pg.Pool;
   const first=await startCombat(asRole,f.account,env(0,'START_COMBAT'),'encounter.first');await takeCombatAction(asRole,f.account,env(1),first.instanceId as string,0,'ATTACK');
   const final=await startCombat(asRole,f.account,env(2,'START_COMBAT'),'encounter.final');await takeCombatAction(asRole,f.account,env(3),final.instanceId as string,0,'ATTACK');await ascend(asRole,f.account,env(4,'ASCEND'));
   for(const sql of ['DELETE FROM combat_steps','UPDATE combat_gold_plans SET amount=amount','DELETE FROM run_completions'])await assert.rejects(client.query(sql),(e:{code?:string})=>e.code==='42501');
  }finally{await client.query('RESET ROLE');client.release();}
  assert.ok(Object.values(await integrityReport(pool)).every(n=>n===0));
 }finally{if(created){await pool.query(`DROP OWNED BY ${role}`);await pool.query(`DROP ROLE ${role}`);}await db.close();}
});


test('read-only device sessions cannot start combat, submit actions or ascend',async()=>{
 const db=await testDatabase(),pool=db.pool;
 try{
  const f=await fixture(pool),token='rs1_'+randomBytes(32).toString('base64url');
  await pool.query(`INSERT INTO auth_sessions(account_id,token_digest,security_epoch,scopes,device_label,expires_at)
    SELECT id,$2,security_epoch,ARRAY['GAME_READ'],'Read only',now()+interval '1 hour' FROM accounts WHERE id=$1`,[f.account,createHash('sha256').update(token).digest('hex')]);
  const app=buildApp(pool,{mode:'sessions',throttleKey:'combat-session-throttle-key-long-enough'}),headers={authorization:`Bearer ${token}`};
  assert.equal((await app.inject({method:'POST',url:'/api/v1/combat/start',headers,payload:{...env(0,'START_COMBAT'),definitionId:'encounter.first'}})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/combat/actions',headers,payload:{...env(),instanceId:randomUUID(),expectedRound:0,intent:'ATTACK'}})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/ascend',headers,payload:env(0,'ASCEND')})).statusCode,403);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM combat_states')).rows[0].n,0);await app.close();
 }finally{await db.close();}
});
