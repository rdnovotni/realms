import type pg from 'pg';
import { transaction } from '../foundation/transaction.js';
import { advancementScope,advancementStamp } from './advancement-view.js';
/** Public schedule facts only. No raw contracts, hidden catalog IDs, or speculative class rewards. */
export async function milestoneView(pool:pg.Pool,accountId:string){
 return transaction(pool,async client=>{
  await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const run=await advancementScope(client,accountId);
  const facts=(await client.query(`WITH current_run AS (
   SELECT r.*,b.state AS build,p.level FROM runs r JOIN run_builds b ON b.run_id=r.id JOIN run_progression p ON p.run_id=r.id
   WHERE r.id=$1 AND r.mode IN('STANDARD','CASUAL') AND b.state->>'mode'='CONFIGURED'
  ), contracts AS (
   SELECT e.entity_id,e.revision,v.definition->'mechanics' AS mechanics FROM current_run r
   JOIN release_entries e ON e.release_id=r.content_release_id JOIN content_entities ce ON ce.id=e.entity_id AND ce.kind='TUNING'
   JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision
  ), facts AS (
   SELECT 'ATTRIBUTE' AS category,c.entity_id AS "contractId",c.revision AS "contractRevision",(m->>'level')::integer AS level,
    'CHARACTER' AS basis,NULL::text AS name,
    CASE WHEN EXISTS(SELECT 1 FROM run_attribute_choices a WHERE a.run_id=r.id AND a.milestone=(m->>'level')::integer) THEN 'COMPLETED'
     WHEN (m->>'level')::integer<=r.level THEN 'EARNED' ELSE 'UPCOMING' END AS state,
    jsonb_build_object('points',m->'points','allowedAttributes',m->'allowedAttributes') AS details
   FROM current_run r CROSS JOIN contracts c CROSS JOIN LATERAL jsonb_array_elements(c.mechanics->'attributeRules'->'milestones') m
   WHERE c.mechanics->'attributeRules'->>'buildRulesId'=r.build->'rules'->>'id'
    AND NOT EXISTS(SELECT 1 FROM run_attribute_choices a WHERE a.run_id=r.id AND a.rules_id<>c.entity_id)
   UNION ALL
   SELECT 'PROFICIENCY',c.entity_id,c.revision,m::integer,'CHARACTER',NULL,
    CASE WHEN EXISTS(SELECT 1 FROM run_proficiency_choices a WHERE a.run_id=r.id AND a.milestone=m::integer) THEN 'COMPLETED'
     WHEN m::integer<=r.level THEN 'EARNED' ELSE 'UPCOMING' END,NULL
   FROM current_run r CROSS JOIN contracts c CROSS JOIN LATERAL jsonb_array_elements_text(c.mechanics->'proficiencyRules'->'milestones') m
   WHERE c.mechanics->'proficiencyRules'->>'buildRulesId'=r.build->'rules'->>'id'
    AND NOT EXISTS(SELECT 1 FROM run_proficiency_choices a WHERE a.run_id=r.id AND a.rules_id<>c.entity_id)
    AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(c.mechanics->'proficiencyRules'->'skillIds') skill JOIN discoveries d ON d.entity_id=skill AND d.account_id=$2)
   UNION ALL
   SELECT 'FEAT',c.entity_id,c.revision,m::integer,'CHARACTER',NULL,
    CASE WHEN EXISTS(SELECT 1 FROM run_feat_choices a WHERE a.run_id=r.id AND a.milestone=m::integer) THEN 'COMPLETED'
     WHEN m::integer<=r.level THEN 'EARNED' ELSE 'UPCOMING' END,NULL
   FROM current_run r CROSS JOIN contracts c CROSS JOIN LATERAL jsonb_array_elements_text(c.mechanics->'featRules'->'milestones') m
   WHERE c.mechanics->'featRules'->>'buildRulesId'=r.build->'rules'->>'id'
    AND NOT EXISTS(SELECT 1 FROM run_feat_choices a WHERE a.run_id=r.id AND a.rules_id<>c.entity_id)
    AND EXISTS(SELECT 1 FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision
      JOIN discoveries d ON d.entity_id=e.entity_id AND d.account_id=$2 WHERE e.release_id=r.content_release_id AND v.definition->'mechanics'->'feat'->>'rulesId'=c.entity_id)
   UNION ALL
   SELECT 'SUBCLASS',e.entity_id,e.revision,(v.definition->'mechanics'->'subclass'->>'unlockNativeLevel')::integer,'NATIVE_CLASS',v.definition->>'name',
    CASE WHEN s.class_id IS NOT NULL THEN 'COMPLETED' WHEN l.native_level>=(v.definition->'mechanics'->'subclass'->>'unlockNativeLevel')::integer THEN 'EARNED' ELSE 'UPCOMING' END,
    jsonb_build_object('className',cv.definition->>'name','nativeLevel',l.native_level,'selected',s.subclass_id=e.entity_id)
   FROM current_run r JOIN release_entries e ON e.release_id=r.content_release_id JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision
   JOIN discoveries d ON d.entity_id=e.entity_id AND d.account_id=$2
   JOIN run_class_levels l ON l.run_id=r.id AND l.class_id=v.definition->'mechanics'->'subclass'->>'classId'
   JOIN release_entries ce ON ce.release_id=r.content_release_id AND ce.entity_id=l.class_id
   JOIN content_versions cv ON cv.entity_id=ce.entity_id AND cv.revision=ce.revision
   LEFT JOIN run_subclasses s ON s.run_id=r.id AND s.class_id=l.class_id
  ) SELECT * FROM facts ORDER BY level,category,"contractId" LIMIT 513`,[run.id,accountId])).rows;
  return {...advancementStamp(run),milestones:facts.slice(0,512),truncated:facts.length>512};
 });
}
