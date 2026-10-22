CREATE TABLE combat_quickslot_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id),
 action_id uuid NOT NULL UNIQUE REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
 slots jsonb NOT NULL CHECK(jsonb_typeof(slots)='array' AND jsonb_array_length(slots)<=4),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX combat_quickslot_account ON combat_quickslot_events(account_id,id DESC);
CREATE TRIGGER combat_quickslot_immutable BEFORE UPDATE OR DELETE ON combat_quickslot_events FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION validate_combat_quickslots() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE slot jsonb; owner_run uuid;
BEGIN
 SELECT r.id INTO owner_run FROM runs r JOIN characters c ON c.id=r.character_id WHERE c.account_id=NEW.account_id AND r.status IN('ACTIVE','AFTERCORE');
 IF owner_run IS NULL OR EXISTS(SELECT 1 FROM instance_participants p JOIN instances i ON i.id=p.instance_id WHERE p.run_id=owner_run AND i.lifecycle='ACTIVE') THEN RAISE EXCEPTION 'Prepare combat items outside active encounters'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.slots) s GROUP BY s->>'slot' HAVING count(*)>1) OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.slots) s GROUP BY s->>'itemId' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate prepared slot'; END IF;
 FOR slot IN SELECT * FROM jsonb_array_elements(NEW.slots) LOOP
  IF (SELECT count(*) FROM jsonb_object_keys(slot))<>2 OR (slot->>'slot')::integer NOT BETWEEN 1 AND 4 OR NOT EXISTS(
   SELECT 1 FROM inventory_items i JOIN inventory_containers b ON b.id=i.container_id JOIN state_scopes s ON s.id=b.scope_id JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision JOIN discoveries d ON d.account_id=NEW.account_id AND d.entity_id=i.definition_id
   WHERE i.id=(slot->>'itemId')::uuid AND s.run_id=owner_run AND b.kind='CARRIED' AND i.quantity>0 AND v.definition->'mechanics' ? 'combatItem') THEN RAISE EXCEPTION 'Combat quickslot requires owned carried known stock'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER combat_quickslot_guard BEFORE INSERT ON combat_quickslot_events FOR EACH ROW EXECUTE FUNCTION validate_combat_quickslots();
CREATE FUNCTION check_combat_quickslot_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM action_receipts a WHERE a.action_id=NEW.action_id AND a.account_id=NEW.account_id AND a.action_type='SET_COMBAT_QUICKSLOTS') THEN RAISE EXCEPTION 'Prepared slots require their owner action receipt'; END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER combat_quickslot_receipt AFTER INSERT ON combat_quickslot_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_combat_quickslot_receipt();
CREATE FUNCTION combat_quickslots_at(owner_id uuid,cutoff timestamptz) RETURNS jsonb LANGUAGE SQL STABLE
BEGIN ATOMIC
 SELECT coalesce((SELECT slots FROM combat_quickslot_events WHERE account_id=owner_id AND created_at<=cutoff ORDER BY id DESC LIMIT 1),'[]'::jsonb);
END;
