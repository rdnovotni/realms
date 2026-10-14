import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { actor,testDatabase } from './helpers.js';
import { publishContent,validateContent } from '../src/domains/content.js';
import { resolveRuleCombat,resolveRuleInteraction } from '../src/domains/shared-rule-actions.js';
import { setFeatureControl } from '../src/rules/controls.js';
import { approveNewRunRelease,nextRunRelease,initialRunRelease } from '../src/rules/releases.js';
import { resolveSharedCheck } from '../src/rules/checks.js';
import { randomInteger } from '../src/foundation/rng.js';
import { fixturePackage,spec } from './shared-rules-fixture.js';
import { assertLifetimeFields } from '../src/domains/lifetime-fields.js';
import { spendTurns } from '../src/actions.js';
import { buildApp } from '../src/app.js';
import type pg from 'pg';
const env=(type:string,revision:number)=>({requestId:randomUUID(),actionType:type,expectedRevision:revision});
async function setup(pool:pg.Pool){
 const release=await publishContent(pool,fixturePackage()),f=await actor(pool,release,10);
 await pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,'encounter.test','DISCOVERED'),($1,'activity.test','DISCOVERED')",[f.account]);
 await pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE run_id=$1",[f.run]);
 await pool.query("INSERT INTO resource_pools(scope_id,resource_key,amount,capacity) SELECT id,'resource.energy',10,10 FROM state_scopes WHERE run_id=$1",[f.run]);
 const world=randomUUID();await pool.query("INSERT INTO worlds(id,name) VALUES($1,'Fixture world')",[world]);await pool.query("INSERT INTO wallets(scope_id,currency_id,purpose) SELECT id,'GOLD',CASE WHEN run_id IS NOT NULL THEN 'PLAYER' ELSE 'FAUCET_SINK' END FROM state_scopes WHERE run_id=$1 OR world_id=$2",[f.run,world]);
 const c=await pool.connect();try{await setFeatureControl(c,'shared.rules','RELEASE','ENABLED','Disposable activation');}finally{c.release();}return {...f,release};
}
test('two domains share checks, prerequisites, effects and sourced rewards without duplicate settlement',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool),request=env('RESOLVE_RULE_INTERACTION',0);const results=await Promise.all(Array.from({length:4},()=>resolveRuleInteraction(db.pool,f.account,request,'activity.test')));assert.equal(results.filter(r=>!r.replayed).length,1);
  const combat=await resolveRuleCombat(db.pool,f.account,env('RESOLVE_RULE_COMBAT',1),'encounter.test');assert.ok(['SUCCESS','EXCEPTIONAL'].includes(combat.degree as string));
  assert.equal((await db.pool.query('SELECT turns FROM runs WHERE id=$1',[f.run])).rows[0].turns,8);
  assert.equal((await db.pool.query('SELECT world_time::text AS t FROM run_progression WHERE run_id=$1',[f.run])).rows[0].t,'10');
  assert.equal((await db.pool.query('SELECT sum(quantity)::text AS n FROM inventory_items')).rows[0].n,'2');
  assert.equal((await db.pool.query("SELECT first_run_id FROM discoveries WHERE account_id=$1 AND entity_id='lore.test'",[f.account])).rows[0].first_run_id,f.run);
  assert.equal((await db.pool.query("SELECT balance::text n FROM wallets w JOIN state_scopes s ON s.id=w.scope_id WHERE s.run_id=$1",[f.run])).rows[0].n,'3');assert.equal((await db.pool.query('SELECT sum(balance)::text n FROM wallets')).rows[0].n,'0');
  const journal=(await db.pool.query('SELECT * FROM shared_rules_events ORDER BY state_revision')).rows;assert.equal(journal.length,2);assert.equal(journal[1]!.evidence.check.modifiers[0]!.amount,2);
  for(const r of journal){const rolls=r.evidence.check.rolls.map((_:number,i:number)=>randomInteger(r.seed,'shared.check',BigInt(i),20)+1);assert.deepEqual(resolveSharedCheck(spec(r.evidence.domain).check,r.evidence.actor,rolls),r.evidence.check);}
  await assert.rejects(resolveRuleInteraction(db.pool,f.account,env('RESOLVE_RULE_INTERACTION',2),'activity.test'),/RULE_RETRY_NOT_READY/);
  await assert.rejects(db.pool.query("UPDATE shared_rules_state SET state='{}'"),/immutable action evidence/);await assertLifetimeFields(db.pool);
 }finally{await db.close();}
});
test('late cost failure rolls back combat, rewards, clocks and receipt',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool);await db.pool.query('UPDATE resource_pools SET amount=0');await assert.rejects(resolveRuleCombat(db.pool,f.account,env('RESOLVE_RULE_COMBAT',0),'encounter.test'),/INSUFFICIENT_RESOURCE/);
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM instances')).rows[0].n,0);assert.equal((await db.pool.query('SELECT count(*)::int n FROM action_receipts')).rows[0].n,0);assert.equal((await db.pool.query('SELECT turns FROM runs')).rows[0].turns,10);assert.equal((await db.pool.query('SELECT world_time::text t FROM run_progression')).rows[0].t,'0');
 }finally{await db.close();}
});
test('emergency disables stop new work but preserve exact receipt replay and operator audit',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool),request=env('RESOLVE_RULE_INTERACTION',0);await resolveRuleInteraction(db.pool,f.account,request,'activity.test');const c=await db.pool.connect();try{await setFeatureControl(c,'actions.global','SAFETY','DISABLED','Synthetic emergency');}finally{c.release();}
 assert.equal((await resolveRuleInteraction(db.pool,f.account,request,'activity.test')).replayed,true);await assert.rejects(spendTurns(db.pool,f.account,{...env('SPEND_TURNS',1),actionType:'SPEND_TURNS',amount:1}),/FEATURE_DISABLED/);assert.ok((await db.pool.query('SELECT count(*)::int n FROM feature_control_events')).rows[0].n>=4);
 }finally{await db.close();}
});
test('new-run releases require review and retained revision compatibility; existing runs stay pinned',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool),expanded=fixturePackage();expanded.version='expanded';expanded.entities.push({id:'lore.new',kind:'LORE',revision:1,schemaVersion:1,definition:{name:'new fixture',dependencies:[],public:{}}});const next=await publishContent(db.pool,expanded),c=await db.pool.connect();try{
 await assert.rejects(nextRunRelease(c,f.release,next),/RELEASE_NOT_ELIGIBLE/);await approveNewRunRelease(c,next,'RETAIN_IDENTICAL','Fixture review');assert.equal(await nextRunRelease(c,f.release,next),next);
 const broken=structuredClone(expanded);broken.version='changed';broken.entities[0]!.revision=2;broken.entities[0]!.definition.name='Changed item';const changed=await publishContent(db.pool,broken);await approveNewRunRelease(c,changed,'RETAIN_IDENTICAL','Negative fixture');await assert.rejects(nextRunRelease(c,f.release,changed),/RETAINED_CONTENT_INCOMPATIBLE/);await approveNewRunRelease(c,next,'PIN_EXISTING','First-life policy fixture');assert.equal(await initialRunRelease(c,next),next);await assert.rejects(nextRunRelease(c,f.release,next),/RELEASE_NOT_ELIGIBLE/);
 }finally{c.release();}await assert.rejects(db.pool.query('UPDATE runs SET content_release_id=$1 WHERE id=$2',[next,f.run]),/remain pinned/);
 }finally{await db.close();}
});
test('HTTP accepts intent only, rejects client rolls, and denies undiscovered actions',async()=>{
 const db=await testDatabase();let server;try{const f=await setup(db.pool);const token='shared-test-token'.repeat(3),headers={authorization:`Bearer ${token}`};server=buildApp(db.pool,{mode:'development',token,accountId:f.account});await server.ready();assert.equal((await server.inject({method:'POST',url:'/api/v1/rules/interaction',headers,payload:{...env('RESOLVE_RULE_INTERACTION',0),entityId:'activity.test',roll:20,rewards:[]}})).statusCode,400);
 const result=await server.inject({method:'POST',url:'/api/v1/rules/interaction',headers,payload:{...env('RESOLVE_RULE_INTERACTION',0),entityId:'activity.test'}});assert.equal(result.statusCode,200,result.body);assert.equal(result.body.includes('seed'),false);const g=await actor(db.pool,f.release);await assert.rejects(resolveRuleInteraction(db.pool,g.account,env('RESOLVE_RULE_INTERACTION',0),'activity.test'),/RULE_ACTION_NOT_KNOWN/);
 }finally{if(server)await server.close();await db.close();}
});
test('content rejects free repeat rewards and missing prerequisite references',()=>{
 const a=fixturePackage();(a.entities.find(e=>e.id==='activity.test')!.definition.mechanics!.sharedAction as any).prerequisite={op:'FACT',key:'known.lore.missing',test:'EQ',value:true};assert.throws(()=>validateContent(a),/INVALID_PREREQUISITE_REFERENCE/);
 const b=fixturePackage(),s=(b.entities.find(e=>e.id==='activity.test')!.definition.mechanics!.sharedAction as any);s.retry='PAID';s.costs.turns=0;s.costs.resources=[];assert.throws(()=>validateContent(b),/FREE_RULE_RETRY/);
});

test('read-only preview explains eligibility/costs and exposes no hidden rolls or writes',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool);const {ruleActionPreview}=await import('../src/domains/shared-rule-actions.js');const before=await ruleActionPreview(db.pool,f.account,'activity.test');assert.equal(before.eligible,true);assert.equal(before.check?.chance.denominator,20);assert.equal(before.effects[0]!.source,'unidentified.effect');assert.equal((await db.pool.query('SELECT count(*)::int n FROM shared_rules_events')).rows[0].n,0);
 await resolveRuleInteraction(db.pool,f.account,env('RESOLVE_RULE_INTERACTION',0),'activity.test');const after=await ruleActionPreview(db.pool,f.account,'activity.test');assert.equal(after.eligible,false);assert.equal(after.retry,'ALREADY_ATTEMPTED');
 const p=fixturePackage();p.version='hidden-check';p.entities.find(e=>e.id==='activity.test')!.revision=2;(p.entities.find(e=>e.id==='activity.test')!.definition.mechanics!.sharedAction as any).check.visibility='HIDDEN';const release=await publishContent(db.pool,p),g=await actor(db.pool,release);await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,'activity.test','DISCOVERED')",[g.account]);const hidden=await ruleActionPreview(db.pool,g.account,'activity.test');assert.equal(hidden.check,undefined);assert.equal(JSON.stringify(hidden).includes('seed'),false);
 }finally{await db.close();}
});
test('Ascension binds release choice to preview and new runs adopt only the reviewed compatible release',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool);await resolveRuleInteraction(db.pool,f.account,env('RESOLVE_RULE_INTERACTION',0),'activity.test');const expanded=fixturePackage();expanded.version='ascension-expanded';expanded.entities.push({id:'lore.new',kind:'LORE',revision:1,schemaVersion:1,definition:{name:'new fixture',dependencies:[],public:{}}});const next=await publishContent(db.pool,expanded),c=await db.pool.connect();try{await approveNewRunRelease(c,next,'RETAIN_IDENTICAL','Ascension adoption fixture');}finally{c.release();}await db.pool.query("UPDATE runs SET status='AFTERCORE' WHERE id=$1",[f.run]);const {ascensionPreview}=await import('../src/domains/ascension-contract.js'),{confirmAscension}=await import('../src/domains/lifecycle.js');const old=await ascensionPreview(db.pool,f.account);await assert.rejects(confirmAscension(db.pool,f.account,env('ASCEND',1),old.previewToken,next),/ASCENSION_PREVIEW_CHANGED/);const preview=await ascensionPreview(db.pool,f.account,next),request=env('ASCEND',1),result=await confirmAscension(db.pool,f.account,request,preview.previewToken,next);assert.equal((await db.pool.query('SELECT content_release_id FROM runs WHERE id=$1',[result.runId])).rows[0].content_release_id,next);assert.equal((await db.pool.query('SELECT content_release_id FROM runs WHERE id=$1',[f.run])).rows[0].content_release_id,f.release);assert.equal((await confirmAscension(db.pool,f.account,request,preview.previewToken,next)).replayed,true);
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM shared_rules_state WHERE run_id=$1',[result.runId])).rows[0].n,0);
 }finally{await db.close();}
});
test('restricted runtime can use shared services but cannot change flags or adoption policies',async()=>{
 const db=await testDatabase(),role=`probe_${randomUUID().replaceAll('-','')}`;let created=false;try{const f=await setup(db.pool);await db.pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);created=true;
 await db.pool.query(`GRANT USAGE ON SCHEMA ${db.schema} TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA ${db.schema} TO ${role}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ${db.schema} TO ${role}; GRANT UPDATE(security_epoch) ON accounts TO ${role};
 GRANT INSERT,UPDATE ON runs,run_progression,resource_pools,discoveries,inventory_items,inventory_containers,wallets,instances,instance_participants,state_scopes,encounter_records,shared_rules_state TO ${role};
 GRANT INSERT ON shared_rules_events,action_receipts,audit_events,outbox_events,turn_ledger,currency_transfers,inventory_quantity_operations TO ${role}`);
 const client=await db.pool.connect();try{await client.query(`SET ROLE ${role}`);const restricted={connect:async()=>({query:client.query.bind(client),on:client.on.bind(client),removeListener:client.removeListener.bind(client),release:()=>{}})} as unknown as pg.Pool;await resolveRuleInteraction(restricted,f.account,env('RESOLVE_RULE_INTERACTION',0),'activity.test');await resolveRuleCombat(restricted,f.account,env('RESOLVE_RULE_COMBAT',1),'encounter.test');await assert.rejects(client.query("UPDATE feature_controls SET mode='DISABLED'"),(e:{code?:string})=>e.code==='42501');await assert.rejects(client.query('UPDATE release_adoptions SET new_runs=true'),(e:{code?:string})=>e.code==='42501');await assert.rejects(client.query('DELETE FROM shared_rules_events'),(e:{code?:string})=>e.code==='42501');}finally{await client.query('RESET ROLE');client.release();}
 }finally{if(created){await db.pool.query(`DROP OWNED BY ${role}`);await db.pool.query(`DROP ROLE ${role}`);}await db.close();}
});
test('state-changed retries ignore unrelated discoveries and accept actual changed check inputs',async()=>{
 const db=await testDatabase();try{const p=fixturePackage();p.version='state-retry';const a=p.entities.find(e=>e.id==='activity.test')!.definition.mechanics!.sharedAction as any;a.retry='STATE_CHANGED';a.effects=[];a.rewards=[];const boost=structuredClone(p.entities.find(e=>e.id==='activity.test')!);boost.id='activity.boost';(boost.definition.mechanics!.sharedAction as any).retry='NEVER';(boost.definition.mechanics!.sharedAction as any).effects=['effect.focus'];p.entities.push(boost);const release=await publishContent(db.pool,p),f=await actor(db.pool,release,10);await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,'activity.test','DISCOVERED')",[f.account]);await db.pool.query("INSERT INTO resource_pools(scope_id,resource_key,amount,capacity) SELECT id,'resource.energy',10,10 FROM state_scopes WHERE run_id=$1",[f.run]);const c=await db.pool.connect();try{await setFeatureControl(c,'shared.rules','RELEASE','ENABLED','Retry fixture');}finally{c.release();}await resolveRuleInteraction(db.pool,f.account,env('RESOLVE_RULE_INTERACTION',0),'activity.test');await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,'lore.test','LEARNED')",[f.account]);await assert.rejects(resolveRuleInteraction(db.pool,f.account,env('RESOLVE_RULE_INTERACTION',1),'activity.test'),/RULE_RETRY_NOT_READY/);
 await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,'activity.boost','DISCOVERED')",[f.account]);await resolveRuleInteraction(db.pool,f.account,env('RESOLVE_RULE_INTERACTION',1),'activity.boost');assert.equal((await resolveRuleInteraction(db.pool,f.account,env('RESOLVE_RULE_INTERACTION',2),'activity.test')).replayed,false);
 }finally{await db.close();}
});

test('actual legacy Turn spending expires shared buffs without refresh or logout decay',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool);await resolveRuleInteraction(db.pool,f.account,env('RESOLVE_RULE_INTERACTION',0),'activity.test');await spendTurns(db.pool,f.account,{...env('SPEND_TURNS',1),actionType:'SPEND_TURNS',amount:2});await resolveRuleCombat(db.pool,f.account,env('RESOLVE_RULE_COMBAT',2),'encounter.test');const row=(await db.pool.query('SELECT evidence FROM shared_rules_events WHERE entity_id=$1',['encounter.test'])).rows[0];assert.deepEqual(row.evidence.check.modifiers,[]);assert.ok(row.evidence.effectEvents.some((e:{kind:string})=>e.kind==='EXPIRE'));assert.equal(row.evidence.clocksBefore.ADVENTURE_TURNS,3);
 }finally{await db.close();}
});
test('emergency drain blocks new starts while existing owned encounter settlement remains available',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool);const {executeAction,advanceRevision}=await import('../src/foundation/action.js'),{beginEncounter,finishEncounter}=await import('../src/domains/encounters.js');const opened=await executeAction(db.pool,f.account,env('START_COMBAT',0),{},async c=>({...await beginEncounter(c,'encounter.test',{}),revision:await advanceRevision(c)}));const client=await db.pool.connect();try{await setFeatureControl(client,'actions.global','SAFETY','DRAIN','Drain fixture');}finally{client.release();}await assert.rejects(resolveRuleInteraction(db.pool,f.account,env('RESOLVE_RULE_INTERACTION',1),'activity.test'),/FEATURE_DISABLED/);const finished=await executeAction(db.pool,f.account,env('COMBAT_ACTION',1),{},async c=>({...await finishEncounter(c,opened.instanceId as string,0,'RETREAT',async()=>({})),revision:await advanceRevision(c)}));assert.equal(finished.outcome,'RETREAT');
 }finally{await db.close();}
});
