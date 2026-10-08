-- Explicit trivial processing only: no skill, station, uncertain-quality or timer bypass.
CREATE TABLE craft_records (
  action_id uuid PRIMARY KEY REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
  run_id uuid NOT NULL REFERENCES runs(id),
  release_id uuid NOT NULL,
  recipe_id text NOT NULL,
  definition_kind text NOT NULL DEFAULT 'RECIPE' CHECK(definition_kind='RECIPE'),
  definition_revision integer NOT NULL,
  batches integer NOT NULL CHECK(batches BETWEEN 1 AND 100),
  output_operation_id uuid NOT NULL UNIQUE REFERENCES inventory_quantity_operations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(recipe_id,definition_kind) REFERENCES content_entities(id,kind),
  FOREIGN KEY(release_id,recipe_id,definition_revision) REFERENCES release_entries(release_id,entity_id,revision)
);
CREATE INDEX crafts_by_run ON craft_records(run_id);
CREATE INDEX crafts_by_definition ON craft_records(recipe_id,definition_kind);
CREATE INDEX crafts_by_release ON craft_records(release_id,recipe_id,definition_revision);
CREATE TABLE craft_inputs (
  action_id uuid NOT NULL REFERENCES craft_records(action_id),
  line_index integer NOT NULL CHECK(line_index BETWEEN 0 AND 15),
  operation_id uuid NOT NULL UNIQUE REFERENCES inventory_quantity_operations(id),
  PRIMARY KEY(action_id,line_index)
);
CREATE TRIGGER immutable_craft_record BEFORE UPDATE OR DELETE ON craft_records FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER immutable_craft_input BEFORE UPDATE OR DELETE ON craft_inputs FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE VIEW craft_integrity_issues AS
SELECT cr.action_id FROM craft_records cr
JOIN runs r ON r.id=cr.run_id JOIN characters c ON c.id=r.character_id
JOIN content_versions v ON v.entity_id=cr.recipe_id AND v.revision=cr.definition_revision
LEFT JOIN action_receipts a ON a.action_id=cr.action_id
LEFT JOIN inventory_quantity_operations op ON op.id=cr.output_operation_id
LEFT JOIN inventory_items output ON output.id=op.to_item_id
WHERE
  a.account_id IS DISTINCT FROM c.account_id OR a.action_type IS DISTINCT FROM 'CRAFT_ROUTINE'
  OR r.content_release_id<>cr.release_id
  OR v.definition->'mechanics'->'routineRecipe'->>'ruleset' IS DISTINCT FROM 'TRIVIAL_PROCESSING_V1'
  OR v.definition->'mechanics'->'routineRecipe'->>'access' IS DISTINCT FROM 'DISCOVERED_CURRENT_RUN'
  OR v.definition->'mechanics'->'routineRecipe'->>'version' IS DISTINCT FROM '1'
  OR v.definition->'mechanics'->'routineRecipe'->>'turnCost' IS DISTINCT FROM '0'
  OR cr.batches>coalesce((v.definition->'mechanics'->'routineRecipe'->>'maxBatch')::integer,0)
  OR op.kind IS DISTINCT FROM 'GRANT' OR op.action_id IS DISTINCT FROM cr.action_id OR op.operation_key IS DISTINCT FROM 'craft.output' OR op.reason IS DISTINCT FROM 'ROUTINE_CRAFT_OUTPUT'
  OR op.quantity IS DISTINCT FROM (v.definition->'mechanics'->'routineRecipe'->'output'->>'quantity')::bigint*cr.batches
  OR output.definition_id IS DISTINCT FROM v.definition->'mechanics'->'routineRecipe'->'output'->>'itemId'
  OR output.release_id IS DISTINCT FROM cr.release_id OR output.storage_mode IS DISTINCT FROM 'STACK' OR output.quality IS DISTINCT FROM 1::numeric OR output.source_code IS DISTINCT FROM 'ROUTINE_CRAFT'
  OR output.metadata IS DISTINCT FROM jsonb_build_object('craftActionId',cr.action_id::text,'recipeId',cr.recipe_id,'makerCharacterId',r.character_id::text,'batches',cr.batches)
  OR (SELECT count(*) FROM craft_inputs ci WHERE ci.action_id=cr.action_id) IS DISTINCT FROM jsonb_array_length(v.definition->'mechanics'->'routineRecipe'->'inputs')::bigint
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(v.definition->'mechanics'->'routineRecipe'->'inputs') WITH ORDINALITY line(value,n)
    LEFT JOIN craft_inputs ci ON ci.action_id=cr.action_id AND ci.line_index=line.n-1
    LEFT JOIN inventory_quantity_operations inp ON inp.id=ci.operation_id
    LEFT JOIN inventory_items material ON material.id=inp.from_item_id
    WHERE ci.operation_id IS NULL OR inp.kind IS DISTINCT FROM 'CONSUME' OR inp.action_id IS DISTINCT FROM cr.action_id
      OR inp.operation_key IS DISTINCT FROM 'craft.input.'||(line.n-1)::text OR inp.reason IS DISTINCT FROM 'ROUTINE_CRAFT_INPUT'
      OR inp.quantity IS DISTINCT FROM (line.value->>'quantity')::bigint*cr.batches
      OR material.definition_id IS DISTINCT FROM line.value->>'itemId' OR material.release_id IS DISTINCT FROM cr.release_id
      OR material.storage_mode IS DISTINCT FROM 'STACK' OR material.quality IS DISTINCT FROM 1::numeric OR material.binding='SYSTEM_UNTRADEABLE'
      OR (material.metadata<>'{}'::jsonb AND (material.source_code<>'ROUTINE_CRAFT' OR (material.metadata-ARRAY['craftActionId','recipeId','makerCharacterId','batches'])<>'{}'::jsonb)))
  OR output.binding IS DISTINCT FROM (
    SELECT CASE WHEN bool_or(material.binding='RUN_BOUND') THEN 'RUN_BOUND'
      WHEN bool_or(material.binding='ACCOUNT_BOUND') THEN 'ACCOUNT_BOUND' ELSE 'TRADEABLE' END
    FROM craft_inputs ci JOIN inventory_quantity_operations inp ON inp.id=ci.operation_id JOIN inventory_items material ON material.id=inp.from_item_id
    WHERE ci.action_id=cr.action_id);
-- Missing craft records and unlinked/extra operations are also visible to audits.
CREATE VIEW craft_operation_issues AS
SELECT op.id FROM inventory_quantity_operations op WHERE
  (op.operation_key LIKE 'craft.%' OR op.reason IN ('ROUTINE_CRAFT_INPUT','ROUTINE_CRAFT_OUTPUT')) AND NOT (
    (op.kind='GRANT' AND EXISTS(SELECT 1 FROM craft_records cr WHERE cr.action_id=op.action_id AND cr.output_operation_id=op.id)) OR
    (op.kind='CONSUME' AND EXISTS(SELECT 1 FROM craft_inputs ci WHERE ci.action_id=op.action_id AND ci.operation_id=op.id)));
CREATE FUNCTION check_routine_craft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM craft_integrity_issues WHERE action_id=NEW.action_id) OR
    EXISTS(SELECT 1 FROM craft_operation_issues issue JOIN inventory_quantity_operations op ON op.id=issue.id WHERE op.action_id=NEW.action_id) THEN
    RAISE EXCEPTION 'Routine craft does not match authored recipe and ledger';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER craft_record_integrity AFTER INSERT ON craft_records DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_routine_craft();
CREATE CONSTRAINT TRIGGER craft_input_integrity AFTER INSERT ON craft_inputs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_routine_craft();
CREATE CONSTRAINT TRIGGER craft_operation_integrity AFTER INSERT ON inventory_quantity_operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_routine_craft();

CREATE FUNCTION guard_craft_custody() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_run uuid; current_run uuid; scope_lifecycle text; container_kind text;
BEGIN
  IF TG_TABLE_NAME='craft_records' THEN
    current_run:=NEW.run_id;
    SELECT s.run_id,s.lifecycle,c.kind INTO owner_run,scope_lifecycle,container_kind
      FROM inventory_quantity_operations op JOIN inventory_items i ON i.id=op.to_item_id
      JOIN inventory_containers c ON c.id=i.container_id JOIN state_scopes s ON s.id=c.scope_id WHERE op.id=NEW.output_operation_id;
    IF container_kind IS DISTINCT FROM 'CARRIED' OR NOT EXISTS(SELECT 1 FROM runs r JOIN characters c ON c.id=r.character_id
      JOIN discoveries d ON d.account_id=c.account_id AND d.entity_id=NEW.recipe_id WHERE r.id=current_run AND r.status IN ('ACTIVE','AFTERCORE'))
      OR EXISTS(SELECT 1 FROM instance_participants p JOIN instances i ON i.id=p.instance_id WHERE p.run_id=current_run AND i.lifecycle='ACTIVE') THEN
      RAISE EXCEPTION 'Routine craft access or output custody is invalid';
    END IF;
  ELSE
    SELECT run_id INTO current_run FROM craft_records WHERE action_id=NEW.action_id;
    SELECT s.run_id,s.lifecycle,c.kind INTO owner_run,scope_lifecycle,container_kind
      FROM inventory_quantity_operations op JOIN inventory_items i ON i.id=op.from_item_id
      JOIN inventory_containers c ON c.id=i.container_id JOIN state_scopes s ON s.id=c.scope_id WHERE op.id=NEW.operation_id;
    IF container_kind NOT IN ('CARRIED','MATERIAL_VAULT','HOME') THEN RAISE EXCEPTION 'Routine craft input custody is invalid'; END IF;
  END IF;
  IF owner_run IS DISTINCT FROM current_run OR scope_lifecycle IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'Routine craft requires current-run custody';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER craft_record_custody BEFORE INSERT ON craft_records FOR EACH ROW EXECUTE FUNCTION guard_craft_custody();
CREATE TRIGGER craft_input_custody BEFORE INSERT ON craft_inputs FOR EACH ROW EXECUTE FUNCTION guard_craft_custody();
