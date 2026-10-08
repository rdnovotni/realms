-- Keep immutable starting attributes in the class journal; growth is an independent overlay.
CREATE FUNCTION valid_attribute_rules(spec jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE a text; m jsonb; x jsonb; prior integer:=0;
BEGIN
  IF spec IS NULL OR jsonb_typeof(spec)<>'object' OR (spec-ARRAY['version','ruleset','buildRulesId','maximumScores','milestones'])<>'{}'::jsonb
    OR NOT(spec ?& ARRAY['version','ruleset','buildRulesId','maximumScores','milestones']) OR spec->'version' IS DISTINCT FROM '1'::jsonb
    OR spec->>'ruleset' IS DISTINCT FROM 'ATTRIBUTE_MILESTONES_V1' OR jsonb_typeof(spec->'buildRulesId')<>'string'
    OR spec->>'buildRulesId' !~ '^[a-z][a-z0-9_.-]{2,119}$' OR jsonb_typeof(spec->'maximumScores')<>'object'
    OR jsonb_typeof(spec->'milestones')<>'array' THEN RETURN false; END IF;
  IF ((spec->'maximumScores')-ARRAY['strength','dexterity','constitution','intelligence','wisdom','charisma','luck'])<>'{}'::jsonb
    OR NOT(spec->'maximumScores' ?& ARRAY['strength','dexterity','constitution','intelligence','wisdom','charisma','luck']) THEN RETURN false; END IF;
  FOREACH a IN ARRAY ARRAY['strength','dexterity','constitution','intelligence','wisdom','charisma','luck'] LOOP
    x:=spec->'maximumScores'->a;IF jsonb_typeof(x)<>'number' OR x#>>'{}' !~ '^[1-9][0-9]{0,3}$' THEN RETURN false; END IF;
  END LOOP;
  IF jsonb_array_length(spec->'milestones') NOT BETWEEN 1 AND 32 THEN RETURN false; END IF;
  FOR m IN SELECT value FROM jsonb_array_elements(spec->'milestones') LOOP
    IF jsonb_typeof(m)<>'object' OR (m-ARRAY['level','points','allowedAttributes'])<>'{}'::jsonb OR NOT(m ?& ARRAY['level','points','allowedAttributes'])
      OR jsonb_typeof(m->'level')<>'number' OR m->>'level' !~ '^[1-9][0-9]{0,2}$'
      OR jsonb_typeof(m->'points')<>'number' OR m->>'points' !~ '^[1-9][0-9]?$'
      OR jsonb_typeof(m->'allowedAttributes')<>'array' THEN RETURN false; END IF;
    IF (m->>'level')::integer<=prior OR (m->>'points')::integer>30 OR jsonb_array_length(m->'allowedAttributes') NOT BETWEEN 1 AND 7 THEN RETURN false; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(m->'allowedAttributes') z WHERE jsonb_typeof(z)<>'string' OR z#>>'{}' NOT IN('strength','dexterity','constitution','intelligence','wisdom','charisma','luck'))
      OR (SELECT count(DISTINCT z) FROM jsonb_array_elements(m->'allowedAttributes') z)<>jsonb_array_length(m->'allowedAttributes') THEN RETURN false; END IF;
    prior:=(m->>'level')::integer;
  END LOOP;RETURN true;
END $$;
CREATE FUNCTION valid_attribute_allocation(allocation jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE x jsonb;
BEGIN
  IF allocation IS NULL OR jsonb_typeof(allocation)<>'object' OR allocation='{}'::jsonb
    OR (allocation-ARRAY['strength','dexterity','constitution','intelligence','wisdom','charisma','luck'])<>'{}'::jsonb THEN RETURN false; END IF;
  FOR x IN SELECT value FROM jsonb_each(allocation) LOOP
    IF jsonb_typeof(x)<>'number' OR x#>>'{}' !~ '^[1-9][0-9]?$' THEN RETURN false; END IF;
    IF (x#>>'{}')::integer>30 THEN RETURN false; END IF;
  END LOOP;RETURN true;
END $$;
CREATE FUNCTION attribute_budget_valid(rules jsonb,milestone integer,allocation jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE m jsonb;
BEGIN
  IF NOT valid_attribute_rules(rules) OR NOT valid_attribute_allocation(allocation) THEN RETURN false; END IF;
  SELECT x INTO m FROM jsonb_array_elements(rules->'milestones') x WHERE (x->>'level')::integer=milestone;
  RETURN m IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(allocation) a WHERE NOT(m->'allowedAttributes' ? a))
    AND (SELECT sum((x#>>'{}')::integer) FROM jsonb_each(allocation) e(a,x))=(m->>'points')::integer;
END $$;
CREATE FUNCTION attribute_capacity_valid(rules jsonb,current_attributes jsonb,used integer[]) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE names text[]:=ARRAY['strength','dexterity','constitution','intelligence','wisdom','charisma','luck']; mask integer; i integer; room integer; needed integer; subset integer; m jsonb;
BEGIN
  IF NOT valid_attribute_rules(rules) THEN RETURN false; END IF;
  FOR mask IN 1..127 LOOP
    room:=0;needed:=0;
    FOR i IN 1..7 LOOP
      IF (mask & (1<<(i-1)))<>0 THEN room:=room+greatest((rules->'maximumScores'->>names[i])::integer-(current_attributes->>names[i])::integer,0); END IF;
    END LOOP;
    FOR m IN SELECT x FROM jsonb_array_elements(rules->'milestones') x WHERE NOT((x->>'level')::integer=ANY(used)) LOOP
      subset:=0;FOR i IN 1..7 LOOP IF m->'allowedAttributes' ? names[i] THEN subset:=subset | (1<<(i-1)); END IF;END LOOP;
      IF (subset & mask)=subset THEN needed:=needed+(m->>'points')::integer; END IF;
    END LOOP;
    IF needed>room THEN RETURN false; END IF;
  END LOOP;RETURN true;
END $$;
CREATE FUNCTION add_attribute_points(base jsonb,delta jsonb,factor integer DEFAULT 1) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_object_agg(a,CASE WHEN base->a='null'::jsonb THEN 'null'::jsonb ELSE to_jsonb((base->>a)::integer+factor*coalesce((delta->>a)::integer,0)) END)
  FROM unnest(ARRAY['strength','dexterity','constitution','intelligence','wisdom','charisma','luck']) a
$$;
CREATE TABLE run_attribute_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL REFERENCES run_progression(run_id),
  action_id uuid NOT NULL UNIQUE REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
  choice_no integer NOT NULL CHECK(choice_no BETWEEN 1 AND 32),
  rules_id text NOT NULL,rules_kind text NOT NULL DEFAULT 'TUNING' CHECK(rules_kind='TUNING'),rules_revision integer NOT NULL,release_id uuid NOT NULL,
  milestone integer NOT NULL CHECK(milestone BETWEEN 1 AND 999),level_at_choice integer NOT NULL CHECK(level_at_choice>=milestone),
  build_event_id uuid NOT NULL REFERENCES run_build_events(id),allocation jsonb NOT NULL CHECK(valid_attribute_allocation(allocation)),
  before_attributes jsonb NOT NULL,after_attributes jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,choice_no),UNIQUE(run_id,milestone),
  FOREIGN KEY(rules_id,rules_kind) REFERENCES content_entities(id,kind),
  FOREIGN KEY(release_id,rules_id,rules_revision) REFERENCES release_entries(release_id,entity_id,revision)
);
CREATE INDEX attribute_choices_rules ON run_attribute_choices(rules_id,rules_kind);
CREATE INDEX attribute_choices_rules_release ON run_attribute_choices(release_id,rules_id,rules_revision);
CREATE INDEX attribute_choices_build_event ON run_attribute_choices(build_event_id);
CREATE TRIGGER immutable_attribute_choice BEFORE UPDATE OR DELETE ON run_attribute_choices FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION attribute_totals(target uuid,before_choice integer DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_object_agg(a,coalesce((SELECT sum((allocation->>a)::integer) FROM run_attribute_choices WHERE run_id=target AND (before_choice IS NULL OR choice_no<before_choice)),0))
  FROM unnest(ARRAY['strength','dexterity','constitution','intelligence','wisdom','charisma','luck']) a
$$;
CREATE FUNCTION attribute_projection(target uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('strength',strength,'dexterity',dexterity,'constitution',constitution,'intelligence',intelligence,'wisdom',wisdom,'charisma',charisma,'luck',luck) FROM run_progression WHERE run_id=target
$$;
-- Existing immutable class events keep their original starting-attribute meaning.
CREATE OR REPLACE FUNCTION build_projection(target uuid,mode text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('mode',mode,'level',p.level,'attributes',add_attribute_points(attribute_projection(target),attribute_totals(target),-1),
    'classes',coalesce((SELECT jsonb_agg(jsonb_build_object('classId',class_id,'nativeLevel',native_level) ORDER BY class_id) FROM run_class_levels WHERE run_id=target),'[]'::jsonb),
    'rules',null,'presetKey',null) FROM run_progression p WHERE run_id=target
$$;
CREATE OR REPLACE FUNCTION apply_build_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attr jsonb; c jsonb;
BEGIN
  UPDATE run_builds SET state=NEW.after_state,revision=NEW.revision,last_event_id=NEW.id WHERE run_id=NEW.run_id;
  attr:=add_attribute_points(NEW.after_state->'attributes',attribute_totals(NEW.run_id));
  UPDATE run_progression SET level=(NEW.after_state->>'level')::integer,strength=(attr->>'strength')::integer,dexterity=(attr->>'dexterity')::integer,
    constitution=(attr->>'constitution')::integer,intelligence=(attr->>'intelligence')::integer,wisdom=(attr->>'wisdom')::integer,charisma=(attr->>'charisma')::integer,luck=(attr->>'luck')::integer WHERE run_id=NEW.run_id;
  FOR c IN SELECT x FROM jsonb_array_elements(NEW.after_state->'classes') x LOOP
    INSERT INTO run_class_levels(run_id,class_id,native_level) VALUES(NEW.run_id,c->>'classId',(c->>'nativeLevel')::integer)
      ON CONFLICT(run_id,class_id) DO UPDATE SET native_level=EXCLUDED.native_level;
  END LOOP;RETURN NULL;
END $$;
CREATE FUNCTION guard_attribute_choice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r runs%ROWTYPE; b run_builds%ROWTYPE; rules jsonb; prior_rules text; used integer[];
BEGIN
  IF NEW.choice_no IS NOT NULL OR NEW.rules_revision IS NOT NULL OR NEW.release_id IS NOT NULL OR NEW.level_at_choice IS NOT NULL
    OR NEW.build_event_id IS NOT NULL OR NEW.before_attributes IS NOT NULL OR NEW.after_attributes IS NOT NULL THEN RAISE EXCEPTION 'Attribute pins and outcomes are server-derived'; END IF;
  SELECT * INTO r FROM runs WHERE id=NEW.run_id FOR NO KEY UPDATE;SELECT * INTO b FROM run_builds WHERE run_id=NEW.run_id FOR SHARE;
  IF r.id IS NULL OR r.status NOT IN('ACTIVE','AFTERCORE') OR r.mode NOT IN('STANDARD','CASUAL') OR b.state->>'mode' IS DISTINCT FROM 'CONFIGURED' THEN RAISE EXCEPTION 'Attribute choice requires a configured normal run'; END IF;
  IF EXISTS(SELECT 1 FROM instance_participants p JOIN instances i ON i.id=p.instance_id WHERE p.run_id=NEW.run_id AND i.lifecycle='ACTIVE') THEN RAISE EXCEPTION 'Attribute choices require leaving the active instance'; END IF;
  NEW.release_id:=r.content_release_id;
  SELECT e.revision,v.definition->'mechanics'->'attributeRules' INTO NEW.rules_revision,rules FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=NEW.release_id AND e.entity_id=NEW.rules_id;
  SELECT rules_id INTO prior_rules FROM run_attribute_choices WHERE run_id=NEW.run_id ORDER BY choice_no LIMIT 1;
  IF NOT valid_attribute_rules(rules) OR rules->>'buildRulesId' IS DISTINCT FROM b.state->'rules'->>'id' OR (prior_rules IS NOT NULL AND prior_rules<>NEW.rules_id) THEN RAISE EXCEPTION 'Attribute rules do not match the committed build'; END IF;
  NEW.level_at_choice:=(b.state->>'level')::integer;
  IF NEW.milestone>NEW.level_at_choice OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rules->'milestones') m WHERE (m->>'level')::integer=NEW.milestone) THEN RAISE EXCEPTION 'Attribute milestone has not been earned or authored'; END IF;
  IF EXISTS(SELECT 1 FROM run_attribute_choices WHERE run_id=NEW.run_id AND milestone=NEW.milestone) THEN RAISE EXCEPTION 'Attribute milestone already has a choice'; END IF;
  IF NOT attribute_budget_valid(rules,NEW.milestone,NEW.allocation) THEN RAISE EXCEPTION 'Attribute allocation does not match its authored budget'; END IF;
  NEW.before_attributes:=attribute_projection(NEW.run_id);NEW.after_attributes:=add_attribute_points(NEW.before_attributes,NEW.allocation);
  IF EXISTS(SELECT 1 FROM jsonb_each(NEW.after_attributes) e(a,n) WHERE (n#>>'{}')::integer>(rules->'maximumScores'->>a)::integer) THEN RAISE EXCEPTION 'Attribute allocation exceeds authored caps'; END IF;
  SELECT coalesce(array_agg(milestone),'{}'::integer[]),coalesce(max(choice_no),0)+1 INTO used,NEW.choice_no FROM run_attribute_choices WHERE run_id=NEW.run_id;
  IF NOT attribute_capacity_valid(rules,NEW.after_attributes,array_append(used,NEW.milestone)) THEN RAISE EXCEPTION 'Attribute allocation blocks remaining milestone capacity'; END IF;
  NEW.build_event_id:=b.last_event_id;RETURN NEW;
END $$;
CREATE TRIGGER attribute_choice_guard BEFORE INSERT ON run_attribute_choices FOR EACH ROW EXECUTE FUNCTION guard_attribute_choice();
CREATE FUNCTION apply_attribute_choice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a jsonb:=NEW.after_attributes;
BEGIN
  UPDATE run_progression SET strength=(a->>'strength')::integer,dexterity=(a->>'dexterity')::integer,constitution=(a->>'constitution')::integer,
    intelligence=(a->>'intelligence')::integer,wisdom=(a->>'wisdom')::integer,charisma=(a->>'charisma')::integer,luck=(a->>'luck')::integer WHERE run_id=NEW.run_id;RETURN NULL;
END $$;
CREATE TRIGGER apply_attribute_choice AFTER INSERT ON run_attribute_choices FOR EACH ROW EXECUTE FUNCTION apply_attribute_choice();
CREATE VIEW run_attribute_integrity_issues AS
SELECT p.run_id FROM run_progression p JOIN run_builds b ON b.run_id=p.run_id
WHERE attribute_projection(p.run_id) IS DISTINCT FROM add_attribute_points(b.state->'attributes',attribute_totals(p.run_id))
UNION
SELECT c.run_id FROM run_attribute_choices c JOIN runs r ON r.id=c.run_id JOIN characters owner ON owner.id=r.character_id
LEFT JOIN action_receipts a ON a.action_id=c.action_id JOIN run_build_events e ON e.id=c.build_event_id
JOIN content_versions v ON v.entity_id=c.rules_id AND v.revision=c.rules_revision
WHERE a.account_id IS DISTINCT FROM owner.account_id OR a.action_type IS DISTINCT FROM 'ALLOCATE_ATTRIBUTES' OR a.authorization_source IS NULL OR a.authorization_source NOT IN('MANUAL_UI','API')
  OR c.release_id IS DISTINCT FROM r.content_release_id OR e.run_id<>c.run_id OR e.release_id<>c.release_id OR e.after_state->>'mode'<>'CONFIGURED'
  OR c.level_at_choice IS DISTINCT FROM (e.after_state->>'level')::integer OR c.milestone>c.level_at_choice
  OR v.definition->'mechanics'->'attributeRules'->>'buildRulesId' IS DISTINCT FROM e.after_state->'rules'->>'id'
  OR NOT attribute_budget_valid(v.definition->'mechanics'->'attributeRules',c.milestone,c.allocation)
  OR c.before_attributes IS DISTINCT FROM add_attribute_points(e.after_state->'attributes',attribute_totals(c.run_id,c.choice_no))
  OR c.after_attributes IS DISTINCT FROM add_attribute_points(c.before_attributes,c.allocation)
  OR EXISTS(SELECT 1 FROM jsonb_each(c.after_attributes) x(key,value) WHERE (value#>>'{}')::integer>(v.definition->'mechanics'->'attributeRules'->'maximumScores'->>key)::integer)
  OR NOT attribute_capacity_valid(v.definition->'mechanics'->'attributeRules',c.after_attributes,ARRAY(SELECT milestone FROM run_attribute_choices WHERE run_id=c.run_id AND choice_no<=c.choice_no))
  OR c.choice_no IS DISTINCT FROM (SELECT count(*)+1 FROM run_attribute_choices WHERE run_id=c.run_id AND choice_no<c.choice_no)::integer
  OR EXISTS(SELECT 1 FROM run_attribute_choices prior WHERE prior.run_id=c.run_id AND (prior.rules_id<>c.rules_id OR prior.rules_revision<>c.rules_revision));
CREATE FUNCTION check_run_attributes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM run_attribute_integrity_issues WHERE run_id=coalesce(NEW.run_id,OLD.run_id)) THEN RAISE EXCEPTION 'Attribute history and projection are inconsistent'; END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER attribute_choice_consistency AFTER INSERT ON run_attribute_choices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_run_attributes();
CREATE CONSTRAINT TRIGGER attribute_projection_consistency AFTER INSERT OR UPDATE ON run_progression DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_run_attributes();
