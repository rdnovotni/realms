-- Collection identity protection is independent of favorites and manual locks.
ALTER TABLE inventory_item_annotations ADD COLUMN collection_protected boolean NOT NULL DEFAULT false;
INSERT INTO state_contracts(key,owner_module,scope_kind,reset_policy,value_schema,default_value,ascension_policy)
VALUES('inventory.automation.v1','inventory','ACCOUNT','KEEP',
'{"type":"object","additionalProperties":false,"required":["keep"],"properties":{"keep":{"type":"array","maxItems":100,"items":{"type":"object","additionalProperties":false,"required":["definitionId","quantity"],"properties":{"definitionId":{"type":"string","pattern":"^[a-z][a-z0-9_.-]{2,119}$"},"quantity":{"type":"integer","minimum":0,"maximum":1000000}}}}}}',
'{"keep":[]}','KEEP'),
('inventory.views.v1','inventory','ACCOUNT','KEEP',
'{"type":"object","additionalProperties":false,"required":["views"],"properties":{"views":{"type":"array","maxItems":12,"items":{"type":"object","additionalProperties":false,"required":["name","query"],"properties":{"name":{"type":"string","minLength":1,"maxLength":40},"query":{"type":"object"}}}}}}',
'{"views":[]}','KEEP');
