import { seedLegacyConsumption } from './helpers.js';
import { turnsPackage } from './turn-planner-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { actor,testDatabase } from './helpers.js';
import { publishContent,validateContent,type ContentPackage } from '../src/domains/content.js';
import { turnPlanner,setTurnReserve } from '../src/domains/turn-planner.js';
import { useDailyAllowance,setDailyAutoCollect } from '../src/domains/daily-allowances.js';
import { applyRollover,ascend,catchUpRollover } from '../src/domains/lifecycle.js';
import { resolveRuleInteraction,ruleActionPreview } from '../src/domains/shared-rule-actions.js';
import { createTurnPlan,stepTurnPlan } from '../src/domains/turn-automation.js';
import { setFeatureControl } from '../src/rules/controls.js';
import { configureSchedule } from '../src/scheduler.js';
import { spec } from './shared-rules-fixture.js';
import { spendTurns } from '../src/actions.js';
import { assertLifetimeFields } from '../src/domains/lifetime-fields.js';
import { buildApp } from '../src/app.js';
const env=(type:string,revision:number)=>({requestId:randomUUID(),actionType:type,expectedRevision:revision});

async function setup(pool:any,turns=280){const release=await publishContent(pool,turnsPackage()),f=await actor(pool,release,turns);await pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) SELECT $1,id,'DISCOVERED' FROM content_entities",[f.account]);const c=await pool.connect();try{await setFeatureControl(c,'shared.rules','RELEASE','ENABLED','Disposable turns fixture');}finally{c.release();}return {...f,release};}
async function due(pool:any,n=1){await pool.query("UPDATE accounts SET created_at=now()-interval '10 days'; UPDATE discoveries SET discovered_at=now()-interval '10 days'");for(let i=1;i<=n;i++)await pool.query("INSERT INTO rollover_epochs(epoch,effective_at,baseline_turns,turn_soft_cap) VALUES($1,now()-($2::text||' days')::interval,100,400)",[i,n-i+1]);}
async function revision(pool:any,run:string){return (await pool.query('SELECT revision FROM runs WHERE id=$1',[run])).rows[0].revision;}
test('planner is discovery safe, read only, explicit about absent policy and protects historical lifetimes',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool),unknown=await actor(db.pool,f.release);const before=(await db.pool.query('SELECT count(*) FROM action_receipts')).rows[0].count;
 const view=await turnPlanner(db.pool,f.account,0);assert.equal(view.turns,280);assert.equal(view.rollover.configured,false);assert.equal(view.rollover.nextAt,null);assert.equal(view.daily.length,3);assert.equal(view.activities.length,2);assert.equal((await turnPlanner(db.pool,unknown.account)).daily.length,0);assert.equal((await db.pool.query('SELECT count(*) FROM action_receipts')).rows[0].count,before);await assertLifetimeFields(db.pool);await assert.rejects(turnPlanner(db.pool,f.account,1),/STALE_REVISION/);
 }finally{await db.close();}
});
test('100/400 baseline, bonus over cap, chronological catch-up, banking and zero grant resets are durable',async()=>{
 const db=await testDatabase();try{const a=await setup(db.pool,280),b=await actor(db.pool,a.release,365),c=await actor(db.pool,a.release,427);await due(db.pool);for(const owner of [a,b,c])await seedLegacyConsumption(db.pool,owner.run,{fullness:9});await Promise.all([applyRollover(db.pool,a.account),applyRollover(db.pool,a.account),applyRollover(db.pool,b.account),applyRollover(db.pool,c.account)]);
 for(const [f,expected]of [[a,380],[b,400],[c,427]] as const)assert.equal((await turnPlanner(db.pool,f.account)).turns,expected);
 assert.equal((await turnPlanner(db.pool,c.account)).consumption.fullness,0);assert.equal((await db.pool.query('SELECT count(*) FROM run_rollovers')).rows[0].count,'3');assert.equal((await turnPlanner(db.pool,a.account)).daily.find(d=>d.entityId==='activity.garden')!.charges,1);
 await db.pool.query("INSERT INTO rollover_epochs VALUES(2,now()-interval '12 hours',100,400),(3,now()-interval '6 hours',100,400)");await applyRollover(db.pool,a.account);const view=await turnPlanner(db.pool,a.account);assert.equal(view.turns,400);assert.equal(view.daily.find(d=>d.entityId==='activity.garden')!.charges,3);assert.equal(view.daily.find(d=>d.entityId==='activity.strict')!.charges,1);
 }finally{await db.close();}
});
test('daily use is atomic, finite, receipted and manual discovery is required for autocollection',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool,399);await assert.rejects(setDailyAutoCollect(db.pool,f.account,env('SET_DAILY_AUTO_COLLECT',0),'activity.garden',true),/DAILY_MANUAL_USE_REQUIRED/);
 const request=env('USE_DAILY_ALLOWANCE',0);const results=await Promise.all([useDailyAllowance(db.pool,f.account,request,'activity.garden'),useDailyAllowance(db.pool,f.account,request,'activity.garden')]);assert.equal(results.filter(r=>r.replayed).length,1);assert.equal((await turnPlanner(db.pool,f.account)).turns,404);assert.equal((await turnPlanner(db.pool,f.account)).daily[0]!.charges,0);
 await assert.rejects(useDailyAllowance(db.pool,f.account,env('USE_DAILY_ALLOWANCE',1),'activity.garden'),/DAILY_CHARGES_EMPTY/);await setDailyAutoCollect(db.pool,f.account,env('SET_DAILY_AUTO_COLLECT',1),'activity.garden',true);await due(db.pool);await applyRollover(db.pool,f.account);const v=await turnPlanner(db.pool,f.account);assert.equal(v.turns,409);assert.equal(v.daily[0]!.charges,0);assert.equal(v.daily[0]!.autoCollectEnabled,true);assert.equal(v.history.filter(r=>r.reason.startsWith('DAILY_AUTO:')).length,1);
 await assert.rejects(db.pool.query('UPDATE daily_allowance_events SET turn_bonus=0'),/immutable/i);
 }finally{await db.close();}
});
test('shared daily checks consume the same bounded account allowance and preview exhausted charges',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool);await resolveRuleInteraction(db.pool,f.account,env('RESOLVE_RULE_INTERACTION',0),'activity.prayer');assert.equal((await ruleActionPreview(db.pool,f.account,'activity.prayer')).eligible,false);await assert.rejects(resolveRuleInteraction(db.pool,f.account,env('RESOLVE_RULE_INTERACTION',1),'activity.prayer'),/DAILY_CHARGES_EMPTY/);assert.equal((await turnPlanner(db.pool,f.account)).turns,280);
 }finally{await db.close();}
});
test('Ascension carries Turns, reserve, consumption and used account allowances without refreshing',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool);await useDailyAllowance(db.pool,f.account,env('USE_DAILY_ALLOWANCE',0),'activity.garden');await setTurnReserve(db.pool,f.account,env('SET_TURN_RESERVE',1),200);await db.pool.query("UPDATE runs SET status='AFTERCORE' WHERE id=$1",[f.run]);await seedLegacyConsumption(db.pool,f.run,{fullness:7});const next=await ascend(db.pool,f.account,env('ASCEND',2));const v=await turnPlanner(db.pool,f.account);assert.equal(v.runId,next.runId);assert.equal(v.turns,285);assert.equal(v.reserve,200);assert.equal(v.consumption.fullness,7);assert.equal(v.daily[0]!.charges,0);await assert.rejects(useDailyAllowance(db.pool,f.account,env('USE_DAILY_ALLOWANCE',0),'activity.garden'),/DAILY_CHARGES_EMPTY/);
 }finally{await db.close();}
});
test('server reserve enforcement rolls back all effects, binds confirmation to request and blocks API/automation bypass',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool,10);await setTurnReserve(db.pool,f.account,env('SET_TURN_RESERVE',0),9);await assert.rejects(resolveRuleInteraction(db.pool,f.account,env('RESOLVE_RULE_INTERACTION',1),'activity.work'),/TURN_RESERVE_CONFIRMATION_REQUIRED/);assert.equal((await turnPlanner(db.pool,f.account)).turns,10);assert.equal((await db.pool.query('SELECT count(*) FROM shared_rules_events')).rows[0].count,'0');
 const request={...env('RESOLVE_RULE_INTERACTION',1),confirmReserve:true};await resolveRuleInteraction(db.pool,f.account,request,'activity.work');assert.equal((await turnPlanner(db.pool,f.account)).turns,8);assert.equal((await resolveRuleInteraction(db.pool,f.account,request,'activity.work')).replayed,true);await assert.rejects(resolveRuleInteraction(db.pool,f.account,{...request,confirmReserve:false},'activity.work'),/REQUEST_ID_REUSED/);await assert.rejects(resolveRuleInteraction(db.pool,f.account,{...env('RESOLVE_RULE_INTERACTION',2),confirmReserve:true,authorizationSource:'API'},'activity.work'),/TURN_RESERVE_CONFIRMATION_REQUIRED/);await assert.rejects(resolveRuleInteraction(db.pool,f.account,{...env('RESOLVE_RULE_INTERACTION',2),authorizationSource:'AUTOMATION'},'activity.work'),/TURN_AUTOMATION_BUDGET_REQUIRED/);
 }finally{await db.close();}
});
test('bounded plans stop at reserve and total Turn budget, remain idempotent and cannot automate unknown encounters',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool,10);await setTurnReserve(db.pool,f.account,env('SET_TURN_RESERVE',0),7);const plan=await createTurnPlan(db.pool,f.account,env('CREATE_TURN_PLAN',1),{entityId:'activity.work',maxTurns:6,maxActions:5,minHealth:0});const request=env('STEP_TURN_PLAN',2);await stepTurnPlan(db.pool,f.account,request,String(plan.planId));assert.equal((await stepTurnPlan(db.pool,f.account,request,String(plan.planId))).replayed,true);const stopped=await stepTurnPlan(db.pool,f.account,env('STEP_TURN_PLAN',3),String(plan.planId));assert.equal(stopped.reason,'PROTECTED_RESERVE');assert.equal((await turnPlanner(db.pool,f.account)).turns,8);await setTurnReserve(db.pool,f.account,env('SET_TURN_RESERVE',4),0);
 const second=await createTurnPlan(db.pool,f.account,env('CREATE_TURN_PLAN',5),{entityId:'activity.work',maxTurns:3,maxActions:5,minHealth:0});await stepTurnPlan(db.pool,f.account,env('STEP_TURN_PLAN',6),String(second.planId));assert.equal((await stepTurnPlan(db.pool,f.account,env('STEP_TURN_PLAN',7),String(second.planId))).reason,'TURN_BUDGET');assert.equal((await turnPlanner(db.pool,f.account)).turns,6);
 await assert.rejects(createTurnPlan(db.pool,f.account,env('CREATE_TURN_PLAN',8),{entityId:'encounter.unknown',maxTurns:10,maxActions:5,minHealth:0}),/AUTOMATION_UNKNOWN_ACTIVITY/);
 }finally{await db.close();}
});
test('HTTP planner honors session authority, rejects forged policy/rewards and offers explicit catch-up',async()=>{
 const db=await testDatabase();let app;try{const f=await setup(db.pool);const token='turns-fixture-token'.repeat(3),headers={authorization:`Bearer ${token}`};app=buildApp(db.pool,{mode:'development',token,accountId:f.account});await app.ready();assert.equal((await app.inject({url:'/api/v1/turns'})).statusCode,401);assert.equal((await app.inject({url:'/api/v1/turns?expectedRevision=0',headers})).statusCode,200);assert.equal((await app.inject({method:'POST',url:'/api/v1/turns/daily/use',headers,payload:{...env('USE_DAILY_ALLOWANCE',0),entityId:'activity.garden',turnBonus:999}})).statusCode,400);
 await due(db.pool);const payload=env('APPLY_ROLLOVER',0);const response=await app.inject({method:'POST',url:'/api/v1/turns/rollover',headers,payload});assert.equal(response.statusCode,200,response.body);assert.equal(response.json().applied,1);assert.equal((await catchUpRollover(db.pool,f.account,payload)).replayed,true);
 }finally{await app?.close();await db.close();}
});
test('rollover forecast respects local civil schedule rather than a 24 hour increment',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool);await configureSchedule(db.pool,{id:'game-daily',hook:'DAILY_ROLLOVER',cadence:'DAILY',timezone:'America/Chicago',localTime:'00:00',startDate:'2026-01-01',config:{turns:100,cap:400}});const v=await turnPlanner(db.pool,f.account);assert.equal(v.rollover.forecastGrant,100);assert.ok(Date.parse(v.rollover.nextAt!)>Date.parse(v.serverNow));assert.equal(v.rollover.timezone,'America/Chicago');await db.pool.query('UPDATE game_schedules SET enabled=false');assert.equal((await turnPlanner(db.pool,f.account)).rollover.nextAt,null);
 }finally{await db.close();}
});
test('malformed daily sources and unbounded automatic rewards fail publication',()=>{
 for(const patch of [{capacity:0},{refresh:0},{turnBonus:-1},{banking:'UNLIMITED'},{unexpected:true}]){const p=turnsPackage();Object.assign(p.entities[0]!.definition.mechanics!.dailyAllowance as object,patch);assert.throws(()=>validateContent(p),/INVALID_DAILY_ALLOWANCE/);}
 const p=turnsPackage();(p.entities[3]!.definition.mechanics!.dailyAllowance as any).autoCollect=true;assert.throws(()=>validateContent(p),/INVALID_DAILY_ALLOWANCE/);
});
test('quick/full and charged free rests recover retained HP/MP, advance rest clocks and reconcile the next encounter',async()=>{
 const {tacticalPackage,tacticalFixture}=await import('./tactical-fixture.js');const {startTacticalCombat,takeTacticalAction}=await import('../src/domains/tactical-combat.js');const {integrityReport,unindexedForeignKeys}=await import('../src/foundation/integrity.js');
 const db=await testDatabase();try{
  const p=tacticalPackage();(p.entities.find(e=>e.id==='encounter.tactical')!.definition.mechanics!.tacticalCombat as any).rules.roundLimit=1;(p.entities.find(e=>e.id==='encounter.tactical')!.definition.mechanics!.tacticalCombat as any).allies=[];Object.assign((p.entities.find(e=>e.id==='monster.tactical')!.definition.mechanics!.tacticalUnit as any).stats,{initiative:100,accuracy:100,attackMin:25,attackMax:25});
  for(const [id,full,free]of [['activity.quick',false,false],['activity.full',true,false],['activity.free',true,true]] as const){const action=spec('INTERACTION');action.check={...action.check,possibility:'AUTOMATIC'};action.costs={turns:free?0:1,worldTime:0,gold:'0',resources:[],rest:full?'FULL_REST':'REST'};action.effects=[];action.rewards=[];action.retry='PAID';p.entities.push({id,kind:'ACTIVITY',revision:1,schemaVersion:1,definition:{name:id,dependencies:[],public:{},mechanics:{sharedAction:action as any,turnRest:{version:1,healthBps:full?10000:2500,manaBps:full?10000:2500},...(free?{dailyAllowance:{version:1,refresh:1,capacity:2,banking:'BANK',turnBonus:0,autoCollect:false}}:{})}}});}
  const f=await tacticalFixture(db.pool,p,20);await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) SELECT $1,id,'DISCOVERED' FROM content_entities WHERE id LIKE 'activity.%'",[f.account]);const c=await db.pool.connect();try{await setFeatureControl(c,'shared.rules','RELEASE','ENABLED','Rest fixture');}finally{c.release();}
  let battle:any=await startTacticalCombat(db.pool,f.account,env('START_TACTICAL',f.revision),'encounter.tactical');
  await assert.rejects(resolveRuleInteraction(db.pool,f.account,env('RESOLVE_RULE_INTERACTION',battle.revision),'activity.free'),/INSTANCE_STILL_ACTIVE/);
  battle=await takeTacticalAction(db.pool,f.account,env('TACTICAL_ACTION',battle.revision),battle.instanceId,battle.encounterRevision,battle.tacticalRevision,{actorId:'hero',kind:'CONTINUE'});
  for(const actorId of ['hero'])battle=await takeTacticalAction(db.pool,f.account,env('TACTICAL_ACTION',battle.revision),battle.instanceId,battle.encounterRevision,battle.tacticalRevision,{actorId,kind:'END'});
  assert.equal(battle.outcome,'FAILED_FORWARD');const initialTurns=(await turnPlanner(db.pool,f.account)).turns;
  const quick:any=await resolveRuleInteraction(db.pool,f.account,env('RESOLVE_RULE_INTERACTION',battle.revision),'activity.quick');assert.ok(quick.rest.health>quick.rest.beforeHealth);assert.ok(quick.rest.health<quick.rest.maxHealth);assert.equal((await turnPlanner(db.pool,f.account)).turns,initialTurns-1);
  const free:any=await resolveRuleInteraction(db.pool,f.account,env('RESOLVE_RULE_INTERACTION',quick.revision),'activity.free');assert.equal(free.rest.health,free.rest.maxHealth);assert.equal((await turnPlanner(db.pool,f.account)).turns,initialTurns-1);await assert.rejects(resolveRuleInteraction(db.pool,f.account,env('RESOLVE_RULE_INTERACTION',free.revision),'activity.full'),/NO_REST_NEEDED/);
  const clock=(await db.pool.query('SELECT state FROM shared_rules_state WHERE run_id=$1',[f.run])).rows[0].state.local;assert.equal(clock.rests,2);assert.equal(clock.fullRests,1);
  assert.deepEqual(await unindexedForeignKeys(db.pool),[]);assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0),JSON.stringify(await integrityReport(db.pool)));
  const next:any=await startTacticalCombat(db.pool,f.account,env('START_TACTICAL',free.revision),'encounter.tactical');assert.equal(next.units[0].health,free.rest.maxHealth);assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0),JSON.stringify(await integrityReport(db.pool)));
 }finally{await db.close();}
});
test('automatic collection respects reward disables and a blocked source retains banked charges',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool);await useDailyAllowance(db.pool,f.account,env('USE_DAILY_ALLOWANCE',0),'activity.garden');await setDailyAutoCollect(db.pool,f.account,env('SET_DAILY_AUTO_COLLECT',1),'activity.garden',true);await due(db.pool);const c=await db.pool.connect();try{await setFeatureControl(c,'reward.activity.garden','SAFETY','DISABLED','Fixture stop');}finally{c.release();}await applyRollover(db.pool,f.account);const view=await turnPlanner(db.pool,f.account);assert.equal(view.turns,385);assert.equal(view.daily[0]!.charges,1);assert.equal(view.history.filter(h=>h.reason.startsWith('DAILY_AUTO')).length,0);
 }finally{await db.close();}
});
test('bounded zero-Turn plans stop on charge exhaustion, failed eligibility and missing health evidence',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool);const plan=await createTurnPlan(db.pool,f.account,env('CREATE_TURN_PLAN',0),{entityId:'activity.prayer',maxTurns:0,maxActions:10,minHealth:0});await stepTurnPlan(db.pool,f.account,env('STEP_TURN_PLAN',1),String(plan.planId));const stopped=await stepTurnPlan(db.pool,f.account,env('STEP_TURN_PLAN',2),String(plan.planId));assert.equal(stopped.reason,'DAILY_CHARGES_EMPTY');assert.equal((await turnPlanner(db.pool,f.account)).plans[0]!.completed,1);assert.equal((await turnPlanner(db.pool,f.account)).turns,280);
 const health=await createTurnPlan(db.pool,f.account,env('CREATE_TURN_PLAN',3),{entityId:'activity.work',maxTurns:10,maxActions:10,minHealth:1});assert.equal((await stepTurnPlan(db.pool,f.account,env('STEP_TURN_PLAN',4),String(health.planId))).reason,'HEALTH_THRESHOLD');
 }finally{await db.close();}
});
test('v3 free and extended encounters use sealed costs, bounded source charges and unchanged loot proofs',async()=>{
 const {tacticalPackage,tacticalFixture}=await import('./tactical-fixture.js');const {startTacticalCombat,takeTacticalAction}=await import('../src/domains/tactical-combat.js');const {integrityReport}=await import('../src/foundation/integrity.js');
 const db=await testDatabase();try{const p=tacticalPackage(),encounter=p.entities.find(e=>e.id==='encounter.tactical')!;const old=encounter.definition.mechanics!.encounter as any;encounter.definition.dependencies.push('activity.free_fight');encounter.definition.mechanics!.encounter={version:3,turnCost:0,lootTableId:old.lootTableId,freeSource:'activity.free_fight'};p.entities.push({id:'activity.free_fight',kind:'ACTIVITY',revision:1,schemaVersion:1,definition:{name:'Free fight source',dependencies:[],public:{},mechanics:{freeEncounterSource:true,dailyAllowance:{version:1,refresh:1,capacity:2,banking:'BANK',turnBonus:0,autoCollect:false}}}});
  const f=await tacticalFixture(db.pool,p,10);await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,'activity.free_fight','DISCOVERED')",[f.account]);const before=(await turnPlanner(db.pool,f.account)).turns;let b:any=await startTacticalCombat(db.pool,f.account,env('START_TACTICAL',f.revision),'encounter.tactical');assert.equal((await turnPlanner(db.pool,f.account)).turns,before);assert.equal((await turnPlanner(db.pool,f.account)).daily[0]!.charges,0);
  for(const command of [{actorId:'hero',kind:'ATTACK',targetId:'enemy'},{actorId:'hero',kind:'END'},{actorId:'ally',kind:'ATTACK',targetId:'enemy'}] as const)b=await takeTacticalAction(db.pool,f.account,env('TACTICAL_ACTION',b.revision),b.instanceId,b.encounterRevision,b.tacticalRevision,command);
  assert.equal(b.outcome,'VICTORY');await assert.rejects(startTacticalCombat(db.pool,f.account,env('START_TACTICAL',b.revision),'encounter.tactical'),/DAILY_CHARGES_EMPTY/);assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0),JSON.stringify(await integrityReport(db.pool)));
  const extended=tacticalPackage();extended.version='extended';const e=extended.entities.find(e=>e.id==='encounter.tactical')!;e.definition.mechanics!.encounter={...(e.definition.mechanics!.encounter as object),version:3,turnCost:3};e.revision=2;const next=await tacticalFixture(db.pool,extended,10);const starting=(await turnPlanner(db.pool,next.account)).turns;await startTacticalCombat(db.pool,next.account,env('START_TACTICAL',next.revision),'encounter.tactical');assert.equal((await turnPlanner(db.pool,next.account)).turns,starting-3);
 }finally{await db.close();}
});
test('run policies can suspend baseline/daily refresh and event bonuses remain bounded by the soft cap',async()=>{
 const db=await testDatabase();try{const p=turnsPackage();p.entities.push({id:'rules.turns',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'Alternate allocation fixture',dependencies:[],public:{},mechanics:{turnPolicy:{version:1,baselineTurns:50,softCap:300,baselineWeekdays:[],dailyRefresh:false}}}},{id:'event.turns',kind:'EVENT',revision:1,schemaVersion:1,definition:{name:'Wide-window bonus fixture',dependencies:[],public:{},mechanics:{rolloverBonus:{version:1,starts:'2026-01-01',ends:'2026-12-31',baselineTurns:20}}}});const release=await publishContent(db.pool,p),f=await actor(db.pool,release,290);await db.pool.query("UPDATE accounts SET created_at='2025-01-01'; INSERT INTO rollover_epochs VALUES(20261001,'2026-10-01',100,400)");await applyRollover(db.pool,f.account);const v=await turnPlanner(db.pool,f.account);assert.equal(v.turns,300);assert.equal((await db.pool.query('SELECT policy FROM rollover_policy_receipts')).rows[0].policy.dailyRefresh,false);assert.equal((await db.pool.query('SELECT count(*) FROM daily_allowance_events')).rows[0].count,'0');assert.equal((await db.pool.query('SELECT turn_grant FROM run_rollovers')).rows[0].turn_grant,10);
 }finally{await db.close();}
});

test('daily balance and automatic preference edits require immutable source evidence',async()=>{
 const db=await testDatabase();try{const f=await setup(db.pool);await useDailyAllowance(db.pool,f.account,env('USE_DAILY_ALLOWANCE',0),'activity.garden');await assert.rejects(db.pool.query("UPDATE daily_allowances SET charges=charges+1 WHERE account_id=$1",[f.account]),/does not reconcile/);await assert.rejects(db.pool.query("UPDATE daily_allowances SET auto_collect=true WHERE account_id=$1",[f.account]),/does not reconcile/);assert.equal((await turnPlanner(db.pool,f.account)).daily[0]!.charges,0);
 }finally{await db.close();}
});
