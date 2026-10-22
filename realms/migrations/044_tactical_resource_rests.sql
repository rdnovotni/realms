-- Rest-limited resources retain their last saved value even while unequipped.
-- Resource-only rests need real, previously spent owned pools; a no-op rest
-- cannot be fabricated to advance clocks or collect rewards.
CREATE FUNCTION tactical_resource_rest_needed(target uuid,rest_kind text,cutoff timestamptz,excluded_rest bigint DEFAULT NULL) RETURNS boolean LANGUAGE SQL STABLE
BEGIN ATOMIC
 WITH saved AS (
 SELECT DISTINCT ON(identity.unit_key,res.key) identity.unit_key,res.key,(res.value::text)::integer AS amount,(coalesce(u->'prepared'->'resourceMaximums',u->'techniques'->'maximums')->>res.key)::integer AS maximum,coalesce(u->'prepared'->'resourceClocks',u->'techniques'->'clocks')->res.key->>'refresh' AS refresh,e.finished_at
 FROM tactical_all_origins o JOIN encounter_records e ON e.instance_id=o.instance_id
 CROSS JOIN LATERAL jsonb_array_elements(e.checkpoint->'state'->'units') u
 CROSS JOIN LATERAL jsonb_each(coalesce(u->'techniqueResources','{}'::jsonb)) res
 CROSS JOIN LATERAL (SELECT CASE WHEN u->>'id'='hero' THEN 'hero' ELSE (SELECT a->>'definitionId' FROM jsonb_array_elements(o.spec->'allies') a JOIN owned_companions owned ON owned.companion_id=a->>'definitionId' JOIN characters ch ON ch.account_id=owned.account_id JOIN runs ownrun ON ownrun.character_id=ch.id AND ownrun.id=target WHERE a->>'id'=u->>'id' AND a->>'owned'='true' LIMIT 1) END AS unit_key) identity
 WHERE o.run_id=target AND e.outcome IS NOT NULL AND e.finished_at<=cutoff AND identity.unit_key IS NOT NULL AND coalesce(u->'prepared'->'resourceClocks',u->'techniques'->'clocks')->res.key->>'clock'='REST'
 ORDER BY identity.unit_key,res.key,e.finished_at DESC,e.instance_id DESC
 ) SELECT EXISTS(SELECT 1 FROM saved s WHERE s.amount<s.maximum AND (s.refresh=rest_kind OR s.refresh='REST' AND rest_kind='FULL_REST') AND NOT EXISTS(
 SELECT 1 FROM tactical_rest_events t JOIN action_receipts a ON a.action_id=t.action_id JOIN content_versions v ON v.entity_id=t.entity_id AND v.revision=t.entity_revision
 WHERE t.run_id=target AND (excluded_rest IS NULL OR t.id<>excluded_rest) AND a.created_at>s.finished_at AND a.created_at<=cutoff AND (v.definition->'mechanics'->'sharedAction'->'costs'->>'rest'=s.refresh OR s.refresh='REST' AND v.definition->'mechanics'->'sharedAction'->'costs'->>'rest'='FULL_REST')));
END;

CREATE OR REPLACE VIEW tactical_rest_integrity_issues AS
 SELECT rest.id FROM tactical_rest_events rest
 JOIN tactical_all_origins origin ON origin.instance_id=rest.after_instance_id
 JOIN encounter_records encounter ON encounter.instance_id=origin.instance_id
 JOIN runs run ON run.id=rest.run_id JOIN characters owner ON owner.id=run.character_id
 JOIN content_versions source ON source.entity_id=rest.entity_id AND source.revision=rest.entity_revision
 LEFT JOIN action_receipts receipt ON receipt.action_id=rest.action_id
 LEFT JOIN shared_rules_events shared ON shared.action_id=rest.action_id
 LEFT JOIN tactical_recoveries recovery ON recovery.instance_id=rest.after_instance_id
 LEFT JOIN tactical_rest_events previous ON previous.id=rest.previous_rest_id
 WHERE encounter.outcome IS NULL OR origin.run_id<>rest.run_id OR run.content_release_id<>rest.release_id
 OR receipt.account_id IS DISTINCT FROM owner.account_id
 OR receipt.action_type NOT IN ('RESOLVE_RULE_INTERACTION','STEP_TURN_PLAN')
 OR shared.run_id IS DISTINCT FROM rest.run_id OR shared.entity_id IS DISTINCT FROM rest.entity_id
 OR shared.evidence->'rest'->>'id' IS DISTINCT FROM rest.id::text
 OR source.definition->'mechanics'->'turnRest' IS NULL
 OR rest.max_health IS DISTINCT FROM (origin.initial_checkpoint->'state'->'units'->0->'stats'->>'maxHealth')::integer
 OR rest.max_mana IS DISTINCT FROM (origin.initial_checkpoint->'state'->'units'->0->'stats'->>'maxMana')::integer
 OR rest.before_health IS DISTINCT FROM coalesce(previous.health,recovery.health)
 OR rest.before_mana IS DISTINCT FROM coalesce(previous.mana,recovery.mana)
 OR (previous.id IS NOT NULL AND (previous.run_id<>rest.run_id OR previous.after_instance_id<>rest.after_instance_id OR previous.id>=rest.id))
 OR rest.health IS DISTINCT FROM least(rest.max_health,rest.before_health+greatest(1,rest.max_health::bigint*(source.definition->'mechanics'->'turnRest'->>'healthBps')::integer/10000))
 OR rest.mana IS DISTINCT FROM least(rest.max_mana,rest.before_mana+rest.max_mana::bigint*(source.definition->'mechanics'->'turnRest'->>'manaBps')::integer/10000)
 OR (rest.health=rest.before_health AND rest.mana=rest.before_mana AND NOT tactical_resource_rest_needed(rest.run_id,source.definition->'mechanics'->'sharedAction'->'costs'->>'rest',receipt.created_at,rest.id))
 OR NOT EXISTS(SELECT 1 FROM runs r WHERE r.id=rest.run_id AND (r.status IN ('ACTIVE','AFTERCORE','ARCHIVED','ABANDONED')));
