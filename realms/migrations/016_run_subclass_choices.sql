-- Selection persistence only; production subclass content and feature grants remain authored work.
CREATE FUNCTION valid_subclass(spec jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_typeof(spec)='object' AND (spec-ARRAY['version','ruleset','classId','unlockNativeLevel','access'])='{}'::jsonb
    AND spec ?& ARRAY['version','ruleset','classId','unlockNativeLevel','access'] AND spec->'version'='1'::jsonb
    AND spec->>'ruleset'='SUBCLASS_CHOICE_V1' AND jsonb_typeof(spec->'classId')='string'
    AND spec->>'classId' ~ '^[a-z][a-z0-9_.-]{2,119}$' AND spec->'unlockNativeLevel'='5'::jsonb AND spec->>'access'='DISCOVERED',false)
$$;
CREATE TABLE run_subclass_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES run_progression(run_id),
  action_id uuid NOT NULL UNIQUE REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
  class_id text NOT NULL,
  class_kind text NOT NULL DEFAULT 'CLASS' CHECK(class_kind='CLASS'),
  class_revision integer NOT NULL,
  subclass_id text NOT NULL,
  subclass_kind text NOT NULL DEFAULT 'ABILITY' CHECK(subclass_kind='ABILITY'),
  subclass_revision integer NOT NULL,
  release_id uuid NOT NULL,
  native_level_at_choice integer NOT NULL CHECK(native_level_at_choice>=5),
  build_event_id uuid NOT NULL REFERENCES run_build_events(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,class_id),
  FOREIGN KEY(run_id,class_id) REFERENCES run_class_levels(run_id,class_id),
  FOREIGN KEY(class_id,class_kind) REFERENCES content_entities(id,kind),
  FOREIGN KEY(subclass_id,subclass_kind) REFERENCES content_entities(id,kind),
  FOREIGN KEY(release_id,class_id,class_revision) REFERENCES release_entries(release_id,entity_id,revision),
  FOREIGN KEY(release_id,subclass_id,subclass_revision) REFERENCES release_entries(release_id,entity_id,revision)
);
CREATE INDEX subclass_choices_class ON run_subclass_choices(class_id,class_kind);
CREATE INDEX subclass_choices_definition ON run_subclass_choices(subclass_id,subclass_kind);
CREATE INDEX subclass_choices_class_release ON run_subclass_choices(release_id,class_id,class_revision);
CREATE INDEX subclass_choices_definition_release ON run_subclass_choices(release_id,subclass_id,subclass_revision);
CREATE INDEX subclass_choices_build_event ON run_subclass_choices(build_event_id);
CREATE TABLE run_subclasses (
  run_id uuid NOT NULL,
  class_id text NOT NULL,
  subclass_id text NOT NULL,
  subclass_revision integer NOT NULL,
  choice_id uuid NOT NULL UNIQUE REFERENCES run_subclass_choices(id),
  PRIMARY KEY(run_id,class_id),
  FOREIGN KEY(run_id,class_id) REFERENCES run_class_levels(run_id,class_id)
);
CREATE TRIGGER immutable_subclass_choice BEFORE UPDATE OR DELETE ON run_subclass_choices FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER immutable_subclass_projection BEFORE UPDATE OR DELETE ON run_subclasses FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION guard_subclass_choice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r runs%ROWTYPE; b run_builds%ROWTYPE; spec jsonb; owner uuid; native integer;
BEGIN
  IF NEW.class_id IS NOT NULL OR NEW.class_revision IS NOT NULL OR NEW.subclass_revision IS NOT NULL OR NEW.release_id IS NOT NULL
    OR NEW.native_level_at_choice IS NOT NULL OR NEW.build_event_id IS NOT NULL THEN RAISE EXCEPTION 'Subclass pins and eligibility are server-derived'; END IF;
  SELECT * INTO r FROM runs WHERE id=NEW.run_id FOR NO KEY UPDATE;
  SELECT * INTO b FROM run_builds WHERE run_id=NEW.run_id FOR SHARE;
  IF r.id IS NULL OR r.status NOT IN('ACTIVE','AFTERCORE') OR r.mode NOT IN('STANDARD','CASUAL') OR b.state->>'mode' IS DISTINCT FROM 'CONFIGURED' THEN
    RAISE EXCEPTION 'Subclass choice requires a configured normal run'; END IF;
  IF EXISTS(SELECT 1 FROM instance_participants p JOIN instances i ON i.id=p.instance_id WHERE p.run_id=NEW.run_id AND i.lifecycle='ACTIVE') THEN RAISE EXCEPTION 'Subclass choices require leaving the active instance'; END IF;
  SELECT account_id INTO owner FROM characters WHERE id=r.character_id;
  PERFORM 1 FROM discoveries WHERE account_id=owner AND entity_id=NEW.subclass_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subclass has not been discovered'; END IF;
  NEW.release_id:=r.content_release_id;
  SELECT e.revision,v.definition->'mechanics'->'subclass' INTO NEW.subclass_revision,spec FROM release_entries e
    JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=NEW.release_id AND e.entity_id=NEW.subclass_id;
  IF NOT valid_subclass(spec) THEN RAISE EXCEPTION 'Subclass is not authored in the pinned release'; END IF;
  NEW.class_id:=spec->>'classId';
  SELECT native_level INTO native FROM run_class_levels WHERE run_id=NEW.run_id AND class_id=NEW.class_id FOR SHARE;
  IF native IS NULL OR native<5 THEN RAISE EXCEPTION 'Subclass requires native class level five'; END IF;
  IF EXISTS(SELECT 1 FROM run_subclass_choices WHERE run_id=NEW.run_id AND class_id=NEW.class_id) THEN RAISE EXCEPTION 'Class already has a committed subclass'; END IF;
  SELECT revision INTO NEW.class_revision FROM release_entries WHERE release_id=NEW.release_id AND entity_id=NEW.class_id;
  NEW.native_level_at_choice:=native; NEW.build_event_id:=b.last_event_id;
  RETURN NEW;
END $$;
CREATE TRIGGER subclass_choice_guard BEFORE INSERT ON run_subclass_choices FOR EACH ROW EXECUTE FUNCTION guard_subclass_choice();
CREATE FUNCTION guard_subclass_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM run_subclass_choices c WHERE c.id=NEW.choice_id AND c.run_id=NEW.run_id AND c.class_id=NEW.class_id
    AND c.subclass_id=NEW.subclass_id AND c.subclass_revision=NEW.subclass_revision) THEN RAISE EXCEPTION 'Subclass projection requires its immutable choice'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER subclass_projection_guard BEFORE INSERT ON run_subclasses FOR EACH ROW EXECUTE FUNCTION guard_subclass_projection();
CREATE FUNCTION apply_subclass_choice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO run_subclasses(run_id,class_id,subclass_id,subclass_revision,choice_id) VALUES(NEW.run_id,NEW.class_id,NEW.subclass_id,NEW.subclass_revision,NEW.id);RETURN NULL;
END $$;
CREATE TRIGGER apply_subclass_choice AFTER INSERT ON run_subclass_choices FOR EACH ROW EXECUTE FUNCTION apply_subclass_choice();
CREATE VIEW run_subclass_integrity_issues AS
SELECT c.run_id FROM run_subclass_choices c JOIN runs r ON r.id=c.run_id JOIN characters owner ON owner.id=r.character_id
LEFT JOIN run_subclasses s ON s.choice_id=c.id LEFT JOIN action_receipts a ON a.action_id=c.action_id
JOIN content_versions v ON v.entity_id=c.subclass_id AND v.revision=c.subclass_revision
JOIN run_build_events e ON e.id=c.build_event_id LEFT JOIN run_class_levels l ON l.run_id=c.run_id AND l.class_id=c.class_id
WHERE s.run_id IS DISTINCT FROM c.run_id OR s.class_id IS DISTINCT FROM c.class_id OR s.subclass_id IS DISTINCT FROM c.subclass_id OR s.subclass_revision IS DISTINCT FROM c.subclass_revision
  OR a.account_id IS DISTINCT FROM owner.account_id OR a.action_type IS DISTINCT FROM 'CHOOSE_SUBCLASS' OR a.authorization_source IS NULL OR a.authorization_source NOT IN('MANUAL_UI','API')
  OR NOT valid_subclass(v.definition->'mechanics'->'subclass') OR v.definition->'mechanics'->'subclass'->>'classId' IS DISTINCT FROM c.class_id
  OR c.release_id IS DISTINCT FROM r.content_release_id OR e.run_id<>c.run_id OR e.release_id<>c.release_id OR e.after_state->>'mode'<>'CONFIGURED'
  OR c.native_level_at_choice IS DISTINCT FROM (SELECT (x->>'nativeLevel')::integer FROM jsonb_array_elements(e.after_state->'classes') x WHERE x->>'classId'=c.class_id)
  OR l.native_level IS NULL OR l.native_level<c.native_level_at_choice
UNION
SELECT s.run_id FROM run_subclasses s LEFT JOIN run_subclass_choices c ON c.id=s.choice_id
WHERE c.id IS NULL OR s.run_id IS DISTINCT FROM c.run_id OR s.class_id IS DISTINCT FROM c.class_id OR s.subclass_id IS DISTINCT FROM c.subclass_id OR s.subclass_revision IS DISTINCT FROM c.subclass_revision;
CREATE FUNCTION check_run_subclass() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM run_subclass_integrity_issues WHERE run_id=coalesce(NEW.run_id,OLD.run_id)) THEN RAISE EXCEPTION 'Subclass history and projection are inconsistent'; END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER subclass_choice_consistency AFTER INSERT ON run_subclass_choices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_run_subclass();
CREATE CONSTRAINT TRIGGER subclass_projection_consistency AFTER INSERT ON run_subclasses DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_run_subclass();
CREATE CONSTRAINT TRIGGER subclass_class_consistency AFTER UPDATE OR DELETE ON run_class_levels DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_run_subclass();
