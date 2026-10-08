import { randomBytes,randomUUID } from 'node:crypto';
import type { ActionContext } from '../foundation/action.js';
import { requireActive } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';
import { checksum,type Json } from '../foundation/json.js';
import { randomInteger } from '../foundation/rng.js';

export type EncounterSpec={version:1;turnCost:1}|{version:2;turnCost:1;lootTableId:string};
export function validateEncounterSpec(value:unknown): asserts value is EncounterSpec {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new DomainError(400,'INVALID_ENCOUNTER_SPEC');
  const spec=value as EncounterSpec;
  const keys=spec.version===2?['version','turnCost','lootTableId']:['version','turnCost'];
  if(Object.keys(value).some(k=>!keys.includes(k)) || ![1,2].includes(spec.version) || spec.turnCost!==1 ||
    (spec.version===2 && (typeof spec.lootTableId!=='string' || !/^[a-z][a-z0-9_.-]{2,119}$/.test(spec.lootTableId)))) throw new DomainError(400,'INVALID_ENCOUNTER_SPEC');
}
function object(value:Record<string,Json>){
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new DomainError(400,'INVALID_ENCOUNTER_STATE');
  checksum(value);
  if(Buffer.byteLength(JSON.stringify(value))>65536) throw new DomainError(400,'ENCOUNTER_STATE_TOO_LARGE');
  return structuredClone(value);
}
function identity(value:string){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new DomainError(400,'INVALID_ENCOUNTER_ID');
  return value.toLowerCase();
}
// Internal server primitives: an owning gameplay handler validates choices, eligibility,
// state transitions and rewards. Neither checkpoints nor settlements are client payloads.
export async function beginEncounter(context:ActionContext,definitionId:string,initial:Record<string,Json>){
  requireActive(context);const checkpoint=object(initial);
  const content=(await context.client.query(`SELECT e.revision,v.definition->'mechanics'->'encounter' AS spec
    FROM release_entries e JOIN content_entities c ON c.id=e.entity_id AND c.kind='ENCOUNTER'
    JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision
    WHERE e.release_id=$1 AND e.entity_id=$2`,[context.run.content_release_id,definitionId])).rows[0];
  if(!content) throw new DomainError(409,'ENCOUNTER_NOT_IN_RULES_SNAPSHOT');
  validateEncounterSpec(content.spec);
  if((await context.client.query(`SELECT 1 FROM instance_participants p JOIN instances i ON i.id=p.instance_id
    WHERE p.run_id=$1 AND i.lifecycle='ACTIVE' AND i.kind IN('ENCOUNTER','COMBAT')`,[context.run.id])).rows.length) throw new DomainError(409,'ENCOUNTER_ALREADY_OPEN');
  if(context.run.turns<content.spec.turnCost) throw new DomainError(409,'INSUFFICIENT_TURNS');
  const id=randomUUID();
  await context.client.query("INSERT INTO instances(id,kind,content_release_id,seed) VALUES($1,'ENCOUNTER',$2,$3)",[id,context.run.content_release_id,randomBytes(32)]);
  await context.client.query('INSERT INTO instance_participants(instance_id,run_id) VALUES($1,$2)',[id,context.run.id]);
  await context.client.query(`INSERT INTO encounter_records(instance_id,run_id,release_id,definition_id,definition_revision,start_action_id,turn_cost,checkpoint)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,context.run.id,context.run.content_release_id,definitionId,content.revision,context.actionId,content.spec.turnCost,checkpoint]);
  await context.client.query('UPDATE runs SET turns=turns-$2 WHERE id=$1',[context.run.id,content.spec.turnCost]);
  context.run.turns-=content.spec.turnCost;
  await context.client.query("INSERT INTO turn_ledger(run_id,request_id,delta,reason) VALUES($1,$2,$3,'ENCOUNTER_START')",[context.run.id,context.requestId,-content.spec.turnCost]);
  return {instanceId:id,encounterRevision:0};
}
async function locked(context:ActionContext,instanceId:string){
  requireActive(context);
  const row=(await context.client.query(`SELECT e.*,i.seed,i.rng_version FROM encounter_records e JOIN instances i ON i.id=e.instance_id
    WHERE e.instance_id=$1 AND e.run_id=$2 FOR UPDATE OF e,i`,[identity(instanceId),context.run.id])).rows[0];
  if(!row) throw new DomainError(404,'ENCOUNTER_NOT_FOUND');
  if(row.outcome!==null) throw new DomainError(409,'ENCOUNTER_RESOLVED');
  return row;
}
export async function encounterCheckpoint(context:ActionContext,instanceId:string){
  const row=await locked(context,instanceId);
  return {definitionId:row.definition_id as string,definitionRevision:row.definition_revision as number,
    revision:row.revision as number,checkpoint:structuredClone(row.checkpoint) as Record<string,Json>};
}
export async function drawEncounter(context:ActionContext,instanceId:string,stream:string,key:string,bound:number){
  if(!/^[a-z][a-z0-9_.-]{0,63}$/.test(stream) || !/^[a-z][a-z0-9_.-]{0,63}$/.test(key) ||
    !Number.isSafeInteger(bound) || bound<1 || bound>4294967296) throw new DomainError(400,'INVALID_ENCOUNTER_DRAW');
  const row=await locked(context,instanceId);
  const prior=(await context.client.query('SELECT bound,value FROM encounter_draws WHERE instance_id=$1 AND stream=$2 AND draw_key=$3',[row.instance_id,stream,key])).rows[0];
  if(prior){if(Number(prior.bound)!==bound) throw new DomainError(409,'DRAW_KEY_REUSED');return Number(prior.value);}
  const counter=BigInt((await context.client.query('SELECT coalesce(max(counter)+1,0)::text AS counter FROM encounter_draws WHERE instance_id=$1 AND stream=$2',[row.instance_id,stream])).rows[0].counter);
  if(row.rng_version!=='hmac-sha256-v1') throw new DomainError(409,'UNSUPPORTED_ENCOUNTER_RNG');
  const value=randomInteger(row.seed,stream,counter,bound);
  await context.client.query('INSERT INTO encounter_draws(instance_id,stream,draw_key,counter,bound,value,action_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[row.instance_id,stream,key,counter.toString(),bound,value,context.actionId]);
  return value;
}
export async function saveEncounterCheckpoint(context:ActionContext,instanceId:string,expectedRevision:number,next:Record<string,Json>){
  const checkpoint=object(next),row=await locked(context,instanceId);
  if(row.revision!==expectedRevision) throw new DomainError(409,'STALE_ENCOUNTER_REVISION');
  await context.client.query('UPDATE encounter_records SET checkpoint=$2,revision=revision+1 WHERE instance_id=$1',[row.instance_id,checkpoint]);
  await context.client.query('UPDATE instances SET revision=revision+1 WHERE id=$1',[row.instance_id]);
  return {instanceId:row.instance_id as string,encounterRevision:row.revision+1 as number};
}
export type EncounterOutcome='VICTORY'|'DEFEAT'|'RETREAT'|'SURRENDER'|'FAILED_FORWARD';
export async function finishEncounter(context:ActionContext,instanceId:string,expectedRevision:number,outcome:EncounterOutcome,
  settle:(context:ActionContext)=>Promise<Record<string,Json>>){
  if(!['VICTORY','DEFEAT','RETREAT','SURRENDER','FAILED_FORWARD'].includes(outcome)) throw new DomainError(400,'INVALID_ENCOUNTER_OUTCOME');
  const row=await locked(context,instanceId);
  if(row.revision!==expectedRevision) throw new DomainError(409,'STALE_ENCOUNTER_REVISION');
  // The callback uses this same client for inventory/currency/quest/defeat writes.
  // A failure rolls back the outcome, draws, rewards, receipt and entire Action.
  const settlement=object(await settle(context));
  await context.client.query(`UPDATE encounter_records SET outcome=$2,settlement=$3,finish_action_id=$4,finished_at=now(),revision=revision+1 WHERE instance_id=$1`,[row.instance_id,outcome,settlement,context.actionId]);
  await context.client.query("UPDATE instances SET lifecycle='RESOLVED',revision=revision+1 WHERE id=$1",[row.instance_id]);
  await context.client.query("UPDATE state_scopes SET lifecycle='ARCHIVED' WHERE instance_id=$1",[row.instance_id]);
  // Caller builds a discovery-safe public result; never return the hidden settlement.
  return {instanceId:row.instance_id as string,outcome,encounterRevision:row.revision+1 as number};
}
