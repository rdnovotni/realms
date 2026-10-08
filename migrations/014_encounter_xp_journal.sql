-- Preserve historical XP as an explicit opening balance. New runs start at zero;
-- successful encounter resolutions are the only award source in this pass.
CREATE TABLE run_xp_baselines (
  run_id uuid PRIMARY KEY REFERENCES run_progression(run_id),
  xp bigint NOT NULL CHECK(xp>=0),
  origin text NOT NULL CHECK(origin IN('MIGRATION_014','NEW_RUN')),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO run_xp_baselines(run_id,xp,origin) SELECT run_id,xp,'MIGRATION_014' FROM run_progression;
CREATE TRIGGER immutable_xp_baseline BEFORE UPDATE OR DELETE ON run_xp_baselines FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION guard_xp_baseline() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.origin<>'NEW_RUN' OR NEW.xp<>0 OR NOT EXISTS(SELECT 1 FROM run_progression WHERE run_id=NEW.run_id AND xp=0) THEN
    RAISE EXCEPTION 'New run XP baseline must be zero';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER xp_baseline_shape BEFORE INSERT ON run_xp_baselines FOR EACH ROW EXECUTE FUNCTION guard_xp_baseline();
CREATE FUNCTION open_run_xp_baseline() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.xp<>0 THEN RAISE EXCEPTION 'New run XP must start at zero'; END IF;
  INSERT INTO run_xp_baselines(run_id,xp,origin) VALUES(NEW.run_id,0,'NEW_RUN');
  RETURN NULL;
END $$;
CREATE TRIGGER a_open_run_xp AFTER INSERT ON run_progression FOR EACH ROW EXECUTE FUNCTION open_run_xp_baseline();

CREATE FUNCTION valid_xp_curve(curve jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE value jsonb; amount numeric; prior numeric := -1; position integer := 0;
BEGIN
  IF curve IS NULL OR jsonb_typeof(curve)<>'object' OR (curve-ARRAY['version','thresholds'])<>'{}'::jsonb
    OR curve->'version' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(curve->'thresholds') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(curve->'thresholds') NOT BETWEEN 25 AND 999 THEN RETURN false; END IF;
  FOR value IN SELECT x FROM jsonb_array_elements(curve->'thresholds') x LOOP
    IF jsonb_typeof(value)<>'string' OR (value#>>'{}') !~ '^(0|[1-9][0-9]{0,18})$' THEN RETURN false; END IF;
    amount:=(value#>>'{}')::numeric;
    IF amount>9223372036854775807 OR amount<=prior OR (position=0 AND amount<>0) THEN RETURN false; END IF;
    prior:=amount; position:=position+1;
  END LOOP;
  RETURN true;
END $$;

CREATE TABLE encounter_xp_plans (
  instance_id uuid PRIMARY KEY REFERENCES encounter_records(instance_id),
  run_id uuid NOT NULL REFERENCES run_progression(run_id),
  release_id uuid NOT NULL,
  curve_id text NOT NULL,
  curve_kind text NOT NULL DEFAULT 'TUNING' CHECK(curve_kind='TUNING'),
  curve_revision integer NOT NULL,
  amount bigint NOT NULL CHECK(amount>0),
  commit_action_id uuid NOT NULL REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(curve_id,curve_kind) REFERENCES content_entities(id,kind),
  FOREIGN KEY(release_id,curve_id,curve_revision) REFERENCES release_entries(release_id,entity_id,revision)
);
CREATE INDEX xp_plans_by_run ON encounter_xp_plans(run_id);
CREATE INDEX xp_plans_by_action ON encounter_xp_plans(commit_action_id);
CREATE INDEX xp_plans_by_curve ON encounter_xp_plans(curve_id,curve_kind);
CREATE INDEX xp_plans_by_release ON encounter_xp_plans(release_id,curve_id,curve_revision);
CREATE TABLE run_xp_awards (
  instance_id uuid PRIMARY KEY REFERENCES encounter_xp_plans(instance_id),
  run_id uuid NOT NULL REFERENCES run_progression(run_id),
  action_id uuid NOT NULL REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
  amount bigint NOT NULL CHECK(amount>0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX xp_awards_by_run ON run_xp_awards(run_id);
CREATE INDEX xp_awards_by_action ON run_xp_awards(action_id);
CREATE TRIGGER immutable_xp_plan BEFORE UPDATE OR DELETE ON encounter_xp_plans FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER immutable_xp_award BEFORE UPDATE OR DELETE ON run_xp_awards FOR EACH ROW EXECUTE FUNCTION reject_record_change();

CREATE FUNCTION guard_encounter_xp_plan() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e encounter_records%ROWTYPE; spec jsonb; curve jsonb; p run_progression%ROWTYPE;
BEGIN
  -- Ordinary handlers already own the run lock. Also serialize direct SQL writers;
  -- NO KEY UPDATE remains compatible with foreign-key KEY SHARE locks.
  PERFORM 1 FROM runs WHERE id=NEW.run_id FOR NO KEY UPDATE;
  SELECT * INTO e FROM encounter_records WHERE instance_id=NEW.instance_id;
  SELECT definition->'mechanics'->'resolutionXP' INTO spec FROM content_versions WHERE entity_id=e.definition_id AND revision=e.definition_revision;
  SELECT definition->'mechanics'->'xpCurve' INTO curve FROM content_versions WHERE entity_id=NEW.curve_id AND revision=NEW.curve_revision;
  SELECT * INTO p FROM run_progression WHERE run_id=NEW.run_id;
  IF e.instance_id IS NULL OR e.outcome IS NOT NULL OR e.run_id<>NEW.run_id OR e.release_id<>NEW.release_id
    OR e.start_action_id<>NEW.commit_action_id OR spec IS DISTINCT FROM jsonb_build_object('version',1,'amount',NEW.amount::text,'curveId',NEW.curve_id)
    OR NOT valid_xp_curve(curve) OR p.run_id IS NULL OR p.level>jsonb_array_length(curve->'thresholds')
    OR p.xp::numeric<(curve->'thresholds'->>(p.level-1))::numeric THEN
    RAISE EXCEPTION 'Encounter XP plan does not match pinned rules or progression';
  END IF;
  IF EXISTS(SELECT 1 FROM encounter_xp_plans WHERE run_id=NEW.run_id AND (curve_id<>NEW.curve_id OR curve_revision<>NEW.curve_revision)) THEN
    RAISE EXCEPTION 'Run XP curve is already pinned';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER xp_plan_shape BEFORE INSERT ON encounter_xp_plans FOR EACH ROW EXECUTE FUNCTION guard_encounter_xp_plan();
CREATE FUNCTION commit_encounter_xp_plan() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE spec jsonb; xp_curve_revision integer;
BEGIN
  SELECT definition->'mechanics'->'resolutionXP' INTO spec FROM content_versions WHERE entity_id=NEW.definition_id AND revision=NEW.definition_revision;
  IF spec IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(spec)<>'object' OR (spec-ARRAY['version','amount','curveId'])<>'{}'::jsonb
    OR spec->'version' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(spec->'amount') IS DISTINCT FROM 'string'
    OR (spec->>'amount') !~ '^[1-9][0-9]{0,18}$' OR (spec->>'amount')::numeric>9223372036854775807
    OR jsonb_typeof(spec->'curveId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid authored resolution XP'; END IF;
  SELECT r.revision INTO xp_curve_revision FROM release_entries r WHERE r.release_id=NEW.release_id AND r.entity_id=spec->>'curveId';
  IF xp_curve_revision IS NULL THEN RAISE EXCEPTION 'XP curve is not in pinned release'; END IF;
  INSERT INTO encounter_xp_plans(instance_id,run_id,release_id,curve_id,curve_revision,amount,commit_action_id)
    VALUES(NEW.instance_id,NEW.run_id,NEW.release_id,spec->>'curveId',xp_curve_revision,(spec->>'amount')::bigint,NEW.start_action_id);
  RETURN NULL;
END $$;
CREATE TRIGGER commit_encounter_xp AFTER INSERT ON encounter_records FOR EACH ROW EXECUTE FUNCTION commit_encounter_xp_plan();

CREATE FUNCTION guard_run_xp_award() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e encounter_records%ROWTYPE; plan encounter_xp_plans%ROWTYPE;
BEGIN
  PERFORM 1 FROM runs WHERE id=NEW.run_id FOR NO KEY UPDATE;
  SELECT * INTO e FROM encounter_records WHERE instance_id=NEW.instance_id;
  SELECT * INTO plan FROM encounter_xp_plans WHERE instance_id=NEW.instance_id;
  IF plan.instance_id IS NULL OR e.outcome IS DISTINCT FROM 'VICTORY' OR e.finish_action_id IS DISTINCT FROM NEW.action_id
    OR NEW.run_id<>plan.run_id OR NEW.amount<>plan.amount THEN RAISE EXCEPTION 'XP award requires the matching successful resolution'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER xp_award_shape BEFORE INSERT ON run_xp_awards FOR EACH ROW EXECUTE FUNCTION guard_run_xp_award();
CREATE FUNCTION apply_run_xp_award() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE run_progression SET xp=xp+NEW.amount WHERE run_id=NEW.run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'XP progression is missing'; END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER apply_xp_award AFTER INSERT ON run_xp_awards FOR EACH ROW EXECUTE FUNCTION apply_run_xp_award();
CREATE FUNCTION settle_encounter_xp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.outcome IS NULL AND NEW.outcome='VICTORY' AND EXISTS(SELECT 1 FROM encounter_xp_plans WHERE instance_id=NEW.instance_id) THEN
    INSERT INTO run_xp_awards(instance_id,run_id,action_id,amount)
      SELECT instance_id,run_id,NEW.finish_action_id,amount FROM encounter_xp_plans WHERE instance_id=NEW.instance_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER settle_resolution_xp AFTER UPDATE ON encounter_records FOR EACH ROW EXECUTE FUNCTION settle_encounter_xp();

CREATE VIEW run_xp_integrity_issues AS
SELECT p.run_id FROM run_progression p LEFT JOIN run_xp_baselines b ON b.run_id=p.run_id
WHERE b.run_id IS NULL OR p.xp::numeric<>b.xp::numeric+coalesce((SELECT sum(a.amount::numeric) FROM run_xp_awards a WHERE a.run_id=p.run_id),0)
UNION
SELECT e.run_id FROM encounter_records e JOIN content_versions v ON v.entity_id=e.definition_id AND v.revision=e.definition_revision
LEFT JOIN encounter_xp_plans plan ON plan.instance_id=e.instance_id
LEFT JOIN run_xp_awards a ON a.instance_id=e.instance_id
LEFT JOIN content_versions curve ON curve.entity_id=plan.curve_id AND curve.revision=plan.curve_revision
WHERE ((v.definition->'mechanics'->'resolutionXP' IS NOT NULL)<>(plan.instance_id IS NOT NULL))
  OR (plan.instance_id IS NOT NULL AND (plan.run_id<>e.run_id OR plan.release_id<>e.release_id OR plan.commit_action_id<>e.start_action_id
    OR v.definition->'mechanics'->'resolutionXP' IS DISTINCT FROM jsonb_build_object('version',1,'amount',plan.amount::text,'curveId',plan.curve_id)
    OR NOT valid_xp_curve(curve.definition->'mechanics'->'xpCurve')
    OR (e.outcome='VICTORY' AND a.instance_id IS NULL)))
  OR (a.instance_id IS NOT NULL AND (e.outcome IS DISTINCT FROM 'VICTORY' OR a.action_id IS DISTINCT FROM e.finish_action_id OR a.run_id<>e.run_id OR a.amount<>plan.amount))
UNION
SELECT run_id FROM encounter_xp_plans GROUP BY run_id HAVING count(DISTINCT (curve_id,curve_revision))>1
UNION
SELECT p.run_id FROM run_progression p JOIN encounter_xp_plans plan ON plan.run_id=p.run_id
JOIN content_versions v ON v.entity_id=plan.curve_id AND v.revision=plan.curve_revision
WHERE p.level>jsonb_array_length(v.definition->'mechanics'->'xpCurve'->'thresholds')
  OR p.xp::numeric<(v.definition->'mechanics'->'xpCurve'->'thresholds'->>(p.level-1))::numeric;
CREATE FUNCTION check_run_xp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM run_xp_integrity_issues WHERE run_id=NEW.run_id) THEN RAISE EXCEPTION 'XP history and progression are inconsistent'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER check_xp_progression AFTER INSERT OR UPDATE ON run_progression DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_run_xp();
CREATE CONSTRAINT TRIGGER check_xp_baseline AFTER INSERT ON run_xp_baselines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_run_xp();
CREATE CONSTRAINT TRIGGER check_xp_plan AFTER INSERT ON encounter_xp_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_run_xp();
CREATE CONSTRAINT TRIGGER check_xp_award AFTER INSERT ON run_xp_awards DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_run_xp();
CREATE CONSTRAINT TRIGGER check_xp_encounter AFTER INSERT OR UPDATE ON encounter_records DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_run_xp();
