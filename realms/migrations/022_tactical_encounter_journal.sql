-- New tactical history only. Historical BASIC_DUEL_V1 and generic encounters stay intact.
CREATE TABLE tactical_run_state (
 run_id uuid PRIMARY KEY REFERENCES runs(id),health integer NOT NULL CHECK(health BETWEEN 1 AND 1000000),
 mana integer NOT NULL CHECK(mana BETWEEN 0 AND 1000000),last_instance_id uuid NOT NULL
);
CREATE TABLE tactical_encounter_origins (
 instance_id uuid PRIMARY KEY REFERENCES encounter_records(instance_id),run_id uuid NOT NULL REFERENCES runs(id),
 previous_instance_id uuid,
 spec jsonb NOT NULL CHECK(jsonb_typeof(spec)='object'),initial_checkpoint jsonb NOT NULL CHECK(jsonb_typeof(initial_checkpoint)='object')
);
CREATE INDEX tactical_origin_run ON tactical_encounter_origins(run_id);
ALTER TABLE tactical_encounter_origins ADD UNIQUE(instance_id,run_id);
ALTER TABLE tactical_encounter_origins ADD FOREIGN KEY(previous_instance_id,run_id) REFERENCES tactical_encounter_origins(instance_id,run_id);
CREATE UNIQUE INDEX tactical_origin_predecessor ON tactical_encounter_origins(previous_instance_id) WHERE previous_instance_id IS NOT NULL;
CREATE INDEX tactical_origin_previous_run ON tactical_encounter_origins(previous_instance_id,run_id);
CREATE UNIQUE INDEX tactical_origin_root ON tactical_encounter_origins(run_id) WHERE previous_instance_id IS NULL;
ALTER TABLE tactical_run_state ADD FOREIGN KEY(last_instance_id,run_id) REFERENCES tactical_encounter_origins(instance_id,run_id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX tactical_run_last ON tactical_run_state(last_instance_id,run_id);
CREATE TABLE tactical_steps (
 instance_id uuid NOT NULL REFERENCES tactical_encounter_origins(instance_id),revision integer NOT NULL CHECK(revision>0),
 action_id uuid NOT NULL REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
 control text NOT NULL CHECK(control IN('PLAYER','SERVER')),
 intent jsonb NOT NULL CHECK(jsonb_typeof(intent)='object'),evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'),
 state jsonb NOT NULL CHECK(jsonb_typeof(state)='object'),PRIMARY KEY(instance_id,revision)
);
CREATE INDEX tactical_step_action ON tactical_steps(action_id);
CREATE TABLE tactical_recoveries (
 instance_id uuid PRIMARY KEY REFERENCES tactical_encounter_origins(instance_id),
 action_id uuid NOT NULL REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
 health integer NOT NULL CHECK(health BETWEEN 1 AND 1000000),mana integer NOT NULL CHECK(mana BETWEEN 0 AND 1000000),
 turn_cost integer NOT NULL CHECK(turn_cost BETWEEN 0 AND 3),destination text NOT NULL CHECK(destination IN('HOME','FIELD'))
);
CREATE INDEX tactical_recovery_action ON tactical_recoveries(action_id);
CREATE TRIGGER tactical_origin_immutable BEFORE UPDATE OR DELETE ON tactical_encounter_origins FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER tactical_step_immutable BEFORE UPDATE OR DELETE ON tactical_steps FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER tactical_recovery_immutable BEFORE UPDATE OR DELETE ON tactical_recoveries FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION guard_tactical_origin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e encounter_records%ROWTYPE; authored jsonb; snapshot jsonb; prior uuid; prior_health integer; prior_mana integer;
BEGIN
 SELECT * INTO e FROM encounter_records WHERE instance_id=NEW.instance_id FOR UPDATE;
 SELECT definition->'mechanics'->'tacticalCombat' INTO authored FROM content_versions WHERE entity_id=e.definition_id AND revision=e.definition_revision;
 SELECT last_instance_id,health,mana INTO prior,prior_health,prior_mana FROM tactical_run_state WHERE run_id=NEW.run_id FOR UPDATE;
 SELECT derived->'stats' INTO snapshot FROM character_encounter_snapshots WHERE instance_id=NEW.instance_id AND run_id=NEW.run_id;
 IF NEW.previous_instance_id IS DISTINCT FROM prior OR e.run_id IS DISTINCT FROM NEW.run_id OR e.outcome IS NOT NULL OR e.revision<>1 OR authored IS NULL OR NEW.spec<>authored
   OR NEW.initial_checkpoint<>e.checkpoint OR NEW.initial_checkpoint->>'engine' IS DISTINCT FROM 'TACTICAL_TRANSITION_V1'
   OR NEW.initial_checkpoint->'rules' IS DISTINCT FROM authored->'rules'
   OR NEW.initial_checkpoint->'state'->'revision' IS DISTINCT FROM '0'::jsonb
   OR NEW.initial_checkpoint->'state'->'units'->0->>'id' IS DISTINCT FROM 'hero'
   OR NEW.initial_checkpoint->'state'->'units'->0->'stats' IS DISTINCT FROM snapshot
   OR NEW.initial_checkpoint->'state'->'units'->0->'health' IS DISTINCT FROM to_jsonb(least(coalesce(prior_health,(snapshot->>'maxHealth')::integer),(snapshot->>'maxHealth')::integer))
   OR NEW.initial_checkpoint->'state'->'units'->0->'mana' IS DISTINCT FROM to_jsonb(least(coalesce(prior_mana,(snapshot->>'maxMana')::integer),(snapshot->>'maxMana')::integer)) THEN
   RAISE EXCEPTION 'Tactical origin must pin its authored encounter and verified character snapshot';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tactical_origin_guard BEFORE INSERT ON tactical_encounter_origins FOR EACH ROW EXECUTE FUNCTION guard_tactical_origin();
CREATE FUNCTION guard_tactical_step() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e encounter_records%ROWTYPE; prior integer;
BEGIN
 SELECT * INTO e FROM encounter_records WHERE instance_id=NEW.instance_id FOR UPDATE;
 SELECT coalesce(max(revision),0) INTO prior FROM tactical_steps WHERE instance_id=NEW.instance_id;
 IF e.outcome IS NOT NULL OR NEW.revision<>prior+1 OR e.checkpoint->'state' IS DISTINCT FROM NEW.state
   OR NEW.state->'revision' IS DISTINCT FROM to_jsonb(NEW.revision) OR NEW.intent IS DISTINCT FROM NEW.evidence->'intent' THEN
   RAISE EXCEPTION 'Tactical steps must consecutively pin the saved transition';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tactical_step_guard BEFORE INSERT ON tactical_steps FOR EACH ROW EXECUTE FUNCTION guard_tactical_step();
CREATE FUNCTION guard_tactical_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.run_id<>OLD.run_id THEN RAISE EXCEPTION 'Tactical run identity cannot change'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tactical_run_guard BEFORE UPDATE OR DELETE ON tactical_run_state FOR EACH ROW EXECUTE FUNCTION guard_tactical_run();
CREATE VIEW tactical_integrity_issues AS
SELECT e.instance_id FROM encounter_records e
JOIN content_versions v ON v.entity_id=e.definition_id AND v.revision=e.definition_revision
LEFT JOIN tactical_encounter_origins o ON o.instance_id=e.instance_id
LEFT JOIN LATERAL (SELECT CASE WHEN o.instance_id IS NOT NULL AND (e.checkpoint->'state'->>'revision') ~ '^(0|[1-9][0-9]{0,5})$' THEN (e.checkpoint->'state'->>'revision')::integer ELSE NULL END AS revision) progress ON true
LEFT JOIN tactical_steps last ON last.instance_id=o.instance_id AND last.revision=progress.revision
LEFT JOIN tactical_recoveries recovery ON recovery.instance_id=o.instance_id
JOIN runs r ON r.id=e.run_id JOIN characters owner ON owner.id=r.character_id
WHERE (v.definition->'mechanics'->'tacticalCombat' IS NOT NULL AND o.instance_id IS NULL)
 OR (o.instance_id IS NOT NULL AND (
   NOT EXISTS(SELECT 1 FROM tactical_run_state pool WHERE pool.run_id=o.run_id)
   OR o.run_id<>e.run_id OR o.spec IS DISTINCT FROM v.definition->'mechanics'->'tacticalCombat'
   OR e.checkpoint-'state' IS DISTINCT FROM o.initial_checkpoint-'state'
   OR e.checkpoint->'rules' IS DISTINCT FROM o.initial_checkpoint->'rules'
   OR e.checkpoint->'controlledIds' IS DISTINCT FROM o.initial_checkpoint->'controlledIds'
   OR e.revision IS DISTINCT FROM 1+progress.revision+(CASE WHEN e.outcome IS NULL THEN 0 ELSE 1 END)
   OR coalesce(progress.revision,-1)<>(SELECT count(*) FROM tactical_steps WHERE instance_id=o.instance_id)
   OR e.checkpoint->'state' IS DISTINCT FROM coalesce(last.state,o.initial_checkpoint->'state')
   OR (e.outcome IS NULL AND (e.checkpoint->'state'->>'outcome' IS NOT NULL OR recovery.instance_id IS NOT NULL))
   OR (e.outcome IS NOT NULL AND (e.outcome IS DISTINCT FROM e.checkpoint->'state'->>'outcome' OR recovery.instance_id IS NULL OR recovery.action_id IS DISTINCT FROM e.finish_action_id))
   OR EXISTS(SELECT 1 FROM tactical_steps step LEFT JOIN action_receipts receipt ON receipt.action_id=step.action_id
      WHERE step.instance_id=o.instance_id AND receipt.account_id IS DISTINCT FROM owner.account_id)
   OR (e.outcome IS NOT NULL AND last.action_id IS DISTINCT FROM e.finish_action_id)
 ));
CREATE FUNCTION check_tactical_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM tactical_integrity_issues WHERE instance_id=NEW.instance_id) THEN RAISE EXCEPTION 'Tactical history or settlement does not reconcile'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER tactical_encounter_check AFTER INSERT OR UPDATE ON encounter_records DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_tactical_history();
CREATE CONSTRAINT TRIGGER tactical_origin_check AFTER INSERT ON tactical_encounter_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_tactical_history();
CREATE CONSTRAINT TRIGGER tactical_step_check AFTER INSERT ON tactical_steps DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_tactical_history();
CREATE CONSTRAINT TRIGGER tactical_recovery_check AFTER INSERT ON tactical_recoveries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_tactical_history();
CREATE FUNCTION check_tactical_pool() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM tactical_run_state s JOIN tactical_encounter_origins o ON o.instance_id=s.last_instance_id
   LEFT JOIN tactical_recoveries recovery ON recovery.instance_id=o.instance_id
   WHERE s.run_id=NEW.run_id AND (
     s.health IS DISTINCT FROM coalesce(recovery.health,(o.initial_checkpoint->'state'->'units'->0->>'health')::integer)
     OR s.mana IS DISTINCT FROM coalesce(recovery.mana,(o.initial_checkpoint->'state'->'units'->0->>'mana')::integer)
     OR EXISTS(SELECT 1 FROM tactical_encounter_origins child WHERE child.previous_instance_id=s.last_instance_id))) THEN
   RAISE EXCEPTION 'Tactical retained pool does not match its latest immutable encounter';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER tactical_pool_check AFTER INSERT OR UPDATE ON tactical_run_state DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_tactical_pool();
CREATE FUNCTION guard_tactical_recovery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e encounter_records%ROWTYPE; spec jsonb; hero jsonb; available integer; failure boolean; terminal text; last_action uuid; expected_health integer; expected_cost integer; expected_destination text;
BEGIN
 SELECT * INTO e FROM encounter_records WHERE instance_id=NEW.instance_id FOR UPDATE;
 SELECT o.spec INTO spec FROM tactical_encounter_origins o WHERE instance_id=NEW.instance_id;
 SELECT turns INTO available FROM runs WHERE id=e.run_id;
 SELECT action_id INTO last_action FROM tactical_steps WHERE instance_id=NEW.instance_id ORDER BY revision DESC LIMIT 1;
 hero:=e.checkpoint->'state'->'units'->0;terminal:=e.checkpoint->'state'->>'outcome';
 failure:=terminal IN('DEFEAT','FAILED_FORWARD');
 expected_health:=CASE WHEN (hero->>'health')::integer>0 THEN (hero->>'health')::integer ELSE least((hero->'stats'->>'maxHealth')::integer,(spec->'failure'->>'recoveryHealth')::integer) END;
 expected_cost:=CASE WHEN failure THEN least(available,(spec->'failure'->>'turnCost')::integer) ELSE 0 END;
 expected_destination:=CASE WHEN failure THEN 'HOME' ELSE 'FIELD' END;
 IF terminal IS NULL OR terminal NOT IN('VICTORY','DEFEAT','FAILED_FORWARD','RETREAT') OR e.outcome IS NOT NULL
   OR NEW.action_id IS DISTINCT FROM last_action
   OR NEW.health IS DISTINCT FROM expected_health
   OR NEW.mana IS DISTINCT FROM (hero->>'mana')::integer
   OR NEW.turn_cost IS DISTINCT FROM expected_cost
   OR NEW.destination IS DISTINCT FROM expected_destination THEN
   RAISE EXCEPTION 'Tactical recovery must match terminal state and disclosed costs';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tactical_recovery_guard BEFORE INSERT ON tactical_recoveries FOR EACH ROW EXECUTE FUNCTION guard_tactical_recovery();
