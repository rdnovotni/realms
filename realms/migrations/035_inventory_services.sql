-- Append-only repair history; old failure wear records and checksums stay intact.
CREATE TABLE inventory_repairs (
 action_id uuid NOT NULL REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
 item_id uuid NOT NULL REFERENCES inventory_items(id),run_id uuid NOT NULL REFERENCES runs(id),
 wear_id bigint NOT NULL CHECK(wear_id>=0),before_condition integer NOT NULL CHECK(before_condition>=0),
 after_condition integer NOT NULL CHECK(after_condition>before_condition),cost bigint NOT NULL CHECK(cost>0),
 PRIMARY KEY(action_id,item_id),UNIQUE(item_id,wear_id)
);
CREATE INDEX inventory_repairs_item ON inventory_repairs(item_id,wear_id);
CREATE INDEX inventory_repairs_run ON inventory_repairs(run_id);
CREATE TRIGGER inventory_repairs_immutable BEFORE UPDATE OR DELETE ON inventory_repairs FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION inventory_condition(target uuid,before_wear bigint DEFAULT NULL) RETURNS integer LANGUAGE SQL STABLE AS $$
 SELECT CASE WHEN coalesce(w.id,0)<=coalesce(r.wear_id,-1) THEN r.after_condition
 ELSE coalesce(w.after_condition,(v.definition->'mechanics'->'tacticalDurability'->>'maximum')::integer) END
 FROM inventory_items i JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision
 LEFT JOIN LATERAL(SELECT id,after_condition FROM tactical_equipment_wear WHERE item_id=i.id AND (before_wear IS NULL OR id<before_wear) ORDER BY id DESC LIMIT 1) w ON true
 LEFT JOIN LATERAL(SELECT wear_id,after_condition FROM inventory_repairs WHERE item_id=i.id AND (before_wear IS NULL OR wear_id<before_wear) ORDER BY wear_id DESC LIMIT 1) r ON true WHERE i.id=target
$$;
CREATE FUNCTION guard_inventory_repair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE maximum integer; unit_cost integer; current_wear bigint;
BEGIN
 SELECT (v.definition->'mechanics'->'tacticalDurability'->>'maximum')::integer,(v.definition->'mechanics'->'repair'->>'goldPerPoint')::integer INTO maximum,unit_cost
 FROM inventory_items i JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision
 JOIN inventory_containers b ON b.id=i.container_id JOIN state_scopes s ON s.id=b.scope_id
 WHERE i.id=NEW.item_id AND i.quantity>0 AND b.kind IN('CARRIED','HOME') AND s.run_id=NEW.run_id AND s.lifecycle='ACTIVE' FOR UPDATE OF i;
 SELECT coalesce(max(id),0) INTO current_wear FROM tactical_equipment_wear WHERE item_id=NEW.item_id;
 IF maximum IS NULL OR unit_cost IS NULL OR NEW.wear_id<>current_wear OR NEW.before_condition IS DISTINCT FROM inventory_condition(NEW.item_id)
 OR NEW.after_condition<>maximum OR NEW.cost<>(maximum-NEW.before_condition)::bigint*unit_cost
 OR EXISTS(SELECT 1 FROM instance_participants p JOIN instances i ON i.id=p.instance_id WHERE p.run_id=NEW.run_id AND i.lifecycle='ACTIVE') THEN RAISE EXCEPTION 'Repair must match current owned condition and authored price outside encounters'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_repairs_guard BEFORE INSERT ON inventory_repairs FOR EACH ROW EXECUTE FUNCTION guard_inventory_repair();
CREATE FUNCTION check_inventory_repair_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM currency_transfers t JOIN wallets w ON w.id=t.from_wallet_id JOIN state_scopes s ON s.id=w.scope_id JOIN wallets sink ON sink.id=t.to_wallet_id JOIN state_scopes world ON world.id=sink.scope_id JOIN action_receipts a ON a.action_id=NEW.action_id JOIN runs r ON r.id=NEW.run_id JOIN characters c ON c.id=r.character_id
 WHERE t.action_id=NEW.action_id AND t.leg_key='inventory.repair' AND t.amount=(SELECT sum(cost) FROM inventory_repairs WHERE action_id=NEW.action_id) AND t.reason='INVENTORY_REPAIR' AND w.currency_id='GOLD' AND w.purpose='PLAYER' AND s.run_id=NEW.run_id AND sink.currency_id='GOLD' AND sink.purpose='FAUCET_SINK' AND world.kind='WORLD' AND a.account_id=c.account_id AND a.action_type='REPAIR_ITEMS' AND a.authorization_source IN('MANUAL_UI','API')) THEN RAISE EXCEPTION 'Repair requires its complete Gold payment and receipt'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER inventory_repair_payment AFTER INSERT ON inventory_repairs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_inventory_repair_payment();
INSERT INTO state_contracts(key,owner_module,scope_kind,reset_policy,value_schema,default_value,ascension_policy)
VALUES('inventory.workspace.v1','inventory','ACCOUNT','KEEP','{"type":"object","additionalProperties":false,"required":["layout"],"properties":{"layout":{"type":"string","enum":["COMPACT","STANDARD","DETAILED"]}}}','{"layout":"STANDARD"}','KEEP');

CREATE OR REPLACE FUNCTION guard_tactical_wear() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run uuid; f jsonb;
BEGIN
 SELECT o.run_id,o.spec->'failure' INTO run,f FROM tactical_all_origins o JOIN tactical_failure_costs costs ON costs.instance_id=o.instance_id WHERE o.instance_id=NEW.instance_id AND costs.failed;
 IF run IS NULL OR NEW.maximum IS NOT NULL OR NEW.before_condition IS NOT NULL OR NEW.after_condition IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM equipment_slots s JOIN run_equipment g ON g.run_id=s.run_id WHERE s.run_id=run AND s.item_id=NEW.item_id AND (s.set_id='WORN' OR s.set_id=g.active_set)) THEN RAISE EXCEPTION 'Tactical wear requires active owned equipment and an authored failure'; END IF;
 SELECT (v.definition->'mechanics'->'tacticalDurability'->>'maximum')::integer INTO NEW.maximum FROM inventory_items i JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision WHERE i.id=NEW.item_id FOR UPDATE OF i;
 IF NEW.maximum IS NULL THEN RAISE EXCEPTION 'Equipment has no authored durability'; END IF;
 NEW.before_condition:=inventory_condition(NEW.item_id);
 NEW.before_condition:=coalesce(NEW.before_condition,NEW.maximum);
 NEW.after_condition:=greatest(1,NEW.before_condition-ceil(NEW.maximum::numeric*(f->>'durabilityWearBps')::integer/10000)::integer);
 RETURN NEW;
END $$;
