-- No gameplay policy or schedule is enabled by this migration.
CREATE TABLE game_schedules (
 id text PRIMARY KEY CHECK(id ~ '^[a-z][a-z0-9_-]{2,63}$'),
 hook text NOT NULL CHECK(hook ~ '^[A-Z][A-Z0-9_]{2,63}$'),
 cadence text NOT NULL CHECK(cadence IN ('DAILY','ONCE')),
 timezone text NOT NULL, local_time text NOT NULL CHECK(local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 start_date date NOT NULL CHECK(start_date BETWEEN '2000-01-01' AND '2099-12-31'), next_date date NOT NULL,
 config jsonb NOT NULL DEFAULT '{}', enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), last_planned_at timestamptz, last_error text
);
CREATE UNIQUE INDEX one_daily_rollover ON game_schedules(hook) WHERE hook='DAILY_ROLLOVER';
CREATE FUNCTION guard_game_schedule() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.id,NEW.hook,NEW.cadence,NEW.timezone,NEW.local_time,NEW.start_date,NEW.config)
 IS DISTINCT FROM (OLD.id,OLD.hook,OLD.cadence,OLD.timezone,OLD.local_time,OLD.start_date,OLD.config)
 THEN RAISE EXCEPTION 'Schedule definition is immutable'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER immutable_schedule_definition BEFORE UPDATE ON game_schedules FOR EACH ROW EXECUTE FUNCTION guard_game_schedule();
CREATE TABLE scheduled_periods (
 id text PRIMARY KEY, schedule_id text NOT NULL REFERENCES game_schedules(id), game_date date NOT NULL,
 effective_at timestamptz NOT NULL, epoch bigint REFERENCES rollover_epochs(epoch),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SUCCEEDED','FAILED')),
 cursor jsonb NOT NULL DEFAULT '{}', attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 available_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 last_error text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(schedule_id,game_date)
);
CREATE INDEX scheduled_periods_pending ON scheduled_periods(available_at,effective_at,id) WHERE status='PENDING';
CREATE FUNCTION guard_scheduled_period() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status='SUCCEEDED' OR (NEW.id,NEW.schedule_id,NEW.game_date,NEW.effective_at,NEW.epoch)
 IS DISTINCT FROM (OLD.id,OLD.schedule_id,OLD.game_date,OLD.effective_at,OLD.epoch)
 THEN RAISE EXCEPTION 'Completed period or period identity is immutable'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER immutable_period_identity BEFORE UPDATE ON scheduled_periods FOR EACH ROW EXECUTE FUNCTION guard_scheduled_period();
CREATE TABLE rollover_subjects (
 period_id text NOT NULL REFERENCES scheduled_periods(id), account_id uuid NOT NULL REFERENCES accounts(id),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','DEFERRED','DONE')),
 result jsonb, available_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(period_id,account_id)
);
CREATE INDEX rollover_subjects_pending ON rollover_subjects(period_id,available_at,account_id) WHERE status<>'DONE';
CREATE FUNCTION guard_rollover_subject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status='DONE' OR (NEW.period_id,NEW.account_id) IS DISTINCT FROM (OLD.period_id,OLD.account_id)
 THEN RAISE EXCEPTION 'Completed rollover subject is immutable'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER immutable_rollover_subject BEFORE UPDATE ON rollover_subjects FOR EACH ROW EXECUTE FUNCTION guard_rollover_subject();
CREATE TABLE scheduler_execution_log (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, period_id text REFERENCES scheduled_periods(id),
 schedule_id text NOT NULL REFERENCES game_schedules(id), outcome text NOT NULL CHECK(outcome IN ('BATCH','SUCCEEDED','RETRY','FAILED','RESUMED','PLANNING_FAILED')),
 error_code text CHECK(error_code ~ '^[A-Z0-9_]{1,64}$'), report jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_scheduler_log BEFORE UPDATE OR DELETE ON scheduler_execution_log FOR EACH ROW EXECUTE FUNCTION reject_record_change();
-- Every foreign-key access path remains indexed under the foundation audit.
CREATE INDEX scheduled_periods_epoch ON scheduled_periods(epoch);
CREATE INDEX rollover_subjects_account ON rollover_subjects(account_id);
CREATE INDEX scheduler_log_period ON scheduler_execution_log(period_id);
CREATE INDEX scheduler_log_schedule ON scheduler_execution_log(schedule_id);
