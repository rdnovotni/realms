-- Durable content identity and immutable release snapshots.
CREATE TABLE content_entities (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_.-]{2,119}$'),
  kind text NOT NULL CHECK (kind IN ('ITEM','EFFECT','ABILITY','CLASS','SPECIES','MONSTER','NPC','ENCOUNTER','QUEST','RECIPE','LOCATION','ROUTE','FACTION','PATH','EVENT','ACTIVITY','CARD','FAMILIAR','BOSS','LOOT_TABLE','LORE','TUNING')),
  retired_at timestamptz,
  UNIQUE (id, kind)
);
CREATE TABLE content_versions (
  entity_id text NOT NULL REFERENCES content_entities(id),
  revision integer NOT NULL CHECK (revision > 0),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition)='object'),
  checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, revision)
);
CREATE TABLE content_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE CHECK (length(version) BETWEEN 1 AND 100),
  engine_version text NOT NULL,
  checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest)='object'),
  sealed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE release_entries (
  release_id uuid NOT NULL REFERENCES content_releases(id),
  entity_id text NOT NULL,
  revision integer NOT NULL,
  PRIMARY KEY (release_id, entity_id),
  UNIQUE (release_id, entity_id, revision),
  FOREIGN KEY (entity_id, revision) REFERENCES content_versions(entity_id, revision)
);
ALTER TABLE runs ADD COLUMN content_release_id uuid REFERENCES content_releases(id);
ALTER TABLE runs ADD COLUMN started_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE runs ADD COLUMN completed_at timestamptz;
ALTER TABLE runs ADD COLUMN mode text NOT NULL DEFAULT 'STANDARD' CHECK (mode IN ('CASUAL','STANDARD','HARDCORE','EQUAL_START'));
ALTER TABLE runs ADD COLUMN rules_manifest jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(rules_manifest)='object');
DROP INDEX one_active_run;
ALTER TABLE runs DROP CONSTRAINT runs_status_check;
UPDATE runs SET status='ARCHIVED' WHERE status='COMPLETED';
ALTER TABLE runs ADD CONSTRAINT runs_status_check CHECK(status IN('ACTIVE','AFTERCORE','ARCHIVED','ABANDONED'));
CREATE UNIQUE INDEX one_current_run ON runs(character_id) WHERE status IN('ACTIVE','AFTERCORE');
ALTER TABLE action_receipts ADD COLUMN action_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
ALTER TABLE action_receipts ADD COLUMN action_type text NOT NULL DEFAULT 'SPEND_TURNS';
ALTER TABLE action_receipts ADD COLUMN envelope_version integer NOT NULL DEFAULT 1 CHECK(envelope_version IN (1,2));
ALTER TABLE action_receipts ADD COLUMN rules_version text NOT NULL DEFAULT 'prototype-0.1';
ALTER TABLE action_receipts ADD COLUMN authorization_source text NOT NULL DEFAULT 'MANUAL_UI'
  CHECK (authorization_source IN ('MANUAL_UI','PARSER','AUTOMATION','API','ADMIN'));

CREATE TABLE worlds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE);
CREATE TABLE guilds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE guild_members (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('OWNER','OFFICER','MEMBER')),
  PRIMARY KEY (guild_id, account_id), UNIQUE (account_id)
);
CREATE TABLE world_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), world_id uuid NOT NULL REFERENCES worlds(id),
  content_release_id uuid NOT NULL REFERENCES content_releases(id),
  lifecycle text NOT NULL CHECK (lifecycle IN ('PLANNED','ACTIVE','CLAIM_ONLY','ARCHIVED')),
  starts_at timestamptz, ends_at timestamptz,
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE TABLE instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('ENCOUNTER','COMBAT','DUNGEON','EXPEDITION','RAID','PVP','ACTIVITY','CARD_MATCH','HOME')),
  content_release_id uuid NOT NULL REFERENCES content_releases(id),
  lifecycle text NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle IN ('ACTIVE','RESOLVED','EXPIRED','MIGRATED')),
  seed bytea NOT NULL CHECK (octet_length(seed)=32),
  rng_version text NOT NULL DEFAULT 'hmac-sha256-v1' CHECK(rng_version='hmac-sha256-v1'),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  state jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(state)='object'),
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz
);
CREATE TABLE instance_participants (
  instance_id uuid NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES runs(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, run_id)
);

-- No dangling polymorphic owner IDs: exactly one real owner FK per scope.
CREATE TABLE state_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('ACCOUNT','CHARACTER','RUN','INSTANCE','GUILD','EVENT','WORLD')),
  account_id uuid UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  character_id uuid UNIQUE REFERENCES characters(id) ON DELETE CASCADE,
  run_id uuid UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
  instance_id uuid UNIQUE REFERENCES instances(id) ON DELETE CASCADE,
  guild_id uuid UNIQUE REFERENCES guilds(id) ON DELETE CASCADE,
  event_id uuid UNIQUE REFERENCES world_events(id) ON DELETE CASCADE,
  world_id uuid UNIQUE REFERENCES worlds(id) ON DELETE CASCADE,
  lifecycle text NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle IN ('ACTIVE','ARCHIVED')),
  UNIQUE (id, kind),
  CHECK (num_nonnulls(account_id,character_id,run_id,instance_id,guild_id,event_id,world_id)=1),
  CHECK (CASE kind WHEN 'ACCOUNT' THEN account_id IS NOT NULL WHEN 'CHARACTER' THEN character_id IS NOT NULL
    WHEN 'RUN' THEN run_id IS NOT NULL WHEN 'INSTANCE' THEN instance_id IS NOT NULL WHEN 'GUILD' THEN guild_id IS NOT NULL
    WHEN 'EVENT' THEN event_id IS NOT NULL WHEN 'WORLD' THEN world_id IS NOT NULL END)
);
CREATE FUNCTION create_owner_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'accounts' THEN INSERT INTO state_scopes(kind,account_id) VALUES('ACCOUNT',NEW.id);
    WHEN 'characters' THEN INSERT INTO state_scopes(kind,character_id) VALUES('CHARACTER',NEW.id);
    WHEN 'runs' THEN INSERT INTO state_scopes(kind,run_id) VALUES('RUN',NEW.id);
    WHEN 'instances' THEN INSERT INTO state_scopes(kind,instance_id) VALUES('INSTANCE',NEW.id);
    WHEN 'guilds' THEN INSERT INTO state_scopes(kind,guild_id) VALUES('GUILD',NEW.id);
    WHEN 'world_events' THEN INSERT INTO state_scopes(kind,event_id) VALUES('EVENT',NEW.id);
    WHEN 'worlds' THEN INSERT INTO state_scopes(kind,world_id) VALUES('WORLD',NEW.id);
    ELSE RAISE EXCEPTION 'Unknown scope owner';
  END CASE;
  RETURN NEW;
END $$;
CREATE TRIGGER account_scope AFTER INSERT ON accounts FOR EACH ROW EXECUTE FUNCTION create_owner_scope();
CREATE TRIGGER character_scope AFTER INSERT ON characters FOR EACH ROW EXECUTE FUNCTION create_owner_scope();
CREATE TRIGGER run_scope AFTER INSERT ON runs FOR EACH ROW EXECUTE FUNCTION create_owner_scope();
CREATE TRIGGER instance_scope AFTER INSERT ON instances FOR EACH ROW EXECUTE FUNCTION create_owner_scope();
CREATE TRIGGER guild_scope AFTER INSERT ON guilds FOR EACH ROW EXECUTE FUNCTION create_owner_scope();
CREATE TRIGGER event_scope AFTER INSERT ON world_events FOR EACH ROW EXECUTE FUNCTION create_owner_scope();
CREATE TRIGGER world_scope AFTER INSERT ON worlds FOR EACH ROW EXECUTE FUNCTION create_owner_scope();
INSERT INTO state_scopes(kind,account_id) SELECT 'ACCOUNT',id FROM accounts;
INSERT INTO state_scopes(kind,character_id) SELECT 'CHARACTER',id FROM characters;
INSERT INTO state_scopes(kind,run_id) SELECT 'RUN',id FROM runs;
UPDATE state_scopes SET lifecycle='ARCHIVED' WHERE run_id IN(SELECT id FROM runs WHERE status IN('ARCHIVED','ABANDONED'));

CREATE TABLE state_contracts (
  key text PRIMARY KEY, owner_module text NOT NULL,
  scope_kind text NOT NULL CHECK (scope_kind IN ('ACCOUNT','CHARACTER','RUN','INSTANCE','GUILD','EVENT','WORLD')),
  reset_policy text NOT NULL CHECK (reset_policy IN ('KEEP','ARCHIVE_WITH_OWNER','RESET_AT_ROLLOVER')),
  value_schema jsonb NOT NULL CHECK (jsonb_typeof(value_schema)='object'),
  default_value jsonb NOT NULL,
  UNIQUE(key,scope_kind)
);
CREATE TABLE scoped_state (
  scope_id uuid NOT NULL, scope_kind text NOT NULL, key text NOT NULL,
  value jsonb NOT NULL, revision bigint NOT NULL DEFAULT 0 CHECK (revision>=0),
  PRIMARY KEY(scope_id,key),
  FOREIGN KEY(scope_id,scope_kind) REFERENCES state_scopes(id,kind) ON DELETE CASCADE,
  FOREIGN KEY(key,scope_kind) REFERENCES state_contracts(key,scope_kind)
);
CREATE TABLE run_progression (
  run_id uuid PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  level integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 999),
  xp bigint NOT NULL DEFAULT 0 CHECK (xp>=0),
  strength integer NOT NULL DEFAULT 10 CHECK(strength>=0), dexterity integer NOT NULL DEFAULT 10 CHECK(dexterity>=0),
  constitution integer NOT NULL DEFAULT 10 CHECK(constitution>=0), intelligence integer NOT NULL DEFAULT 10 CHECK(intelligence>=0),
  wisdom integer NOT NULL DEFAULT 10 CHECK(wisdom>=0), charisma integer NOT NULL DEFAULT 10 CHECK(charisma>=0),
  world_time bigint NOT NULL DEFAULT 0 CHECK(world_time>=0)
);
CREATE TABLE run_class_levels (
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  class_id text NOT NULL, definition_kind text NOT NULL DEFAULT 'CLASS' CHECK(definition_kind='CLASS'),
  native_level integer NOT NULL CHECK(native_level BETWEEN 1 AND 999),
  PRIMARY KEY(run_id,class_id), FOREIGN KEY(class_id,definition_kind) REFERENCES content_entities(id,kind)
);
CREATE TABLE resource_pools (
  scope_id uuid NOT NULL REFERENCES state_scopes(id) ON DELETE CASCADE,
  resource_key text NOT NULL, amount bigint NOT NULL CHECK(amount>=0), capacity bigint NOT NULL CHECK(capacity>=0),
  PRIMARY KEY(scope_id,resource_key)
);
CREATE TABLE run_consumption (
  run_id uuid PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  fullness integer NOT NULL DEFAULT 0 CHECK(fullness>=0), drunkenness integer NOT NULL DEFAULT 0 CHECK(drunkenness>=0),
  tolerance integer NOT NULL DEFAULT 0 CHECK(tolerance>=0)
);
CREATE TABLE rollover_epochs (
  epoch bigint PRIMARY KEY CHECK(epoch>0), effective_at timestamptz NOT NULL UNIQUE,
  baseline_turns integer NOT NULL CHECK(baseline_turns>=0), turn_soft_cap integer NOT NULL CHECK(turn_soft_cap>0)
);
CREATE TABLE run_rollovers (
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id),
  epoch bigint NOT NULL REFERENCES rollover_epochs(epoch), turn_grant integer NOT NULL CHECK(turn_grant>=0),
  applied_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(run_id,epoch), UNIQUE(account_id,epoch)
);

CREATE TABLE inventory_containers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scope_id uuid NOT NULL REFERENCES state_scopes(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('CARRIED','MATERIAL_VAULT','HOME','MUSEUM','GUILD_VAULT','MAIL','LEGACY','ESCROW')),
  label text NOT NULL DEFAULT '', UNIQUE(scope_id,kind,label)
);
CREATE TABLE inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), container_id uuid NOT NULL REFERENCES inventory_containers(id),
  definition_id text NOT NULL, definition_kind text NOT NULL DEFAULT 'ITEM' CHECK(definition_kind='ITEM'),
  release_id uuid NOT NULL, definition_revision integer NOT NULL,
  storage_mode text NOT NULL CHECK(storage_mode IN ('INSTANCE','STACK')),
  quantity bigint NOT NULL CHECK(quantity>0), quality numeric(12,4) NOT NULL DEFAULT 1 CHECK(quality>0),
  binding text NOT NULL DEFAULT 'TRADEABLE' CHECK(binding IN ('TRADEABLE','ACCOUNT_BOUND','RUN_BOUND','SYSTEM_UNTRADEABLE')),
  bound_account_id uuid REFERENCES accounts(id), bound_run_id uuid REFERENCES runs(id),
  source_code text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), metadata jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object'),
  CHECK(storage_mode='STACK' OR quantity=1),
  CHECK((binding='ACCOUNT_BOUND')=(bound_account_id IS NOT NULL)),
  CHECK((binding='RUN_BOUND')=(bound_run_id IS NOT NULL)),
  FOREIGN KEY(definition_id,definition_kind) REFERENCES content_entities(id,kind),
  FOREIGN KEY(release_id,definition_id,definition_revision) REFERENCES release_entries(release_id,entity_id,revision)
);
CREATE INDEX inventory_by_container ON inventory_items(container_id,definition_id);
CREATE TABLE inventory_movements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES inventory_items(id), from_container_id uuid NOT NULL REFERENCES inventory_containers(id),
  to_container_id uuid NOT NULL REFERENCES inventory_containers(id), action_id uuid NOT NULL REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
  reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(from_container_id<>to_container_id), UNIQUE(item_id,action_id)
);
CREATE TABLE currencies (id text PRIMARY KEY, fractional_scale integer NOT NULL CHECK(fractional_scale BETWEEN 0 AND 6));
INSERT INTO currencies VALUES ('GOLD',0),('SUPPORTER_UNITS',2);
CREATE TABLE wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scope_id uuid NOT NULL REFERENCES state_scopes(id),
  currency_id text NOT NULL REFERENCES currencies(id), purpose text NOT NULL CHECK(purpose IN ('PLAYER','TREASURY','ESCROW','FAUCET_SINK')),
  balance bigint NOT NULL DEFAULT 0,
  CHECK(purpose='FAUCET_SINK' OR balance>=0), UNIQUE(scope_id,currency_id,purpose), UNIQUE(id,currency_id)
);
CREATE TABLE currency_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action_id uuid NOT NULL REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
  currency_id text NOT NULL REFERENCES currencies(id), from_wallet_id uuid NOT NULL, to_wallet_id uuid NOT NULL,
  amount bigint NOT NULL CHECK(amount>0), reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(from_wallet_id<>to_wallet_id), UNIQUE(action_id),
  FOREIGN KEY(from_wallet_id,currency_id) REFERENCES wallets(id,currency_id),
  FOREIGN KEY(to_wallet_id,currency_id) REFERENCES wallets(id,currency_id)
);
-- A transfer row updates both balances in canonical UUID lock order, in the same transaction.
CREATE FUNCTION apply_currency_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source wallets%ROWTYPE;
BEGIN
  PERFORM id FROM wallets WHERE id IN (NEW.from_wallet_id,NEW.to_wallet_id) ORDER BY id FOR UPDATE;
  SELECT * INTO STRICT source FROM wallets WHERE id=NEW.from_wallet_id;
  IF source.currency_id<>NEW.currency_id THEN RAISE EXCEPTION 'Currency mismatch'; END IF;
  IF source.purpose<>'FAUCET_SINK' AND source.balance<NEW.amount THEN RAISE EXCEPTION 'Insufficient balance' USING ERRCODE='23514'; END IF;
  UPDATE wallets SET balance=balance-NEW.amount WHERE id=NEW.from_wallet_id;
  UPDATE wallets SET balance=balance+NEW.amount WHERE id=NEW.to_wallet_id;
  RETURN NEW;
END $$;
CREATE TRIGGER currency_transfer BEFORE INSERT ON currency_transfers FOR EACH ROW EXECUTE FUNCTION apply_currency_transfer();
CREATE FUNCTION guard_wallet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.balance<>0 THEN RAISE EXCEPTION 'Wallets start at zero; use a transfer'; END IF;
  ELSE
    IF (to_jsonb(NEW)-'balance')<>(to_jsonb(OLD)-'balance') THEN RAISE EXCEPTION 'Wallet identity is immutable'; END IF;
    IF NEW.balance<>OLD.balance AND pg_trigger_depth()<>2 THEN RAISE EXCEPTION 'Balances change through transfers only'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wallet_guard BEFORE INSERT OR UPDATE ON wallets FOR EACH ROW EXECUTE FUNCTION guard_wallet();

CREATE TABLE discoveries (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  entity_id text NOT NULL REFERENCES content_entities(id),
  knowledge_level text NOT NULL CHECK(knowledge_level IN ('DISCOVERED','LEARNED','ADVANCED')),
  first_run_id uuid REFERENCES runs(id), discovered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,entity_id)
);
CREATE TABLE quest_states (
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  quest_id text NOT NULL, definition_kind text NOT NULL DEFAULT 'QUEST' CHECK(definition_kind='QUEST'),
  release_id uuid NOT NULL, definition_revision integer NOT NULL,
  lifecycle text NOT NULL CHECK(lifecycle IN ('RUMORED','DISCOVERED','ACTIVE','WAITING','BLOCKED','READY','RESOLVED','FAILED_FORWARD','ABANDONED','ARCHIVED')),
  node_id text NOT NULL, state jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(state)='object'), revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
  PRIMARY KEY(run_id,quest_id), FOREIGN KEY(quest_id,definition_kind) REFERENCES content_entities(id,kind),
  FOREIGN KEY(release_id,quest_id,definition_revision) REFERENCES release_entries(release_id,entity_id,revision)
);
CREATE TABLE effect_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scope_id uuid NOT NULL REFERENCES state_scopes(id),
  effect_id text NOT NULL, definition_kind text NOT NULL DEFAULT 'EFFECT' CHECK(definition_kind='EFFECT'),
  release_id uuid NOT NULL, definition_revision integer NOT NULL,
  source_ref text NOT NULL, stacks integer NOT NULL CHECK(stacks>0),
  clock text NOT NULL CHECK(clock IN ('ROUNDS','ENCOUNTERS','ADVENTURE_TURNS','WORLD_TIME','REST','FULL_REST','ROLLOVER','UNTIL_CLEANSED','CONDITIONAL','RUN')),
  remaining bigint CHECK(remaining>=0), snapshot jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(snapshot)='object'),
  FOREIGN KEY(effect_id,definition_kind) REFERENCES content_entities(id,kind),
  FOREIGN KEY(release_id,effect_id,definition_revision) REFERENCES release_entries(release_id,entity_id,revision)
);
CREATE TABLE run_history (
  run_id uuid PRIMARY KEY REFERENCES runs(id), character_id uuid NOT NULL REFERENCES characters(id),
  next_run_id uuid NOT NULL UNIQUE REFERENCES runs(id), action_id uuid NOT NULL UNIQUE REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
  summary jsonb NOT NULL CHECK(jsonb_typeof(summary)='object'), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, action_id uuid REFERENCES action_receipts(action_id),
  actor_account_id uuid REFERENCES accounts(id), category text NOT NULL, source text NOT NULL,
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_by_action ON audit_events(action_id);
CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action_id uuid NOT NULL REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
  event_type text NOT NULL, payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  created_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz,
  UNIQUE(action_id,event_type)
);
CREATE INDEX outbox_pending ON outbox_events(created_at) WHERE delivered_at IS NULL;
CREATE TABLE durable_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_key text NOT NULL UNIQUE, kind text NOT NULL,
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
  available_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK(max_attempts>0), lease_token uuid, lease_until timestamptz,
  CHECK(attempts<=max_attempts),
  CHECK((status='RUNNING')=(lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX jobs_claimable ON durable_jobs(available_at) WHERE status IN ('PENDING','RUNNING');
CREATE TABLE feature_flags (
  key text PRIMARY KEY, enabled boolean NOT NULL DEFAULT false,
  kind text NOT NULL CHECK(kind IN ('RELEASE','CONTENT','SAFETY','ELIGIBILITY','CHALLENGE','EXPERIMENT')),
  revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION reject_record_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable record: %',TG_TABLE_NAME USING ERRCODE='55000'; END $$;
CREATE TRIGGER immutable_content_version BEFORE UPDATE OR DELETE ON content_versions FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION seal_content_release() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual jsonb;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Immutable content release'; END IF;
  IF OLD.sealed OR NOT NEW.sealed OR (to_jsonb(OLD)-'sealed')<>(to_jsonb(NEW)-'sealed') THEN RAISE EXCEPTION 'Only sealing an unsealed release is allowed'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.entity_id,'revision',e.revision,'checksum',v.checksum) ORDER BY e.entity_id COLLATE "C"),'[]'::jsonb)
    INTO actual FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=OLD.id;
  IF NEW.manifest->'entities' IS DISTINCT FROM actual THEN RAISE EXCEPTION 'Release manifest mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_content_release BEFORE UPDATE OR DELETE ON content_releases FOR EACH ROW EXECUTE FUNCTION seal_content_release();
CREATE FUNCTION check_open_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM content_releases WHERE id=NEW.release_id AND NOT sealed FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Release is sealed or missing'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER release_entry_insert BEFORE INSERT ON release_entries FOR EACH ROW EXECUTE FUNCTION check_open_release();
CREATE TRIGGER immutable_release_entry BEFORE UPDATE OR DELETE ON release_entries FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER immutable_currency_transfer BEFORE UPDATE OR DELETE ON currency_transfers FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER immutable_inventory_movement BEFORE UPDATE OR DELETE ON inventory_movements FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER immutable_run_history BEFORE UPDATE OR DELETE ON run_history FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER immutable_receipt BEFORE UPDATE ON action_receipts FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER immutable_turn_entry BEFORE UPDATE ON turn_ledger FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE INDEX receipts_by_created_at ON action_receipts(created_at);
CREATE INDEX instances_by_lifecycle ON instances(lifecycle,expires_at);
CREATE INDEX discoveries_by_entity ON discoveries(entity_id);

CREATE FUNCTION require_sealed_release() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE release uuid;
BEGIN
  release := coalesce(to_jsonb(NEW)->>'content_release_id',to_jsonb(NEW)->>'release_id')::uuid;
  IF TG_TABLE_NAME='runs' AND TG_OP='INSERT' AND release IS NULL THEN RAISE EXCEPTION 'New runs require a content release'; END IF;
  IF TG_OP='UPDATE' THEN
    IF TG_TABLE_NAME='runs' AND ((to_jsonb(NEW)->>'id') IS DISTINCT FROM (to_jsonb(OLD)->>'id') OR
      (to_jsonb(NEW)->>'character_id') IS DISTINCT FROM (to_jsonb(OLD)->>'character_id') OR
      (to_jsonb(NEW)->>'mode') IS DISTINCT FROM (to_jsonb(OLD)->>'mode') OR
      (to_jsonb(NEW)->>'started_at') IS DISTINCT FROM (to_jsonb(OLD)->>'started_at')) THEN RAISE EXCEPTION 'Run identity and mode are immutable'; END IF;
    IF TG_TABLE_NAME='runs' AND (to_jsonb(OLD)->>'content_release_id') IS NOT NULL AND
      ((to_jsonb(NEW)->>'content_release_id') IS DISTINCT FROM (to_jsonb(OLD)->>'content_release_id') OR
       (to_jsonb(NEW)->>'rules_version') IS DISTINCT FROM (to_jsonb(OLD)->>'rules_version') OR
       (to_jsonb(NEW)->'rules_manifest') IS DISTINCT FROM (to_jsonb(OLD)->'rules_manifest')) THEN
      RAISE EXCEPTION 'Run rules snapshot is immutable';
    END IF;
    IF TG_TABLE_NAME='instances' AND
      ((to_jsonb(NEW)->>'content_release_id') IS DISTINCT FROM (to_jsonb(OLD)->>'content_release_id') OR
       (to_jsonb(NEW)->>'seed') IS DISTINCT FROM (to_jsonb(OLD)->>'seed') OR
       (to_jsonb(NEW)->>'rng_version') IS DISTINCT FROM (to_jsonb(OLD)->>'rng_version')) THEN
      RAISE EXCEPTION 'Instance rules and RNG snapshot are immutable';
    END IF;
  END IF;
  IF release IS NOT NULL AND NOT EXISTS(SELECT 1 FROM content_releases WHERE id=release AND sealed) THEN
    RAISE EXCEPTION 'A sealed content release is required';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER run_release BEFORE INSERT OR UPDATE ON runs FOR EACH ROW EXECUTE FUNCTION require_sealed_release();
CREATE TRIGGER instance_release BEFORE INSERT OR UPDATE ON instances FOR EACH ROW EXECUTE FUNCTION require_sealed_release();
CREATE TRIGGER event_release BEFORE INSERT OR UPDATE OF content_release_id ON world_events FOR EACH ROW EXECUTE FUNCTION require_sealed_release();
CREATE TRIGGER item_release BEFORE INSERT OR UPDATE OF release_id ON inventory_items FOR EACH ROW EXECUTE FUNCTION require_sealed_release();
CREATE TRIGGER quest_release BEFORE INSERT OR UPDATE OF release_id ON quest_states FOR EACH ROW EXECUTE FUNCTION require_sealed_release();
CREATE TRIGGER effect_release BEFORE INSERT OR UPDATE OF release_id ON effect_instances FOR EACH ROW EXECUTE FUNCTION require_sealed_release();
CREATE FUNCTION guard_content_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.kind<>OLD.kind OR (OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at) THEN
    RAISE EXCEPTION 'Content identity cannot be recycled';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER content_identity BEFORE UPDATE ON content_entities FOR EACH ROW EXECUTE FUNCTION guard_content_identity();
CREATE TRIGGER content_identity_delete BEFORE DELETE ON content_entities FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER immutable_contract BEFORE UPDATE OR DELETE ON state_contracts FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER immutable_rollover_epoch BEFORE UPDATE OR DELETE ON rollover_epochs FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER immutable_rollover BEFORE UPDATE OR DELETE ON run_rollovers FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE INDEX runs_by_release ON runs(content_release_id);
CREATE INDEX participants_by_run ON instance_participants(run_id);
CREATE INDEX versions_by_revision ON release_entries(entity_id,revision);
CREATE INDEX quests_by_definition ON quest_states(quest_id,definition_revision);
CREATE INDEX effects_by_scope ON effect_instances(scope_id,clock);
CREATE INDEX effects_by_definition ON effect_instances(effect_id,definition_revision);
CREATE INDEX movements_by_action ON inventory_movements(action_id);
CREATE INDEX transfers_by_from ON currency_transfers(from_wallet_id,created_at);
CREATE INDEX transfers_by_to ON currency_transfers(to_wallet_id,created_at);
CREATE INDEX wallets_by_currency ON wallets(currency_id);
CREATE INDEX audit_by_actor ON audit_events(actor_account_id,created_at);
CREATE INDEX rollover_by_account ON run_rollovers(account_id,applied_at);
CREATE FUNCTION guard_scope_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-'lifecycle')<>(to_jsonb(OLD)-'lifecycle') OR (OLD.lifecycle='ARCHIVED' AND NEW.lifecycle<>'ARCHIVED') THEN
    RAISE EXCEPTION 'Scope identity and archived lifetime are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER scope_identity BEFORE UPDATE ON state_scopes FOR EACH ROW EXECUTE FUNCTION guard_scope_identity();
CREATE FUNCTION guard_item_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owning_account uuid; owning_run uuid;
BEGIN
  SELECT coalesce(s.account_id,c.account_id),s.run_id INTO owning_account,owning_run
    FROM inventory_containers b JOIN state_scopes s ON s.id=b.scope_id
    LEFT JOIN runs r ON r.id=s.run_id LEFT JOIN characters c ON c.id=r.character_id WHERE b.id=NEW.container_id;
  IF NEW.binding='ACCOUNT_BOUND' AND owning_account IS DISTINCT FROM NEW.bound_account_id THEN RAISE EXCEPTION 'Account binding does not match custody'; END IF;
  IF NEW.binding='RUN_BOUND' AND owning_run IS DISTINCT FROM NEW.bound_run_id THEN RAISE EXCEPTION 'Run binding does not match custody'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER item_binding BEFORE INSERT OR UPDATE ON inventory_items FOR EACH ROW EXECUTE FUNCTION guard_item_binding();
CREATE FUNCTION guard_participant_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM instances i,runs r WHERE i.id=NEW.instance_id AND r.id=NEW.run_id AND i.content_release_id=r.content_release_id) THEN
    RAISE EXCEPTION 'Participant rules snapshot does not match instance';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER participant_release BEFORE INSERT OR UPDATE ON instance_participants FOR EACH ROW EXECUTE FUNCTION guard_participant_release();
CREATE FUNCTION guard_run_rollover() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM runs r JOIN characters c ON c.id=r.character_id WHERE r.id=NEW.run_id AND c.account_id=NEW.account_id) THEN
    RAISE EXCEPTION 'Rollover account does not own run';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rollover_owner BEFORE INSERT ON run_rollovers FOR EACH ROW EXECUTE FUNCTION guard_run_rollover();
CREATE FUNCTION guard_run_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.run_id=NEW.next_run_id OR NOT EXISTS(SELECT 1 FROM runs previous_run,runs following_run
    WHERE previous_run.id=NEW.run_id AND following_run.id=NEW.next_run_id AND previous_run.character_id=NEW.character_id AND following_run.character_id=NEW.character_id) THEN
    RAISE EXCEPTION 'Run history identities do not match';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER run_history_owner BEFORE INSERT ON run_history FOR EACH ROW EXECUTE FUNCTION guard_run_history();
CREATE FUNCTION require_open_new_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sealed OR jsonb_typeof(NEW.manifest->'entities') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'New releases must be open and declare their entries'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER new_release BEFORE INSERT ON content_releases FOR EACH ROW EXECUTE FUNCTION require_open_new_release();
