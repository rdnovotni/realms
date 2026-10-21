CREATE TABLE tactical_rest_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 action_id uuid NOT NULL UNIQUE REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
 run_id uuid NOT NULL REFERENCES runs(id),after_instance_id uuid NOT NULL,
 previous_rest_id bigint REFERENCES tactical_rest_events(id),
 release_id uuid NOT NULL,entity_id text NOT NULL,entity_revision integer NOT NULL,
 before_health integer NOT NULL,before_mana integer NOT NULL,health integer NOT NULL,mana integer NOT NULL,
 max_health integer NOT NULL,max_mana integer NOT NULL,
 FOREIGN KEY(after_instance_id,run_id) REFERENCES encounter_records(instance_id,run_id),
 FOREIGN KEY(release_id,entity_id,entity_revision) REFERENCES release_entries(release_id,entity_id,revision),
 UNIQUE(id,run_id)
);
CREATE INDEX rest_run ON tactical_rest_events(run_id,id DESC);
CREATE INDEX rest_instance ON tactical_rest_events(after_instance_id,run_id);
CREATE INDEX rest_source ON tactical_rest_events(release_id,entity_id,entity_revision);
CREATE INDEX rest_entity ON tactical_rest_events(entity_id,entity_revision);
CREATE INDEX rest_predecessor ON tactical_rest_events(previous_rest_id);
CREATE TRIGGER immutable_rest_event BEFORE UPDATE OR DELETE ON tactical_rest_events FOR EACH ROW EXECUTE FUNCTION reject_record_change();
ALTER TABLE tactical_encounter_origins ADD rest_event_id bigint REFERENCES tactical_rest_events(id);
ALTER TABLE shared_tactical_members ADD rest_event_id bigint REFERENCES tactical_rest_events(id);
CREATE INDEX tactical_origin_rest ON tactical_encounter_origins(rest_event_id);
CREATE INDEX shared_member_rest ON shared_tactical_members(rest_event_id);
CREATE OR REPLACE VIEW tactical_all_origins AS
 SELECT * FROM tactical_encounter_origins
 UNION ALL
 SELECT m.instance_id,m.run_id,m.previous_instance_id,
 CASE WHEN m.run_id=s.host_run_id THEN s.spec ELSE jsonb_set(s.spec,'{allies}','[]'::jsonb) END,m.initial_checkpoint,m.rest_event_id
 FROM shared_tactical_members m JOIN shared_tactical_sessions s ON s.id=m.session_id;
CREATE FUNCTION guard_rest_origin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected bigint;
BEGIN
 SELECT max(id) INTO expected FROM tactical_rest_events WHERE run_id=NEW.run_id AND after_instance_id=NEW.previous_instance_id;
 IF NEW.rest_event_id IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Encounter must pin its latest intervening rest'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tactical_rest_origin BEFORE INSERT ON tactical_encounter_origins FOR EACH ROW EXECUTE FUNCTION guard_rest_origin();
CREATE TRIGGER shared_rest_origin BEFORE INSERT ON shared_tactical_members FOR EACH ROW EXECUTE FUNCTION guard_rest_origin();
CREATE FUNCTION project_tactical_rest() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pool tactical_run_state%ROWTYPE; last_rest bigint;
BEGIN
 SELECT * INTO pool FROM tactical_run_state WHERE run_id=NEW.run_id FOR UPDATE;
 SELECT max(id) INTO last_rest FROM tactical_rest_events WHERE run_id=NEW.run_id AND after_instance_id=NEW.after_instance_id AND id<>NEW.id;
 IF pool.run_id IS NULL OR pool.last_instance_id<>NEW.after_instance_id OR (pool.health,pool.mana) IS DISTINCT FROM (NEW.before_health,NEW.before_mana)
 OR NEW.previous_rest_id IS DISTINCT FROM last_rest
 OR EXISTS(SELECT 1 FROM instances i JOIN instance_participants p ON p.instance_id=i.id WHERE p.run_id=NEW.run_id AND i.lifecycle='ACTIVE')
 THEN RAISE EXCEPTION 'Rest requires a settled retained pool and consecutive provenance'; END IF;
 UPDATE tactical_run_state SET health=NEW.health,mana=NEW.mana WHERE run_id=NEW.run_id;
 RETURN NEW;
END $$;
CREATE TRIGGER tactical_rest_project AFTER INSERT ON tactical_rest_events FOR EACH ROW EXECUTE FUNCTION project_tactical_rest();
CREATE VIEW tactical_rest_integrity_issues AS
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
 OR (rest.health=rest.before_health AND rest.mana=rest.before_mana)
 OR NOT EXISTS(SELECT 1 FROM runs r WHERE r.id=rest.run_id AND (r.status IN ('ACTIVE','AFTERCORE','ARCHIVED','ABANDONED')));
CREATE FUNCTION check_tactical_rest() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM tactical_rest_integrity_issues WHERE id=NEW.id) THEN RAISE EXCEPTION 'Rest evidence does not reconcile'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER tactical_rest_check AFTER INSERT ON tactical_rest_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_tactical_rest();
CREATE OR REPLACE FUNCTION check_tactical_pool() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM tactical_all_origins WHERE instance_id=NEW.last_instance_id AND run_id=NEW.run_id) THEN RAISE EXCEPTION 'Tactical retained pools require a managed solo or consented shared origin'; END IF;
 IF EXISTS(SELECT 1 FROM tactical_run_state s JOIN tactical_all_origins o ON o.instance_id=s.last_instance_id
   LEFT JOIN tactical_recoveries recovery ON recovery.instance_id=o.instance_id
   LEFT JOIN LATERAL (SELECT health,mana FROM tactical_rest_events WHERE run_id=s.run_id AND after_instance_id=s.last_instance_id ORDER BY id DESC LIMIT 1) rest ON true
   WHERE s.run_id=NEW.run_id AND (
     s.health IS DISTINCT FROM coalesce(rest.health,recovery.health,(o.initial_checkpoint->'state'->'units'->0->>'health')::integer)
     OR s.mana IS DISTINCT FROM coalesce(rest.mana,recovery.mana,(o.initial_checkpoint->'state'->'units'->0->>'mana')::integer)
     OR EXISTS(SELECT 1 FROM tactical_all_origins child WHERE child.previous_instance_id=s.last_instance_id))) THEN
   RAISE EXCEPTION 'Tactical retained pool does not match its latest immutable encounter/rest';
 END IF;
 RETURN NULL;
END $$;
