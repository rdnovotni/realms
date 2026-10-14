-- Versioned generic field contracts now declare Ascension separately from rollover.
ALTER TABLE state_contracts ADD COLUMN ascension_policy text;
ALTER TABLE state_contracts DISABLE TRIGGER immutable_contract;
UPDATE state_contracts SET ascension_policy=CASE
 WHEN scope_kind='RUN' AND reset_policy='RESET_AT_ROLLOVER' THEN 'CARRY'
 WHEN scope_kind IN('RUN','INSTANCE') THEN 'ARCHIVE'
 ELSE 'KEEP' END;
ALTER TABLE state_contracts ENABLE TRIGGER immutable_contract;
ALTER TABLE state_contracts ALTER COLUMN ascension_policy SET NOT NULL;
ALTER TABLE state_contracts ADD CONSTRAINT state_ascension_policy CHECK (
 (scope_kind='RUN' AND ascension_policy IN('CARRY','RESET','ARCHIVE')) OR
 (scope_kind='INSTANCE' AND ascension_policy='ARCHIVE') OR
 (scope_kind IN('ACCOUNT','CHARACTER','GUILD','EVENT','WORLD') AND ascension_policy='KEEP'));
ALTER TABLE state_contracts ADD CONSTRAINT daily_run_state_carries CHECK (
 scope_kind<>'RUN' OR reset_policy<>'RESET_AT_ROLLOVER' OR ascension_policy='CARRY');

-- Serialize field writes against owner archival even outside an Action. Identity is
-- immutable; callers cannot move a row to a fresh scope to bypass its reset policy.
CREATE FUNCTION guard_scoped_state_lifetime() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_lifecycle text;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.scope_id,NEW.scope_kind,NEW.key) IS DISTINCT FROM (OLD.scope_id,OLD.scope_kind,OLD.key)
 THEN RAISE EXCEPTION 'Scoped field identity is immutable'; END IF;
 SELECT lifecycle INTO owner_lifecycle FROM state_scopes WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.scope_id ELSE NEW.scope_id END FOR SHARE;
 IF owner_lifecycle IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'Scoped field owner is archived'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scoped_state_lifetime BEFORE INSERT OR UPDATE OR DELETE ON scoped_state
 FOR EACH ROW EXECUTE FUNCTION guard_scoped_state_lifetime();
UPDATE state_scopes s SET lifecycle='ARCHIVED' FROM instances i
 WHERE s.instance_id=i.id AND i.lifecycle<>'ACTIVE' AND s.lifecycle='ACTIVE';
CREATE FUNCTION archive_terminal_instance_fields() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.lifecycle<>'ACTIVE' THEN UPDATE state_scopes SET lifecycle='ARCHIVED' WHERE instance_id=NEW.id; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sync_instance_field_scope AFTER INSERT OR UPDATE OF lifecycle ON instances
 FOR EACH ROW EXECUTE FUNCTION archive_terminal_instance_fields();
