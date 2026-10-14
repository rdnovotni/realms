import type pg from 'pg';
import { DomainError } from '../foundation/errors.js';
/** New owners only. Existing runs/instances remain pinned, even after rollout. */
export async function nextRunRelease(client:pg.PoolClient,current:string,requested?:string){
 const target=requested??current;if(target===current)return current;
 const candidate=(await client.query('SELECT locked_release_adoption($1) AS policy',[target])).rows[0]?.policy;
 if(!candidate||!candidate.new_runs||candidate.compatibility!=='RETAIN_IDENTICAL'||candidate.engine_version!=='foundation-1')throw new DomainError(409,'RELEASE_NOT_ELIGIBLE');
 // Custody may retain any old source/revision. A conservative superset policy also
 // retains all recursive dependencies; no reinterpretation of old item metadata.
 const changed=await client.query(`SELECT 1 FROM release_entries old LEFT JOIN release_entries next ON next.release_id=$2 AND next.entity_id=old.entity_id AND next.revision=old.revision WHERE old.release_id=$1 AND next.entity_id IS NULL LIMIT 1`,[current,target]);
 if(changed.rowCount)throw new DomainError(409,'RETAINED_CONTENT_INCOMPATIBLE');return target;
}
export async function approveNewRunRelease(client:pg.PoolClient,releaseId:string,compatibility:'PIN_EXISTING'|'RETAIN_IDENTICAL',reason:string){await client.query(`INSERT INTO release_adoptions(release_id,new_runs,compatibility,reason) VALUES($1,true,$2,$3) ON CONFLICT(release_id) DO UPDATE SET new_runs=true,compatibility=EXCLUDED.compatibility,reason=EXCLUDED.reason`,[releaseId,compatibility,reason]);}
/** First-life creation has no retained run/item snapshots to reinterpret. */
export async function initialRunRelease(client:pg.PoolClient,requested:string){
 const candidate=(await client.query('SELECT locked_release_adoption($1) AS policy',[requested])).rows[0]?.policy;
 if(!candidate?.new_runs||candidate.engine_version!=='foundation-1')throw new DomainError(409,'RELEASE_NOT_ELIGIBLE');return requested;
}
