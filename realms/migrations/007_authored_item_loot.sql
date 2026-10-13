-- Immutable ordinary personal item loot; currencies/shared/unsecured loot need owning policies.
CREATE TABLE encounter_reward_plans (
  instance_id uuid PRIMARY KEY REFERENCES encounter_records(instance_id),
  release_id uuid NOT NULL,
  loot_table_id text NOT NULL,
  definition_kind text NOT NULL DEFAULT 'LOOT_TABLE' CHECK(definition_kind='LOOT_TABLE'),
  definition_revision integer NOT NULL,
  commit_action_id uuid NOT NULL REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
  rewards jsonb NOT NULL CHECK(jsonb_typeof(rewards)='array' AND jsonb_array_length(rewards)<=16),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(loot_table_id,definition_kind) REFERENCES content_entities(id,kind),
  FOREIGN KEY(release_id,loot_table_id,definition_revision) REFERENCES release_entries(release_id,entity_id,revision)
);
CREATE INDEX reward_plans_by_action ON encounter_reward_plans(commit_action_id);
CREATE INDEX reward_plans_by_definition ON encounter_reward_plans(loot_table_id,definition_kind);
CREATE INDEX reward_plans_by_release ON encounter_reward_plans(release_id,loot_table_id,definition_revision);
CREATE TABLE encounter_reward_claims (
  instance_id uuid PRIMARY KEY REFERENCES encounter_reward_plans(instance_id),
  action_id uuid NOT NULL UNIQUE REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE encounter_reward_items (
  instance_id uuid NOT NULL REFERENCES encounter_reward_claims(instance_id),
  reward_key text NOT NULL CHECK(reward_key ~ '^[a-z][a-z0-9_.-]{0,23}$'),
  operation_id uuid NOT NULL UNIQUE REFERENCES inventory_quantity_operations(id),
  PRIMARY KEY(instance_id,reward_key)
);
CREATE TRIGGER immutable_reward_plan BEFORE UPDATE OR DELETE ON encounter_reward_plans FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER immutable_reward_claim BEFORE UPDATE OR DELETE ON encounter_reward_claims FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER immutable_reward_item BEFORE UPDATE OR DELETE ON encounter_reward_items FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION guard_reward_plan() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry jsonb; seen text[] := '{}';
BEGIN
  FOR entry IN SELECT value FROM jsonb_array_elements(NEW.rewards) LOOP
    IF jsonb_typeof(entry)<>'object' OR (entry-ARRAY['key','itemId','quantity','binding','quality'])<>'{}'::jsonb OR
      NOT (entry ?& ARRAY['key','itemId','quantity','binding','quality']) OR
      jsonb_typeof(entry->'key')<>'string' OR jsonb_typeof(entry->'itemId')<>'string' OR
      jsonb_typeof(entry->'quantity')<>'string' OR jsonb_typeof(entry->'binding')<>'string' OR jsonb_typeof(entry->'quality')<>'string' OR
      (entry->>'key') !~ '^[a-z][a-z0-9_.-]{0,23}$' OR (entry->>'itemId') !~ '^[a-z][a-z0-9_.-]{2,119}$' OR
      (entry->>'quantity') !~ '^[1-9][0-9]{0,6}$' OR (entry->>'binding') NOT IN('TRADEABLE','ACCOUNT_BOUND','RUN_BOUND') OR
      (entry->>'quality') !~ '^(0|[1-9][0-9]{0,7})(\.[0-9]{1,4})?$' THEN
      RAISE EXCEPTION 'Malformed committed item reward';
    END IF;
    IF entry->>'key'=ANY(seen) OR (entry->>'quantity')::bigint>1000000 OR (entry->>'quality')::numeric<=0 THEN
      RAISE EXCEPTION 'Invalid committed item reward';
    END IF;
    seen:=array_append(seen,entry->>'key');
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER reward_plan_shape BEFORE INSERT ON encounter_reward_plans FOR EACH ROW EXECUTE FUNCTION guard_reward_plan();

-- Reconciliation is shared by deferred constraints, the read-only audit and restore checks.
CREATE VIEW encounter_reward_issues AS
SELECT e.instance_id FROM encounter_records e
JOIN content_versions v ON v.entity_id=e.definition_id AND v.revision=e.definition_revision
LEFT JOIN encounter_reward_plans p ON p.instance_id=e.instance_id
LEFT JOIN encounter_reward_claims c ON c.instance_id=e.instance_id
WHERE
  (v.definition->'mechanics'->'encounter'->>'version'='2' AND p.instance_id IS NULL)
  OR (p.instance_id IS NOT NULL AND (
    v.definition->'mechanics'->'encounter'->>'version' IS DISTINCT FROM '2'
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
      OR item.binding IS DISTINCT FROM r->>'binding' OR item.quality IS DISTINCT FROM (r->>'quality')::numeric
      OR item.source_code<>'ENCOUNTER_LOOT'
      OR item.metadata IS DISTINCT FROM jsonb_build_object('encounterId',e.instance_id::text,'lootTableId',p.loot_table_id,'group',r->>'key')))
  OR EXISTS(SELECT 1 FROM encounter_reward_items line WHERE line.instance_id=e.instance_id AND NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(p.rewards) r WHERE r->>'key'=line.reward_key));
CREATE FUNCTION check_authored_rewards() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM encounter_reward_issues WHERE instance_id=NEW.instance_id) THEN
    RAISE EXCEPTION 'Authored reward commitment or claim does not match encounter settlement';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER authored_encounter_rewards AFTER INSERT OR UPDATE ON encounter_records DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_authored_rewards();
CREATE CONSTRAINT TRIGGER authored_reward_plan AFTER INSERT ON encounter_reward_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_authored_rewards();
CREATE CONSTRAINT TRIGGER authored_reward_claim AFTER INSERT ON encounter_reward_claims DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_authored_rewards();
CREATE CONSTRAINT TRIGGER authored_reward_item AFTER INSERT ON encounter_reward_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_authored_rewards();
