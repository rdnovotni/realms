-- A saved combat item result requires the exact physical debit and sealed item
-- profile. Quantity accounting independently verifies owner custody and balance.
CREATE FUNCTION check_combat_item_debit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source inventory_items%ROWTYPE; actual jsonb; prepared boolean;
BEGIN
 IF NEW.intent->>'kind'<>'USE_COMBAT_ITEM' THEN RETURN NULL; END IF;
 SELECT * INTO source FROM inventory_items WHERE id=(NEW.intent->'item'->>'itemId')::uuid;
 SELECT definition->'mechanics'->'combatItem' INTO actual FROM content_versions WHERE entity_id=source.definition_id AND revision=source.definition_revision;
 SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.state->'units') u CROSS JOIN LATERAL jsonb_array_elements(u->'prepared'->'quickslots') q WHERE u->>'id'=NEW.intent->>'actorId' AND q->>'slot'=NEW.intent->>'slot' AND q->>'itemId'=source.id::text) INTO prepared;
 IF NOT prepared OR NEW.intent->'item'->'spec' IS DISTINCT FROM actual OR NEW.intent->'item'->>'sourceId' IS DISTINCT FROM source.definition_id OR (NEW.intent->'item'->>'sourceRevision')::integer IS DISTINCT FROM source.definition_revision OR NOT EXISTS(SELECT 1 FROM inventory_quantity_operations o WHERE o.action_id=NEW.action_id AND o.kind='CONSUME' AND o.from_item_id=source.id AND o.quantity=1 AND o.reason='COMBAT_ITEM_USE') THEN RAISE EXCEPTION 'Combat item results require their prepared sealed source and exact one-item debit'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER combat_item_step_debit AFTER INSERT ON tactical_steps DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_combat_item_debit();
CREATE CONSTRAINT TRIGGER shared_combat_item_step_debit AFTER INSERT ON shared_tactical_steps DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_combat_item_debit();
