-- Extend the existing ledger without rewriting historical transfer rows.
ALTER TABLE currency_transfers ADD COLUMN leg_key text NOT NULL DEFAULT 'primary'
  CHECK(leg_key ~ '^[a-z][a-z0-9_.-]{0,63}$');
ALTER TABLE currency_transfers DROP CONSTRAINT currency_transfers_action_id_key;
ALTER TABLE currency_transfers ADD CONSTRAINT transfer_leg_once UNIQUE(action_id,leg_key);

-- The old check allowed a non-running job to retain one orphan lease field.
ALTER TABLE durable_jobs ADD CONSTRAINT complete_job_lease CHECK(
  (status='RUNNING' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR
  (status<>'RUNNING' AND lease_token IS NULL AND lease_until IS NULL));
ALTER TABLE durable_jobs ADD CONSTRAINT bounded_job_identity CHECK(
  length(btrim(job_key)) BETWEEN 1 AND 256 AND kind ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,79}$');
CREATE FUNCTION guard_job_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.job_key<>OLD.job_key OR NEW.kind<>OLD.kind OR NEW.payload<>OLD.payload OR NEW.max_attempts<>OLD.max_attempts THEN
    RAISE EXCEPTION 'Job identity, work and retry budget are immutable';
  END IF;
  IF OLD.status IN('SUCCEEDED','FAILED','CANCELLED') AND NEW.status<>OLD.status THEN RAISE EXCEPTION 'Terminal jobs cannot be reopened'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER job_identity BEFORE UPDATE ON durable_jobs FOR EACH ROW EXECUTE FUNCTION guard_job_identity();

-- Changing an owner container must not silently change every item's custody.
CREATE FUNCTION guard_container_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.scope_id<>OLD.scope_id OR NEW.kind<>OLD.kind THEN RAISE EXCEPTION 'Container identity and ownership are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER container_identity BEFORE UPDATE ON inventory_containers FOR EACH ROW EXECUTE FUNCTION guard_container_identity();
CREATE FUNCTION guard_character_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.account_id<>OLD.account_id THEN RAISE EXCEPTION 'Character identity and ownership are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER character_identity BEFORE UPDATE ON characters FOR EACH ROW EXECUTE FUNCTION guard_character_identity();

CREATE FUNCTION guard_run_lifetime() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN('ARCHIVED','ABANDONED') AND NEW.status<>OLD.status THEN RAISE EXCEPTION 'Terminal runs cannot be reopened'; END IF;
  IF OLD.status='AFTERCORE' AND NEW.status='ACTIVE' THEN RAISE EXCEPTION 'Victory cannot be reversed'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER run_lifetime BEFORE UPDATE ON runs FOR EACH ROW EXECUTE FUNCTION guard_run_lifetime();
CREATE FUNCTION archive_terminal_run_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN('ARCHIVED','ABANDONED') THEN UPDATE state_scopes SET lifecycle='ARCHIVED' WHERE run_id=NEW.id; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sync_run_scope AFTER INSERT OR UPDATE OF status ON runs FOR EACH ROW EXECUTE FUNCTION archive_terminal_run_scope();
CREATE FUNCTION check_run_scope_lifetime() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_uuid uuid; run_status text; scope_status text;
BEGIN
  IF TG_TABLE_NAME='runs' THEN run_uuid:=(to_jsonb(NEW)->>'id')::uuid;
  ELSIF TG_OP='DELETE' THEN run_uuid:=(to_jsonb(OLD)->>'run_id')::uuid;
  ELSE run_uuid:=(to_jsonb(NEW)->>'run_id')::uuid; END IF;
  IF run_uuid IS NULL THEN RETURN NULL; END IF;
  SELECT r.status,s.lifecycle INTO run_status,scope_status FROM runs r LEFT JOIN state_scopes s ON s.run_id=r.id WHERE r.id=run_uuid;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF scope_status IS DISTINCT FROM (CASE WHEN run_status IN('ARCHIVED','ABANDONED') THEN 'ARCHIVED' ELSE 'ACTIVE' END) THEN
    RAISE EXCEPTION 'Run and scope lifetimes must agree';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER run_scope_consistency AFTER INSERT OR UPDATE ON runs
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_run_scope_lifetime();
CREATE CONSTRAINT TRIGGER scope_run_consistency AFTER INSERT OR UPDATE OR DELETE ON state_scopes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_run_scope_lifetime();

-- Foreign-key leading-column coverage found by the repeatable catalog audit.
CREATE INDEX transfers_by_currency ON currency_transfers(currency_id);
CREATE INDEX transfers_from_currency ON currency_transfers(from_wallet_id,currency_id);
CREATE INDEX transfers_to_currency ON currency_transfers(to_wallet_id,currency_id);
CREATE INDEX discoveries_by_first_run ON discoveries(first_run_id);
CREATE INDEX effects_by_typed_definition ON effect_instances(effect_id,definition_kind);
CREATE INDEX effects_by_release_definition ON effect_instances(release_id,effect_id,definition_revision);
CREATE INDEX instances_by_release ON instances(content_release_id);
CREATE INDEX items_by_bound_account ON inventory_items(bound_account_id);
CREATE INDEX items_by_bound_run ON inventory_items(bound_run_id);
CREATE INDEX items_by_typed_definition ON inventory_items(definition_id,definition_kind);
CREATE INDEX items_by_release_definition ON inventory_items(release_id,definition_id,definition_revision);
CREATE INDEX movements_by_from ON inventory_movements(from_container_id);
CREATE INDEX movements_by_to ON inventory_movements(to_container_id);
CREATE INDEX quests_by_typed_definition ON quest_states(quest_id,definition_kind);
CREATE INDEX quests_by_release_definition ON quest_states(release_id,quest_id,definition_revision);
CREATE INDEX class_levels_by_definition ON run_class_levels(class_id,definition_kind);
CREATE INDEX history_by_character ON run_history(character_id);
CREATE INDEX rollovers_by_epoch ON run_rollovers(epoch);
CREATE INDEX runs_by_character ON runs(character_id);
CREATE INDEX state_by_contract ON scoped_state(key,scope_kind);
CREATE INDEX state_by_typed_scope ON scoped_state(scope_id,scope_kind);
CREATE INDEX events_by_release ON world_events(content_release_id);
CREATE INDEX events_by_world ON world_events(world_id);
