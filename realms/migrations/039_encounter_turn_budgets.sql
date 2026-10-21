-- Opt-in v3 only; all v1/v2 encounter prices remain exactly one Turn.
ALTER TABLE encounter_records DROP CONSTRAINT encounter_records_turn_cost_check;
ALTER TABLE encounter_records ADD CONSTRAINT encounter_records_turn_cost_check CHECK(turn_cost BETWEEN 0 AND 10);
CREATE FUNCTION guard_encounter_turn_budget() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE spec jsonb; owner uuid;
BEGIN
 SELECT definition->'mechanics'->'encounter' INTO spec FROM content_versions WHERE entity_id=NEW.definition_id AND revision=NEW.definition_revision;
 IF NEW.turn_cost IS DISTINCT FROM (spec->>'turnCost')::integer OR ((spec->>'version')::integer IN (1,2) AND NEW.turn_cost<>1) THEN RAISE EXCEPTION 'Encounter price must match its sealed definition'; END IF;
 IF NEW.turn_cost=0 THEN
  SELECT c.account_id INTO owner FROM runs r JOIN characters c ON c.id=r.character_id WHERE r.id=NEW.run_id;
  IF NOT EXISTS(SELECT 1 FROM daily_allowance_events d WHERE d.account_id=owner AND d.run_id=NEW.run_id AND d.action_id=NEW.start_action_id AND d.entity_id=spec->>'freeSource' AND d.kind='USE' AND d.after_charges=least(d.before_charges,(SELECT (v.definition->'mechanics'->'dailyAllowance'->>'capacity')::integer FROM content_versions v WHERE v.entity_id=d.entity_id AND v.revision=d.entity_revision))-1 AND d.turn_bonus=0) THEN RAISE EXCEPTION 'Free encounter requires a bounded source charge'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER encounter_turn_budget BEFORE INSERT ON encounter_records FOR EACH ROW EXECUTE FUNCTION guard_encounter_turn_budget();

CREATE OR REPLACE VIEW encounter_reward_issues AS
SELECT e.instance_id FROM encounter_records e
JOIN content_versions v ON v.entity_id=e.definition_id AND v.revision=e.definition_revision
LEFT JOIN encounter_reward_plans p ON p.instance_id=e.instance_id
LEFT JOIN encounter_reward_claims c ON c.instance_id=e.instance_id
WHERE
  (v.definition->'mechanics'->'encounter'->>'lootTableId' IS NOT NULL AND p.instance_id IS NULL)
  OR (p.instance_id IS NOT NULL AND (
    v.definition->'mechanics'->'encounter'->>'version' NOT IN ('2','3')
    OR v.definition->'mechanics'->'encounter'->>'lootTableId' IS DISTINCT FROM p.loot_table_id
    OR p.release_id<>e.release_id OR p.commit_action_id<>e.start_action_id
    OR (e.outcome='VICTORY' AND c.instance_id IS NULL)))
  OR (c.instance_id IS NOT NULL AND (e.outcome IS DISTINCT FROM 'VICTORY' OR c.action_id IS DISTINCT FROM e.finish_action_id))
  OR (c.instance_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM jsonb_array_elements(p.rewards) r
    LEFT JOIN encounter_reward_items line ON line.instance_id=e.instance_id AND line.reward_key=r->>'key'
    LEFT JOIN inventory_quantity_operations op ON op.id=line.operation_id
    LEFT JOIN inventory_items item ON item.id=op.to_item_id
    WHERE line.operation_id IS NULL OR op.kind<>'GRANT' OR op.action_id IS DISTINCT FROM c.action_id
      OR op.quantity::text IS DISTINCT FROM r->>'quantity' OR op.reason<>'ENCOUNTER_REWARD'
      OR item.definition_id IS DISTINCT FROM r->>'itemId' OR item.release_id IS DISTINCT FROM p.release_id
      OR inventory_issue_binding(item.id) IS DISTINCT FROM r->>'binding' OR item.quality IS DISTINCT FROM (r->>'quality')::numeric
      OR item.source_code<>'ENCOUNTER_LOOT'
      OR item.metadata IS DISTINCT FROM jsonb_build_object('encounterId',e.instance_id::text,'lootTableId',p.loot_table_id,'group',r->>'key')))
  OR EXISTS(SELECT 1 FROM encounter_reward_items line WHERE line.instance_id=e.instance_id AND NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(p.rewards) r WHERE r->>'key'=line.reward_key));
