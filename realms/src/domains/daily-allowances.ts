import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { executeAction,advanceRevision,type ActionContext,type Envelope } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';
import { requireFeature,featureAvailable } from '../rules/controls.js';
import { requireEntityPrerequisite } from '../rules/requirements.js';
import type { DailyAllowance } from './daily-content.js';
type Source={id:string;revision:number;name:string;spec:DailyAllowance;shared:boolean;encounterOnly:boolean;discovered_at:Date};
export async function dailySources(client:pg.PoolClient,accountId:string,releaseId:string|null):Promise<Source[]>{
 return (await client.query(`SELECT e.entity_id AS id,e.revision,v.definition->>'name' AS name,
  v.definition->'mechanics'->'dailyAllowance' AS spec,(v.definition->'mechanics'->'sharedAction' IS NOT NULL) AS shared,coalesce((v.definition->'mechanics'->>'freeEncounterSource')::boolean,false) AS "encounterOnly",d.discovered_at
  FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision
  JOIN discoveries d ON d.account_id=$1 AND d.entity_id=e.entity_id AND d.knowledge_level IN ('DISCOVERED','LEARNED','ADVANCED')
  WHERE e.release_id=$2 AND v.definition->'mechanics'->'dailyAllowance' IS NOT NULL ORDER BY e.entity_id LIMIT 128`,[accountId,releaseId])).rows;
}
export async function noOpenInstance(c:ActionContext){
 if((await c.client.query(`SELECT 1 FROM instance_participants p JOIN instances i ON i.id=p.instance_id WHERE p.run_id=$1 AND i.lifecycle='ACTIVE' LIMIT 1`,[c.run.id])).rowCount)throw new DomainError(409,'INSTANCE_STILL_ACTIVE');
}
async function requireCurrent(c:ActionContext){
 if((await c.client.query(`SELECT 1 FROM rollover_epochs e JOIN accounts a ON a.id=$1 WHERE e.effective_at<=now() AND e.effective_at>=a.created_at
  AND NOT EXISTS(SELECT 1 FROM run_rollovers r WHERE r.account_id=a.id AND r.epoch=e.epoch) LIMIT 1`,[c.accountId])).rowCount)throw new DomainError(409,'ROLLOVER_PENDING');
}
async function event(c:ActionContext,s:Source,kind:string,before:number,after:number,bonus:number,autoCollect:boolean|null=null){
 await c.client.query(`INSERT INTO daily_allowance_events(account_id,entity_id,run_id,release_id,entity_revision,action_id,kind,before_charges,after_charges,turn_bonus,ledger_request_id,auto_collect)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[c.accountId,s.id,c.run.id,c.run.content_release_id,s.revision,c.actionId,kind,before,after,bonus,bonus?c.requestId:null,autoCollect]);
}
/** Account lock is held by executeAction; a failure rolls charge, reward and receipt back together. */
export async function consumeDailyAllowance(c:ActionContext,entityId:string){
 const s=(await dailySources(c.client,c.accountId,c.run.content_release_id)).find(s=>s.id===entityId);if(!s)return null;
 await requireCurrent(c);await noOpenInstance(c);
 await requireFeature(c.client,`content.${s.id}`,c.accountId);await requireEntityPrerequisite(c,s.id);
 let row=(await c.client.query('SELECT * FROM daily_allowances WHERE account_id=$1 AND entity_id=$2 FOR UPDATE',[c.accountId,s.id])).rows[0];
 if(!row){row=(await c.client.query('INSERT INTO daily_allowances(account_id,entity_id,charges) VALUES($1,$2,$3) RETURNING *',[c.accountId,s.id,s.spec.refresh])).rows[0];}
 const before=Math.min(row.charges,s.spec.capacity);if(before<1)throw new DomainError(409,'DAILY_CHARGES_EMPTY');
 await c.client.query('UPDATE daily_allowances SET charges=$3,manual_uses=manual_uses+$4 WHERE account_id=$1 AND entity_id=$2',[c.accountId,s.id,before-1,(c.authorizationSource??'MANUAL_UI')==='MANUAL_UI'?1:0]);
 await event(c,s,'USE',row.charges,before-1,s.spec.turnBonus);
 if(s.spec.turnBonus){await requireFeature(c.client,'rewards.global',c.accountId);await requireFeature(c.client,`reward.${s.id}`,c.accountId);}
 if(s.spec.turnBonus)await bonus(c.client,c.run.id,c.requestId,s.spec.turnBonus,`DAILY:${s.id}`);
 return s;
}
async function bonus(client:pg.PoolClient,runId:string,requestId:string,amount:number,reason:string){
 const result=await client.query('UPDATE runs SET turns=turns+$2 WHERE id=$1 AND turns<=2147483647-$2 RETURNING turns',[runId,amount]);
 if(!result.rowCount)throw new DomainError(409,'TURN_BALANCE_LIMIT');
 await client.query('INSERT INTO turn_ledger(run_id,request_id,delta,reason) VALUES($1,$2,$3,$4)',[runId,requestId,amount,reason]);
}
export function useDailyAllowance(pool:pg.Pool,accountId:string,envelope:Envelope,entityId:string){
 if(envelope.actionType!=='USE_DAILY_ALLOWANCE')throw new DomainError(400,'INVALID_DAILY_ACTION');
 return executeAction(pool,accountId,envelope,{entityId},async c=>{
  const s=(await dailySources(c.client,accountId,c.run.content_release_id)).find(s=>s.id===entityId);
  if(!s||s.shared||s.encounterOnly)throw new DomainError(404,'DAILY_ACTION_NOT_KNOWN');
  await consumeDailyAllowance(c,entityId);return {entityId,turnBonus:s.spec.turnBonus,revision:await advanceRevision(c)};
 });
}
export function setDailyAutoCollect(pool:pg.Pool,accountId:string,envelope:Envelope,entityId:string,enabled:boolean){
 if(envelope.actionType!=='SET_DAILY_AUTO_COLLECT'||typeof enabled!=='boolean')throw new DomainError(400,'INVALID_DAILY_ACTION');
 return executeAction(pool,accountId,envelope,{entityId,enabled},async c=>{
  const s=(await dailySources(c.client,accountId,c.run.content_release_id)).find(s=>s.id===entityId);
  if(!s||!s.spec.autoCollect||s.shared)throw new DomainError(409,'DAILY_AUTO_COLLECT_UNAVAILABLE');
  const row=(await c.client.query('SELECT * FROM daily_allowances WHERE account_id=$1 AND entity_id=$2 FOR UPDATE',[accountId,entityId])).rows[0];
  if(!row?.manual_uses)throw new DomainError(409,'DAILY_MANUAL_USE_REQUIRED');
  await c.client.query('UPDATE daily_allowances SET auto_collect=$3 WHERE account_id=$1 AND entity_id=$2',[accountId,entityId,enabled]);
  await event(c,s,'PREFERENCE',row.charges,row.charges,0,enabled);return {entityId,enabled,revision:await advanceRevision(c)};
 });
}
/** Same transaction and account/run locks as the baseline grant. Missed days process in order. */
export async function refreshDailyAllowances(client:pg.PoolClient,accountId:string,run:{id:string;content_release_id:string|null},epoch:{epoch:string;effective_at:Date}){
 let granted=0;
 for(const s of await dailySources(client,accountId,run.content_release_id)){
  if(s.discovered_at>epoch.effective_at)continue;
  await client.query('INSERT INTO daily_allowances(account_id,entity_id,charges) VALUES($1,$2,0) ON CONFLICT DO NOTHING',[accountId,s.id]);
  const row=(await client.query('SELECT * FROM daily_allowances WHERE account_id=$1 AND entity_id=$2 FOR UPDATE',[accountId,s.id])).rows[0];
  let after=s.spec.banking==='BANK'?Math.min(s.spec.capacity,row.charges+s.spec.refresh):s.spec.refresh;
  // Autocollect never executes arbitrary shared checks, effects or costs in the scheduler role.
  const enabled=await featureAvailable(client,'rewards.global',accountId)&&await featureAvailable(client,`reward.${s.id}`,accountId)&&await featureAvailable(client,`content.${s.id}`,accountId);
  const collect=enabled&&row.auto_collect&&row.manual_uses>0&&s.spec.autoCollect&&!s.shared;
  const amount=collect?after*s.spec.turnBonus:0,ledgerRequest=amount?randomUUID():null;if(collect)after=0;
  await client.query('UPDATE daily_allowances SET charges=$3 WHERE account_id=$1 AND entity_id=$2',[accountId,s.id,after]);
  await client.query(`INSERT INTO daily_allowance_events(account_id,entity_id,run_id,release_id,entity_revision,epoch,kind,before_charges,after_charges,turn_bonus,ledger_request_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[accountId,s.id,run.id,run.content_release_id,s.revision,epoch.epoch,collect?'AUTO_COLLECT':'REFRESH',row.charges,after,amount,ledgerRequest]);
  if(amount){await bonus(client,run.id,ledgerRequest!,amount,`DAILY_AUTO:${s.id}:${epoch.epoch}`);granted+=amount;}
 }
 return granted;
}
