-- Routine plans are bounded owner jobs. Their steps use the existing combat
-- journal and Action receipts; no alternative reward/roll authority is added.
CREATE TABLE tactical_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 run_id uuid NOT NULL REFERENCES runs(id),
 instance_id uuid NOT NULL REFERENCES tactical_encounter_origins(instance_id),
 max_actions integer NOT NULL CHECK(max_actions BETWEEN 1 AND 100),
 max_mana integer NOT NULL CHECK(max_mana BETWEEN 0 AND 1000000),
 min_health integer NOT NULL CHECK(min_health BETWEEN 0 AND 99),
 heal_below integer NOT NULL CHECK(heal_below BETWEEN 0 AND 100),
 completed integer NOT NULL DEFAULT 0 CHECK(completed BETWEEN 0 AND 100),
 spent_mana integer NOT NULL DEFAULT 0 CHECK(spent_mana BETWEEN 0 AND 1000000),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','STOPPED')),
 stop_reason text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tactical_plans_run ON tactical_plans(run_id);
CREATE INDEX tactical_plans_instance ON tactical_plans(instance_id);
CREATE UNIQUE INDEX tactical_plans_active ON tactical_plans(instance_id) WHERE status='ACTIVE';
