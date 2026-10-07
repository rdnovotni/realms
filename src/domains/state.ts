import { Ajv } from 'ajv';
import type pg from 'pg';
import { checksum, type Json } from '../foundation/json.js';
import { DomainError } from '../foundation/errors.js';
const ajv=new Ajv({strict:true,allErrors:true});
export type StateContract={key:string;ownerModule:string;scopeKind:'ACCOUNT'|'CHARACTER'|'RUN'|'INSTANCE'|'GUILD'|'EVENT'|'WORLD';resetPolicy:'KEEP'|'ARCHIVE_WITH_OWNER'|'RESET_AT_ROLLOVER';schema:Record<string,Json>;defaultValue:Json};
export async function registerContract(client:pg.PoolClient,contract:StateContract){
  if(!/^[a-z][a-z0-9_.-]{2,119}$/.test(contract.key) || !contract.ownerModule) throw new Error('Invalid contract identity');
  const validate=ajv.compile(contract.schema);
  if(!validate(contract.defaultValue)) throw new Error('Contract default does not match its schema');
  const prior=(await client.query('SELECT * FROM state_contracts WHERE key=$1',[contract.key])).rows[0];
  if(prior){
    if(prior.owner_module!==contract.ownerModule || prior.scope_kind!==contract.scopeKind || prior.reset_policy!==contract.resetPolicy || checksum(prior.value_schema)!==checksum(contract.schema) || checksum(prior.default_value)!==checksum(contract.defaultValue)) throw new Error('Contract changed; register a new versioned key');
    return;
  }
  await client.query('INSERT INTO state_contracts(key,owner_module,scope_kind,reset_policy,value_schema,default_value) VALUES($1,$2,$3,$4,$5,$6)',[contract.key,contract.ownerModule,contract.scopeKind,contract.resetPolicy,contract.schema,JSON.stringify(contract.defaultValue)]);
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
