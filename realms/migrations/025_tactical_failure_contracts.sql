-- Versioned failure costs. No historical recovery or item data is rewritten.
ALTER TABLE tactical_recoveries DROP CONSTRAINT tactical_recoveries_destination_check;
ALTER TABLE tactical_recoveries ADD CONSTRAINT tactical_recoveries_destination_check CHECK(destination IN('HOME','FIELD','CHECKPOINT','CAPTURED','NPC_RESCUE','EJECTED','FAILED_FORWARD'));
CREATE TABLE tactical_failure_costs (
 instance_id uuid PRIMARY KEY REFERENCES tactical_encounter_origins(instance_id),
 action_id uuid NOT NULL REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
 failed boolean NOT NULL,before_gold bigint NOT NULL CHECK(before_gold>=0),gold_lost bigint NOT NULL CHECK(gold_lost BETWEEN 0 AND before_gold),
 source_wallet_id uuid REFERENCES wallets(id),sink_wallet_id uuid REFERENCES wallets(id)
);
CREATE INDEX tactical_failure_action ON tactical_failure_costs(action_id);
CREATE INDEX tactical_failure_source ON tactical_failure_costs(source_wallet_id);
CREATE INDEX tactical_failure_sink ON tactical_failure_costs(sink_wallet_id);
CREATE TRIGGER tactical_failure_immutable BEFORE UPDATE OR DELETE ON tactical_failure_costs FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION guard_tactical_failure_costs() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o tactical_encounter_origins%ROWTYPE; e encounter_records%ROWTYPE; f jsonb; source wallets%ROWTYPE;
BEGIN
 SELECT * INTO o FROM tactical_encounter_origins WHERE instance_id=NEW.instance_id;
 SELECT * INTO e FROM encounter_records WHERE instance_id=NEW.instance_id FOR UPDATE;
 f:=o.spec->'failure';
 IF f->>'version' IS DISTINCT FROM '2' OR e.outcome IS NOT NULL OR e.checkpoint->'state'->>'outcome' IS NULL
  OR NEW.failed IS DISTINCT FROM (e.checkpoint->'state'->>'outcome' IN('DEFEAT','FAILED_FORWARD','SURRENDER'))
  OR NEW.action_id IS DISTINCT FROM (SELECT action_id FROM tactical_steps WHERE instance_id=NEW.instance_id ORDER BY revision DESC LIMIT 1)
  OR NEW.before_gold IS NOT NULL OR NEW.gold_lost IS NOT NULL OR NEW.source_wallet_id IS NOT NULL OR NEW.sink_wallet_id IS NOT NULL THEN
  RAISE EXCEPTION 'Tactical failure costs must be generated from the terminal disclosed contract';
 END IF;
 SELECT w.* INTO source FROM wallets w JOIN state_scopes s ON s.id=w.scope_id WHERE s.run_id=o.run_id AND s.lifecycle='ACTIVE' AND w.currency_id='GOLD' AND w.purpose='PLAYER' ORDER BY w.id LIMIT 1 FOR UPDATE OF w;
 NEW.source_wallet_id:=source.id;NEW.before_gold:=coalesce(source.balance,0);
 NEW.gold_lost:=CASE WHEN NEW.failed THEN least(floor(NEW.before_gold::numeric*(f->>'goldLossBps')::integer/10000)::bigint,(f->>'goldLossCap')::bigint) ELSE 0 END;
 IF NEW.gold_lost>0 THEN
  SELECT w.id INTO NEW.sink_wallet_id FROM wallets w JOIN state_scopes s ON s.id=w.scope_id WHERE w.currency_id='GOLD' AND w.purpose='FAUCET_SINK' AND s.kind='WORLD' AND s.lifecycle='ACTIVE' ORDER BY w.id LIMIT 1;
  IF NEW.sink_wallet_id IS NULL THEN RAISE EXCEPTION 'Tactical failure requires a configured Gold sink'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tactical_failure_guard BEFORE INSERT ON tactical_failure_costs FOR EACH ROW EXECUTE FUNCTION guard_tactical_failure_costs();
CREATE TABLE tactical_equipment_wear (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 instance_id uuid NOT NULL REFERENCES tactical_failure_costs(instance_id),item_id uuid NOT NULL REFERENCES inventory_items(id),
 maximum integer NOT NULL CHECK(maximum BETWEEN 1 AND 1000000),before_condition integer NOT NULL,after_condition integer NOT NULL,
 CHECK(before_condition BETWEEN 1 AND maximum AND after_condition BETWEEN 1 AND before_condition),UNIQUE(instance_id,item_id)
);
CREATE INDEX tactical_wear_item ON tactical_equipment_wear(item_id,id);
CREATE TRIGGER tactical_wear_immutable BEFORE UPDATE OR DELETE ON tactical_equipment_wear FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION guard_tactical_wear() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run uuid; f jsonb;
BEGIN
 SELECT o.run_id,o.spec->'failure' INTO run,f FROM tactical_encounter_origins o JOIN tactical_failure_costs costs ON costs.instance_id=o.instance_id WHERE o.instance_id=NEW.instance_id AND costs.failed;
 IF run IS NULL OR NEW.maximum IS NOT NULL OR NEW.before_condition IS NOT NULL OR NEW.after_condition IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM equipment_slots s JOIN run_equipment g ON g.run_id=s.run_id WHERE s.run_id=run AND s.item_id=NEW.item_id AND (s.set_id='WORN' OR s.set_id=g.active_set)) THEN RAISE EXCEPTION 'Tactical wear requires active owned equipment and an authored failure'; END IF;
 SELECT (v.definition->'mechanics'->'tacticalDurability'->>'maximum')::integer INTO NEW.maximum FROM inventory_items i JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision WHERE i.id=NEW.item_id FOR UPDATE OF i;
 IF NEW.maximum IS NULL THEN RAISE EXCEPTION 'Equipment has no authored durability'; END IF;
 SELECT after_condition INTO NEW.before_condition FROM tactical_equipment_wear WHERE item_id=NEW.item_id ORDER BY id DESC LIMIT 1;
 NEW.before_condition:=coalesce(NEW.before_condition,NEW.maximum);
 NEW.after_condition:=greatest(1,NEW.before_condition-ceil(NEW.maximum::numeric*(f->>'durabilityWearBps')::integer/10000)::integer);
 RETURN NEW;
END $$;
CREATE TRIGGER tactical_wear_guard BEFORE INSERT ON tactical_equipment_wear FOR EACH ROW EXECUTE FUNCTION guard_tactical_wear();

CREATE OR REPLACE FUNCTION guard_tactical_recovery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e encounter_records%ROWTYPE; spec jsonb; hero jsonb; available integer; failure boolean; terminal text; last_action uuid; expected_health integer; expected_cost integer; expected_destination text;
BEGIN
 SELECT * INTO e FROM encounter_records WHERE instance_id=NEW.instance_id FOR UPDATE;
 SELECT o.spec INTO spec FROM tactical_encounter_origins o WHERE instance_id=NEW.instance_id;
 SELECT turns INTO available FROM runs WHERE id=e.run_id;
 SELECT action_id INTO last_action FROM tactical_steps WHERE instance_id=NEW.instance_id ORDER BY revision DESC LIMIT 1;
 hero:=e.checkpoint->'state'->'units'->0;terminal:=e.checkpoint->'state'->>'outcome';
 failure:=terminal IN('DEFEAT','FAILED_FORWARD','SURRENDER');
 expected_health:=CASE WHEN (hero->>'health')::integer>0 THEN (hero->>'health')::integer ELSE least((hero->'stats'->>'maxHealth')::integer,(spec->'failure'->>'recoveryHealth')::integer) END;
 expected_cost:=CASE WHEN failure THEN least(available,(spec->'failure'->>'turnCost')::integer) ELSE 0 END;
 expected_destination:=CASE WHEN failure THEN spec->'failure'->>'destination' ELSE 'FIELD' END;
 IF terminal IS NULL OR terminal NOT IN('VICTORY','DEFEAT','FAILED_FORWARD','RETREAT','SURRENDER') OR e.outcome IS NOT NULL
   OR NEW.action_id IS DISTINCT FROM last_action
   OR NEW.health IS DISTINCT FROM expected_health
   OR NEW.mana IS DISTINCT FROM (hero->>'mana')::integer
   OR NEW.turn_cost IS DISTINCT FROM expected_cost
   OR NEW.destination IS DISTINCT FROM expected_destination THEN
   RAISE EXCEPTION 'Tactical recovery must match terminal state and disclosed costs';
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION guard_tactical_full_costs() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f jsonb; cost tactical_failure_costs%ROWTYPE; owner uuid; expected_wear integer;
BEGIN
 SELECT spec->'failure',run_id INTO f,owner FROM tactical_encounter_origins WHERE instance_id=NEW.instance_id;
 IF f->>'version' IS DISTINCT FROM '2' THEN RETURN NEW; END IF;
 SELECT * INTO cost FROM tactical_failure_costs WHERE instance_id=NEW.instance_id;
 IF cost.instance_id IS NULL OR cost.action_id IS DISTINCT FROM NEW.action_id THEN RAISE EXCEPTION 'Recovery must pin disclosed failure costs'; END IF;
 IF (cost.gold_lost=0 AND EXISTS(SELECT 1 FROM currency_transfers WHERE action_id=NEW.action_id AND leg_key='tactical-death'))
  OR (cost.gold_lost>0 AND NOT EXISTS(SELECT 1 FROM currency_transfers WHERE action_id=NEW.action_id AND leg_key='tactical-death' AND from_wallet_id=cost.source_wallet_id AND to_wallet_id=cost.sink_wallet_id AND amount=cost.gold_lost AND reason='TACTICAL_FAILURE')) THEN RAISE EXCEPTION 'Failure Gold must reconcile its immutable transfer'; END IF;
 SELECT CASE WHEN cost.failed THEN count(DISTINCT s.item_id)::integer ELSE 0 END INTO expected_wear FROM equipment_slots s JOIN run_equipment g ON g.run_id=s.run_id JOIN inventory_items i ON i.id=s.item_id JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision WHERE s.run_id=owner AND (s.set_id='WORN' OR s.set_id=g.active_set) AND v.definition->'mechanics'->'tacticalDurability' IS NOT NULL;
 IF expected_wear<>(SELECT count(*) FROM tactical_equipment_wear WHERE instance_id=NEW.instance_id) THEN RAISE EXCEPTION 'Failure must settle every eligible active item'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tactical_full_costs_guard BEFORE INSERT ON tactical_recoveries FOR EACH ROW EXECUTE FUNCTION guard_tactical_full_costs();
