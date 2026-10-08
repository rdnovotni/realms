import type pg from 'pg';

export async function unindexedForeignKeys(pool:pg.Pool){
  return (await pool.query(`SELECT c.conname AS constraint_name,t.relname AS table_name,
    ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(num,ord)
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.num ORDER BY k.ord) AS columns
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE c.contype='f' AND n.nspname=current_schema() AND NOT EXISTS(
      SELECT 1 FROM pg_index i WHERE i.indrelid=t.oid AND i.indisvalid AND i.indisready AND i.indpred IS NULL
      AND i.indnkeyatts>=cardinality(c.conkey)
      AND (i.indkey::smallint[])[0:cardinality(c.conkey)-1] @> c.conkey)
    ORDER BY t.relname,c.conname`)).rows as {constraint_name:string;table_name:string;columns:string[]}[];
}

export async function integrityReport(pool:pg.Pool){
  const client=await pool.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const balances=(await client.query(`WITH legs AS (
      SELECT from_wallet_id AS id,-amount::numeric AS delta FROM currency_transfers
      UNION ALL SELECT to_wallet_id,amount::numeric FROM currency_transfers)
      SELECT count(*)::int AS n FROM wallets w LEFT JOIN(SELECT id,sum(delta) AS total FROM legs GROUP BY id) l ON l.id=w.id
      WHERE w.balance::numeric<>coalesce(l.total,0)`)).rows[0].n as number;
    const lifetimes=(await client.query(`SELECT count(*)::int AS n FROM runs r LEFT JOIN state_scopes s ON s.run_id=r.id
      WHERE s.lifecycle IS DISTINCT FROM CASE WHEN r.status IN('ARCHIVED','ABANDONED') THEN 'ARCHIVED' ELSE 'ACTIVE' END`)).rows[0].n as number;
    const itemQuantities=(await client.query(`WITH legs AS (
      SELECT from_item_id AS id,-quantity::numeric AS delta FROM inventory_quantity_operations WHERE from_item_id IS NOT NULL
      UNION ALL SELECT to_item_id,quantity::numeric FROM inventory_quantity_operations WHERE to_item_id IS NOT NULL)
      SELECT count(*)::int AS n FROM inventory_items i LEFT JOIN(SELECT id,sum(delta) AS total FROM legs GROUP BY id) l ON l.id=i.id
      WHERE i.quantity::numeric<>coalesce(l.total,0) OR l.id IS NULL`)).rows[0].n as number;
    const leases=(await client.query(`SELECT count(*)::int AS n FROM durable_jobs WHERE
      (status='RUNNING' AND (lease_token IS NULL OR lease_until IS NULL)) OR
      (status<>'RUNNING' AND (lease_token IS NOT NULL OR lease_until IS NOT NULL))`)).rows[0].n as number;
    const bindings=(await client.query(`SELECT count(*)::int AS n FROM inventory_items i
      JOIN inventory_containers b ON b.id=i.container_id JOIN state_scopes s ON s.id=b.scope_id
      LEFT JOIN runs r ON r.id=s.run_id LEFT JOIN characters c ON c.id=r.character_id
      WHERE (i.binding='ACCOUNT_BOUND' AND coalesce(s.account_id,c.account_id) IS DISTINCT FROM i.bound_account_id)
      OR (i.binding='RUN_BOUND' AND s.run_id IS DISTINCT FROM i.bound_run_id)`)).rows[0].n as number;
    const collisions=(await client.query(`SELECT count(*)::int AS n FROM outbox_events e JOIN durable_jobs j ON j.job_key='outbox:'||e.id::text
      WHERE j.kind<>e.event_type OR j.payload<>e.payload`)).rows[0].n as number;
    const encounters=(await client.query(`SELECT count(*)::int AS n FROM encounter_records e
      JOIN instances i ON i.id=e.instance_id JOIN state_scopes s ON s.instance_id=i.id
      JOIN runs r ON r.id=e.run_id JOIN characters c ON c.id=r.character_id
      LEFT JOIN action_receipts a ON a.action_id=e.start_action_id
      LEFT JOIN turn_ledger t ON t.run_id=e.run_id AND t.request_id=a.request_id
      LEFT JOIN action_receipts f ON f.action_id=e.finish_action_id
      WHERE i.kind<>'ENCOUNTER' OR i.revision<>e.revision OR i.content_release_id<>e.release_id OR r.content_release_id<>e.release_id
        OR a.account_id IS DISTINCT FROM c.account_id OR t.delta IS DISTINCT FROM -e.turn_cost OR t.reason IS DISTINCT FROM 'ENCOUNTER_START'
        OR (e.outcome IS NULL AND (i.lifecycle<>'ACTIVE' OR s.lifecycle<>'ACTIVE'))
        OR (e.outcome IS NOT NULL AND (i.lifecycle<>'RESOLVED' OR s.lifecycle<>'ARCHIVED' OR f.account_id IS DISTINCT FROM c.account_id))`)).rows[0].n as number;
    const rewards=(await client.query('SELECT count(*)::int AS n FROM encounter_reward_issues')).rows[0].n as number;
    const equipment=(await client.query('SELECT count(*)::int AS n FROM equipment_integrity_issues')).rows[0].n as number;
    const locks=(await client.query('SELECT count(*)::int AS n FROM item_lock_integrity_issues')).rows[0].n as number;
    const crafts=(await client.query('SELECT (SELECT count(*) FROM craft_integrity_issues)+(SELECT count(*) FROM craft_operation_issues) AS n')).rows[0].n;
    const combat=(await client.query('SELECT count(*)::int AS n FROM combat_integrity_issues')).rows[0].n as number;
    const completions=(await client.query('SELECT count(*)::int AS n FROM run_completion_issues')).rows[0].n as number;
    const constraints=(await client.query(`SELECT count(*)::int AS n FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
      JOIN pg_namespace s ON s.oid=t.relnamespace WHERE s.nspname=current_schema() AND c.contype IN('c','f') AND NOT c.convalidated`)).rows[0].n as number;
    await client.query('COMMIT');
    return {equipmentMismatches:equipment,itemLockMismatches:locks,craftMismatches:Number(crafts),combatMismatches:combat,completionMismatches:completions,rewardMismatches:rewards,encounterMismatches:encounters,walletBalanceMismatches:balances,itemQuantityMismatches:itemQuantities,runScopeMismatches:lifetimes,malformedJobLeases:leases,itemBindingMismatches:bindings,outboxJobCollisions:collisions,unvalidatedConstraints:constraints};
  }catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
}
