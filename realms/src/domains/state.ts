import { Ajv } from 'ajv';
import type pg from 'pg';
import { checksum, type Json } from '../foundation/json.js';
import { DomainError } from '../foundation/errors.js';
export const stateRegistryLock='realms.state-contracts.v1';
const ajv=new Ajv({strict:true,allErrors:true});
export type StateContract={key:string;ownerModule:string;scopeKind:'ACCOUNT'|'CHARACTER'|'RUN'|'INSTANCE'|'GUILD'|'EVENT'|'WORLD';resetPolicy:'KEEP'|'ARCHIVE_WITH_OWNER'|'RESET_AT_ROLLOVER';schema:Record<string,Json>;defaultValue:Json;ascensionPolicy?:'KEEP'|'CARRY'|'RESET'|'ARCHIVE'};
export async function registerContract(client:pg.PoolClient,contract:StateContract){
  // Registration is an administration/startup transaction, never a player Action.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[stateRegistryLock]);
  if(!/^[a-z][a-z0-9_.-]{2,119}$/.test(contract.key) || !contract.ownerModule) throw new Error('Invalid contract identity');
  const ascensionPolicy=contract.ascensionPolicy??(contract.scopeKind==='RUN'?(contract.resetPolicy==='RESET_AT_ROLLOVER'?'CARRY':'ARCHIVE'):contract.scopeKind==='INSTANCE'?'ARCHIVE':'KEEP');
  if((contract.scopeKind==='RUN'?!['CARRY','RESET','ARCHIVE'].includes(ascensionPolicy):ascensionPolicy!==(contract.scopeKind==='INSTANCE'?'ARCHIVE':'KEEP')) || (contract.scopeKind==='RUN'&&contract.resetPolicy==='RESET_AT_ROLLOVER'&&ascensionPolicy!=='CARRY')) throw new Error('Invalid Ascension lifetime policy');
  const validate=ajv.compile(contract.schema);
  if(!validate(contract.defaultValue)) throw new Error('Contract default does not match its schema');
  const prior=(await client.query('SELECT * FROM state_contracts WHERE key=$1',[contract.key])).rows[0];
  if(prior){
    if(prior.owner_module!==contract.ownerModule || prior.scope_kind!==contract.scopeKind || prior.reset_policy!==contract.resetPolicy || prior.ascension_policy!==ascensionPolicy || checksum(prior.value_schema)!==checksum(contract.schema) || checksum(prior.default_value)!==checksum(contract.defaultValue)) throw new Error('Contract changed; register a new versioned key');
    return;
  }
  await client.query('INSERT INTO state_contracts(key,owner_module,scope_kind,reset_policy,value_schema,default_value,ascension_policy) VALUES($1,$2,$3,$4,$5,$6,$7)',[contract.key,contract.ownerModule,contract.scopeKind,contract.resetPolicy,contract.schema,JSON.stringify(contract.defaultValue),ascensionPolicy]);
}
// Internal module API only; no HTTP endpoint accepts arbitrary scope IDs or state keys.
export async function writeState(client:pg.PoolClient,ownerModule:string,scopeId:string,key:string,value:Json,expectedRevision:string|null){
  const contract=(await client.query(`SELECT c.*,s.kind,s.lifecycle FROM state_contracts c CROSS JOIN state_scopes s WHERE c.key=$1 AND s.id=$2`,[key,scopeId])).rows[0];
  if(!contract || contract.owner_module!==ownerModule || contract.scope_kind!==contract.kind || contract.lifecycle!=='ACTIVE') throw new DomainError(409,'INVALID_STATE_SCOPE');
  if(!ajv.compile(contract.value_schema)(value)) throw new DomainError(400,'INVALID_STATE_VALUE');
  const result=expectedRevision===null ? await client.query(`INSERT INTO scoped_state(scope_id,scope_kind,key,value) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING revision::text`,[scopeId,contract.kind,key,JSON.stringify(value)])
    : await client.query(`UPDATE scoped_state SET value=$1,revision=revision+1 WHERE scope_id=$2 AND key=$3 AND revision=$4 RETURNING revision::text`,[JSON.stringify(value),scopeId,key,expectedRevision]);
  if(!result.rows.length) throw new DomainError(409,'STALE_STATE_REVISION');
  return result.rows[0].revision as string;
}

/** Called with the account/run and old scope locked by the transition coordinator.
 * Only declared RUN fields migrate; history remains in the archived old owner.
 * Existing contracts retain archival behavior except daily fields, which carry.
 */
export async function transitionRunFields(client:pg.PoolClient,oldRunId:string,nextRunId:string){
 const values=(await client.query(`SELECT c.key,c.value_schema,CASE WHEN c.ascension_policy='CARRY' THEN coalesce(old.value,c.default_value) ELSE c.default_value END AS next_value FROM state_contracts c LEFT JOIN state_scopes prior ON prior.run_id=$1 LEFT JOIN scoped_state old ON old.scope_id=prior.id AND old.key=c.key WHERE c.scope_kind='RUN' AND c.ascension_policy IN('CARRY','RESET')`,[oldRunId])).rows;
 for(const field of values)if(!ajv.compile(field.value_schema)(field.next_value))throw new DomainError(409,'INVALID_STATE_VALUE');
 const rows=(await client.query(`INSERT INTO scoped_state(scope_id,scope_kind,key,value)
   SELECT next.id,'RUN',c.key,CASE WHEN c.ascension_policy='CARRY' THEN coalesce(old.value,c.default_value) ELSE c.default_value END
   FROM state_contracts c CROSS JOIN state_scopes next
   LEFT JOIN state_scopes prior ON prior.run_id=$1
   LEFT JOIN scoped_state old ON old.scope_id=prior.id AND old.key=c.key
   WHERE next.run_id=$2 AND c.scope_kind='RUN' AND c.ascension_policy IN('CARRY','RESET')
   RETURNING key`,[oldRunId,nextRunId])).rows;
 return rows.length;
}
