import type pg from 'pg';
import { transaction } from '../foundation/transaction.js';
import { DomainError } from '../foundation/errors.js';
import { progressionReadiness,type ProgressionCurve } from './progression-rules.js';

// Public read model only. Awards are produced by the terminal encounter journal;
// no public endpoint accepts an XP amount or a successful-resolution assertion.
export async function progressionView(pool:pg.Pool,accountId:string) {
  return transaction(pool,async client=>{
    const row=(await client.query(`SELECT r.id,r.revision,r.status,p.level,p.xp::text,
      coalesce(plan.curve_id,b.state->'rules'->>'curveId') AS curve_id,coalesce(plan.curve_revision,(b.state->'rules'->>'curveRevision')::integer) AS curve_revision,b.state AS build,v.definition->'mechanics'->'xpCurve' AS curve
      FROM runs r JOIN characters c ON c.id=r.character_id JOIN run_progression p ON p.run_id=r.id
      LEFT JOIN run_builds b ON b.run_id=r.id
      LEFT JOIN LATERAL (SELECT curve_id,curve_revision FROM encounter_xp_plans WHERE run_id=r.id ORDER BY instance_id LIMIT 1) plan ON true
      LEFT JOIN content_versions v ON v.entity_id=coalesce(plan.curve_id,b.state->'rules'->>'curveId') AND v.revision=coalesce(plan.curve_revision,(b.state->'rules'->>'curveRevision')::integer)
      WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE')`,[accountId])).rows[0];
    if(!row) throw new DomainError(404,'PROGRESSION_NOT_FOUND');
    return {runId:row.id as string,revision:row.revision as number,campaignState:row.status as string,
      xp:row.xp as string,level:row.level as number,curveId:row.curve_id as string|null,curveRevision:row.curve_revision as number|null,
      build:row.build,readiness:row.curve ? progressionReadiness(row.curve as ProgressionCurve,row.xp,row.level) : null};
  });
}
