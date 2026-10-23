import { nextRunRelease } from '../rules/releases.js';
import { stateRegistryLock } from './state.js';
import { createHmac,randomBytes } from 'node:crypto';
import type pg from 'pg';
import { checksum,type Json } from '../foundation/json.js';
import { DomainError } from '../foundation/errors.js';
import { transaction } from '../foundation/transaction.js';
import type { RunState,ActionContext } from '../foundation/action.js';

export const ascensionContract={version:1,
 preserve:['Stable character identity','Remaining Turns','Current-day fullness, drunkenness and tolerance','Account discoveries and campaign knowledge','Ordinary items, binding and protection in Home/Material Vault','Current-run Gold moved to account wealth','Guild, event and world state','Daily allowances and uses until rollover','Saved meal plans, observed consumable knowledge and the account-wide onboarding undo state'],
 reset:['Class, levels, XP and earned choices','Run quests and local consequences','Equipment assignments and run resource pools','Run-specific progress that starts over'],
 archive:['Your old life, completed encounters and choice history','Run-bound and quest items in inaccessible old custody','Past run-specific progress'],
 blockers:['Campaign must be complete','Every active instance must finish','Player must explicitly confirm a current preview']} as const;
const previewKey=randomBytes(32);

/** Locked snapshot: no seeds, content secrets or arbitrary field values are projected.
 * The private digest is process-keyed; restart invalidates previews but committed
 * request receipts still replay before this handler runs.
 */
export async function transitionPreview(client:pg.PoolClient,accountId:string,run:RunState,requestedRelease?:string){
 const releaseId=run.content_release_id?await nextRunRelease(client,run.content_release_id,requestedRelease):null;
 const active=(await client.query(`SELECT count(*)::int AS n FROM instances i JOIN instance_participants p ON p.instance_id=i.id WHERE p.run_id=$1 AND i.lifecycle='ACTIVE'`,[run.id])).rows[0].n;
 const consumption=(await client.query('SELECT fullness,drunkenness,tolerance FROM run_consumption WHERE run_id=$1',[run.id])).rows[0];
 if(!consumption)throw new DomainError(409,'ASCENSION_STATE_INCOMPLETE');
 const possessions=(await client.query(`SELECT i.id,i.quantity::text,i.binding,i.container_id,
 coalesce(v.definition->'mechanics'->'inventory'->>'category',v.definition->'mechanics'->>'inventoryCategory') AS category
 FROM inventory_items i JOIN inventory_containers c ON c.id=i.container_id JOIN state_scopes s ON s.id=c.scope_id
 JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision WHERE s.run_id=$1 AND i.quantity>0 ORDER BY i.id`,[run.id])).rows;
 const gold=(await client.query(`SELECT w.id,w.balance::text FROM wallets w JOIN state_scopes s ON s.id=w.scope_id WHERE s.run_id=$1 AND w.currency_id='GOLD' AND w.purpose='PLAYER' ORDER BY w.id`,[run.id])).rows;
 const contracts=(await client.query(`SELECT c.key,c.ascension_policy,c.reset_policy,c.default_value,s.value,s.revision::text FROM state_contracts c LEFT JOIN state_scopes owner ON owner.run_id=$1 LEFT JOIN scoped_state s ON s.scope_id=owner.id AND s.key=c.key WHERE c.scope_kind='RUN' ORDER BY c.key`,[run.id])).rows;
 const knowledge=(await client.query('SELECT count(*)::int AS n FROM discoveries WHERE account_id=$1',[accountId])).rows[0].n;
 const turnTables=(await client.query("SELECT to_regclass('turn_preferences') AS table")).rows[0].table;
 const turnReserve=turnTables?(await client.query('SELECT reserve FROM turn_preferences WHERE account_id=$1',[accountId])).rows[0]?.reserve??0:0;
 const dailyAllowances=turnTables?(await client.query('SELECT entity_id,charges,auto_collect,manual_uses FROM daily_allowances WHERE account_id=$1 ORDER BY entity_id',[accountId])).rows:[];
 const snapshot={turnReserve,dailyAllowances,accountId,nextRelease:releaseId,run:{id:run.id,characterId:run.character_id,status:run.status,revision:run.revision,turns:run.turns,release:run.content_release_id,rulesVersion:run.rules_version,mode:run.mode},consumption,possessions,gold,contracts,active,knowledge,contractVersion:ascensionContract.version};
 const previewToken=createHmac('sha256',previewKey).update(checksum(snapshot as unknown as Json)).digest('hex');
 const ordinary=possessions.filter(i=>['TRADEABLE','ACCOUNT_BOUND'].includes(i.binding));
 return {runId:run.id,revision:run.revision,ready:run.status==='AFTERCORE'&&active===0&&!!run.content_release_id,activeInstances:active,
  previewToken,contract:ascensionContract,retained:{turns:run.turns,turnReserve,dailyAllowances:dailyAllowances.length,consumption,knowledge,storedItems:ordinary.length,archivedItems:possessions.length-ordinary.length,gold:gold[0]?.balance??'0',carriedFields:contracts.filter(c=>c.ascension_policy==='CARRY').length},next:{releaseId,mode:run.mode,startingLevel:1,startingXP:'0',build:'UNCONFIGURED'}};
}
export function ascensionPreview(pool:pg.Pool,accountId:string,requestedRelease?:string){
 return transaction(pool,async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[stateRegistryLock]);
  await client.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE',[accountId]);
  const run=(await client.query<RunState>(`SELECT r.* FROM runs r JOIN characters c ON c.id=r.character_id WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE') FOR UPDATE OF r`,[accountId])).rows[0];
  if(!run)throw new DomainError(404,'NO_ACTIVE_RUN');
  return transitionPreview(client,accountId,run,requestedRelease);
 });
}
/** A campaign's persisted victory earns account knowledge, never a numeric Mastery award.
 * Invocation belongs to the authoritative completion transaction, not a public grant API.
 */
export async function rememberCampaign(c:ActionContext,campaignId:string){
 await c.client.query(`INSERT INTO discoveries(account_id,entity_id,knowledge_level,first_run_id) VALUES($1,$2,'LEARNED',$3)
 ON CONFLICT(account_id,entity_id) DO UPDATE SET knowledge_level=CASE WHEN discoveries.knowledge_level='ADVANCED' THEN 'ADVANCED' ELSE 'LEARNED' END`,[c.accountId,campaignId,c.run.id]);
}
