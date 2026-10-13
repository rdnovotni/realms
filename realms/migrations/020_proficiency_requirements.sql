-- Optional authored rank gates. NULL historical evidence means no fabricated attestations.
ALTER TABLE run_feat_choices ADD COLUMN proficiency_evidence jsonb;
ALTER TABLE equipment_events ADD COLUMN proficiency_evidence jsonb;
CREATE FUNCTION valid_proficiency_requirements(spec jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s jsonb; seen text[]:='{}';
BEGIN
 IF spec IS NULL THEN RETURN true; END IF;
 IF jsonb_typeof(spec)<>'object' OR (spec-ARRAY['version','skills'])<>'{}'::jsonb OR NOT(spec ?& ARRAY['version','skills']) OR spec->'version' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(spec->'skills')<>'array' THEN RETURN false; END IF;
 IF jsonb_array_length(spec->'skills') NOT BETWEEN 1 AND 8 THEN RETURN false; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(spec->'skills') LOOP
  IF jsonb_typeof(s)<>'object' OR (s-ARRAY['skillId','minimumRank'])<>'{}'::jsonb OR NOT(s ?& ARRAY['skillId','minimumRank'])
   OR jsonb_typeof(s->'skillId')<>'string' OR s->>'skillId' !~ '^[a-z][a-z0-9_.-]{2,119}$' OR s->>'skillId'=ANY(seen)
   OR jsonb_typeof(s->'minimumRank')<>'number' OR s->>'minimumRank' !~ '^[1-5]$' THEN RETURN false; END IF;seen:=array_append(seen,s->>'skillId');
 END LOOP;RETURN true;
END $$;
CREATE FUNCTION proficiency_requirements_met(target uuid,spec jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN
 IF NOT valid_proficiency_requirements(spec) THEN RETURN false; END IF;IF spec IS NULL THEN RETURN true; END IF;
 RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(spec->'skills') s LEFT JOIN run_skill_ranks p ON p.run_id=target AND p.skill_id=s->>'skillId' WHERE coalesce(p.rank,0)<(s->>'minimumRank')::integer);
END $$;
CREATE FUNCTION capture_proficiency_evidence(target uuid,spec jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE evidence jsonb;
BEGIN
 IF NOT proficiency_requirements_met(target,spec) THEN RAISE EXCEPTION 'Proficiency requirements are not satisfied'; END IF;
 IF spec IS NULL THEN RETURN '[]'::jsonb; END IF;
 SELECT jsonb_agg(jsonb_build_object('skillId',s->>'skillId','minimumRank',(s->>'minimumRank')::integer,'rank',p.rank,'choiceId',p.last_choice_id::text,'skillRevision',p.skill_revision) ORDER BY s->>'skillId') INTO evidence
 FROM jsonb_array_elements(spec->'skills') s JOIN run_skill_ranks p ON p.run_id=target AND p.skill_id=s->>'skillId';RETURN evidence;
END $$;
CREATE FUNCTION valid_proficiency_evidence(target uuid,spec jsonb,evidence jsonb,at_time timestamptz) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE line jsonb; expected jsonb; proof run_proficiency_choices%ROWTYPE; seen text[]:='{}'; release uuid;
BEGIN
 IF spec IS NULL THEN RETURN evidence IS NULL OR evidence='[]'::jsonb; END IF;
 IF NOT valid_proficiency_requirements(spec) OR evidence IS NULL OR jsonb_typeof(evidence)<>'array' THEN RETURN false; END IF;
 IF jsonb_array_length(evidence)<>jsonb_array_length(spec->'skills') THEN RETURN false; END IF;
 SELECT content_release_id INTO release FROM runs WHERE id=target;
 FOR line IN SELECT value FROM jsonb_array_elements(evidence) LOOP
  IF jsonb_typeof(line)<>'object' OR (line-ARRAY['skillId','minimumRank','rank','choiceId','skillRevision'])<>'{}'::jsonb OR NOT(line ?& ARRAY['skillId','minimumRank','rank','choiceId','skillRevision'])
   OR jsonb_typeof(line->'skillId')<>'string' OR line->>'skillId'=ANY(seen) OR jsonb_typeof(line->'choiceId')<>'string' OR line->>'choiceId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
  SELECT value INTO expected FROM jsonb_array_elements(spec->'skills') WHERE value->>'skillId'=line->>'skillId';IF expected IS NULL THEN RETURN false; END IF;
  SELECT * INTO proof FROM run_proficiency_choices WHERE id=(line->>'choiceId')::uuid;
  IF proof.id IS NULL OR proof.run_id<>target OR proof.release_id<>release OR proof.skill_id<>line->>'skillId' OR proof.created_at>at_time
   OR line->'minimumRank' IS DISTINCT FROM expected->'minimumRank' OR line->'rank' IS DISTINCT FROM to_jsonb(proof.after_rank)
   OR line->'skillRevision' IS DISTINCT FROM to_jsonb(proof.skill_revision) OR proof.after_rank<(expected->>'minimumRank')::integer THEN RETURN false; END IF;
  seen:=array_append(seen,line->>'skillId');
 END LOOP;RETURN true;
END $$;
CREATE FUNCTION guard_feat_proficiency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE spec jsonb;
BEGIN
 IF NEW.proficiency_evidence IS NOT NULL THEN RAISE EXCEPTION 'Proficiency evidence is server-derived'; END IF;
 SELECT definition->'mechanics'->'proficiencyRequirements' INTO spec FROM content_versions WHERE entity_id=NEW.feat_id AND revision=NEW.feat_revision;
 NEW.proficiency_evidence:=capture_proficiency_evidence(NEW.run_id,spec);RETURN NEW;
END $$;
-- The ordinary choice guard derives pins first (alphabetical BEFORE trigger order).
CREATE TRIGGER z_feat_proficiency_guard BEFORE INSERT ON run_feat_choices FOR EACH ROW EXECUTE FUNCTION guard_feat_proficiency();
CREATE FUNCTION equipment_requirement_specs(state jsonb) RETURNS TABLE(item_id uuid,spec jsonb) LANGUAGE sql STABLE AS $$
 SELECT DISTINCT i.id,v.definition->'mechanics'->'proficiencyRequirements'
 FROM jsonb_array_elements(state->'slots') s JOIN inventory_items i ON i.id=(s->>'itemId')::uuid
 JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision
 WHERE v.definition->'mechanics'->'proficiencyRequirements' IS NOT NULL;
$$;
CREATE FUNCTION guard_equipment_proficiency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item record; line jsonb;
BEGIN
 IF NEW.proficiency_evidence IS NOT NULL THEN RAISE EXCEPTION 'Proficiency evidence is server-derived'; END IF;
 PERFORM id FROM runs WHERE id=NEW.run_id FOR NO KEY UPDATE;
 IF jsonb_typeof(NEW.after_state->'slots') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid equipment state'; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(NEW.after_state->'slots') LOOP
  IF jsonb_typeof(line->'itemId') IS DISTINCT FROM 'string' OR line->>'itemId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Invalid equipment slot'; END IF;
 END LOOP;
 NEW.proficiency_evidence:='{}'::jsonb;
 FOR item IN SELECT * FROM equipment_requirement_specs(NEW.after_state) ORDER BY item_id LOOP
  NEW.proficiency_evidence:=NEW.proficiency_evidence || jsonb_build_object(item.item_id::text,capture_proficiency_evidence(NEW.run_id,item.spec));
 END LOOP;RETURN NEW;
END $$;
CREATE TRIGGER equipment_proficiency_guard BEFORE INSERT ON equipment_events FOR EACH ROW EXECUTE FUNCTION guard_equipment_proficiency();
CREATE FUNCTION valid_equipment_proficiency_evidence(target uuid,state jsonb,evidence jsonb,at_time timestamptz) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE item record; expected integer:=0;
BEGIN
 IF evidence IS NOT NULL AND jsonb_typeof(evidence)<>'object' THEN RETURN false; END IF;
 FOR item IN SELECT * FROM equipment_requirement_specs(state) LOOP
  expected:=expected+1;
  IF NOT valid_proficiency_evidence(target,item.spec,evidence->item.item_id::text,at_time) THEN RETURN false; END IF;
 END LOOP;
 RETURN (evidence IS NULL AND expected=0) OR (evidence IS NOT NULL AND (SELECT count(*) FROM jsonb_object_keys(evidence))=expected);
END $$;
CREATE VIEW proficiency_requirement_integrity_issues AS
 SELECT f.run_id FROM run_feat_choices f JOIN content_versions v ON v.entity_id=f.feat_id AND v.revision=f.feat_revision
 WHERE NOT valid_proficiency_evidence(f.run_id,v.definition->'mechanics'->'proficiencyRequirements',f.proficiency_evidence,f.created_at)
 UNION
 SELECT e.run_id FROM equipment_events e WHERE NOT valid_equipment_proficiency_evidence(e.run_id,e.after_state,e.proficiency_evidence,e.created_at)
 UNION
 SELECT es.run_id FROM equipment_slots es JOIN inventory_items i ON i.id=es.item_id JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision
 WHERE NOT proficiency_requirements_met(es.run_id,v.definition->'mechanics'->'proficiencyRequirements');
CREATE FUNCTION check_proficiency_requirements() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM proficiency_requirement_integrity_issues WHERE run_id=NEW.run_id) THEN RAISE EXCEPTION 'Proficiency prerequisite evidence is inconsistent'; END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER feat_proficiency_integrity AFTER INSERT ON run_feat_choices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_proficiency_requirements();
CREATE CONSTRAINT TRIGGER equipment_proficiency_integrity AFTER INSERT ON equipment_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_proficiency_requirements();
CREATE CONSTRAINT TRIGGER proficiency_requirement_rank_integrity AFTER INSERT OR UPDATE ON run_skill_ranks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_proficiency_requirements();
CREATE CONSTRAINT TRIGGER proficiency_requirement_slot_integrity AFTER INSERT OR UPDATE ON equipment_slots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_proficiency_requirements();
