-- Opted-in shared services preserve historical combat/content snapshots.
CREATE TABLE feature_controls (
 key text PRIMARY KEY CHECK(key ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,119}$'),
 taxonomy text NOT NULL CHECK(taxonomy IN('RELEASE','CONTENT','SAFETY','EXPERIMENT','ELIGIBILITY','CHALLENGE')),
 mode text NOT NULL CHECK(mode IN('ENABLED','DISABLED','DRAIN')),
 cohort_percent integer NOT NULL DEFAULT 100 CHECK(cohort_percent BETWEEN 0 AND 100),
 revision bigint NOT NULL DEFAULT 1, reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500)
);
CREATE TABLE feature_control_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,key text NOT NULL,
 operator text NOT NULL, before_state jsonb, after_state jsonb NOT NULL, changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION audit_feature_control() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.key<>OLD.key OR NEW.taxonomy<>OLD.taxonomy) THEN RAISE EXCEPTION 'Flag identity is immutable'; END IF;
 IF NEW.cohort_percent<>100 AND NEW.taxonomy NOT IN('RELEASE','EXPERIMENT') THEN RAISE EXCEPTION 'Safety and eligibility flags cannot use cohorts'; END IF;
 NEW.revision:=CASE WHEN TG_OP='UPDATE' THEN OLD.revision+1 ELSE 1 END;
 INSERT INTO feature_control_events(key,operator,before_state,after_state) VALUES(NEW.key,current_user,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));RETURN NEW;
END $$;
CREATE TRIGGER feature_control_audit BEFORE INSERT OR UPDATE ON feature_controls FOR EACH ROW EXECUTE FUNCTION audit_feature_control();
CREATE TRIGGER feature_control_no_delete BEFORE DELETE ON feature_controls FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER feature_control_events_immutable BEFORE UPDATE OR DELETE ON feature_control_events FOR EACH ROW EXECUTE FUNCTION reject_record_change();
INSERT INTO feature_controls(key,taxonomy,mode,reason) VALUES('actions.global','SAFETY','ENABLED','Existing game actions remain enabled'),('shared.rules','RELEASE','DISABLED','Opt-in shared rules require reviewed activation');
CREATE TABLE release_adoptions (
 release_id uuid PRIMARY KEY REFERENCES content_releases(id),
 new_runs boolean NOT NULL DEFAULT false, compatibility text NOT NULL CHECK(compatibility IN('PIN_EXISTING','RETAIN_IDENTICAL')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),approved_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION guard_release_adoption() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM content_releases WHERE id=NEW.release_id AND sealed AND engine_version='foundation-1') THEN RAISE EXCEPTION 'Release adoption requires a supported sealed engine'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER release_adoption_guard BEFORE INSERT OR UPDATE ON release_adoptions FOR EACH ROW EXECUTE FUNCTION guard_release_adoption();
CREATE FUNCTION pin_existing_run_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.content_release_id IS NOT NULL AND (NEW.content_release_id IS DISTINCT FROM OLD.content_release_id OR NEW.rules_version<>OLD.rules_version OR NEW.rules_manifest<>OLD.rules_manifest) THEN RAISE EXCEPTION 'Existing run rules are immutable and remain pinned'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER existing_run_release BEFORE UPDATE ON runs FOR EACH ROW EXECUTE FUNCTION pin_existing_run_release();
CREATE TABLE shared_rules_state (
 run_id uuid PRIMARY KEY REFERENCES runs(id), revision bigint NOT NULL CHECK(revision>0), state jsonb NOT NULL CHECK(jsonb_typeof(state)='object')
);
CREATE TABLE shared_rules_events (
 action_id uuid PRIMARY KEY REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
 run_id uuid NOT NULL REFERENCES runs(id),release_id uuid NOT NULL REFERENCES content_releases(id),
 entity_id text NOT NULL,entity_revision integer NOT NULL,seed bytea NOT NULL CHECK(octet_length(seed)=32),
 state_revision bigint NOT NULL CHECK(state_revision>0),
 UNIQUE(run_id,state_revision),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'),before_state jsonb NOT NULL,after_state jsonb NOT NULL,
 FOREIGN KEY(release_id,entity_id,entity_revision) REFERENCES release_entries(release_id,entity_id,revision),
 CHECK(octet_length(after_state::text)<=131072)
);
CREATE INDEX shared_rules_events_release ON shared_rules_events(release_id,entity_id,entity_revision);
CREATE INDEX shared_rules_events_run ON shared_rules_events(run_id);
CREATE TRIGGER shared_rules_events_immutable BEFORE UPDATE OR DELETE ON shared_rules_events FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION project_shared_rules_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior jsonb; owner runs%ROWTYPE;
BEGIN
 SELECT * INTO owner FROM runs WHERE id=NEW.run_id FOR UPDATE;
 IF owner.status NOT IN('ACTIVE','AFTERCORE') OR owner.content_release_id IS DISTINCT FROM NEW.release_id THEN RAISE EXCEPTION 'Shared rules require active pinned owner'; END IF;
 SELECT state INTO prior FROM shared_rules_state WHERE run_id=NEW.run_id;
 IF NEW.state_revision<>coalesce((SELECT revision FROM shared_rules_state WHERE run_id=NEW.run_id),0)+1 OR NEW.before_state IS DISTINCT FROM coalesce(prior,'{}'::jsonb) THEN RAISE EXCEPTION 'Shared rule state revision changed'; END IF;
 INSERT INTO shared_rules_state(run_id,revision,state) VALUES(NEW.run_id,NEW.state_revision,NEW.after_state) ON CONFLICT(run_id) DO UPDATE SET revision=shared_rules_state.revision+1,state=EXCLUDED.state;
 RETURN NEW;
END $$;
CREATE TRIGGER shared_rules_event_projection AFTER INSERT ON shared_rules_events FOR EACH ROW EXECUTE FUNCTION project_shared_rules_event();
CREATE FUNCTION guard_shared_rules_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NOT EXISTS(SELECT 1 FROM runs WHERE id=NEW.run_id AND status IN('ACTIVE','AFTERCORE')) OR NOT EXISTS(SELECT 1 FROM shared_rules_events WHERE run_id=NEW.run_id AND after_state=NEW.state AND state_revision=NEW.revision) OR
 (TG_OP='UPDATE' AND (NEW.run_id<>OLD.run_id OR NEW.revision<>OLD.revision+1)) THEN RAISE EXCEPTION 'Shared rule state requires immutable action evidence'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER shared_rules_state_guard BEFORE INSERT OR UPDATE OR DELETE ON shared_rules_state FOR EACH ROW EXECUTE FUNCTION guard_shared_rules_state();
-- Parsed SQL bodies bind the relation identity at creation. Runtime may obtain
-- coherent read locks without receiving UPDATE privileges on operator controls.
CREATE FUNCTION locked_feature_control(target text) RETURNS SETOF feature_controls LANGUAGE SQL SECURITY DEFINER
BEGIN ATOMIC
 SELECT * FROM feature_controls WHERE key=target FOR SHARE;
END;
CREATE FUNCTION locked_release_adoption(target uuid) RETURNS jsonb LANGUAGE SQL SECURITY DEFINER
BEGIN ATOMIC
 SELECT to_jsonb(p)||jsonb_build_object('engine_version',r.engine_version) FROM release_adoptions p JOIN content_releases r ON r.id=p.release_id AND r.sealed WHERE p.release_id=target FOR SHARE OF p,r;
END;
CREATE FUNCTION audit_release_adoption() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO audit_events(category,source,payload) VALUES('RELEASE_ADOPTION',current_user,jsonb_build_object('before',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,'after',to_jsonb(NEW))); RETURN NEW;
END $$;
CREATE TRIGGER release_adoption_audit AFTER INSERT OR UPDATE ON release_adoptions FOR EACH ROW EXECUTE FUNCTION audit_release_adoption();
CREATE TRIGGER release_adoption_no_delete BEFORE DELETE ON release_adoptions FOR EACH ROW EXECUTE FUNCTION reject_record_change();
