import type pg from 'pg';
import { transaction } from '../foundation/transaction.js';
import { DomainError } from '../foundation/errors.js';
import type { Principal } from '../auth/sessions.js';

/** A bounded, knowledge-filtered starting point for clients. No source mechanics,
 * loot commitments, seeds or another account's state enter this projection. */
export function gameView(pool:pg.Pool,accountId:string,principal?:Principal) {
 return transaction(pool,async client=>{
  await client.query('SELECT id FROM accounts WHERE id=$1 FOR SHARE',[accountId]);
  const run=(await client.query(`SELECT r.id AS "runId",r.turns,r.revision,r.status,r.mode FROM runs r JOIN characters c ON c.id=r.character_id WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE') FOR SHARE OF r`,[accountId])).rows[0];
  if(!run)throw new DomainError(404,'NO_ACTIVE_RUN');
  const canWrite=!principal||(await client.query("SELECT 'GAME_WRITE'=ANY(scopes) AS allowed FROM auth_sessions WHERE id=$1 AND account_id=$2",[principal.sessionId,accountId])).rows[0]?.allowed===true;
  const active=(await client.query(`SELECT e.instance_id AS id,CASE WHEN t.instance_id IS NOT NULL THEN 'TACTICAL' ELSE 'OTHER' END AS kind FROM encounter_records e LEFT JOIN tactical_encounter_origins t ON t.instance_id=e.instance_id WHERE e.run_id=$1 AND e.outcome IS NULL ORDER BY e.created_at DESC,e.instance_id LIMIT 1`,[run.runId])).rows[0]??null;
  const latest=(await client.query(`SELECT e.instance_id AS id,v.definition->>'name' AS name,e.outcome FROM encounter_records e JOIN tactical_encounter_origins t ON t.instance_id=e.instance_id JOIN content_versions v ON v.entity_id=e.definition_id AND v.revision=e.definition_revision WHERE e.run_id=$1 AND e.outcome IS NOT NULL ORDER BY e.finished_at DESC,e.instance_id LIMIT 1`,[run.runId])).rows[0]??null;
  const adventures=(await client.query(`SELECT e.entity_id AS id,v.definition->>'name' AS name,v.definition->'public' AS description,(v.definition->'mechanics'->'encounter'->>'turnCost')::integer AS "turnCost",v.definition->'mechanics'->'tacticalCombat'->'failure' AS failure FROM runs r JOIN release_entries e ON e.release_id=r.content_release_id JOIN content_entities ce ON ce.id=e.entity_id AND ce.kind='ENCOUNTER' JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision JOIN discoveries d ON d.account_id=$2 AND d.entity_id=e.entity_id WHERE r.id=$1 AND d.knowledge_level IN('DISCOVERED','LEARNED','ADVANCED') AND v.definition->'mechanics'->'tacticalCombat' IS NOT NULL AND v.definition->'mechanics'->'tacticalCombat'->'sharedCombat' IS NULL ORDER BY e.entity_id LIMIT 101`,[run.runId,accountId])).rows;
  const inventory=(await client.query(`SELECT i.id,v.definition->>'name' AS name,i.quantity::text,i.binding FROM inventory_items i JOIN inventory_containers c ON c.id=i.container_id AND c.kind='CARRIED' JOIN state_scopes s ON s.id=c.scope_id AND s.run_id=$1 JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision WHERE i.quantity>0 ORDER BY i.created_at,i.id LIMIT 101`,[run.runId])).rows;
  return {protocolVersion:1,run,canWrite,activeEncounter:active,latestEncounter:latest,adventures:adventures.slice(0,100),inventory:inventory.slice(0,100),hasMoreAdventures:adventures.length>100,hasMoreItems:inventory.length>100};
 });
}
