import { rolloverPolicy } from './turn-policy.js';
import type pg from 'pg';
import { executeAction,advanceRevision,type Envelope } from '../foundation/action.js';
import { transaction } from '../foundation/transaction.js';
import { DomainError } from '../foundation/errors.js';
import { nextDate,rolloverInstant } from '../schedule-clock.js';
import { dailySources } from './daily-allowances.js';
export function setTurnReserve(pool:pg.Pool,accountId:string,envelope:Envelope,reserve:number){
 if(envelope.actionType!=='SET_TURN_RESERVE'||!Number.isInteger(reserve)||reserve<0||reserve>1000000)throw new DomainError(400,'INVALID_TURN_RESERVE');
 return executeAction(pool,accountId,envelope,{reserve},async c=>{
  await c.client.query('INSERT INTO turn_preferences(account_id,reserve) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET reserve=EXCLUDED.reserve',[accountId,reserve]);
  return {reserve,revision:await advanceRevision(c)};
 });
}
export function turnPlanner(pool:pg.Pool,accountId:string,expectedRevision?:number,historyBefore?:string){
 if(historyBefore!==undefined&&(!/^[1-9][0-9]{0,18}$/.test(historyBefore)||BigInt(historyBefore)>9223372036854775807n))throw new DomainError(400,'INVALID_LEDGER_CURSOR');
 return transaction(pool,async client=>{
  await client.query('SELECT id FROM accounts WHERE id=$1 FOR SHARE',[accountId]);
  const run=(await client.query(`SELECT r.* FROM runs r JOIN characters c ON c.id=r.character_id WHERE c.account_id=$1 AND r.status IN ('ACTIVE','AFTERCORE') FOR SHARE OF r`,[accountId])).rows[0];
  if(!run)throw new DomainError(409,'NO_RUN');if(expectedRevision!==undefined&&expectedRevision!==run.revision)throw new DomainError(409,'STALE_REVISION');
  const now=(await client.query('SELECT now() AS now')).rows[0].now as Date;
  const s=(await client.query(`SELECT *,to_char(start_date,'YYYY-MM-DD') AS start FROM game_schedules WHERE hook='DAILY_ROLLOVER' LIMIT 1`)).rows[0];
  let next:string|null=null;
  if(s?.enabled){
   const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:s.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));
   let day=[parts.year,parts.month,parts.day].join('-');if(day<s.start)day=s.start;
   next=rolloverInstant(day,s.local_time,s.timezone);if(Date.parse(next)<=now.getTime())next=rolloverInstant(nextDate(day),s.local_time,s.timezone);
  }
  const pending=Number((await client.query(`SELECT count(*) FROM rollover_epochs e JOIN accounts a ON a.id=$1 WHERE e.effective_at<=now() AND e.effective_at>=a.created_at
   AND NOT EXISTS(SELECT 1 FROM run_rollovers r WHERE r.account_id=a.id AND r.epoch=e.epoch)`,[accountId])).rows[0].count);
  const active=!!(await client.query(`SELECT 1 FROM instances i JOIN instance_participants p ON p.instance_id=i.id WHERE p.run_id=$1 AND i.lifecycle='ACTIVE' AND i.kind IN ('ENCOUNTER','COMBAT') LIMIT 1`,[run.id])).rowCount;
  const reserve=(await client.query('SELECT reserve FROM turn_preferences WHERE account_id=$1',[accountId])).rows[0]?.reserve??0;
  const allowances=(await client.query('SELECT * FROM daily_allowances WHERE account_id=$1',[accountId])).rows;
  const sources=await dailySources(client,accountId,run.content_release_id);
  const daily=sources.map(source=>{const saved=allowances.find(a=>a.entity_id===source.id),charges=Math.min(saved?.charges??source.spec.refresh,source.spec.capacity);return {entityId:source.id,name:source.name,...source.spec,charges,nextCharges:source.spec.banking==='BANK'?Math.min(source.spec.capacity,charges+source.spec.refresh):source.spec.refresh,autoCollectEnabled:saved?.auto_collect??false,manualUseCompleted:(saved?.manual_uses??0)>0,shared:source.shared,encounterOnly:source.encounterOnly};});
  const history=(await client.query(`SELECT l.id::text,l.delta,l.reason,l.created_at AS "createdAt",r.id AS "runId" FROM turn_ledger l JOIN runs r ON r.id=l.run_id JOIN characters c ON c.id=r.character_id WHERE c.account_id=$1 AND ($2::bigint IS NULL OR l.id<$2::bigint) ORDER BY l.id DESC LIMIT 51`,[accountId,historyBefore??null])).rows;
  const totals=(await client.query(`SELECT coalesce(sum(greatest(delta,0)),0)::text AS gained,coalesce(-sum(least(delta,0)),0)::text AS spent FROM turn_ledger WHERE run_id=$1`,[run.id])).rows[0];
  const freeUses=Number((await client.query("SELECT count(*) FROM daily_allowance_events WHERE run_id=$1 AND kind='USE'",[run.id])).rows[0].count);
  const sourcesTotal=(await client.query(`SELECT CASE WHEN reason LIKE 'ROLLOVER:%' THEN 'Baseline rollover' WHEN reason LIKE 'DAILY_AUTO:%' THEN 'Daily automatic collection' WHEN reason LIKE 'DAILY:%' THEN 'Daily collection' WHEN reason='CONSUMPTION' THEN 'Consumable bonus' WHEN reason='CONSUMPTION_UNDO' THEN 'Overdrink reversal' WHEN reason='ENCOUNTER_START' THEN 'Encounter entry' WHEN reason LIKE '%RECOVERY%' THEN 'Recovery' ELSE 'Activity' END AS source,coalesce(sum(greatest(delta,0)),0)::text AS gained,coalesce(-sum(least(delta,0)),0)::text AS spent FROM turn_ledger WHERE run_id=$1 GROUP BY 1 ORDER BY 1`,[run.id])).rows;
  const consumption=(await client.query('SELECT fullness,drunkenness,tolerance FROM run_consumption WHERE run_id=$1',[run.id])).rows[0]??{fullness:0,drunkenness:0,tolerance:0};
  const activities=(await client.query(`SELECT e.entity_id AS id,v.definition->>'name' AS name,v.definition->'mechanics'->'sharedAction'->'costs' AS costs,v.definition->'mechanics'->'turnRest' AS rest,
   (v.definition->'mechanics'->'dailyAllowance' IS NOT NULL) AS daily FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision
   JOIN discoveries d ON d.account_id=$1 AND d.entity_id=e.entity_id AND d.knowledge_level IN ('DISCOVERED','LEARNED','ADVANCED') WHERE e.release_id=$2
   AND v.definition->'mechanics'->'sharedAction'->>'domain'='INTERACTION' ORDER BY e.entity_id LIMIT 101`,[accountId,run.content_release_id])).rows;
  const plans=(await client.query(`SELECT p.id,p.entity_id AS "entityId",v.definition->>'name' AS name,p.max_turns AS "maxTurns",p.max_actions AS "maxActions",p.spent,p.completed,p.min_health AS "minHealth",p.target_item_id AS "targetItemId",p.target_quantity AS "targetQuantity",p.status,p.stop_reason AS "stopReason" FROM turn_plans p JOIN release_entries e ON e.entity_id=p.entity_id AND e.release_id=$2 JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE p.run_id=$1 ORDER BY (p.status='ACTIVE') DESC,p.created_at DESC,p.id LIMIT 20`,[run.id,run.content_release_id])).rows;
  const targets=(await client.query(`SELECT e.entity_id AS id,v.definition->>'name' AS name FROM release_entries e JOIN content_entities t ON t.id=e.entity_id AND t.kind='ITEM' JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision JOIN discoveries d ON d.entity_id=e.entity_id AND d.account_id=$1 AND d.knowledge_level IN ('DISCOVERED','LEARNED','ADVANCED') WHERE e.release_id=$2 ORDER BY e.entity_id LIMIT 100`,[accountId,run.content_release_id])).rows;
  const forecastParts=next&&s?Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:s.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(next)).map(p=>[p.type,p.value])):null;
  const policy=s?await rolloverPolicy(client,run.content_release_id,forecastParts?[forecastParts.year,forecastParts.month,forecastParts.day].join(''):'',{baseline_turns:s.config.turns,turn_soft_cap:s.config.cap}):null;
  const baseline=policy?.baselineTurns??null,cap=policy?.softCap??null;
  return {runId:run.id,revision:run.revision,turns:run.turns,reserve,spendable:Math.max(0,run.turns-reserve),serverNow:now.toISOString(),
   rollover:{policy,configured:!!s,enabled:s?.enabled??false,nextAt:next,timezone:s?.timezone??null,baseline,softCap:cap,forecastGrant:cap===null?null:Math.min(baseline!,Math.max(0,cap-run.turns)),overCap:cap!==null&&run.turns>cap,pending,deferred:pending>0&&active},
   historyBefore:historyBefore??null,nextHistoryCursor:history.length>50?String(history[49]!.id):null,freeUses,sourcesTotal,plans,targets,consumption,daily,activities:activities.slice(0,100),hasMoreActivities:activities.length>100,history:history.slice(0,50),hasMoreHistory:history.length>50,totals};
 });
}
