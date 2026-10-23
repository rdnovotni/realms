-- Body capacity is a projection of immutable consumption, rollover and undo facts.
CREATE FUNCTION consumption_policy(target uuid) RETURNS jsonb LANGUAGE SQL STABLE
BEGIN ATOMIC
 WITH chosen AS (
 SELECT coalesce((SELECT v.definition->'mechanics'->'consumptionPolicy' FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=r.content_release_id AND v.definition->'mechanics' ? 'consumptionPolicy' LIMIT 1),
 '{"version":1,"capacities":{"fullness":20,"drunkenness":15,"tolerance":10},"constitutionBonuses":[],"forbiddenFamilies":[],"reset":{"fullness":true,"drunkenness":true,"tolerance":true},"allowNightcaps":true}'::jsonb) AS spec,coalesce(p.constitution,10) AS constitution
 FROM runs r LEFT JOIN run_progression p ON p.run_id=r.id WHERE r.id=target
 ), effective AS (SELECT *,coalesce((SELECT b FROM jsonb_array_elements(spec->'constitutionBonuses') b WHERE (b->>'minimum')::integer<=constitution ORDER BY (b->>'minimum')::integer DESC LIMIT 1),'{}'::jsonb) bonus FROM chosen)
 SELECT jsonb_build_object('definition',spec,'constitution',constitution,'capacities',jsonb_build_object(
 'fullness',(spec->'capacities'->>'fullness')::integer+coalesce((bonus->>'fullness')::integer,0),
 'drunkenness',(spec->'capacities'->>'drunkenness')::integer+coalesce((bonus->>'drunkenness')::integer,0),
 'tolerance',(spec->'capacities'->>'tolerance')::integer+coalesce((bonus->>'tolerance')::integer,0)),
 'reset',spec->'reset','forbiddenFamilies',spec->'forbiddenFamilies','allowNightcaps',spec->'allowNightcaps') FROM effective;
END;
CREATE FUNCTION consumption_yield(spec jsonb,quality numeric) RETURNS integer LANGUAGE SQL IMMUTABLE
BEGIN ATOMIC
 SELECT floor((spec->>'turns')::numeric*(10000+floor((spec->'quality'->>'maximumBonusBps')::numeric*greatest(0,quality-(spec->'quality'->>'reference')::numeric)/((spec->'quality'->>'softness')::numeric+greatest(0,quality-(spec->'quality'->>'reference')::numeric))))/10000)::integer;
END;
CREATE TABLE consumption_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 run_id uuid NOT NULL REFERENCES runs(id),account_id uuid NOT NULL REFERENCES accounts(id),
 kind text NOT NULL CHECK(kind IN('BASELINE','CONSUME','RESET','UNDO')),
 action_id uuid REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
 request_id uuid,operation_id uuid REFERENCES inventory_quantity_operations(id),item_id uuid REFERENCES inventory_items(id),
 source_event_id bigint REFERENCES consumption_events(id),epoch bigint,
 before_balance jsonb NOT NULL,after_balance jsonb NOT NULL,policy jsonb NOT NULL,
 turn_delta integer NOT NULL DEFAULT 0,confirmed_overdrink boolean NOT NULL DEFAULT false,
 committed_revision integer,shared_before jsonb,shared_after jsonb,
 migrated boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(run_id,epoch) REFERENCES run_rollovers(run_id,epoch) DEFERRABLE INITIALLY DEFERRED,
 CHECK(octet_length(policy::text)<=16384),CHECK(jsonb_typeof(before_balance)='object' AND jsonb_typeof(after_balance)='object')
);
CREATE INDEX consumption_events_run_epoch ON consumption_events(run_id,epoch);
CREATE INDEX consumption_events_account ON consumption_events(account_id);
CREATE INDEX consumption_events_action ON consumption_events(action_id);
CREATE INDEX consumption_events_operation ON consumption_events(operation_id);
CREATE INDEX consumption_events_item ON consumption_events(item_id);
CREATE INDEX consumption_events_source ON consumption_events(source_event_id);
CREATE UNIQUE INDEX consumption_one_baseline ON consumption_events(run_id) WHERE kind='BASELINE';
CREATE UNIQUE INDEX consumption_one_undo ON consumption_events(account_id) WHERE kind='UNDO';
CREATE UNIQUE INDEX consumption_one_epoch ON consumption_events(run_id,epoch) WHERE kind='RESET';
CREATE UNIQUE INDEX consumption_one_commit ON consumption_events(action_id) WHERE kind IN('CONSUME','UNDO');
CREATE INDEX consumption_events_run_history ON consumption_events(run_id,id DESC);
INSERT INTO consumption_events(run_id,account_id,kind,before_balance,after_balance,policy,migrated)
 SELECT s.run_id,c.account_id,'BASELINE',jsonb_build_object('fullness',s.fullness,'drunkenness',s.drunkenness,'tolerance',s.tolerance),
 jsonb_build_object('fullness',s.fullness,'drunkenness',s.drunkenness,'tolerance',s.tolerance),consumption_policy(r.id),true
 FROM run_consumption s JOIN runs r ON r.id=s.run_id JOIN characters c ON c.id=r.character_id;
CREATE TRIGGER consumption_events_immutable BEFORE UPDATE OR DELETE ON consumption_events FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION capture_consumption_baseline() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO consumption_events(run_id,account_id,kind,before_balance,after_balance,policy)
 SELECT NEW.run_id,c.account_id,'BASELINE','{}'::jsonb,jsonb_build_object('fullness',NEW.fullness,'drunkenness',NEW.drunkenness,'tolerance',NEW.tolerance),consumption_policy(r.id)
 FROM runs r JOIN characters c ON c.id=r.character_id WHERE r.id=NEW.run_id;
 RETURN NEW;
END $$;
CREATE TRIGGER consumption_baseline AFTER INSERT ON run_consumption FOR EACH ROW EXECUTE FUNCTION capture_consumption_baseline();
CREATE FUNCTION validate_consumption_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_balance jsonb; item inventory_items%ROWTYPE; spec jsonb; key text; old consumption_events%ROWTYPE;
BEGIN
 IF NEW.migrated OR NOT EXISTS(SELECT 1 FROM runs r JOIN characters c ON c.id=r.character_id WHERE r.id=NEW.run_id AND c.account_id=NEW.account_id AND r.status IN('ACTIVE','AFTERCORE')) THEN RAISE EXCEPTION 'Consumption requires active owned evidence'; END IF;
 IF NEW.kind='BASELINE' THEN RETURN NEW; END IF;
 SELECT jsonb_build_object('fullness',fullness,'drunkenness',drunkenness,'tolerance',tolerance) INTO current_balance FROM run_consumption WHERE run_id=NEW.run_id FOR UPDATE;
 IF NEW.before_balance IS DISTINCT FROM current_balance OR NEW.policy IS DISTINCT FROM consumption_policy(NEW.run_id) THEN RAISE EXCEPTION 'Consumption state or policy changed'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(NEW.after_balance) e WHERE e.key NOT IN('fullness','drunkenness','tolerance') OR jsonb_typeof(e.value)<>'number' OR e.value::text !~ '^[0-9]+$') OR NOT(NEW.after_balance ?& ARRAY['fullness','drunkenness','tolerance']) THEN RAISE EXCEPTION 'Invalid consumption balance'; END IF;
 IF NEW.kind='CONSUME' THEN
  SELECT * INTO item FROM inventory_items WHERE id=NEW.item_id;
  SELECT definition->'mechanics'->'itemUse'->'consumption' INTO spec FROM content_versions WHERE entity_id=item.definition_id AND revision=item.definition_revision;
  IF spec IS NULL OR NEW.action_id IS NULL OR NEW.request_id IS NULL OR NOT EXISTS(SELECT 1 FROM inventory_quantity_operations o WHERE o.id=NEW.operation_id AND o.kind='CONSUME' AND o.from_item_id=item.id AND o.quantity=1 AND o.action_id=NEW.action_id) THEN RAISE EXCEPTION 'Consumption requires sealed item debit'; END IF;
  FOREACH key IN ARRAY ARRAY['fullness','drunkenness','tolerance'] LOOP
   IF (NEW.after_balance->>key)::integer<>(NEW.before_balance->>key)::integer+(spec->'costs'->>key)::integer THEN RAISE EXCEPTION 'Consumption cost mismatch'; END IF;
   IF key<>'drunkenness' AND (spec->'costs'->>key)::integer>0 AND (NEW.after_balance->>key)::integer>(NEW.policy->'capacities'->>key)::integer THEN RAISE EXCEPTION 'Consumption capacity exceeded'; END IF;
  END LOOP;
  IF NEW.policy->'forbiddenFamilies' ? (spec->>'family') OR NEW.turn_delta<>consumption_yield(spec,item.quality) THEN RAISE EXCEPTION 'Consumption yield or legality mismatch'; END IF;
  IF (spec->'costs'->>'drunkenness')::integer>0 AND ((NEW.before_balance->>'drunkenness')::integer>(NEW.policy->'capacities'->>'drunkenness')::integer OR (NEW.after_balance->>'drunkenness')::integer>(NEW.policy->'capacities'->>'drunkenness')::integer AND (NOT NEW.confirmed_overdrink OR NOT (NEW.policy->>'allowNightcaps')::boolean)) THEN RAISE EXCEPTION 'Overdrink requires explicit consent'; END IF;
 ELSIF NEW.kind='RESET' THEN
  IF NEW.epoch IS NULL OR NEW.action_id IS NOT NULL OR NEW.turn_delta<>0 THEN RAISE EXCEPTION 'Consumption reset requires rollover'; END IF;
  FOREACH key IN ARRAY ARRAY['fullness','drunkenness','tolerance'] LOOP
   IF (NEW.after_balance->>key)::integer<>(CASE WHEN (NEW.policy->'reset'->>key)::boolean THEN 0 ELSE (NEW.before_balance->>key)::integer END) THEN RAISE EXCEPTION 'Consumption reset mismatch'; END IF;
  END LOOP;
 ELSE
  SELECT * INTO old FROM consumption_events WHERE id=NEW.source_event_id;
  IF old.action_id IS DISTINCT FROM (SELECT action_id FROM audit_events WHERE actor_account_id=NEW.account_id AND category='ACTION_COMMITTED' ORDER BY id DESC LIMIT 1) OR old.kind IS DISTINCT FROM 'CONSUME' OR old.run_id<>NEW.run_id OR old.account_id<>NEW.account_id OR old.policy<>NEW.policy OR old.after_balance<>NEW.before_balance OR old.before_balance<>NEW.after_balance OR NEW.turn_delta<>-old.turn_delta OR (old.after_balance->>'drunkenness')::integer<=(old.policy->'capacities'->>'drunkenness')::integer OR old.committed_revision<>(SELECT revision FROM runs WHERE id=NEW.run_id) OR old.id<>(SELECT max(id) FROM consumption_events WHERE run_id=NEW.run_id) THEN RAISE EXCEPTION 'Onboarding undo is no longer safe'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER consumption_event_guard BEFORE INSERT ON consumption_events FOR EACH ROW EXECUTE FUNCTION validate_consumption_event();
CREATE FUNCTION project_consumption_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind<>'BASELINE' THEN UPDATE run_consumption SET fullness=(NEW.after_balance->>'fullness')::integer,drunkenness=(NEW.after_balance->>'drunkenness')::integer,tolerance=(NEW.after_balance->>'tolerance')::integer WHERE run_id=NEW.run_id; END IF; RETURN NEW;
END $$;
CREATE TRIGGER consumption_projection AFTER INSERT ON consumption_events FOR EACH ROW EXECUTE FUNCTION project_consumption_event();
CREATE VIEW consumption_issues AS
 SELECT s.run_id FROM run_consumption s LEFT JOIN LATERAL(SELECT after_balance FROM consumption_events e WHERE e.run_id=s.run_id ORDER BY e.id DESC LIMIT 1) e ON true
 WHERE e.after_balance IS DISTINCT FROM jsonb_build_object('fullness',s.fullness,'drunkenness',s.drunkenness,'tolerance',s.tolerance);
CREATE FUNCTION reconcile_consumption() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event consumption_events%ROWTYPE; balance jsonb; parent jsonb;
BEGIN
 IF EXISTS(SELECT 1 FROM consumption_issues WHERE run_id=NEW.run_id) THEN RAISE EXCEPTION 'Consumption projection requires immutable evidence'; END IF;
 IF TG_TABLE_NAME='consumption_events' THEN
  SELECT * INTO event FROM consumption_events WHERE id=NEW.id;
  IF event.kind='BASELINE' AND NOT event.migrated THEN
   SELECT jsonb_build_object('fullness',s.fullness,'drunkenness',s.drunkenness,'tolerance',s.tolerance) INTO parent FROM run_history h JOIN run_consumption s ON s.run_id=h.run_id WHERE h.next_run_id=event.run_id;
   IF coalesce(parent,'{"fullness":0,"drunkenness":0,"tolerance":0}'::jsonb) IS DISTINCT FROM event.after_balance THEN RAISE EXCEPTION 'Initial consumption must be empty or an exact Ascension carry'; END IF;
  END IF;
  IF event.kind IN('CONSUME','UNDO') AND (NOT EXISTS(SELECT 1 FROM action_receipts a WHERE a.action_id=event.action_id AND a.account_id=event.account_id AND a.request_id=event.request_id AND a.action_type IN('USE_ITEM','STEP_MEAL_PLAN','UNDO_OVERDRINK') AND (NOT event.confirmed_overdrink OR a.authorization_source IN('MANUAL_UI','API'))) OR NOT EXISTS(SELECT 1 FROM turn_ledger l WHERE l.run_id=event.run_id AND l.request_id=event.request_id AND l.delta=event.turn_delta AND l.reason=CASE WHEN event.kind='UNDO' THEN 'CONSUMPTION_UNDO' ELSE 'CONSUMPTION' END)) THEN RAISE EXCEPTION 'Consumption receipt or Turn ledger mismatch'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER consumption_balance_proof AFTER INSERT OR UPDATE ON run_consumption DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reconcile_consumption();
CREATE CONSTRAINT TRIGGER consumption_event_proof AFTER INSERT ON consumption_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reconcile_consumption();
CREATE TABLE meal_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES accounts(id),name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 80),
 lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array' AND jsonb_array_length(lines) BETWEEN 1 AND 20),deleted boolean NOT NULL DEFAULT false,revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(account_id,name)
);
CREATE INDEX meal_plans_account ON meal_plans(account_id);
CREATE TABLE meal_plan_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES accounts(id),run_id uuid NOT NULL REFERENCES runs(id),plan_id uuid NOT NULL REFERENCES meal_plans(id),
 plan_revision integer NOT NULL,lines jsonb NOT NULL,rollovers bigint NOT NULL CHECK(rollovers>=0),completed integer NOT NULL DEFAULT 0 CHECK(completed BETWEEN 0 AND 100),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','STOPPED')),stop_reason text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meal_plan_runs_account ON meal_plan_runs(account_id);
CREATE INDEX meal_plan_runs_run ON meal_plan_runs(run_id);
CREATE INDEX meal_plan_runs_plan ON meal_plan_runs(plan_id);

CREATE TABLE consumption_item_preferences (
 item_id uuid PRIMARY KEY REFERENCES inventory_items(id),account_id uuid NOT NULL REFERENCES accounts(id),
 never_auto boolean NOT NULL DEFAULT false,nightcap boolean NOT NULL DEFAULT false
);
CREATE INDEX consumption_item_preferences_account ON consumption_item_preferences(account_id);
