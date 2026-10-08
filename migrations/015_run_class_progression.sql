-- Unknown historical Luck remains null. Authored new-run presets supply its value.
ALTER TABLE run_progression ADD COLUMN luck integer CHECK(luck>=0);
CREATE FUNCTION build_projection(target uuid,mode text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('mode',mode,'level',p.level,'attributes',jsonb_build_object(
    'strength',p.strength,'dexterity',p.dexterity,'constitution',p.constitution,'intelligence',p.intelligence,
    'wisdom',p.wisdom,'charisma',p.charisma,'luck',p.luck),
    'classes',coalesce((SELECT jsonb_agg(jsonb_build_object('classId',class_id,'nativeLevel',native_level) ORDER BY class_id) FROM run_class_levels WHERE run_id=target),'[]'::jsonb),
    'rules',null,'presetKey',null) FROM run_progression p WHERE run_id=target
$$;
CREATE FUNCTION valid_build_rules(spec jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE preset jsonb; attr text; value jsonb; seen text[] := '{}';
BEGIN
  IF spec IS NULL OR jsonb_typeof(spec)<>'object' OR (spec-ARRAY['version','ruleset','curveId','maximumClasses','startingLuck','presets'])<>'{}'::jsonb
    OR NOT(spec ?& ARRAY['version','ruleset','curveId','maximumClasses','startingLuck','presets'])
    OR spec->'version' IS DISTINCT FROM '1'::jsonb OR spec->>'ruleset' IS DISTINCT FROM 'CLASS_LEVELS_V1'
    OR spec->'maximumClasses' IS DISTINCT FROM '2'::jsonb OR jsonb_typeof(spec->'curveId')<>'string'
    OR spec->>'curveId' !~ '^[a-z][a-z0-9_.-]{2,119}$' OR jsonb_typeof(spec->'startingLuck')<>'number'
    OR (spec->>'startingLuck') !~ '^[1-9][0-9]?$' OR (spec->>'startingLuck')::numeric>30
    OR jsonb_typeof(spec->'presets')<>'array' THEN RETURN false; END IF;
  IF jsonb_array_length(spec->'presets') NOT BETWEEN 1 AND 16 THEN RETURN false; END IF;
  FOR preset IN SELECT x FROM jsonb_array_elements(spec->'presets') x LOOP
    IF jsonb_typeof(preset)<>'object' OR (preset-ARRAY['key','attributes'])<>'{}'::jsonb OR NOT(preset ?& ARRAY['key','attributes'])
      OR jsonb_typeof(preset->'key')<>'string' OR preset->>'key' !~ '^[a-z][a-z0-9_-]{0,39}$'
      OR preset->>'key'=ANY(seen) OR jsonb_typeof(preset->'attributes')<>'object' THEN RETURN false; END IF;
    IF ((preset->'attributes')-ARRAY['strength','dexterity','constitution','intelligence','wisdom','charisma','luck'])<>'{}'::jsonb
      OR NOT(preset->'attributes' ?& ARRAY['strength','dexterity','constitution','intelligence','wisdom','charisma','luck']) THEN RETURN false; END IF;
    FOREACH attr IN ARRAY ARRAY['strength','dexterity','constitution','intelligence','wisdom','charisma','luck'] LOOP
      value:=preset->'attributes'->attr;
      IF jsonb_typeof(value)<>'number' OR (value#>>'{}') !~ '^[1-9][0-9]?$' OR (value#>>'{}')::numeric>30 THEN RETURN false; END IF;
    END LOOP;
    IF preset->'attributes'->'luck'<>spec->'startingLuck' THEN RETURN false; END IF;
    seen:=array_append(seen,preset->>'key');
  END LOOP;
  RETURN true;
END $$;
CREATE FUNCTION valid_native_class(spec jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF spec IS NULL OR jsonb_typeof(spec)<>'object' OR (spec-ARRAY['version','rulesId','access','maximumNativeLevel'])<>'{}'::jsonb
    OR NOT(spec ?& ARRAY['version','rulesId','access','maximumNativeLevel']) OR spec->'version' IS DISTINCT FROM '1'::jsonb
    OR spec->>'access' IS DISTINCT FROM 'DISCOVERED' OR jsonb_typeof(spec->'rulesId')<>'string'
    OR spec->>'rulesId' !~ '^[a-z][a-z0-9_.-]{2,119}$' OR jsonb_typeof(spec->'maximumNativeLevel')<>'number'
    OR (spec->>'maximumNativeLevel') !~ '^[1-9][0-9]{0,2}$' THEN RETURN false; END IF;
  RETURN true;
END $$;

CREATE TABLE run_builds (
  run_id uuid PRIMARY KEY REFERENCES run_progression(run_id),
  revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
  state jsonb NOT NULL,
  last_event_id uuid
);
INSERT INTO run_builds(run_id,state) SELECT run_id,build_projection(run_id,'LEGACY') FROM run_progression;
CREATE TABLE run_build_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES run_progression(run_id),
  revision integer NOT NULL CHECK(revision>0),
  action_id uuid NOT NULL UNIQUE REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
  kind text NOT NULL CHECK(kind IN('START_BUILD','LEVEL_UP')),
  class_id text NOT NULL,
  class_kind text NOT NULL DEFAULT 'CLASS' CHECK(class_kind='CLASS'),
  class_revision integer NOT NULL,
  release_id uuid NOT NULL,
  rules_id text NOT NULL,
  rules_kind text NOT NULL DEFAULT 'TUNING' CHECK(rules_kind='TUNING'),
  rules_revision integer NOT NULL,
  curve_id text NOT NULL,
  curve_kind text NOT NULL DEFAULT 'TUNING' CHECK(curve_kind='TUNING'),
  curve_revision integer NOT NULL,
  preset_key text,
  xp_at_choice bigint NOT NULL CHECK(xp_at_choice>=0),
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,revision),
  FOREIGN KEY(class_id,class_kind) REFERENCES content_entities(id,kind),
  FOREIGN KEY(rules_id,rules_kind) REFERENCES content_entities(id,kind),
  FOREIGN KEY(curve_id,curve_kind) REFERENCES content_entities(id,kind),
  FOREIGN KEY(release_id,class_id,class_revision) REFERENCES release_entries(release_id,entity_id,revision),
  FOREIGN KEY(release_id,rules_id,rules_revision) REFERENCES release_entries(release_id,entity_id,revision),
  FOREIGN KEY(release_id,curve_id,curve_revision) REFERENCES release_entries(release_id,entity_id,revision)
);
CREATE INDEX build_events_by_class ON run_build_events(class_id,class_kind);
CREATE INDEX build_events_by_rules ON run_build_events(rules_id,rules_kind);
CREATE INDEX build_events_by_curve ON run_build_events(curve_id,curve_kind);
CREATE INDEX build_events_class_release ON run_build_events(release_id,class_id,class_revision);
CREATE INDEX build_events_rules_release ON run_build_events(release_id,rules_id,rules_revision);
CREATE INDEX build_events_curve_release ON run_build_events(release_id,curve_id,curve_revision);
ALTER TABLE run_builds ADD FOREIGN KEY(last_event_id) REFERENCES run_build_events(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX builds_by_event ON run_builds(last_event_id);
CREATE TRIGGER immutable_build_event BEFORE UPDATE OR DELETE ON run_build_events FOR EACH ROW EXECUTE FUNCTION reject_record_change();

CREATE FUNCTION next_build_state(before_state jsonb,event_kind text,chosen_class text,preset_key text,native jsonb,rules jsonb,rule_ref jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE classes jsonb; attrs jsonb; native_level integer; level integer; result jsonb;
BEGIN
  IF NOT valid_native_class(native) OR NOT valid_build_rules(rules) OR native->>'rulesId' IS DISTINCT FROM rule_ref->>'id' THEN RAISE EXCEPTION 'Invalid authored class progression rules'; END IF;
  IF event_kind='START_BUILD' THEN
    IF before_state->>'mode'<>'UNCONFIGURED' OR before_state->>'level'<>'1' OR before_state->'classes'<>'[]'::jsonb THEN RAISE EXCEPTION 'Build setup requires a fresh unconfigured run'; END IF;
    SELECT p->'attributes' INTO attrs FROM jsonb_array_elements(rules->'presets') p WHERE p->>'key'=preset_key;
    IF attrs IS NULL THEN RAISE EXCEPTION 'Unknown starting attribute preset'; END IF;
    classes:='[]'; level:=1;
  ELSIF event_kind='LEVEL_UP' THEN
    IF before_state->>'mode'<>'CONFIGURED' OR before_state->'rules' IS DISTINCT FROM rule_ref OR preset_key IS NOT NULL THEN RAISE EXCEPTION 'Level choice requires the current configured build rules'; END IF;
    classes:=before_state->'classes';attrs:=before_state->'attributes';level:=(before_state->>'level')::integer+1;
  ELSE RAISE EXCEPTION 'Unsupported build choice'; END IF;
  SELECT (c->>'nativeLevel')::integer INTO native_level FROM jsonb_array_elements(classes) c WHERE c->>'classId'=chosen_class;
  IF native_level IS NULL AND jsonb_array_length(classes)>=(rules->>'maximumClasses')::integer THEN RAISE EXCEPTION 'Normal class limit reached'; END IF;
  IF coalesce(native_level,0)+1>(native->>'maximumNativeLevel')::integer THEN RAISE EXCEPTION 'Authored native class level limit reached'; END IF;
  SELECT jsonb_agg(c ORDER BY c->>'classId') INTO result FROM (
    SELECT CASE WHEN c->>'classId'=chosen_class THEN jsonb_set(c,'{nativeLevel}',to_jsonb(native_level+1)) ELSE c END AS c FROM jsonb_array_elements(classes) c
    UNION ALL SELECT jsonb_build_object('classId',chosen_class,'nativeLevel',1) WHERE native_level IS NULL
  ) choices;
  RETURN jsonb_build_object('mode','CONFIGURED','level',level,'attributes',attrs,'classes',result,'rules',rule_ref,
    'presetKey',CASE WHEN event_kind='START_BUILD' THEN preset_key ELSE before_state->>'presetKey' END);
END $$;

CREATE FUNCTION guard_build_header() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e run_build_events%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Build history cannot be deleted'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.revision<>0 OR NEW.last_event_id IS NOT NULL OR NEW.state IS DISTINCT FROM build_projection(NEW.run_id,'UNCONFIGURED')
      OR NEW.state->>'level'<>'1' OR NEW.state->'classes'<>'[]'::jsonb OR NEW.state->'attributes' IS DISTINCT FROM
        '{"strength":10,"dexterity":10,"constitution":10,"intelligence":10,"wisdom":10,"charisma":10,"luck":null}'::jsonb THEN
      RAISE EXCEPTION 'New run build must be unconfigured';
    END IF;
  ELSE
    SELECT * INTO e FROM run_build_events WHERE id=NEW.last_event_id;
    IF NEW.run_id<>OLD.run_id OR e.run_id IS DISTINCT FROM OLD.run_id OR e.revision IS DISTINCT FROM OLD.revision+1
      OR NEW.revision<>e.revision OR e.before_state IS DISTINCT FROM OLD.state OR e.after_state IS DISTINCT FROM NEW.state THEN
      RAISE EXCEPTION 'Build projection does not match next immutable event'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER build_header_guard BEFORE INSERT OR UPDATE OR DELETE ON run_builds FOR EACH ROW EXECUTE FUNCTION guard_build_header();
CREATE FUNCTION open_run_build() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO run_builds(run_id,state) VALUES(NEW.run_id,build_projection(NEW.run_id,'UNCONFIGURED')); RETURN NULL;
END $$;
CREATE TRIGGER a_open_run_build AFTER INSERT ON run_progression FOR EACH ROW EXECUTE FUNCTION open_run_build();

CREATE FUNCTION guard_build_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r runs%ROWTYPE; b run_builds%ROWTYPE; p run_progression%ROWTYPE; native jsonb; rules jsonb; curve jsonb; rule_ref jsonb; owner uuid;
BEGIN
  IF NEW.revision IS NOT NULL OR NEW.class_revision IS NOT NULL OR NEW.release_id IS NOT NULL OR NEW.rules_id IS NOT NULL OR NEW.rules_revision IS NOT NULL
    OR NEW.curve_id IS NOT NULL OR NEW.curve_revision IS NOT NULL OR NEW.xp_at_choice IS NOT NULL OR NEW.before_state IS NOT NULL OR NEW.after_state IS NOT NULL THEN
    RAISE EXCEPTION 'Build event snapshots and pins are derived from server rules'; END IF;
  SELECT * INTO r FROM runs WHERE id=NEW.run_id FOR NO KEY UPDATE;
  SELECT * INTO b FROM run_builds WHERE run_id=NEW.run_id FOR UPDATE;
  SELECT * INTO p FROM run_progression WHERE run_id=NEW.run_id;
  IF r.id IS NULL OR b.run_id IS NULL OR r.status NOT IN('ACTIVE','AFTERCORE') OR r.mode NOT IN('STANDARD','CASUAL') THEN RAISE EXCEPTION 'Run does not support normal class progression'; END IF;
  IF EXISTS(SELECT 1 FROM instance_participants ip JOIN instances i ON i.id=ip.instance_id WHERE ip.run_id=NEW.run_id AND i.lifecycle='ACTIVE') THEN RAISE EXCEPTION 'Build choices require leaving the active instance'; END IF;
  IF NEW.kind='START_BUILD' AND (p.xp<>0 OR EXISTS(SELECT 1 FROM encounter_records WHERE run_id=NEW.run_id)) THEN RAISE EXCEPTION 'Starting build must precede encounter progression'; END IF;
  SELECT account_id INTO owner FROM characters WHERE id=r.character_id;
  PERFORM 1 FROM discoveries WHERE account_id=owner AND entity_id=NEW.class_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Class has not been discovered'; END IF;
  NEW.release_id:=r.content_release_id;
  SELECT e.revision,v.definition->'mechanics'->'classProgression' INTO NEW.class_revision,native FROM release_entries e
    JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=NEW.release_id AND e.entity_id=NEW.class_id;
  IF NOT valid_native_class(native) THEN RAISE EXCEPTION 'Class is not authored in the pinned release'; END IF;
  NEW.rules_id:=native->>'rulesId';
  SELECT e.revision,v.definition->'mechanics'->'buildRules' INTO NEW.rules_revision,rules FROM release_entries e
    JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=NEW.release_id AND e.entity_id=NEW.rules_id;
  IF NOT valid_build_rules(rules) THEN RAISE EXCEPTION 'Starting rules are not authored in the pinned release'; END IF;
  NEW.curve_id:=rules->>'curveId';
  SELECT e.revision,v.definition->'mechanics'->'xpCurve' INTO NEW.curve_revision,curve FROM release_entries e
    JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=NEW.release_id AND e.entity_id=NEW.curve_id;
  IF NOT valid_xp_curve(curve) THEN RAISE EXCEPTION 'Build XP curve is not authored in the pinned release'; END IF;
  rule_ref:=jsonb_build_object('id',NEW.rules_id,'revision',NEW.rules_revision,'curveId',NEW.curve_id,'curveRevision',NEW.curve_revision,'releaseId',NEW.release_id::text);
  NEW.before_state:=b.state;
  NEW.after_state:=next_build_state(b.state,NEW.kind,NEW.class_id,NEW.preset_key,native,rules,rule_ref);
  IF (NEW.after_state->>'level')::integer>jsonb_array_length(curve->'thresholds') OR p.xp::numeric<(curve->'thresholds'->>((NEW.after_state->>'level')::integer-1))::numeric THEN RAISE EXCEPTION 'Next character level has not been earned'; END IF;
  IF EXISTS(SELECT 1 FROM encounter_xp_plans WHERE run_id=NEW.run_id AND (curve_id<>NEW.curve_id OR curve_revision<>NEW.curve_revision)) THEN RAISE EXCEPTION 'Build and encounter XP curves differ'; END IF;
  NEW.revision:=b.revision+1;NEW.xp_at_choice:=p.xp;
  RETURN NEW;
END $$;
CREATE TRIGGER build_event_guard BEFORE INSERT ON run_build_events FOR EACH ROW EXECUTE FUNCTION guard_build_event();
CREATE FUNCTION apply_build_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attr jsonb; c jsonb;
BEGIN
  UPDATE run_builds SET state=NEW.after_state,revision=NEW.revision,last_event_id=NEW.id WHERE run_id=NEW.run_id;
  attr:=NEW.after_state->'attributes';
  UPDATE run_progression SET level=(NEW.after_state->>'level')::integer,strength=(attr->>'strength')::integer,dexterity=(attr->>'dexterity')::integer,
    constitution=(attr->>'constitution')::integer,intelligence=(attr->>'intelligence')::integer,wisdom=(attr->>'wisdom')::integer,charisma=(attr->>'charisma')::integer,luck=(attr->>'luck')::integer WHERE run_id=NEW.run_id;
  FOR c IN SELECT x FROM jsonb_array_elements(NEW.after_state->'classes') x LOOP
    INSERT INTO run_class_levels(run_id,class_id,native_level) VALUES(NEW.run_id,c->>'classId',(c->>'nativeLevel')::integer)
      ON CONFLICT(run_id,class_id) DO UPDATE SET native_level=EXCLUDED.native_level;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER apply_build_choice AFTER INSERT ON run_build_events FOR EACH ROW EXECUTE FUNCTION apply_build_event();

CREATE VIEW run_build_integrity_issues AS
SELECT p.run_id FROM run_progression p LEFT JOIN run_builds b ON b.run_id=p.run_id
LEFT JOIN run_build_events e ON e.id=b.last_event_id
WHERE b.run_id IS NULL OR (build_projection(p.run_id,b.state->>'mode')-ARRAY['rules','presetKey']) IS DISTINCT FROM (b.state-ARRAY['rules','presetKey'])
  OR (b.revision=0 AND (b.last_event_id IS NOT NULL OR b.state->>'mode' NOT IN('LEGACY','UNCONFIGURED')))
  OR (b.revision>0 AND (e.id IS NULL OR e.run_id<>p.run_id OR e.revision<>b.revision OR e.after_state<>b.state OR b.state->>'mode'<>'CONFIGURED'))
  OR b.revision IS DISTINCT FROM coalesce((SELECT max(revision) FROM run_build_events WHERE run_id=p.run_id),0)
  OR (b.state->>'mode'='CONFIGURED' AND (SELECT sum(native_level) FROM run_class_levels WHERE run_id=p.run_id) IS DISTINCT FROM p.level::bigint)
UNION
SELECT e.run_id FROM run_build_events e JOIN runs r ON r.id=e.run_id JOIN characters c ON c.id=r.character_id
LEFT JOIN action_receipts a ON a.action_id=e.action_id
LEFT JOIN run_build_events prior ON prior.run_id=e.run_id AND prior.revision=e.revision-1
JOIN content_versions nv ON nv.entity_id=e.class_id AND nv.revision=e.class_revision
JOIN content_versions rv ON rv.entity_id=e.rules_id AND rv.revision=e.rules_revision
JOIN content_versions cv ON cv.entity_id=e.curve_id AND cv.revision=e.curve_revision
WHERE a.account_id IS DISTINCT FROM c.account_id OR a.action_type IS DISTINCT FROM e.kind OR a.authorization_source NOT IN('MANUAL_UI','API')
  OR e.release_id IS DISTINCT FROM r.content_release_id OR nv.definition->'mechanics'->'classProgression'->>'rulesId' IS DISTINCT FROM e.rules_id
  OR rv.definition->'mechanics'->'buildRules'->>'curveId' IS DISTINCT FROM e.curve_id
  OR (e.revision=1 AND (e.kind<>'START_BUILD' OR e.before_state->>'mode'<>'UNCONFIGURED'))
  OR (e.revision>1 AND (e.kind<>'LEVEL_UP' OR prior.id IS NULL OR prior.after_state<>e.before_state))
  OR e.after_state IS DISTINCT FROM next_build_state(e.before_state,e.kind,e.class_id,e.preset_key,nv.definition->'mechanics'->'classProgression',rv.definition->'mechanics'->'buildRules',
    jsonb_build_object('id',e.rules_id,'revision',e.rules_revision,'curveId',e.curve_id,'curveRevision',e.curve_revision,'releaseId',e.release_id::text))
  OR e.xp_at_choice::numeric<(cv.definition->'mechanics'->'xpCurve'->'thresholds'->>((e.after_state->>'level')::integer-1))::numeric;
CREATE FUNCTION check_run_build() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM run_build_integrity_issues WHERE run_id=coalesce(NEW.run_id,OLD.run_id)) THEN RAISE EXCEPTION 'Run build history and projections are inconsistent'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER build_progression_consistency AFTER INSERT OR UPDATE ON run_progression DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_run_build();
CREATE CONSTRAINT TRIGGER build_class_consistency AFTER INSERT OR UPDATE OR DELETE ON run_class_levels DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_run_build();
CREATE CONSTRAINT TRIGGER build_header_consistency AFTER INSERT OR UPDATE ON run_builds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_run_build();
CREATE CONSTRAINT TRIGGER build_event_consistency AFTER INSERT ON run_build_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_run_build();
CREATE FUNCTION check_build_xp_curve() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b jsonb;
BEGIN
  PERFORM 1 FROM runs WHERE id=NEW.run_id FOR NO KEY UPDATE;
  SELECT state INTO b FROM run_builds WHERE run_id=NEW.run_id;
  IF b->>'mode'='CONFIGURED' AND (b->'rules'->>'curveId'<>NEW.curve_id OR (b->'rules'->>'curveRevision')::integer<>NEW.curve_revision) THEN
    RAISE EXCEPTION 'Build and encounter XP curves differ'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER build_xp_curve_guard BEFORE INSERT ON encounter_xp_plans FOR EACH ROW EXECUTE FUNCTION check_build_xp_curve();
