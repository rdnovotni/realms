-- Additive M04 reader. No content adoption or activation.
INSERT INTO feature_controls(key,taxonomy,mode,reason) VALUES('quests.journal','RELEASE','DISABLED','M04 requires reviewed quest content and separate activation');
CREATE TABLE quest_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id),run_id uuid NOT NULL REFERENCES runs(id),
 quest_id text NOT NULL,release_id uuid NOT NULL,definition_revision integer NOT NULL,
 action_id uuid NOT NULL UNIQUE REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
 kind text NOT NULL CHECK(kind IN('ACCEPT','ADVANCE','ABANDON')),before_state jsonb NOT NULL,after_state jsonb NOT NULL,
 evidence jsonb NOT NULL,rewards jsonb NOT NULL CHECK(jsonb_typeof(rewards)='array'),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(release_id,quest_id,definition_revision) REFERENCES release_entries(release_id,entity_id,revision)
);
CREATE INDEX quest_events_by_run ON quest_events(run_id,quest_id,created_at,id);
CREATE TRIGGER quest_events_immutable BEFORE UPDATE OR DELETE ON quest_events FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TABLE quest_outcome_claims (
 run_id uuid NOT NULL REFERENCES runs(id),principal_id text NOT NULL,cycle integer NOT NULL CHECK(cycle BETWEEN 1 AND 20),
 event_id uuid NOT NULL UNIQUE REFERENCES quest_events(id),PRIMARY KEY(run_id,principal_id,cycle)
);
CREATE TRIGGER quest_claims_immutable BEFORE UPDATE OR DELETE ON quest_outcome_claims FOR EACH ROW EXECUTE FUNCTION reject_record_change();
-- One finished encounter cannot fund multiple contract iterations or quest rewards.
CREATE TABLE quest_source_claims (
 run_id uuid NOT NULL REFERENCES runs(id),source_id uuid NOT NULL,source_kind text NOT NULL CHECK(source_kind IN('OBSTACLE','ENCOUNTER')),
 event_id uuid NOT NULL REFERENCES quest_events(id),PRIMARY KEY(run_id,source_kind,source_id)
);
CREATE TRIGGER quest_sources_immutable BEFORE UPDATE OR DELETE ON quest_source_claims FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TABLE journal_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES accounts(id),run_id uuid NOT NULL REFERENCES runs(id),
 scope text NOT NULL CHECK(scope IN('RUN','ACCOUNT','WORLD')),world_id uuid REFERENCES worlds(id),
 kind text NOT NULL CHECK(kind IN('HINT','RUMOR','LEAD','NOTE')),subject_id text NOT NULL,
 text text NOT NULL CHECK(length(text) BETWEEN 1 AND 1500),source text NOT NULL CHECK(length(source) BETWEEN 1 AND 200),
 credibility text NOT NULL CHECK(credibility IN('UNKNOWN','QUESTIONABLE','PLAUSIBLE','CORROBORATED','PERSONAL')),
 action_id uuid NOT NULL REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((scope='WORLD')=(world_id IS NOT NULL)),CHECK((kind='NOTE')=(credibility='PERSONAL')),
 UNIQUE(account_id,action_id,subject_id)
);
CREATE INDEX journal_by_owner ON journal_records(account_id,scope,run_id,world_id);
CREATE TRIGGER journal_records_immutable BEFORE UPDATE OR DELETE ON journal_records FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION quest_event_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM runs r JOIN characters c ON c.id=r.character_id JOIN action_receipts a ON a.action_id=NEW.action_id WHERE r.id=NEW.run_id AND c.account_id=NEW.account_id AND a.account_id=NEW.account_id AND a.action_type='QUEST_COMMAND' AND a.result->>'questEventId'=NEW.id::text AND a.result->>'questId'=NEW.quest_id AND a.result->>'lifecycle'=NEW.after_state->>'lifecycle' AND a.result->>'revision'=NEW.after_state->>'lastRevision' AND r.revision=(NEW.after_state->>'lastRevision')::integer) THEN RAISE EXCEPTION 'Quest event requires owner receipt';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER quest_event_receipt AFTER INSERT ON quest_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION quest_event_owner();
CREATE FUNCTION guard_quest_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM content_versions WHERE entity_id=NEW.quest_id AND revision=NEW.definition_revision AND definition->'mechanics' ? 'questRuntime') THEN RETURN NEW;END IF;
 IF NOT EXISTS(SELECT 1 FROM runs WHERE id=NEW.run_id AND status IN('ACTIVE','AFTERCORE')) THEN RAISE EXCEPTION 'Archived quest state is immutable';END IF;
 IF (TG_OP='INSERT' AND NEW.revision<>1) OR (TG_OP='UPDATE' AND NEW.revision<>OLD.revision+1) THEN RAISE EXCEPTION 'Quest projection revision must advance once';END IF;
 IF EXISTS(SELECT 1 FROM content_versions WHERE entity_id=NEW.quest_id AND revision=NEW.definition_revision AND definition->'mechanics' ? 'questRuntime') AND NOT EXISTS(SELECT 1 FROM quest_events e WHERE e.run_id=NEW.run_id AND e.quest_id=NEW.quest_id AND e.release_id=NEW.release_id AND e.definition_revision=NEW.definition_revision AND e.after_state=NEW.state AND e.after_state->>'nodeId'=NEW.node_id AND e.after_state->>'lifecycle'=NEW.lifecycle AND (TG_OP='INSERT' OR e.before_state=OLD.state)) THEN RAISE EXCEPTION 'Quest projection requires matching immutable decision';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER quest_projection_guard BEFORE INSERT OR UPDATE ON quest_states FOR EACH ROW EXECUTE FUNCTION guard_quest_projection();
CREATE INDEX quest_events_by_account ON quest_events(account_id);
CREATE INDEX quest_events_by_release ON quest_events(release_id,quest_id,definition_revision);
CREATE INDEX quest_sources_by_event ON quest_source_claims(event_id);
CREATE INDEX journal_by_run ON journal_records(run_id);
CREATE INDEX journal_by_world ON journal_records(world_id);

CREATE FUNCTION journal_record_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM runs r JOIN characters c ON c.id=r.character_id JOIN action_receipts a ON a.action_id=NEW.action_id WHERE r.id=NEW.run_id AND c.account_id=NEW.account_id AND a.account_id=NEW.account_id AND ((NEW.kind='NOTE' AND a.action_type='JOURNAL_NOTE' AND a.result->>'noteId'=NEW.id::text) OR (NEW.kind<>'NOTE' AND a.action_type='QUEST_COMMAND' AND EXISTS(SELECT 1 FROM quest_events e WHERE e.action_id=a.action_id AND e.run_id=NEW.run_id)))) THEN RAISE EXCEPTION 'Journal record requires owner receipt';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_owner_receipt AFTER INSERT ON journal_records DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_record_owner();
CREATE INDEX journal_by_action ON journal_records(action_id);

CREATE FUNCTION guard_quest_claim() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e quest_events; principal text;
BEGIN
 SELECT * INTO e FROM quest_events WHERE id=NEW.event_id;
 IF e.run_id IS DISTINCT FROM NEW.run_id THEN RAISE EXCEPTION 'Quest claim owner differs from evidence';END IF;
 IF TG_TABLE_NAME='quest_outcome_claims' THEN
  SELECT definition->'mechanics'->'questRuntime'->>'principalId' INTO principal FROM content_versions WHERE entity_id=e.quest_id AND revision=e.definition_revision;
  IF e.after_state->>'lifecycle' NOT IN('RESOLVED','FAILED_FORWARD') OR NEW.principal_id IS DISTINCT FROM principal OR NEW.cycle IS DISTINCT FROM (e.after_state->>'cycle')::integer THEN RAISE EXCEPTION 'Quest principal claim requires its terminal outcome';END IF;
 ELSE
  IF e.kind<>'ADVANCE' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e.evidence) value WHERE value->>'kind'=NEW.source_kind AND value->>'sourceId'=NEW.source_id::text) THEN RAISE EXCEPTION 'Quest source claim requires observed evidence';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER quest_principal_guard BEFORE INSERT ON quest_outcome_claims FOR EACH ROW EXECUTE FUNCTION guard_quest_claim();
CREATE TRIGGER quest_source_guard BEFORE INSERT ON quest_source_claims FOR EACH ROW EXECUTE FUNCTION guard_quest_claim();
