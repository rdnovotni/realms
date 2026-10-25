import type pg from 'pg';
import type { TechniqueProfile } from './tactical-techniques.js';
/** Restore rest-limited pools from the last saved occurrence of each source key,
 * even when the source was unequipped or the companion absent in later fights.
 * A sealed rest receipt, never an encounter/reconnect, authorizes replenishment.
 * The cutoff lets independent audits reconstruct the exact original inputs. */
export async function readResourceCarry(client:Pick<pg.PoolClient,'query'>,runId:string,profile:TechniqueProfile,cutoff:Date|string,companionId:string|null=null){
 const keys=Object.keys(profile.clocks??{}).filter(k=>profile.clocks![k]!.clock==='REST');if(!keys.length)return {};
 const rows=(await client.query(`SELECT DISTINCT ON (res.key) res.key,(res.value::text)::integer AS amount,e.finished_at AS spent_at FROM tactical_all_origins o JOIN encounter_records e ON e.instance_id=o.instance_id CROSS JOIN LATERAL jsonb_array_elements(e.checkpoint->'state'->'units') u CROSS JOIN LATERAL jsonb_each(coalesce(u->'techniqueResources','{}'::jsonb)) res WHERE o.run_id=$1 AND e.outcome IS NOT NULL AND e.finished_at<=$2 AND res.key=ANY($3::text[]) AND (CASE WHEN $4::text IS NULL THEN u->>'id'='hero' ELSE EXISTS(SELECT 1 FROM jsonb_array_elements(o.spec->'allies') a WHERE a->>'definitionId'=$4 AND a->>'id'=u->>'id') END) ORDER BY res.key,e.finished_at DESC,e.instance_id DESC`,[runId,cutoff,keys,companionId])).rows;
 const result:Record<string,number>={};
 for(const key of keys){const previous=rows.find(r=>r.key===key),refresh=profile.clocks![key]!.refresh!;let restored=!previous;
  if(previous)restored=!!(await client.query(`SELECT 1 FROM tactical_rest_events t JOIN action_receipts a ON a.action_id=t.action_id JOIN content_versions v ON v.entity_id=t.entity_id AND v.revision=t.entity_revision WHERE t.run_id=$1 AND a.created_at>$2 AND a.created_at<=$3 AND (v.definition->'mechanics'->'sharedAction'->'costs'->>'rest'=$4 OR $4='REST' AND v.definition->'mechanics'->'sharedAction'->'costs'->>'rest'='FULL_REST') LIMIT 1`,[runId,previous.spent_at,cutoff,refresh])).rowCount;
  result[key]=restored?profile.maximums[key]!:Math.min(profile.maximums[key]!,previous!.amount);
 }
 return result;
}
