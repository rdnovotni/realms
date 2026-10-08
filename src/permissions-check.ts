import { poolFor,assertRuntimeRole } from './database.js';
import { config } from './config.js';
import { randomUUID,randomBytes } from 'node:crypto';
import { postTransfers } from './domains/ledger.js';
const pool=poolFor(config().databaseUrl);
try{
  await assertRuntimeRole(pool);
  const role=(await pool.query('SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  if(role.rolname!=='realms_app' || role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolbypassrls)throw new Error('Server role is overprivileged');
  const quantityPermissions=(await pool.query(`SELECT has_table_privilege(current_user,'inventory_quantity_operations','SELECT') AS readable,
    has_table_privilege(current_user,'inventory_quantity_operations','INSERT') AS appendable,
    has_table_privilege(current_user,'inventory_quantity_operations','UPDATE') AS editable,
    has_table_privilege(current_user,'inventory_quantity_operations','DELETE') AS deletable`)).rows[0];
  if(!quantityPermissions.readable || !quantityPermissions.appendable || quantityPermissions.editable || quantityPermissions.deletable)throw new Error('Inventory quantity ledger privileges are incorrect');
  for(const statement of ['UPDATE run_attribute_choices SET milestone=milestone','DELETE FROM run_attribute_choices','UPDATE run_feat_choices SET feat_id=feat_id','DELETE FROM run_feat_choices','UPDATE run_feats SET feat_id=feat_id','DELETE FROM run_feats','UPDATE run_subclass_choices SET subclass_id=subclass_id','DELETE FROM run_subclass_choices','UPDATE run_subclasses SET subclass_id=subclass_id','DELETE FROM run_subclasses','DELETE FROM run_builds','UPDATE run_build_events SET class_id=class_id','DELETE FROM run_build_events','DELETE FROM run_xp_baselines','UPDATE encounter_xp_plans SET amount=amount','DELETE FROM run_xp_awards','CREATE TABLE permission_probe(id integer)','UPDATE schema_migrations SET checksum=checksum','DELETE FROM action_receipts','DELETE FROM inventory_quantity_operations','UPDATE content_releases SET sealed=sealed',"UPDATE accounts SET access_status='SUSPENDED'",'UPDATE auth_credentials SET handle=handle','DELETE FROM auth_events','UPDATE encounter_draws SET value=value','DELETE FROM encounter_records','UPDATE encounter_reward_plans SET rewards=rewards','DELETE FROM encounter_reward_claims','UPDATE encounter_reward_items SET reward_key=reward_key','DELETE FROM combat_steps','UPDATE combat_gold_plans SET amount=amount','DELETE FROM run_completions','UPDATE craft_records SET batches=batches','DELETE FROM craft_inputs','DELETE FROM inventory_lock_events','DELETE FROM inventory_item_locks','UPDATE item_binding_events SET bound_account_id=bound_account_id','DELETE FROM item_binding_events','DELETE FROM equipment_loadout_events','DELETE FROM equipment_loadouts','DELETE FROM equipment_events','DELETE FROM run_equipment']){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');let denied=false;
      try{await client.query(statement);}catch(error){if((error as {code?:string}).code==='42501')denied=true;else throw error;}
      if(!denied)throw new Error('Restricted operation was permitted');
    }finally{await client.query('ROLLBACK');client.release();}
  }
  // Exercise allowed writes in a rolled-back transaction; no development inventory or
  // balance changes persist. This catches missing privileges on trigger-owned writes.
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const run=(await client.query(`SELECT r.* FROM runs r JOIN characters c ON c.id=r.character_id WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE') FOR UPDATE OF r`,[config().accountId])).rows[0];
    if(!run)throw new Error('The development run is missing');
    const request=randomUUID(),action=randomUUID(),instance=randomUUID();
    await client.query('UPDATE runs SET revision=revision+1 WHERE id=$1',[run.id]);
    await client.query('INSERT INTO action_receipts(account_id,request_id,payload_hash,result,action_id,envelope_version) VALUES($1,$2,$3,$4,$5,2)',[config().accountId,request,'0'.repeat(64),{probe:true},action]);
    await client.query("INSERT INTO turn_ledger(run_id,request_id,delta,reason) VALUES($1,$2,0,'PERMISSION_PROBE')",[run.id,request]);
    await client.query("INSERT INTO audit_events(action_id,actor_account_id,category,source,payload) VALUES($1,$2,'PROBE','OPERATIONS','{}')",[action,config().accountId]);
    await client.query("INSERT INTO outbox_events(action_id,event_type,payload) VALUES($1,'PROBE','{}')",[action]);
    await client.query("INSERT INTO instances(id,kind,content_release_id,seed) VALUES($1,'COMBAT',$2,$3)",[instance,run.content_release_id,randomBytes(32)]);
    await client.query('INSERT INTO instance_participants(instance_id,run_id) VALUES($1,$2)',[instance,run.id]);
    const authSession=randomUUID();
    await client.query(`INSERT INTO auth_sessions(id,account_id,token_digest,security_epoch,scopes,device_label,expires_at)
      SELECT $1,id,$3,security_epoch,ARRAY['GAME_READ'],'PERMISSION_PROBE',now()+interval '1 hour' FROM accounts WHERE id=$2`,[authSession,config().accountId,randomBytes(32).toString('hex')]);
    await client.query('UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE id=$1',[authSession]);
    const source=(await client.query("SELECT id FROM wallets WHERE currency_id='GOLD' AND purpose='FAUCET_SINK' LIMIT 1")).rows[0]?.id;
    const target=(await client.query("SELECT w.id FROM wallets w JOIN state_scopes s ON s.id=w.scope_id WHERE s.account_id=$1 AND w.currency_id='GOLD' AND w.purpose='PLAYER'",[config().accountId])).rows[0]?.id;
    if(!source || !target)throw new Error('Development economy wallets are missing');
    await postTransfers({client,accountId:config().accountId,requestId:request,actionId:action,run},[
      {key:'probe_grant',currencyId:'GOLD',from:source,to:target,amount:'1',reason:'PERMISSION_PROBE'},
      {key:'probe_return',currencyId:'GOLD',from:target,to:source,amount:'1',reason:'PERMISSION_PROBE'}]);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  }finally{await client.query('ROLLBACK');client.release();}
  console.log('Server permissions verified: no administration, schema writes, receipt deletion or content publication.');
  console.log('Action, audit, outbox, instance and currency writes verified without persisting changes.');
}finally{await pool.end();}
