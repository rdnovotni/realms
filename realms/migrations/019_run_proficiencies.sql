-- Run-specific earned proficiency choices. No historical ranks or automatic grants.
ALTER TABLE content_entities DROP CONSTRAINT content_entities_kind_check;
ALTER TABLE content_entities ADD CONSTRAINT content_entities_kind_check CHECK(kind IN('ITEM','EFFECT','ABILITY','CLASS','SPECIES','MONSTER','NPC','ENCOUNTER','QUEST','RECIPE','LOCATION','ROUTE','FACTION','PATH','EVENT','ACTIVITY','CARD','FAMILIAR','BOSS','LOOT_TABLE','LORE','TUNING','SKILL'));
CREATE FUNCTION valid_skill(spec jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF spec IS NULL OR jsonb_typeof(spec)<>'object' OR (spec-ARRAY['version','family','defaultAttribute','maximumRank','access'])<>'{}'::jsonb
    OR NOT(spec ?& ARRAY['version','family','defaultAttribute','maximumRank','access']) OR spec->'version' IS DISTINCT FROM '1'::jsonb
    OR jsonb_typeof(spec->'family')<>'string' OR spec->>'family' NOT IN('PHYSICAL','SUBTERFUGE','KNOWLEDGE','SURVIVAL','SOCIAL','CARE','FORTUNE')
    OR jsonb_typeof(spec->'defaultAttribute')<>'string' OR spec->>'defaultAttribute' NOT IN('strength','dexterity','constitution','intelligence','wisdom','charisma','luck')
    OR jsonb_typeof(spec->'maximumRank')<>'number' OR spec->>'maximumRank' !~ '^[1-5]$' OR spec->>'access' IS DISTINCT FROM 'DISCOVERED' THEN RETURN false; END IF;
  RETURN (spec->>'defaultAttribute'='luck')=(spec->>'family'='FORTUNE');
END $$;
CREATE FUNCTION valid_proficiency_rules(spec jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE x jsonb; last_level integer:=0; seen text[]:='{}';
BEGIN
  IF spec IS NULL OR jsonb_typeof(spec)<>'object' OR (spec-ARRAY['version','ruleset','buildRulesId','skillIds','milestones'])<>'{}'::jsonb
    OR NOT(spec ?& ARRAY['version','ruleset','buildRulesId','skillIds','milestones']) OR spec->'version' IS DISTINCT FROM '1'::jsonb
    OR spec->>'ruleset' IS DISTINCT FROM 'PROFICIENCY_CHOICES_V1' OR jsonb_typeof(spec->'buildRulesId')<>'string' OR spec->>'buildRulesId' !~ '^[a-z][a-z0-9_.-]{2,119}$'
    OR jsonb_typeof(spec->'skillIds')<>'array' OR jsonb_typeof(spec->'milestones')<>'array' THEN RETURN false; END IF;
  IF jsonb_array_length(spec->'skillIds') NOT BETWEEN 1 AND 64 OR jsonb_array_length(spec->'milestones') NOT BETWEEN 1 AND 128 THEN RETURN false; END IF;
  FOR x IN SELECT v FROM jsonb_array_elements(spec->'skillIds') v LOOP
    IF jsonb_typeof(x)<>'string' OR x#>>'{}' !~ '^[a-z][a-z0-9_.-]{2,119}$' OR x#>>'{}'=ANY(seen) THEN RETURN false; END IF;seen:=array_append(seen,x#>>'{}');
  END LOOP;
  FOR x IN SELECT v FROM jsonb_array_elements(spec->'milestones') v LOOP
    IF jsonb_typeof(x)<>'number' OR x#>>'{}' !~ '^[1-9][0-9]{0,2}$' THEN RETURN false; END IF;
    IF (x#>>'{}')::integer<=last_level THEN RETURN false; END IF;last_level:=(x#>>'{}')::integer;
  END LOOP;RETURN true;
END $$;
CREATE TABLE run_proficiency_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL REFERENCES run_progression(run_id),
  action_id uuid NOT NULL UNIQUE REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
  choice_no integer NOT NULL CHECK(choice_no BETWEEN 1 AND 128),
  skill_id text NOT NULL,skill_kind text NOT NULL DEFAULT 'SKILL' CHECK(skill_kind='SKILL'),skill_revision integer NOT NULL,
  rules_id text NOT NULL,rules_kind text NOT NULL DEFAULT 'TUNING' CHECK(rules_kind='TUNING'),rules_revision integer NOT NULL,
  release_id uuid NOT NULL,milestone integer NOT NULL CHECK(milestone BETWEEN 1 AND 999),
  level_at_choice integer NOT NULL CHECK(level_at_choice>=milestone),build_event_id uuid NOT NULL REFERENCES run_build_events(id),
  before_rank integer NOT NULL CHECK(before_rank BETWEEN 0 AND 4),after_rank integer NOT NULL CHECK(after_rank=before_rank+1 AND after_rank BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(run_id,choice_no),UNIQUE(run_id,milestone),UNIQUE(run_id,skill_id,after_rank),
  FOREIGN KEY(skill_id,skill_kind) REFERENCES content_entities(id,kind),FOREIGN KEY(rules_id,rules_kind) REFERENCES content_entities(id,kind),
  FOREIGN KEY(release_id,skill_id,skill_revision) REFERENCES release_entries(release_id,entity_id,revision),
  FOREIGN KEY(release_id,rules_id,rules_revision) REFERENCES release_entries(release_id,entity_id,revision)
);
CREATE INDEX proficiency_choices_skill ON run_proficiency_choices(skill_id,skill_kind);
CREATE INDEX proficiency_choices_rules ON run_proficiency_choices(rules_id,rules_kind);
CREATE INDEX proficiency_choices_skill_release ON run_proficiency_choices(release_id,skill_id,skill_revision);
CREATE INDEX proficiency_choices_rules_release ON run_proficiency_choices(release_id,rules_id,rules_revision);
CREATE INDEX proficiency_choices_build_event ON run_proficiency_choices(build_event_id);
CREATE TABLE run_skill_ranks (
  run_id uuid NOT NULL REFERENCES run_progression(run_id),skill_id text NOT NULL,skill_revision integer NOT NULL,
  rank integer NOT NULL CHECK(rank BETWEEN 1 AND 5),last_choice_id uuid NOT NULL UNIQUE REFERENCES run_proficiency_choices(id),PRIMARY KEY(run_id,skill_id)
);
CREATE TRIGGER immutable_proficiency_choice BEFORE UPDATE OR DELETE ON run_proficiency_choices FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER immutable_skill_rank_delete BEFORE DELETE ON run_skill_ranks FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION guard_proficiency_choice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r runs%ROWTYPE; b run_builds%ROWTYPE; owner uuid; spec jsonb; rules jsonb; prior_rules text;
BEGIN
  IF NEW.choice_no IS NOT NULL OR NEW.skill_revision IS NOT NULL OR NEW.rules_revision IS NOT NULL OR NEW.release_id IS NOT NULL
    OR NEW.level_at_choice IS NOT NULL OR NEW.build_event_id IS NOT NULL OR NEW.before_rank IS NOT NULL OR NEW.after_rank IS NOT NULL THEN RAISE EXCEPTION 'Proficiency pins and ranks are server-derived'; END IF;
  SELECT * INTO r FROM runs WHERE id=NEW.run_id FOR NO KEY UPDATE;SELECT * INTO b FROM run_builds WHERE run_id=NEW.run_id FOR SHARE;
  IF r.id IS NULL OR r.status NOT IN('ACTIVE','AFTERCORE') OR r.mode NOT IN('STANDARD','CASUAL') OR b.state->>'mode' IS DISTINCT FROM 'CONFIGURED' THEN RAISE EXCEPTION 'Proficiency choice requires a configured normal run'; END IF;
  IF EXISTS(SELECT 1 FROM instance_participants p JOIN instances i ON i.id=p.instance_id WHERE p.run_id=NEW.run_id AND i.lifecycle='ACTIVE') THEN RAISE EXCEPTION 'Proficiency choices require leaving the active instance'; END IF;
  SELECT account_id INTO owner FROM characters WHERE id=r.character_id;PERFORM 1 FROM discoveries WHERE account_id=owner AND entity_id=NEW.skill_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Skill has not been discovered'; END IF;
  NEW.release_id:=r.content_release_id;
  SELECT e.revision,v.definition->'mechanics'->'proficiencyRules' INTO NEW.rules_revision,rules FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=NEW.release_id AND e.entity_id=NEW.rules_id;
  SELECT rules_id INTO prior_rules FROM run_proficiency_choices WHERE run_id=NEW.run_id ORDER BY choice_no LIMIT 1;
  IF NOT valid_proficiency_rules(rules) OR rules->>'buildRulesId' IS DISTINCT FROM b.state->'rules'->>'id' OR (prior_rules IS NOT NULL AND prior_rules<>NEW.rules_id) THEN RAISE EXCEPTION 'Proficiency rules do not match the committed build'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(rules->'skillIds') s WHERE s=NEW.skill_id) THEN RAISE EXCEPTION 'Skill is not allowed by the proficiency rules'; END IF;
  SELECT e.revision,v.definition->'mechanics'->'skill' INTO NEW.skill_revision,spec FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision JOIN content_entities ce ON ce.id=e.entity_id AND ce.kind='SKILL' WHERE e.release_id=NEW.release_id AND e.entity_id=NEW.skill_id;
  IF NOT valid_skill(spec) THEN RAISE EXCEPTION 'Skill is not authored in the pinned release'; END IF;
  NEW.level_at_choice:=(b.state->>'level')::integer;
  IF NEW.milestone>NEW.level_at_choice OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(rules->'milestones') m WHERE m::integer=NEW.milestone) THEN RAISE EXCEPTION 'Proficiency milestone has not been earned or authored'; END IF;
  IF EXISTS(SELECT 1 FROM run_proficiency_choices WHERE run_id=NEW.run_id AND milestone=NEW.milestone) THEN RAISE EXCEPTION 'Proficiency milestone already has a choice'; END IF;
  SELECT count(*)::integer INTO NEW.before_rank FROM run_proficiency_choices WHERE run_id=NEW.run_id AND skill_id=NEW.skill_id;
  NEW.after_rank:=NEW.before_rank+1;
  IF NEW.after_rank>(spec->>'maximumRank')::integer THEN RAISE EXCEPTION 'Skill has reached its authored rank cap'; END IF;
  SELECT coalesce(max(choice_no),0)+1 INTO NEW.choice_no FROM run_proficiency_choices WHERE run_id=NEW.run_id;
  NEW.build_event_id:=b.last_event_id;RETURN NEW;
END $$;
CREATE TRIGGER proficiency_choice_guard BEFORE INSERT ON run_proficiency_choices FOR EACH ROW EXECUTE FUNCTION guard_proficiency_choice();
CREATE FUNCTION guard_skill_rank() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.run_id<>OLD.run_id OR NEW.skill_id<>OLD.skill_id OR NEW.skill_revision<>OLD.skill_revision OR NEW.rank<>OLD.rank+1 OR NEW.last_choice_id=OLD.last_choice_id) THEN RAISE EXCEPTION 'Skill rank advances require the next immutable choice'; END IF;
  IF NOT EXISTS(SELECT 1 FROM run_proficiency_choices c WHERE c.id=NEW.last_choice_id AND c.run_id=NEW.run_id AND c.skill_id=NEW.skill_id AND c.skill_revision=NEW.skill_revision AND c.after_rank=NEW.rank
    AND c.before_rank=CASE WHEN TG_OP='INSERT' THEN 0 ELSE OLD.rank END) THEN RAISE EXCEPTION 'Skill rank requires its immutable choice'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER skill_rank_guard BEFORE INSERT OR UPDATE ON run_skill_ranks FOR EACH ROW EXECUTE FUNCTION guard_skill_rank();
CREATE FUNCTION apply_proficiency_choice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- UPDATE first: an INSERT guard would correctly reject a nonzero opening rank.
  UPDATE run_skill_ranks SET rank=NEW.after_rank,last_choice_id=NEW.id WHERE run_id=NEW.run_id AND skill_id=NEW.skill_id;
  IF NOT FOUND THEN INSERT INTO run_skill_ranks(run_id,skill_id,skill_revision,rank,last_choice_id) VALUES(NEW.run_id,NEW.skill_id,NEW.skill_revision,NEW.after_rank,NEW.id); END IF;RETURN NULL;
END $$;
CREATE TRIGGER apply_proficiency_choice AFTER INSERT ON run_proficiency_choices FOR EACH ROW EXECUTE FUNCTION apply_proficiency_choice();
CREATE VIEW run_proficiency_integrity_issues AS
SELECT c.run_id FROM run_proficiency_choices c JOIN runs r ON r.id=c.run_id JOIN characters owner ON owner.id=r.character_id
LEFT JOIN action_receipts a ON a.action_id=c.action_id JOIN run_build_events e ON e.id=c.build_event_id
JOIN content_versions sv ON sv.entity_id=c.skill_id AND sv.revision=c.skill_revision JOIN content_versions rv ON rv.entity_id=c.rules_id AND rv.revision=c.rules_revision
WHERE a.account_id IS DISTINCT FROM owner.account_id OR a.action_type IS DISTINCT FROM 'ADVANCE_PROFICIENCY' OR a.authorization_source IS NULL OR a.authorization_source NOT IN('MANUAL_UI','API')
  OR c.release_id IS DISTINCT FROM r.content_release_id OR e.run_id<>c.run_id OR e.release_id<>c.release_id OR e.after_state->>'mode'<>'CONFIGURED'
  OR c.level_at_choice IS DISTINCT FROM (e.after_state->>'level')::integer OR c.milestone>c.level_at_choice
  OR NOT valid_skill(sv.definition->'mechanics'->'skill') OR NOT valid_proficiency_rules(rv.definition->'mechanics'->'proficiencyRules')
  OR rv.definition->'mechanics'->'proficiencyRules'->>'buildRulesId' IS DISTINCT FROM e.after_state->'rules'->>'id'
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(rv.definition->'mechanics'->'proficiencyRules'->'skillIds') s WHERE s=c.skill_id)
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(rv.definition->'mechanics'->'proficiencyRules'->'milestones') m WHERE m::integer=c.milestone)
  OR c.after_rank>(sv.definition->'mechanics'->'skill'->>'maximumRank')::integer
  OR c.before_rank IS DISTINCT FROM (SELECT count(*) FROM run_proficiency_choices WHERE run_id=c.run_id AND skill_id=c.skill_id AND choice_no<c.choice_no)::integer
  OR c.choice_no IS DISTINCT FROM (SELECT count(*)+1 FROM run_proficiency_choices WHERE run_id=c.run_id AND choice_no<c.choice_no)::integer
  OR EXISTS(SELECT 1 FROM run_proficiency_choices prior WHERE prior.run_id=c.run_id AND (prior.rules_id<>c.rules_id OR prior.rules_revision<>c.rules_revision))
UNION
SELECT latest.run_id FROM (SELECT DISTINCT ON(run_id,skill_id) * FROM run_proficiency_choices ORDER BY run_id,skill_id,choice_no DESC) latest
LEFT JOIN run_skill_ranks p ON p.run_id=latest.run_id AND p.skill_id=latest.skill_id
WHERE p.rank IS DISTINCT FROM latest.after_rank OR p.skill_revision IS DISTINCT FROM latest.skill_revision OR p.last_choice_id IS DISTINCT FROM latest.id
UNION
SELECT p.run_id FROM run_skill_ranks p LEFT JOIN run_proficiency_choices c ON c.id=p.last_choice_id
WHERE c.id IS NULL OR p.run_id IS DISTINCT FROM c.run_id OR p.skill_id IS DISTINCT FROM c.skill_id OR p.skill_revision IS DISTINCT FROM c.skill_revision OR p.rank IS DISTINCT FROM c.after_rank;
CREATE FUNCTION check_run_proficiency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM run_proficiency_integrity_issues WHERE run_id=coalesce(NEW.run_id,OLD.run_id)) THEN RAISE EXCEPTION 'Proficiency history and projection are inconsistent'; END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER proficiency_choice_consistency AFTER INSERT ON run_proficiency_choices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_run_proficiency();
CREATE CONSTRAINT TRIGGER skill_rank_consistency AFTER INSERT OR UPDATE ON run_skill_ranks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_run_proficiency();
