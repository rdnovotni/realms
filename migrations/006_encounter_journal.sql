-- Solo ordinary encounters. Authored free/shared encounters require separate budgets.
CREATE TABLE encounter_records (
  instance_id uuid PRIMARY KEY REFERENCES instances(id),
  run_id uuid NOT NULL,
  release_id uuid NOT NULL,
  definition_id text NOT NULL,
  definition_kind text NOT NULL DEFAULT 'ENCOUNTER' CHECK(definition_kind='ENCOUNTER'),
  definition_revision integer NOT NULL,
  start_action_id uuid NOT NULL UNIQUE REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
  finish_action_id uuid UNIQUE REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
  turn_cost integer NOT NULL CHECK(turn_cost=1),
  revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
  checkpoint jsonb NOT NULL CHECK(jsonb_typeof(checkpoint)='object'),
  outcome text CHECK(outcome IN('VICTORY','DEFEAT','RETREAT','SURRENDER','FAILED_FORWARD')),
  settlement jsonb CHECK(jsonb_typeof(settlement)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  FOREIGN KEY(instance_id,run_id) REFERENCES instance_participants(instance_id,run_id),
  FOREIGN KEY(definition_id,definition_kind) REFERENCES content_entities(id,kind),
  FOREIGN KEY(release_id,definition_id,definition_revision) REFERENCES release_entries(release_id,entity_id,revision),
  CHECK((outcome IS NULL AND finish_action_id IS NULL AND settlement IS NULL AND finished_at IS NULL) OR
        (outcome IS NOT NULL AND finish_action_id IS NOT NULL AND settlement IS NOT NULL AND finished_at IS NOT NULL))
);
CREATE UNIQUE INDEX one_open_encounter ON encounter_records(run_id) WHERE outcome IS NULL;
CREATE INDEX encounters_by_participant ON encounter_records(instance_id,run_id);
CREATE INDEX encounters_by_run ON encounter_records(run_id);
CREATE INDEX encounters_by_typed_definition ON encounter_records(definition_id,definition_kind);
CREATE INDEX encounters_by_release_definition ON encounter_records(release_id,definition_id,definition_revision);
CREATE TABLE encounter_draws (
  instance_id uuid NOT NULL REFERENCES encounter_records(instance_id),
  stream text NOT NULL CHECK(stream ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  draw_key text NOT NULL CHECK(draw_key ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  counter bigint NOT NULL CHECK(counter>=0),
  bound bigint NOT NULL CHECK(bound BETWEEN 1 AND 4294967296),
  value bigint NOT NULL CHECK(value>=0 AND value<bound),
  action_id uuid NOT NULL REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
  PRIMARY KEY(instance_id,stream,counter),
  UNIQUE(instance_id,stream,draw_key)
);
CREATE INDEX encounter_draws_by_action ON encounter_draws(action_id);
CREATE FUNCTION guard_encounter_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Encounter history cannot be deleted'; END IF;
  IF OLD.outcome IS NOT NULL THEN RAISE EXCEPTION 'Encounter settlement is terminal'; END IF;
  IF (to_jsonb(NEW)-ARRAY['checkpoint','revision','outcome','settlement','finish_action_id','finished_at']) <>
     (to_jsonb(OLD)-ARRAY['checkpoint','revision','outcome','settlement','finish_action_id','finished_at']) OR NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'Encounter identity is immutable; checkpoint revision must advance once';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER encounter_record_guard BEFORE UPDATE OR DELETE ON encounter_records FOR EACH ROW EXECUTE FUNCTION guard_encounter_record();
CREATE TRIGGER encounter_draw_immutable BEFORE UPDATE OR DELETE ON encounter_draws FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION guard_encounter_draw() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE terminal text; next_counter bigint;
BEGIN
  SELECT outcome INTO terminal FROM encounter_records WHERE instance_id=NEW.instance_id FOR UPDATE;
  IF NOT FOUND OR terminal IS NOT NULL THEN RAISE EXCEPTION 'Random draws require an open encounter'; END IF;
  SELECT coalesce(max(counter)+1,0) INTO next_counter FROM encounter_draws WHERE instance_id=NEW.instance_id AND stream=NEW.stream;
  IF NEW.counter<>next_counter THEN RAISE EXCEPTION 'Random stream counters must be consecutive'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER encounter_draw_guard BEFORE INSERT ON encounter_draws FOR EACH ROW EXECUTE FUNCTION guard_encounter_draw();
CREATE FUNCTION check_encounter_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
  target:=NEW.instance_id;
  IF EXISTS(SELECT 1 FROM encounter_records e JOIN instances i ON i.id=e.instance_id
    JOIN runs r ON r.id=e.run_id JOIN characters c ON c.id=r.character_id
    LEFT JOIN action_receipts a ON a.action_id=e.start_action_id
    LEFT JOIN turn_ledger t ON t.run_id=e.run_id AND t.request_id=a.request_id
    LEFT JOIN action_receipts f ON f.action_id=e.finish_action_id
    JOIN state_scopes s ON s.instance_id=i.id
    WHERE e.instance_id=target AND (i.revision<>e.revision OR i.kind<>'ENCOUNTER' OR i.content_release_id<>e.release_id OR r.content_release_id<>e.release_id
      OR a.account_id IS DISTINCT FROM c.account_id OR t.delta IS DISTINCT FROM -e.turn_cost OR t.reason IS DISTINCT FROM 'ENCOUNTER_START'
      OR (e.outcome IS NULL AND (i.lifecycle<>'ACTIVE' OR s.lifecycle<>'ACTIVE'))
      OR (e.outcome IS NOT NULL AND (i.lifecycle<>'RESOLVED' OR s.lifecycle<>'ARCHIVED' OR f.account_id IS DISTINCT FROM c.account_id)))) THEN
    RAISE EXCEPTION 'Encounter cost, ownership or lifetime does not match journal';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER encounter_consistency AFTER INSERT OR UPDATE ON encounter_records DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_encounter_consistency();
-- Changes to the associated instance must also recheck its durable journal.
CREATE FUNCTION check_managed_instance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM encounter_records WHERE instance_id=NEW.id) THEN
    IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.kind<>OLD.kind OR NEW.revision<>OLD.revision+1 OR OLD.lifecycle<>'ACTIVE') THEN
      RAISE EXCEPTION 'Managed encounter instance is immutable after resolution';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER managed_instance_guard BEFORE UPDATE ON instances FOR EACH ROW EXECUTE FUNCTION check_managed_instance();
CREATE FUNCTION recheck_managed_instance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM encounter_records e JOIN instances i ON i.id=e.instance_id JOIN state_scopes s ON s.instance_id=i.id
    WHERE e.instance_id=NEW.id AND (i.revision<>e.revision OR (e.outcome IS NULL AND (i.lifecycle<>'ACTIVE' OR s.lifecycle<>'ACTIVE')) OR
      (e.outcome IS NOT NULL AND (i.lifecycle<>'RESOLVED' OR s.lifecycle<>'ARCHIVED')))) THEN
    RAISE EXCEPTION 'Encounter lifetime does not match journal';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER managed_instance_consistency AFTER UPDATE ON instances DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION recheck_managed_instance();

CREATE FUNCTION recheck_encounter_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM encounter_records e WHERE e.instance_id=NEW.instance_id AND
    NEW.lifecycle<>CASE WHEN e.outcome IS NULL THEN 'ACTIVE' ELSE 'ARCHIVED' END) THEN
    RAISE EXCEPTION 'Encounter scope lifetime does not match journal';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER encounter_scope_consistency AFTER UPDATE ON state_scopes DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION recheck_encounter_scope();
