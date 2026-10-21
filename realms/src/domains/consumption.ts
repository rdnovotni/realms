import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { executeAction,advanceRevision,type ActionContext,type Envelope } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';
import type { Json } from '../foundation/json.js';
import { transaction } from '../foundation/transaction.js';
import { grantItem } from './item-accounting.js';
import { requireInventoryIdle } from './inventory-browser.js';
import { requireFeature } from '../rules/controls.js';
import { capacityKeys,consumableTurns,type Capacities,type Consumable } from './consumption-content.js';
export type ConsumptionPolicy={definition:Record<string,Json>;constitution:number;capacities:Capacities;reset:Record<keyof Capacities,boolean>;forbiddenFamilies:string[];allowNightcaps:boolean};
export type ConsumableItem={id:string;definition_id:string;definition_revision:number;quality:string;use:{consumption?:Consumable}};
export async function consumptionPolicy(client:Pick<pg.PoolClient,'query'>,runId:string):Promise<ConsumptionPolicy>{return (await client.query('SELECT consumption_policy($1) AS policy',[runId])).rows[0].policy;}
export async function consumptionBalance(client:Pick<pg.PoolClient,'query'>,runId:string):Promise<Capacities>{const b=(await client.query('SELECT fullness,drunkenness,tolerance FROM run_consumption WHERE run_id=$1',[runId])).rows[0];if(!b)throw new DomainError(409,'CONSUMPTION_STATE_UNAVAILABLE');return b;}
export async function pendingConsumptionRollover(client:Pick<pg.PoolClient,'query'>,accountId:string){return !!(await client.query(`SELECT 1 FROM rollover_epochs e JOIN accounts a ON a.id=$1 WHERE e.effective_at<=now() AND e.effective_at>=a.created_at AND NOT EXISTS(SELECT 1 FROM run_rollovers r WHERE r.account_id=a.id AND r.epoch=e.epoch) LIMIT 1`,[accountId])).rowCount;}
export async function consumptionQuote(c:ActionContext,item:ConsumableItem){
 const spec=item.use.consumption;if(!spec)return null;
 const policy=await consumptionPolicy(c.client,c.run.id),before=await consumptionBalance(c.client,c.run.id),after={...before};for(const k of capacityKeys)after[k]+=spec.costs[k];
 const overdrink=spec.costs.drunkenness>0&&after.drunkenness>policy.capacities.drunkenness;
 const reasons:string[]=[];
 if(policy.forbiddenFamilies.includes(spec.family))reasons.push('CONSUMABLE_FORBIDDEN');
 if(capacityKeys.some(k=>k!=='drunkenness'&&spec.costs[k]>0&&after[k]>policy.capacities[k]))reasons.push('CONSUMPTION_CAPACITY_EXCEEDED');
 if(spec.costs.drunkenness>0&&before.drunkenness>policy.capacities.drunkenness)reasons.push('ALREADY_OVERDRUNK');
 if(overdrink&&!policy.allowNightcaps)reasons.push('NIGHTCAP_FORBIDDEN');
 if(await pendingConsumptionRollover(c.client,c.accountId))reasons.push('CONSUMPTION_ROLLOVER_PENDING');
 const known=!!(await c.client.query(`SELECT 1 FROM discoveries WHERE account_id=$1 AND entity_id=$2 AND knowledge_level IN('LEARNED','ADVANCED') UNION ALL SELECT 1 FROM consumption_events e JOIN inventory_items i ON i.id=e.item_id WHERE e.account_id=$1 AND i.definition_id=$2 AND i.definition_revision=$3 AND e.kind='CONSUME' LIMIT 1`,[c.accountId,item.definition_id,item.definition_revision])).rowCount;
 const sharedBefore=(await c.client.query('SELECT state FROM shared_rules_state WHERE run_id=$1',[c.run.id])).rows[0]?.state??{local:{rounds:0,rests:0,fullRests:0},effects:[]};
 return {spec,policy,before,after,overdrink,reasons,known,turns:consumableTurns(spec,item.quality),sharedBefore};
}
export function publicConsumptionQuote(q:NonNullable<Awaited<ReturnType<typeof consumptionQuote>>>){return {family:q.spec.family,costs:q.spec.costs,before:q.before,after:q.after,limits:q.policy.capacities,turns:q.known?q.turns:null,known:q.known,overdrink:q.overdrink,automatic:q.spec.automatic,rare:q.spec.rare,reasons:q.reasons};}
export function requireConsumptionConsent(q:NonNullable<Awaited<ReturnType<typeof consumptionQuote>>>,confirmOverdrink:boolean,automatic=false){
 if(q.reasons.length)throw new DomainError(409,q.reasons[0]!);
 if(automatic&&(!q.spec.automatic||q.spec.rare||!q.known))throw new DomainError(409,'MEAL_REQUIRES_MANUAL_ATTENTION');
 if(q.overdrink&&(automatic||!confirmOverdrink))throw new DomainError(409,'OVERDRINK_CONFIRMATION_REQUIRED');
}
export async function settleConsumption(c:ActionContext,item:ConsumableItem,operationId:string,q:NonNullable<Awaited<ReturnType<typeof consumptionQuote>>>,confirmOverdrink:boolean){
 await requireFeature(c.client,'consumption.global',c.accountId);
 await c.client.query('UPDATE runs SET turns=turns+$2 WHERE id=$1',[c.run.id,q.turns]);c.run.turns+=q.turns;
 await c.client.query("INSERT INTO turn_ledger(run_id,request_id,delta,reason) VALUES($1,$2,$3,'CONSUMPTION')",[c.run.id,c.requestId,q.turns]);
 const sharedAfter=(await c.client.query('SELECT state FROM shared_rules_state WHERE run_id=$1',[c.run.id])).rows[0]?.state??q.sharedBefore;
 const e=(await c.client.query(`INSERT INTO consumption_events(run_id,account_id,kind,action_id,request_id,operation_id,item_id,before_balance,after_balance,policy,turn_delta,confirmed_overdrink,committed_revision,shared_before,shared_after) VALUES($1,$2,'CONSUME',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,[c.run.id,c.accountId,c.actionId,c.requestId,operationId,item.id,q.before,q.after,q.policy,q.turns,confirmOverdrink,c.run.revision+1,q.sharedBefore,sharedAfter])).rows[0];
 const observed=(await c.client.query("SELECT DISTINCT fact->>'effectId' AS id FROM shared_rules_events e CROSS JOIN LATERAL jsonb_array_elements(e.evidence->'effectEvents') fact WHERE e.action_id=$1 AND fact->>'kind'='APPLY' AND fact->>'source'=$2",[c.actionId,item.definition_id])).rows.map(r=>r.id as string);
 for(const id of [item.definition_id,...observed])await c.client.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level,first_run_id) VALUES($1,$2,'DISCOVERED',$3) ON CONFLICT(account_id,entity_id) DO NOTHING",[c.accountId,id,c.run.id]);
 return {eventId:String(e.id),...publicConsumptionQuote({...q,known:true})};
}
export async function requireSoberAdventure(c:Pick<ActionContext,'client'|'run'>,turnCost:number){
 if(turnCost<=0||!(await c.client.query("SELECT to_regclass('consumption_events') AS table")).rows[0].table)return;
 const b=await consumptionBalance(c.client,c.run.id),p=await consumptionPolicy(c.client,c.run.id);if(b.drunkenness>p.capacities.drunkenness)throw new DomainError(409,'OVERDRUNK_ADVENTURE_BLOCKED');
}
export async function resetConsumption(client:pg.PoolClient,accountId:string,runId:string,epoch:string){
 if(!(await client.query("SELECT to_regclass('consumption_events') AS table")).rows[0].table){await client.query('UPDATE run_consumption SET fullness=0,drunkenness=0,tolerance=0 WHERE run_id=$1',[runId]);return;}
 const before=await consumptionBalance(client,runId),policy=await consumptionPolicy(client,runId),after={...before};for(const k of capacityKeys)if(policy.reset[k])after[k]=0;
 await client.query("INSERT INTO consumption_events(run_id,account_id,kind,epoch,before_balance,after_balance,policy) VALUES($1,$2,'RESET',$3,$4,$5,$6)",[runId,accountId,epoch,before,after,policy]);
}
export async function consumptionReadContext(client:pg.PoolClient,accountId:string,revision?:number):Promise<ActionContext>{
 await client.query('SELECT id FROM accounts WHERE id=$1 FOR SHARE',[accountId]);
 const run=(await client.query("SELECT r.* FROM runs r JOIN characters c ON c.id=r.character_id WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE') FOR SHARE OF r",[accountId])).rows[0];
 if(!run)throw new DomainError(409,'NO_RUN');if(revision!==undefined&&run.revision!==revision)throw new DomainError(409,'STALE_REVISION');
 return {client,run,accountId,actionId:'00000000-0000-0000-0000-000000000000',requestId:'00000000-0000-0000-0000-000000000000'};
}
export function consumptionOverview(pool:pg.Pool,accountId:string,revision?:number){return transaction(pool,async client=>{
 const c=await consumptionReadContext(client,accountId,revision),balance=await consumptionBalance(client,c.run.id),policy=await consumptionPolicy(client,c.run.id);
 const last=(await client.query("SELECT id::text,kind,action_id,committed_revision,after_balance,policy FROM consumption_events WHERE run_id=$1 ORDER BY id DESC LIMIT 1",[c.run.id])).rows[0];
 const latestAction=(await client.query("SELECT action_id FROM audit_events WHERE actor_account_id=$1 AND category='ACTION_COMMITTED' ORDER BY id DESC LIMIT 1",[accountId])).rows[0]?.action_id;
 const undoUsed=!!(await client.query("SELECT 1 FROM consumption_events WHERE account_id=$1 AND kind='UNDO'",[accountId])).rowCount;
 const active=!!(await client.query("SELECT 1 FROM instance_participants p JOIN instances i ON i.id=p.instance_id WHERE p.run_id=$1 AND i.lifecycle='ACTIVE' LIMIT 1",[c.run.id])).rowCount;
 const pending=await pendingConsumptionRollover(client,accountId);
 const rows=(await client.query(`SELECT i.id,v.definition->>'name' AS name,i.quantity::text,coalesce(pref.never_auto,false) AS "neverAuto",coalesce(pref.nightcap,false) AS nightcap,i.definition_id AS "definitionId",v.definition->'mechanics'->'itemUse'->'consumption'->>'family' AS family FROM inventory_items i JOIN inventory_containers b ON b.id=i.container_id JOIN state_scopes s ON s.id=b.scope_id JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision JOIN discoveries d ON d.account_id=$1 AND d.entity_id=i.definition_id LEFT JOIN consumption_item_preferences pref ON pref.item_id=i.id AND pref.account_id=$1 WHERE d.knowledge_level IN('DISCOVERED','LEARNED','ADVANCED') AND s.run_id=$2 AND b.kind='CARRIED' AND i.quantity>0 AND v.definition->'mechanics'->'itemUse' ? 'consumption' ORDER BY v.definition->>'name',i.id LIMIT 101`,[accountId,c.run.id])).rows;
 const plans=(await client.query('SELECT id,name,lines,revision FROM meal_plans WHERE account_id=$1 AND NOT deleted ORDER BY name LIMIT 20',[accountId])).rows;
 const executions=(await client.query('SELECT id,plan_id AS "planId",completed,status,stop_reason AS "stopReason" FROM meal_plan_runs WHERE run_id=$1 ORDER BY (status=\'ACTIVE\') DESC,created_at DESC LIMIT 20',[c.run.id])).rows;
 return {runId:c.run.id,revision:c.run.revision,balance,policy,overdrunk:balance.drunkenness>policy.capacities.drunkenness,pending,active,items:rows.slice(0,100),hasMoreItems:rows.length>100,plans,executions,undoUsed,undoEventId:!undoUsed&&!pending&&!active&&last?.kind==='CONSUME'&&last.action_id===latestAction&&last.committed_revision===c.run.revision&&last.after_balance.drunkenness>last.policy.capacities.drunkenness?last.id:null};
 });}
export function undoOverdrink(pool:pg.Pool,accountId:string,envelope:Envelope,eventId:string){
 if(envelope.actionType!=='UNDO_OVERDRINK'||!/^[1-9][0-9]{0,18}$/.test(eventId)||!['MANUAL_UI','API'].includes(envelope.authorizationSource??'MANUAL_UI'))throw new DomainError(400,'INVALID_OVERDRINK_UNDO');
 return executeAction(pool,accountId,envelope,{eventId},async c=>{
  await requireInventoryIdle(c);if(await pendingConsumptionRollover(c.client,accountId))throw new DomainError(409,'CONSUMPTION_ROLLOVER_PENDING');
  const old=(await c.client.query("SELECT * FROM consumption_events WHERE id=$1 AND account_id=$2 AND run_id=$3 AND kind='CONSUME'",[eventId,accountId,c.run.id])).rows[0];
  const latestAction=(await c.client.query("SELECT action_id FROM audit_events WHERE actor_account_id=$1 AND category='ACTION_COMMITTED' ORDER BY id DESC LIMIT 1",[accountId])).rows[0]?.action_id;
  if(!old||old.action_id!==latestAction||old.committed_revision!==c.run.revision||old.after_balance.drunkenness<=old.policy.capacities.drunkenness||(await c.client.query("SELECT 1 FROM consumption_events WHERE account_id=$1 AND kind='UNDO'",[accountId])).rowCount)throw new DomainError(409,'OVERDRINK_UNDO_UNAVAILABLE');
  if(c.run.turns<old.turn_delta)throw new DomainError(409,'OVERDRINK_UNDO_UNAVAILABLE');
  const item=(await c.client.query('SELECT * FROM inventory_items WHERE id=$1',[old.item_id])).rows[0];
  const restored=await grantItem(c,'consumption.undo',{containerId:item.container_id,definitionId:item.definition_id,quantity:'1',quality:String(item.quality),binding:item.binding,sourceCode:'ONBOARDING_OVERDRINK_UNDO',metadata:item.metadata},'ONBOARDING_OVERDRINK_UNDO');
  const shared=(await c.client.query('SELECT * FROM shared_rules_state WHERE run_id=$1 FOR UPDATE',[c.run.id])).rows[0];
  if(shared&&JSON.stringify(shared.state)!==JSON.stringify(old.shared_after))throw new DomainError(409,'OVERDRINK_UNDO_UNAVAILABLE');
  if(shared&&JSON.stringify(old.shared_before)!==JSON.stringify(old.shared_after))await c.client.query('INSERT INTO shared_rules_events(action_id,run_id,release_id,entity_id,entity_revision,seed,evidence,before_state,after_state,state_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[c.actionId,c.run.id,c.run.content_release_id,item.definition_id,item.definition_revision,randomBytes(32),{version:1,domain:'ITEM_UNDO',sourceEventId:eventId},shared.state,old.shared_before,Number(shared.revision)+1]);
  await c.client.query('UPDATE runs SET turns=turns-$2 WHERE id=$1',[c.run.id,old.turn_delta]);c.run.turns-=old.turn_delta;
  await c.client.query("INSERT INTO turn_ledger(run_id,request_id,delta,reason) VALUES($1,$2,$3,'CONSUMPTION_UNDO')",[c.run.id,c.requestId,-old.turn_delta]);
  await c.client.query(`INSERT INTO consumption_events(run_id,account_id,kind,action_id,request_id,operation_id,item_id,source_event_id,before_balance,after_balance,policy,turn_delta,committed_revision) VALUES($1,$2,'UNDO',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[c.run.id,accountId,c.actionId,c.requestId,restored.operationId,restored.itemId,eventId,old.after_balance,old.before_balance,await consumptionPolicy(c.client,c.run.id),-old.turn_delta,c.run.revision+1]);
  return {restoredItemId:restored.itemId,balance:old.before_balance,turnsRemoved:old.turn_delta,revision:await advanceRevision(c)};
 });
}
