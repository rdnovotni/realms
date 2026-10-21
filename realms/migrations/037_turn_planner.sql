-- Account ownership deliberately prevents Ascension from refreshing allowances.
CREATE TABLE turn_preferences (
 account_id uuid PRIMARY KEY REFERENCES accounts(id),
 reserve integer NOT NULL DEFAULT 0 CHECK(reserve BETWEEN 0 AND 1000000)
);
CREATE TABLE daily_allowances (
 account_id uuid NOT NULL REFERENCES accounts(id),
 entity_id text NOT NULL REFERENCES content_entities(id),
 charges integer NOT NULL CHECK(charges BETWEEN 0 AND 1000),
 auto_collect boolean NOT NULL DEFAULT false,
 manual_uses integer NOT NULL DEFAULT 0 CHECK(manual_uses>=0),
 PRIMARY KEY(account_id,entity_id)
);
CREATE INDEX daily_allowance_entity ON daily_allowances(entity_id);
CREATE TABLE daily_allowance_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id),
 entity_id text NOT NULL REFERENCES content_entities(id),
 run_id uuid NOT NULL REFERENCES runs(id),
 release_id uuid NOT NULL REFERENCES content_releases(id),
 entity_revision integer NOT NULL,
 epoch bigint REFERENCES rollover_epochs(epoch),
 action_id uuid REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
 kind text NOT NULL CHECK(kind IN ('OPEN','USE','REFRESH','AUTO_COLLECT','PREFERENCE')),
 before_charges integer NOT NULL CHECK(before_charges>=0),
 after_charges integer NOT NULL CHECK(after_charges>=0),
 turn_bonus integer NOT NULL DEFAULT 0 CHECK(turn_bonus>=0),
 ledger_request_id uuid,auto_collect boolean,
 CHECK((turn_bonus>0)=(ledger_request_id IS NOT NULL)),
 CHECK((kind='PREFERENCE')=(auto_collect IS NOT NULL)),
 FOREIGN KEY(run_id,ledger_request_id) REFERENCES turn_ledger(run_id,request_id) DEFERRABLE INITIALLY DEFERRED,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(entity_id,entity_revision) REFERENCES content_versions(entity_id,revision),
 FOREIGN KEY(release_id,entity_id,entity_revision) REFERENCES release_entries(release_id,entity_id,revision)
);
CREATE UNIQUE INDEX daily_epoch_once ON daily_allowance_events(account_id,entity_id,epoch) WHERE epoch IS NOT NULL;
CREATE UNIQUE INDEX daily_action_once ON daily_allowance_events(account_id,entity_id,action_id) WHERE action_id IS NOT NULL;
CREATE INDEX daily_event_ledger ON daily_allowance_events(run_id,ledger_request_id);
CREATE INDEX daily_event_account ON daily_allowance_events(account_id,id DESC);
CREATE INDEX daily_event_entity ON daily_allowance_events(entity_id,entity_revision);
CREATE INDEX daily_event_run ON daily_allowance_events(run_id);
CREATE INDEX daily_event_release ON daily_allowance_events(release_id,entity_id,entity_revision);
CREATE INDEX daily_event_epoch ON daily_allowance_events(epoch);
CREATE INDEX daily_event_action ON daily_allowance_events(action_id);
CREATE TRIGGER immutable_daily_event BEFORE UPDATE OR DELETE ON daily_allowance_events FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TABLE turn_plans (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id),run_id uuid NOT NULL REFERENCES runs(id),
 entity_id text NOT NULL REFERENCES content_entities(id),
 max_turns integer NOT NULL CHECK(max_turns BETWEEN 0 AND 1000),
 max_actions integer NOT NULL CHECK(max_actions BETWEEN 1 AND 1000),
 spent integer NOT NULL DEFAULT 0 CHECK(spent BETWEEN 0 AND max_turns),
 completed integer NOT NULL DEFAULT 0 CHECK(completed BETWEEN 0 AND max_actions),
 min_health integer NOT NULL DEFAULT 0 CHECK(min_health BETWEEN 0 AND 1000000),
 target_item_id text REFERENCES content_entities(id),target_quantity integer CHECK(target_quantity BETWEEN 1 AND 1000000),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','STOPPED')),
 stop_reason text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((target_item_id IS NULL)=(target_quantity IS NULL))
);
CREATE INDEX turn_plan_owner ON turn_plans(account_id,created_at DESC);
CREATE INDEX turn_plan_run ON turn_plans(run_id);
CREATE INDEX turn_plan_entity ON turn_plans(entity_id);
CREATE INDEX turn_plan_target ON turn_plans(target_item_id);
-- Parsed SQL binds the account relation at migration time. Scheduler may lock
-- an account in game-action order without receiving account UPDATE privileges.
CREATE FUNCTION locked_rollover_account(target uuid) RETURNS SETOF accounts LANGUAGE SQL SECURITY DEFINER
BEGIN ATOMIC
 SELECT * FROM accounts WHERE id=target FOR UPDATE;
END;
REVOKE ALL ON FUNCTION locked_rollover_account(uuid) FROM PUBLIC;
