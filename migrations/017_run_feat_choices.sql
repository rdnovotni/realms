-- Authored milestones and allocation history; feat execution and attribute growth are separate domains.
CREATE FUNCTION valid_feat_rules(spec jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE m jsonb; last_level integer:=0;
BEGIN
  IF spec IS NULL OR jsonb_typeof(spec)<>'object' OR (spec-ARRAY['version','ruleset','buildRulesId','milestones'])<>'{}'::jsonb
    OR NOT(spec ?& ARRAY['version','ruleset','buildRulesId','milestones']) OR spec->'version' IS DISTINCT FROM '1'::jsonb
    OR spec->>'ruleset' IS DISTINCT FROM 'FEAT_CHOICES_V1' OR jsonb_typeof(spec->'buildRulesId')<>'string'
    OR spec->>'buildRulesId' !~ '^[a-z][a-z0-9_.-]{2,119}$' OR jsonb_typeof(spec->'milestones')<>'array' THEN RETURN false; END IF;
  IF jsonb_array_length(spec->'milestones') NOT BETWEEN 1 AND 32 THEN RETURN false; END IF;
  FOR m IN SELECT x FROM jsonb_array_elements(spec->'milestones') x LOOP
    IF jsonb_typeof(m)<>'number' OR m#>>'{}' !~ '^[1-9][0-9]{0,2}$' THEN RETURN false; END IF;
    IF (m#>>'{}')::integer<=last_level THEN RETURN false; END IF;last_level:=(m#>>'{}')::integer;
  END LOOP;RETURN true;
END $$;
CREATE FUNCTION valid_feat(spec jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE req jsonb; c jsonb; f jsonb; seen text[]:='{}';
BEGIN
  IF spec IS NULL OR jsonb_typeof(spec)<>'object' OR (spec-ARRAY['version','rulesId','access','antiTaxReview','prerequisites'])<>'{}'::jsonb
    OR NOT(spec ?& ARRAY['version','rulesId','access','antiTaxReview','prerequisites']) OR spec->'version' IS DISTINCT FROM '1'::jsonb
    OR spec->>'access' IS DISTINCT FROM 'DISCOVERED' OR spec->>'antiTaxReview' IS DISTINCT FROM 'PASS'
    OR jsonb_typeof(spec->'rulesId')<>'string' OR spec->>'rulesId' !~ '^[a-z][a-z0-9_.-]{2,119}$' THEN RETURN false; END IF;
  req:=spec->'prerequisites';
  IF jsonb_typeof(req)<>'object' OR (req-ARRAY['classes','feats'])<>'{}'::jsonb OR NOT(req ?& ARRAY['classes','feats'])
    OR jsonb_typeof(req->'classes')<>'array' OR jsonb_typeof(req->'feats')<>'array' THEN RETURN false; END IF;
  IF jsonb_array_length(req->'classes')>2 OR jsonb_array_length(req->'feats')>8 THEN RETURN false; END IF;
  FOR c IN SELECT x FROM jsonb_array_elements(req->'classes') x LOOP
    IF jsonb_typeof(c)<>'object' OR (c-ARRAY['classId','nativeLevel'])<>'{}'::jsonb OR NOT(c ?& ARRAY['classId','nativeLevel'])
      OR jsonb_typeof(c->'classId')<>'string' OR c->>'classId' !~ '^[a-z][a-z0-9_.-]{2,119}$' OR c->>'classId'=ANY(seen)
      OR jsonb_typeof(c->'nativeLevel')<>'number' OR c->>'nativeLevel' !~ '^[1-9][0-9]{0,2}$' THEN RETURN false; END IF;
    seen:=array_append(seen,c->>'classId');
  END LOOP;seen:='{}';
  FOR f IN SELECT x FROM jsonb_array_elements(req->'feats') x LOOP
    IF jsonb_typeof(f)<>'string' OR f#>>'{}' !~ '^[a-z][a-z0-9_.-]{2,119}$' OR f#>>'{}'=ANY(seen) THEN RETURN false; END IF;
    seen:=array_append(seen,f#>>'{}');
  END LOOP;RETURN true;
END $$;
CREATE FUNCTION feat_eligible(spec jsonb,build jsonb,selected text[]) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF NOT valid_feat(spec) THEN RETURN false; END IF;
  RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(spec->'prerequisites'->'classes') req
      WHERE coalesce((SELECT (c->>'nativeLevel')::integer FROM jsonb_array_elements(build->'classes') c WHERE c->>'classId'=req->>'classId'),0)<(req->>'nativeLevel')::integer)
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(spec->'prerequisites'->'feats') f WHERE NOT(f=ANY(selected)));
END $$;
CREATE TABLE run_feat_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL REFERENCES run_progression(run_id),
  action_id uuid NOT NULL UNIQUE REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
  choice_no integer NOT NULL CHECK(choice_no BETWEEN 1 AND 32),
  feat_id text NOT NULL,feat_kind text NOT NULL DEFAULT 'ABILITY' CHECK(feat_kind='ABILITY'),feat_revision integer NOT NULL,
  rules_id text NOT NULL,rules_kind text NOT NULL DEFAULT 'TUNING' CHECK(rules_kind='TUNING'),rules_revision integer NOT NULL,
  release_id uuid NOT NULL,milestone integer NOT NULL CHECK(milestone BETWEEN 1 AND 999),
  level_at_choice integer NOT NULL CHECK(level_at_choice>=milestone),build_event_id uuid NOT NULL REFERENCES run_build_events(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,choice_no),UNIQUE(run_id,milestone),UNIQUE(run_id,feat_id),
  FOREIGN KEY(feat_id,feat_kind) REFERENCES content_entities(id,kind),FOREIGN KEY(rules_id,rules_kind) REFERENCES content_entities(id,kind),
  FOREIGN KEY(release_id,feat_id,feat_revision) REFERENCES release_entries(release_id,entity_id,revision),
  FOREIGN KEY(release_id,rules_id,rules_revision) REFERENCES release_entries(release_id,entity_id,revision)
);
CREATE INDEX feat_choices_definition ON run_feat_choices(feat_id,feat_kind);
CREATE INDEX feat_choices_rules ON run_feat_choices(rules_id,rules_kind);
CREATE INDEX feat_choices_definition_release ON run_feat_choices(release_id,feat_id,feat_revision);
CREATE INDEX feat_choices_rules_release ON run_feat_choices(release_id,rules_id,rules_revision);
CREATE INDEX feat_choices_build_event ON run_feat_choices(build_event_id);
CREATE TABLE run_feats (
  run_id uuid NOT NULL REFERENCES run_progression(run_id),feat_id text NOT NULL,feat_revision integer NOT NULL,
  milestone integer NOT NULL,choice_id uuid NOT NULL UNIQUE REFERENCES run_feat_choices(id),
  PRIMARY KEY(run_id,feat_id),UNIQUE(run_id,milestone)
);
CREATE TRIGGER immutable_feat_choice BEFORE UPDATE OR DELETE ON run_feat_choices FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER immutable_feat_projection BEFORE UPDATE OR DELETE ON run_feats FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION guard_feat_choice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r runs%ROWTYPE; b run_builds%ROWTYPE; owner uuid; spec jsonb; rules jsonb; prior_rules text; selected text[];
BEGIN
  IF NEW.choice_no IS NOT NULL OR NEW.feat_revision IS NOT NULL OR NEW.rules_id IS NOT NULL OR NEW.rules_revision IS NOT NULL
    OR NEW.release_id IS NOT NULL OR NEW.level_at_choice IS NOT NULL OR NEW.build_event_id IS NOT NULL THEN RAISE EXCEPTION 'Feat pins and eligibility are server-derived'; END IF;
  SELECT * INTO r FROM runs WHERE id=NEW.run_id FOR NO KEY UPDATE;SELECT * INTO b FROM run_builds WHERE run_id=NEW.run_id FOR SHARE;
  IF r.id IS NULL OR r.status NOT IN('ACTIVE','AFTERCORE') OR r.mode NOT IN('STANDARD','CASUAL') OR b.state->>'mode' IS DISTINCT FROM 'CONFIGURED' THEN RAISE EXCEPTION 'Feat choice requires a configured normal run'; END IF;
  IF EXISTS(SELECT 1 FROM instance_participants p JOIN instances i ON i.id=p.instance_id WHERE p.run_id=NEW.run_id AND i.lifecycle='ACTIVE') THEN RAISE EXCEPTION 'Feat choices require leaving the active instance'; END IF;
  SELECT account_id INTO owner FROM characters WHERE id=r.character_id;PERFORM 1 FROM discoveries WHERE account_id=owner AND entity_id=NEW.feat_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Feat has not been discovered'; END IF;
  NEW.release_id:=r.content_release_id;
  SELECT e.revision,v.definition->'mechanics'->'feat' INTO NEW.feat_revision,spec FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=NEW.release_id AND e.entity_id=NEW.feat_id;
  IF NOT valid_feat(spec) THEN RAISE EXCEPTION 'Feat is not authored in the pinned release'; END IF;
  NEW.rules_id:=spec->>'rulesId';
  SELECT e.revision,v.definition->'mechanics'->'featRules' INTO NEW.rules_revision,rules FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=NEW.release_id AND e.entity_id=NEW.rules_id;
  SELECT rules_id INTO prior_rules FROM run_feat_choices WHERE run_id=NEW.run_id ORDER BY choice_no LIMIT 1;
  IF NOT valid_feat_rules(rules) OR rules->>'buildRulesId' IS DISTINCT FROM b.state->'rules'->>'id' OR (prior_rules IS NOT NULL AND prior_rules<>NEW.rules_id) THEN RAISE EXCEPTION 'Feat rules do not match the committed build'; END IF;
  NEW.level_at_choice:=(b.state->>'level')::integer;
  IF NEW.milestone>NEW.level_at_choice OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(rules->'milestones') m WHERE m::integer=NEW.milestone) THEN RAISE EXCEPTION 'Feat milestone has not been earned or authored'; END IF;
  IF EXISTS(SELECT 1 FROM run_feat_choices WHERE run_id=NEW.run_id AND milestone=NEW.milestone) THEN RAISE EXCEPTION 'Feat milestone already has a choice'; END IF;
  IF EXISTS(SELECT 1 FROM run_feat_choices WHERE run_id=NEW.run_id AND feat_id=NEW.feat_id) THEN RAISE EXCEPTION 'Feat has already been selected'; END IF;
  SELECT coalesce(array_agg(feat_id),'{}'::text[]),coalesce(max(choice_no),0)+1 INTO selected,NEW.choice_no FROM run_feat_choices WHERE run_id=NEW.run_id;
  IF NOT feat_eligible(spec,b.state,selected) THEN RAISE EXCEPTION 'Feat prerequisites are not satisfied'; END IF;
  NEW.build_event_id:=b.last_event_id;RETURN NEW;
END $$;
CREATE TRIGGER feat_choice_guard BEFORE INSERT ON run_feat_choices FOR EACH ROW EXECUTE FUNCTION guard_feat_choice();
CREATE FUNCTION guard_feat_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM run_feat_choices c WHERE c.id=NEW.choice_id AND c.run_id=NEW.run_id AND c.feat_id=NEW.feat_id
    AND c.feat_revision=NEW.feat_revision AND c.milestone=NEW.milestone) THEN RAISE EXCEPTION 'Feat projection requires its immutable choice'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER feat_projection_guard BEFORE INSERT ON run_feats FOR EACH ROW EXECUTE FUNCTION guard_feat_projection();
CREATE FUNCTION apply_feat_choice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO run_feats(run_id,feat_id,feat_revision,milestone,choice_id) VALUES(NEW.run_id,NEW.feat_id,NEW.feat_revision,NEW.milestone,NEW.id);RETURN NULL;
END $$;
CREATE TRIGGER apply_feat_choice AFTER INSERT ON run_feat_choices FOR EACH ROW EXECUTE FUNCTION apply_feat_choice();
CREATE VIEW run_feat_integrity_issues AS
SELECT c.run_id FROM run_feat_choices c JOIN runs r ON r.id=c.run_id JOIN characters owner ON owner.id=r.character_id
LEFT JOIN action_receipts a ON a.action_id=c.action_id LEFT JOIN run_feats f ON f.choice_id=c.id JOIN run_build_events e ON e.id=c.build_event_id
JOIN content_versions fv ON fv.entity_id=c.feat_id AND fv.revision=c.feat_revision JOIN content_versions rv ON rv.entity_id=c.rules_id AND rv.revision=c.rules_revision
WHERE f.run_id IS DISTINCT FROM c.run_id OR f.feat_id IS DISTINCT FROM c.feat_id OR f.feat_revision IS DISTINCT FROM c.feat_revision OR f.milestone IS DISTINCT FROM c.milestone
  OR a.account_id IS DISTINCT FROM owner.account_id OR a.action_type IS DISTINCT FROM 'CHOOSE_FEAT' OR a.authorization_source IS NULL OR a.authorization_source NOT IN('MANUAL_UI','API')
  OR c.release_id IS DISTINCT FROM r.content_release_id OR e.run_id<>c.run_id OR e.release_id<>c.release_id OR e.after_state->>'mode'<>'CONFIGURED'
  OR c.level_at_choice IS DISTINCT FROM (e.after_state->>'level')::integer OR c.milestone>c.level_at_choice
  OR NOT valid_feat_rules(rv.definition->'mechanics'->'featRules') OR fv.definition->'mechanics'->'feat'->>'rulesId' IS DISTINCT FROM c.rules_id
  OR rv.definition->'mechanics'->'featRules'->>'buildRulesId' IS DISTINCT FROM e.after_state->'rules'->>'id'
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(rv.definition->'mechanics'->'featRules'->'milestones') m WHERE m::integer=c.milestone)
  OR NOT feat_eligible(fv.definition->'mechanics'->'feat',e.after_state,ARRAY(SELECT feat_id FROM run_feat_choices WHERE run_id=c.run_id AND choice_no<c.choice_no))
  OR c.choice_no IS DISTINCT FROM (SELECT count(*)+1 FROM run_feat_choices WHERE run_id=c.run_id AND choice_no<c.choice_no)::integer
  OR EXISTS(SELECT 1 FROM run_feat_choices prior WHERE prior.run_id=c.run_id AND (prior.rules_id<>c.rules_id OR prior.rules_revision<>c.rules_revision))
UNION
SELECT f.run_id FROM run_feats f LEFT JOIN run_feat_choices c ON c.id=f.choice_id WHERE c.id IS NULL OR f.run_id IS DISTINCT FROM c.run_id OR f.feat_id IS DISTINCT FROM c.feat_id OR f.feat_revision IS DISTINCT FROM c.feat_revision OR f.milestone IS DISTINCT FROM c.milestone;
CREATE FUNCTION check_run_feat() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM run_feat_integrity_issues WHERE run_id=coalesce(NEW.run_id,OLD.run_id)) THEN RAISE EXCEPTION 'Feat history and projection are inconsistent'; END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER feat_choice_consistency AFTER INSERT ON run_feat_choices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_run_feat();
CREATE CONSTRAINT TRIGGER feat_projection_consistency AFTER INSERT ON run_feats DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_run_feat();
