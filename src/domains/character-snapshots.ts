import type pg from 'pg';
import type { ActionContext } from '../foundation/action.js';
import { checksum,type Json } from '../foundation/json.js';
import { DomainError } from '../foundation/errors.js';
import { deriveProfileStats,type CharacterProfile,type MechanicsSource } from './character-mechanics.js';
import type { StartingAttributes } from './build-content.js';

export type CharacterInputs={version:1;runId:string;releaseId:string;profileId:string;profileRevision:number;profile:CharacterProfile;attributes:StartingAttributes;buildEventId:string;attributeChoiceId:string|null;equipmentEventId:string|null;sources:MechanicsSource[]};
export async function captureCharacterSnapshot(c:ActionContext,instanceId:string,profileId:string) {
  // executeAction owns the account/run lock; SQL independently checks instance
  // ownership, encounter opt-in and the exact current source inputs at insertion.
  const inputs=(await c.client.query('SELECT character_snapshot_inputs($1,$2) AS inputs',[c.run.id,profileId])).rows[0].inputs as CharacterInputs;
  const derived=deriveProfileStats(inputs.profile,inputs.attributes,inputs.sources);
  await c.client.query('INSERT INTO character_encounter_snapshots(instance_id,run_id,profile_id,inputs,derived) VALUES($1,$2,$3,$4,$5)',[instanceId,c.run.id,profileId,inputs,derived]);
  return derived;
}
export async function readCharacterSnapshot(client:pg.PoolClient,instanceId:string,runId:string) {
  const row=(await client.query('SELECT inputs,derived,profile_id,profile_revision,release_id FROM character_encounter_snapshots WHERE instance_id=$1 AND run_id=$2',[instanceId,runId])).rows[0];
  if(!row)throw new DomainError(404,'CHARACTER_SNAPSHOT_NOT_FOUND');
  const inputs=row.inputs as CharacterInputs;
  if(inputs.version!==1 || inputs.runId!==runId || inputs.profileId!==row.profile_id || inputs.profileRevision!==row.profile_revision || inputs.releaseId!==row.release_id)throw new DomainError(409,'CHARACTER_SNAPSHOT_MISMATCH');
  const derived=deriveProfileStats(inputs.profile,inputs.attributes,inputs.sources);
  if(checksum(derived as unknown as Json)!==checksum(row.derived))throw new DomainError(409,'CHARACTER_SNAPSHOT_MISMATCH');
  return {inputs,derived};
}
export async function characterSnapshotMismatchCount(client:pg.PoolClient) {
  let mismatches=0;
  // Called inside the integrity report's consistent read-only transaction.
  await client.query('DECLARE character_snapshot_audit NO SCROLL CURSOR FOR SELECT inputs,derived FROM character_encounter_snapshots');
  try {for(;;) {
    const rows=(await client.query('FETCH FORWARD 64 FROM character_snapshot_audit')).rows;if(rows.length===0)break;
    for(const row of rows)try {
      const input=row.inputs as CharacterInputs;
      if(input.version!==1 || checksum(deriveProfileStats(input.profile,input.attributes,input.sources) as unknown as Json)!==checksum(row.derived))mismatches++;
    }catch{mismatches++;}
  }}finally{await client.query('CLOSE character_snapshot_audit');}
  return mismatches;
}
