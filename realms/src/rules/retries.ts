import type pg from 'pg';
import { checksum,type Json } from '../foundation/json.js';
import { prerequisiteKeys,type Facts,type Prerequisite } from './prerequisites.js';
import type { RuleAction } from './content.js';
/** Only authored gate/check inputs qualify as changed state. Unrelated discovery,
 * free navigation, new request IDs, resource counters and revisions do not. */
export function retryFingerprint(spec:RuleAction,facts:Facts,modifiers:{source:string;amount:number}[],entityPrerequisite?:Prerequisite){
 const keys=[...new Set([...prerequisiteKeys(spec.prerequisite),...(entityPrerequisite?prerequisiteKeys(entityPrerequisite):[]),spec.check.attribute,...(spec.check.skill?[spec.check.skill]:[]),'capability.act'])].sort();
 return checksum({facts:Object.fromEntries(keys.map(k=>[k,Object.hasOwn(facts,k)?facts[k]:null])),modifiers} as Json);
}
export async function retryAvailability(client:pg.PoolClient,runId:string,entityId:string,spec:RuleAction,fingerprint:string,worldTime:number){
 const prior=(await client.query('SELECT evidence FROM shared_rules_events WHERE run_id=$1 AND entity_id=$2 ORDER BY state_revision DESC LIMIT 1',[runId,entityId])).rows[0]?.evidence;
 if(!prior)return null;
 if(spec.retry==='NEVER')return 'ALREADY_ATTEMPTED';
 if(spec.retry==='STATE_CHANGED'&&prior.fingerprint===fingerprint)return 'UNCHANGED_STATE';
 if(spec.retry==='AFTER_TIME'&&worldTime-prior.worldTime<spec.retryTime)return 'TIME_NOT_REACHED';
 return null;
}
