-- Cosmetic account/item annotations never rewrite item metadata or provenance.
CREATE TABLE inventory_item_annotations (
 account_id uuid NOT NULL REFERENCES accounts(id),item_id uuid NOT NULL REFERENCES inventory_items(id),
 favorite boolean NOT NULL DEFAULT false,seen_operation_no bigint NOT NULL DEFAULT 0 CHECK(seen_operation_no>=0),
 last_action_id uuid NOT NULL REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
 PRIMARY KEY(account_id,item_id)
);
CREATE INDEX inventory_annotations_item ON inventory_item_annotations(item_id);
CREATE INDEX inventory_annotations_action ON inventory_item_annotations(last_action_id);
-- One atomic bulk action can protect several identities, each with its own history.
ALTER TABLE inventory_lock_events DROP CONSTRAINT inventory_lock_events_action_id_key;
ALTER TABLE inventory_lock_events ADD UNIQUE(action_id,item_id);
INSERT INTO state_contracts(key,owner_module,scope_kind,reset_policy,value_schema,default_value,ascension_policy)
VALUES('inventory.display.v1','inventory','ACCOUNT','KEEP',
'{"type":"object","additionalProperties":false,"required":["healthyPercent","wornPercent","showSingleQuantity"],"properties":{"healthyPercent":{"type":"integer","minimum":2,"maximum":100},"wornPercent":{"type":"integer","minimum":1,"maximum":99},"showSingleQuantity":{"type":"boolean"}}}',
'{"healthyPercent":70,"wornPercent":25,"showSingleQuantity":true}','KEEP');

CREATE OR REPLACE VIEW item_lock_integrity_issues AS
SELECT coalesce(latest.item_id,p.item_id) AS item_id FROM inventory_item_locks p
FULL JOIN (SELECT DISTINCT ON(item_id) * FROM inventory_lock_events ORDER BY item_id,revision DESC) latest ON latest.item_id=p.item_id
WHERE p.item_id IS NULL OR latest.id IS NULL OR p.last_event_id IS DISTINCT FROM latest.id OR p.revision IS DISTINCT FROM latest.revision OR p.locked IS DISTINCT FROM latest.locked
  OR EXISTS(SELECT 1 FROM (
    SELECT e.*,lag(locked,1,false) OVER(PARTITION BY item_id ORDER BY revision) AS expected_previous,
      row_number() OVER(PARTITION BY item_id ORDER BY revision) AS expected_revision
    FROM inventory_lock_events e) chain JOIN runs r ON r.id=chain.run_id JOIN characters c ON c.id=r.character_id
    LEFT JOIN action_receipts a ON a.action_id=chain.action_id WHERE chain.item_id=coalesce(latest.item_id,p.item_id)
    AND (chain.previous_locked IS DISTINCT FROM chain.expected_previous OR chain.revision<>chain.expected_revision
      OR a.account_id IS DISTINCT FROM c.account_id OR NOT coalesce(a.action_type='SET_ITEM_LOCK' OR (a.action_type='BULK_INVENTORY' AND a.result->>'operation'='LOCK' AND (a.result->'itemIds') ? chain.item_id::text),false) OR (a.action_type='SET_ITEM_LOCK' AND (SELECT count(*) FROM inventory_lock_events same_action WHERE same_action.action_id=chain.action_id)<>1)
      OR a.authorization_source NOT IN('MANUAL_UI','API')));
