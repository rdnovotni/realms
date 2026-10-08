import { clearEquipmentForAscension } from './equipment.js';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { executeAction,type Envelope } from '../foundation/action.js';
import { transaction } from '../foundation/transaction.js';
import { DomainError } from '../foundation/errors.js';

async function hasOpenEncounter(client:pg.PoolClient,runId:string){
  return (await client.query(`SELECT 1 FROM instances i JOIN instance_participants p ON p.instance_id=i.id
    WHERE p.run_id=$1 AND i.lifecycle='ACTIVE' AND i.kind IN ('ENCOUNTER','COMBAT') LIMIT 1`,[runId])).rows.length>0;
}
export async function applyRollover(pool:pg.Pool,accountId:string){
  return transaction(pool,async client=>{
    const account=(await client.query('SELECT * FROM accounts WHERE id=$1 FOR UPDATE',[accountId])).rows[0];
    if(!account) throw new DomainError(404,'ACCOUNT_NOT_FOUND');
    const run=(await client.query(`SELECT r.* FROM runs r JOIN characters c ON c.id=r.character_id WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE') FOR UPDATE OF r`,[accountId])).rows[0];
    if(!run) return {applied:0,deferred:false};
    if(await hasOpenEncounter(client,run.id)) return {applied:0,deferred:true};
    const epochs=await client.query(`SELECT e.* FROM rollover_epochs e WHERE e.effective_at<=now() AND e.effective_at>=$1
      AND NOT EXISTS(SELECT 1 FROM run_rollovers r WHERE r.account_id=$2 AND r.epoch=e.epoch) ORDER BY e.epoch`,[account.created_at,accountId]);
    for(const epoch of epochs.rows){
      const grant=Math.min(epoch.baseline_turns,Math.max(0,epoch.turn_soft_cap-run.turns));
      await client.query('INSERT INTO run_rollovers(run_id,account_id,epoch,turn_grant) VALUES($1,$2,$3,$4)',[run.id,accountId,epoch.epoch,grant]);
      await client.query('UPDATE runs SET turns=turns+$1,revision=revision+1 WHERE id=$2',[grant,run.id]);
      await client.query('INSERT INTO turn_ledger(run_id,request_id,delta,reason) VALUES($1,$2,$3,$4)',[run.id,randomUUID(),grant,`ROLLOVER:${epoch.epoch}`]);
      await client.query('UPDATE run_consumption SET fullness=0,drunkenness=0,tolerance=0 WHERE run_id=$1',[run.id]);
      await client.query(`UPDATE scoped_state s SET value=c.default_value,revision=s.revision+1 FROM state_contracts c,state_scopes o
        WHERE s.key=c.key AND s.scope_id=o.id AND c.reset_policy='RESET_AT_ROLLOVER' AND o.lifecycle='ACTIVE'
        AND (o.run_id=$1 OR o.account_id=$2 OR o.character_id=$3)`,[run.id,accountId,run.character_id]);
      await client.query(`DELETE FROM effect_instances WHERE clock='ROLLOVER' AND scope_id IN (SELECT id FROM state_scopes WHERE run_id=$1)`,[run.id]);
      await client.query('INSERT INTO audit_events(actor_account_id,category,source,payload) VALUES($1,$2,$3,$4)',[accountId,'ROLLOVER_APPLIED','ROLLOVER',{runId:run.id,epoch:epoch.epoch,grant}]);
      run.turns+=grant;
    }
    return {applied:epochs.rows.length,deferred:false};
  });
}
// Eligibility/boss completion is owned by gameplay modules. This transition only accepts a completed run.
export function ascend(pool:pg.Pool,accountId:string,envelope:Envelope){
  const nextId=randomUUID();
  return executeAction(pool,accountId,envelope,{},async context=>{
    if(context.run.status!=='AFTERCORE') throw new DomainError(409,'ASCENSION_NOT_READY');
    if((await context.client.query(`SELECT 1 FROM instances i JOIN instance_participants p ON p.instance_id=i.id WHERE p.run_id=$1 AND i.lifecycle='ACTIVE' LIMIT 1`,[context.run.id])).rows.length) throw new DomainError(409,'INSTANCE_STILL_ACTIVE');
    if(!context.run.content_release_id) throw new DomainError(409,'CONTENT_RELEASE_REQUIRED');
    await clearEquipmentForAscension(context);
    // Ordinary possessions retain custody in account storage. Run-bound and system quest items
    // remain in the archived run for provenance; they cannot be accessed by the new run.
    const possessions=await context.client.query(`SELECT i.id,i.binding,coalesce(v.definition->'mechanics'->'inventory'->>'category',v.definition->'mechanics'->>'inventoryCategory') AS category,i.container_id
      FROM inventory_items i JOIN inventory_containers c ON c.id=i.container_id JOIN state_scopes s ON s.id=c.scope_id
      JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision
      WHERE s.run_id=$1 AND i.quantity>0 AND i.binding IN ('TRADEABLE','ACCOUNT_BOUND') ORDER BY i.id FOR UPDATE OF i`,[context.run.id]);
    const accountScope=(await context.client.query('SELECT id FROM state_scopes WHERE account_id=$1',[accountId])).rows[0].id;
    const storage=await context.client.query(`INSERT INTO inventory_containers(scope_id,kind) VALUES($1,'HOME'),($1,'MATERIAL_VAULT')
      ON CONFLICT(scope_id,kind,label) DO UPDATE SET label=EXCLUDED.label RETURNING id,kind`,[accountScope]);
    for(const item of possessions.rows){
      const destination=storage.rows.find(c=>c.kind===(item.category==='MATERIAL'?'MATERIAL_VAULT':'HOME'))!.id;
      await context.client.query('UPDATE inventory_items SET container_id=$1 WHERE id=$2',[destination,item.id]);
      await context.client.query('INSERT INTO inventory_movements(item_id,from_container_id,to_container_id,action_id,reason) VALUES($1,$2,$3,$4,$5)',[item.id,item.container_id,destination,context.actionId,'ASCENSION_STORAGE']);
    }
    const currentGold=(await context.client.query(`SELECT w.* FROM wallets w JOIN state_scopes s ON s.id=w.scope_id
      WHERE s.run_id=$1 AND w.currency_id='GOLD' AND w.purpose='PLAYER' FOR UPDATE OF w`,[context.run.id])).rows[0];
    if(currentGold && BigInt(currentGold.balance)>0n){
      const wealth=(await context.client.query(`INSERT INTO wallets(scope_id,currency_id,purpose) VALUES($1,'GOLD','PLAYER')
        ON CONFLICT(scope_id,currency_id,purpose) DO UPDATE SET balance=wallets.balance RETURNING id`,[accountScope])).rows[0].id;
      await context.client.query(`INSERT INTO currency_transfers(action_id,currency_id,from_wallet_id,to_wallet_id,amount,reason) VALUES($1,'GOLD',$2,$3,$4,'ASCENSION_WEALTH')`,[context.actionId,currentGold.id,wealth,currentGold.balance]);
    }
    await context.client.query('UPDATE state_scopes SET lifecycle=$1 WHERE run_id=$2',['ARCHIVED',context.run.id]);
    await context.client.query(`UPDATE runs SET status='ARCHIVED',completed_at=coalesce(completed_at,now()) WHERE id=$1`,[context.run.id]);
    await context.client.query(`INSERT INTO runs(id,character_id,turns,mode,content_release_id,rules_version,rules_manifest,completion_policy)
      SELECT $1,character_id,turns,mode,content_release_id,rules_version,rules_manifest,completion_policy FROM runs WHERE id=$2`,[nextId,context.run.id]);
    await context.client.query('INSERT INTO run_progression(run_id) VALUES($1)',[nextId]);
    await context.client.query(`INSERT INTO run_consumption(run_id,fullness,drunkenness,tolerance)
      SELECT $1,fullness,drunkenness,tolerance FROM run_consumption WHERE run_id=$2`,[nextId,context.run.id]);
    await context.client.query(`INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE run_id=$1`,[nextId]);
    await context.client.query('INSERT INTO run_history(run_id,character_id,next_run_id,action_id,summary) VALUES($1,$2,$3,$4,$5)',[context.run.id,context.run.character_id,nextId,context.actionId,{turns:context.run.turns,rulesVersion:context.run.rules_version,storedItems:possessions.rows.length,storedGold:currentGold?.balance??'0'}]);
    return {runId:nextId,previousRunId:context.run.id,turns:context.run.turns,revision:0};
  });
}
