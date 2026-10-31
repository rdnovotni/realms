-- Installed dark. Existing run/release pins and historical migrations are unchanged.
INSERT INTO feature_controls(key,taxonomy,mode,reason) VALUES('scenes.interaction','RELEASE','DISABLED','M06 requires reviewed scene content and separate activation');
CREATE TABLE scene_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES accounts(id),run_id uuid NOT NULL REFERENCES runs(id),scene_id text NOT NULL,
 release_id uuid NOT NULL,definition_revision integer NOT NULL,action_id uuid NOT NULL UNIQUE REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
 object_id text NOT NULL,choice_id text NOT NULL,success boolean NOT NULL,before_state jsonb NOT NULL,after_state jsonb NOT NULL,result jsonb NOT NULL,
 committed_revision integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(run_id,committed_revision),
 FOREIGN KEY(release_id,scene_id,definition_revision) REFERENCES release_entries(release_id,entity_id,revision),
 FOREIGN KEY(action_id) REFERENCES shared_rules_events(action_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX scene_events_by_owner ON scene_events(account_id,run_id,scene_id,committed_revision DESC);
CREATE INDEX scene_events_by_run ON scene_events(run_id);
CREATE INDEX scene_events_by_release ON scene_events(release_id,scene_id,definition_revision);
CREATE TRIGGER scene_events_immutable BEFORE UPDATE OR DELETE ON scene_events FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TABLE scene_states (
 run_id uuid NOT NULL REFERENCES runs(id),scene_id text NOT NULL,release_id uuid NOT NULL,definition_revision integer NOT NULL,
 state jsonb NOT NULL,revision integer NOT NULL CHECK(revision>0),PRIMARY KEY(run_id,scene_id),
 FOREIGN KEY(release_id,scene_id,definition_revision) REFERENCES release_entries(release_id,entity_id,revision)
);
CREATE INDEX scene_states_by_release ON scene_states(release_id,scene_id,definition_revision);
CREATE TABLE scene_outcome_claims (
 run_id uuid NOT NULL REFERENCES runs(id),principal_id text NOT NULL,event_id uuid NOT NULL UNIQUE REFERENCES scene_events(id),PRIMARY KEY(run_id,principal_id)
);
CREATE TRIGGER scene_claims_immutable BEFORE UPDATE OR DELETE ON scene_outcome_claims FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION scene_initial(spec jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('objects',(SELECT jsonb_object_agg(o->>'id',o->'initial') FROM jsonb_array_elements(spec->'objects') o),'clues','[]'::jsonb,'used','[]'::jsonb,'outcome','null'::jsonb,'guards',coalesce((SELECT jsonb_object_agg(g->>'id',jsonb_build_object('suspicion',0,'presence','NONE','location','UNKNOWN','atObjectId',NULL,'identity','UNKNOWN','causes','[]'::jsonb)) FROM jsonb_array_elements(spec->'guards') g),'{}'::jsonb));
$$;
CREATE FUNCTION scene_reveal(state jsonb,clues jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_set(state,'{clues}',coalesce((SELECT jsonb_agg(v ORDER BY v COLLATE "C") FROM (SELECT DISTINCT value #>> '{}' v FROM jsonb_array_elements((state->'clues')||clues)) all_clues),'[]'::jsonb));
$$;
CREATE FUNCTION scene_stimulate(state jsonb,stimuli jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE stimulus jsonb; guard jsonb; causes jsonb;
BEGIN
 FOR stimulus IN SELECT value FROM jsonb_array_elements(stimuli) LOOP
  guard:=state->'guards'->(stimulus->>'guardId');
  SELECT coalesce(jsonb_agg(v ORDER BY ord),'[]'::jsonb) INTO causes FROM (SELECT value v,ordinality ord FROM jsonb_array_elements(guard->'causes'||jsonb_build_array(stimulus->>'cause')) WITH ORDINALITY ORDER BY ordinality DESC LIMIT 16) latest;
  guard:=jsonb_build_object('suspicion',greatest(0,least(3,(guard->>'suspicion')::integer+(stimulus->>'amount')::integer)),'presence',stimulus->'presence','location',stimulus->'location','atObjectId',stimulus->'atObjectId','identity',stimulus->'identity','causes',causes);
  state:=jsonb_set(state,ARRAY['guards',stimulus->>'guardId'],guard);
 END LOOP;RETURN state;
END $$;
CREATE FUNCTION guard_scene_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE spec jsonb; choice jsonb; patch jsonb; expected jsonb; prior jsonb; mutation jsonb; trap jsonb; source shared_rules_events; narration text; clue_titles jsonb;
BEGIN
 SELECT definition->'mechanics'->'scene' INTO spec FROM content_versions WHERE entity_id=NEW.scene_id AND revision=NEW.definition_revision;
 SELECT value INTO choice FROM jsonb_array_elements(spec->'actions') WHERE value->>'id'=NEW.choice_id AND value->>'objectId'=NEW.object_id;
 SELECT state INTO prior FROM scene_states WHERE run_id=NEW.run_id AND scene_id=NEW.scene_id;
 IF prior IS NULL THEN prior:=scene_initial(spec);END IF;
 IF spec->>'version'<>'1' OR choice IS NULL OR NEW.before_state IS DISTINCT FROM prior OR prior->'outcome'<>'null'::jsonb OR prior->'used' ? NEW.choice_id OR NOT(choice->'from' ? (prior->'objects'->>NEW.object_id)) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(choice->'requiresClues'||choice->'visibleAfter'||(SELECT o->'visibleAfter' FROM jsonb_array_elements(spec->'objects') o WHERE o->>'id'=NEW.object_id)) c WHERE NOT(prior->'clues' ? c)) OR EXISTS(SELECT 1 FROM jsonb_array_elements(choice->'requiresStates') r WHERE prior->'objects'->>(r->>'objectId') IS DISTINCT FROM r->>'state') OR (choice->>'maxSuspicion' IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_each(prior->'guards') g WHERE (g.value->>'suspicion')::integer>(choice->>'maxSuspicion')::integer)) THEN RAISE EXCEPTION 'Scene requires its eligible pinned object and previous state';END IF;
 patch:=CASE WHEN NEW.success THEN choice->'success' ELSE choice->'failure' END;expected:=jsonb_set(prior,'{used}',prior->'used'||jsonb_build_array(NEW.choice_id));
 FOR mutation IN SELECT value FROM jsonb_array_elements(patch->'states') LOOP expected:=jsonb_set(expected,ARRAY['objects',mutation->>'objectId'],mutation->'to');END LOOP;
 expected:=scene_reveal(expected,patch->'clues');expected:=scene_stimulate(expected,patch->'stimuli');expected:=jsonb_set(expected,'{outcome}',patch->'outcome');narration:=patch->>'text';
 FOR trap IN SELECT value FROM jsonb_array_elements(spec->'traps') LOOP
  IF trap->'triggerActions' ? NEW.choice_id AND expected->'objects'->>(trap->>'objectId')=trap->>'armedState' THEN
   expected:=jsonb_set(expected,ARRAY['objects',trap->>'objectId'],trap->'triggeredState');expected:=scene_reveal(expected,trap->'onTrigger'->'clues');expected:=scene_stimulate(expected,trap->'onTrigger'->'stimuli');narration:=narration||' '||(trap->'onTrigger'->>'text');
  END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(c->'title' ORDER BY (c->>'id') COLLATE "C"),'[]'::jsonb) INTO clue_titles FROM jsonb_array_elements(spec->'clues') WITH ORDINALITY clue(c,ordinal) WHERE expected->'clues' ? (c->>'id') AND NOT(prior->'clues' ? (c->>'id'));
 IF expected IS DISTINCT FROM NEW.after_state OR NEW.result IS DISTINCT FROM jsonb_build_object('id',NEW.scene_id,'objectId',NEW.object_id,'actionId',NEW.choice_id,'outcome',coalesce(expected->'outcome'->>'kind','IN_PROGRESS'),'route',expected->'outcome'->'id','consequence',narration,'newClues',clue_titles) THEN RAISE EXCEPTION 'Scene state and response must follow authored consequences';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scene_event_guard BEFORE INSERT ON scene_events FOR EACH ROW EXECUTE FUNCTION guard_scene_event();
CREATE FUNCTION guard_scene_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NOT EXISTS(SELECT 1 FROM runs WHERE id=NEW.run_id AND status IN('ACTIVE','AFTERCORE') AND content_release_id=NEW.release_id) OR (TG_OP='INSERT' AND NEW.revision<>1) OR (TG_OP='UPDATE' AND (NEW.run_id<>OLD.run_id OR NEW.scene_id<>OLD.scene_id OR NEW.release_id<>OLD.release_id OR NEW.definition_revision<>OLD.definition_revision OR NEW.revision<>OLD.revision+1)) OR NOT EXISTS(SELECT 1 FROM scene_events e WHERE e.run_id=NEW.run_id AND e.scene_id=NEW.scene_id AND e.release_id=NEW.release_id AND e.definition_revision=NEW.definition_revision AND e.after_state=NEW.state AND (TG_OP='INSERT' OR e.before_state=OLD.state)) THEN RAISE EXCEPTION 'Scene projection requires immutable decision evidence';END IF;RETURN NEW;
END $$;
CREATE TRIGGER scene_projection_guard BEFORE INSERT OR UPDATE OR DELETE ON scene_states FOR EACH ROW EXECUTE FUNCTION guard_scene_projection();
CREATE FUNCTION scene_receipt_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rule shared_rules_events; spec jsonb;
BEGIN
 SELECT * INTO rule FROM shared_rules_events WHERE action_id=NEW.action_id;
 SELECT definition->'mechanics'->'scene' INTO spec FROM content_versions WHERE entity_id=NEW.scene_id AND revision=NEW.definition_revision;
 IF rule.run_id IS DISTINCT FROM NEW.run_id OR rule.release_id IS DISTINCT FROM NEW.release_id OR rule.evidence->'check'->>'success' IS DISTINCT FROM NEW.success::text OR rule.evidence->'scene'->>'sceneId' IS DISTINCT FROM NEW.scene_id OR (rule.evidence->'scene'->>'sceneRevision')::integer IS DISTINCT FROM NEW.definition_revision OR rule.evidence->'scene'->>'actionId' IS DISTINCT FROM NEW.choice_id OR rule.evidence->'coordinated' IS DISTINCT FROM NEW.result||jsonb_build_object('eventId',NEW.id) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(spec->'actions') a WHERE a->>'id'=NEW.choice_id AND a->>'ruleId'=rule.entity_id) THEN RAISE EXCEPTION 'Scene outcome requires matching shared check evidence';END IF;
 IF NOT EXISTS(SELECT 1 FROM action_receipts a JOIN runs r ON r.id=NEW.run_id JOIN characters c ON c.id=r.character_id WHERE a.action_id=NEW.action_id AND a.account_id=NEW.account_id AND c.account_id=NEW.account_id AND r.status IN('ACTIVE','AFTERCORE') AND r.content_release_id=NEW.release_id AND r.revision=NEW.committed_revision AND a.action_type='SCENE_ACTION' AND a.authorization_source='MANUAL_UI' AND a.result->'scene'=NEW.result||jsonb_build_object('eventId',NEW.id) AND (a.result->>'revision')::integer=NEW.committed_revision) THEN RAISE EXCEPTION 'Scene requires explicit owner receipt';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER scene_owner_receipt AFTER INSERT ON scene_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION scene_receipt_owner();
CREATE FUNCTION guard_scene_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM scene_events e JOIN content_versions v ON v.entity_id=e.scene_id AND v.revision=e.definition_revision WHERE e.id=NEW.event_id AND e.run_id=NEW.run_id AND e.after_state->'outcome'<>'null'::jsonb AND v.definition->'mechanics'->'scene'->>'principalId'=NEW.principal_id) THEN RAISE EXCEPTION 'Scene principal requires its terminal event';END IF;RETURN NEW;
END $$;
CREATE TRIGGER scene_claim_guard BEFORE INSERT ON scene_outcome_claims FOR EACH ROW EXECUTE FUNCTION guard_scene_claim();
ALTER TABLE quest_source_claims DROP CONSTRAINT quest_source_claims_source_kind_check;
ALTER TABLE quest_source_claims ADD CONSTRAINT quest_source_claims_source_kind_check CHECK(source_kind IN('OBSTACLE','ENCOUNTER','SCENE'));
ALTER TABLE journal_records DROP CONSTRAINT journal_records_kind_check;
ALTER TABLE journal_records ADD CONSTRAINT journal_records_kind_check CHECK(kind IN('HINT','RUMOR','LEAD','NOTE','OBSERVATION','REASONING'));
CREATE OR REPLACE FUNCTION journal_record_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM runs r JOIN characters c ON c.id=r.character_id JOIN action_receipts a ON a.action_id=NEW.action_id WHERE r.id=NEW.run_id AND c.account_id=NEW.account_id AND a.account_id=NEW.account_id AND ((NEW.kind='NOTE' AND a.action_type='JOURNAL_NOTE' AND a.result->>'noteId'=NEW.id::text) OR (NEW.kind<>'NOTE' AND a.action_type='QUEST_COMMAND' AND EXISTS(SELECT 1 FROM quest_events e WHERE e.action_id=a.action_id AND e.run_id=NEW.run_id)) OR (a.action_type='SCENE_ACTION' AND NEW.scope='RUN' AND EXISTS(SELECT 1 FROM scene_events e JOIN content_versions v ON v.entity_id=e.scene_id AND v.revision=e.definition_revision CROSS JOIN LATERAL jsonb_array_elements(v.definition->'mechanics'->'scene'->'clues') clue WHERE e.action_id=a.action_id AND e.run_id=NEW.run_id AND clue->>'id'=NEW.subject_id AND clue->>'kind'=NEW.kind AND NEW.text=(clue->>'title')||': '||(clue->>'text') AND e.after_state->'clues' ? NEW.subject_id AND NOT(e.before_state->'clues' ? NEW.subject_id))))) THEN RAISE EXCEPTION 'Journal record requires owner receipt and authored source';END IF;RETURN NULL;
END $$;
