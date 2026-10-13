-- Technique checks use the encounter-start attributes and earned proficiency
-- ranks. This additional guard leaves historical, unopted origins unchanged.
CREATE FUNCTION guard_tactical_check_pins() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE hero jsonb; attrs jsonb; skills jsonb;
BEGIN
 IF NEW.spec->'rules'->'techniques' IS NULL THEN RETURN NEW; END IF;
 hero:=NEW.initial_checkpoint->'state'->'units'->0;
 SELECT inputs->'attributes' INTO attrs FROM character_encounter_snapshots WHERE instance_id=NEW.instance_id AND run_id=NEW.run_id;
 SELECT coalesce(jsonb_object_agg(skill_id,rank),'{}'::jsonb) INTO skills FROM run_skill_ranks WHERE run_id=NEW.run_id;
 IF hero->'checkAttributes' IS DISTINCT FROM attrs OR hero->'checkSkills' IS DISTINCT FROM skills THEN
  RAISE EXCEPTION 'Tactical checks must pin verified attributes and earned proficiency';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tactical_check_pins BEFORE INSERT ON tactical_encounter_origins FOR EACH ROW EXECUTE FUNCTION guard_tactical_check_pins();

CREATE TABLE tactical_effect_carryovers (
 instance_id uuid PRIMARY KEY REFERENCES tactical_encounter_origins(instance_id),
 run_id uuid NOT NULL REFERENCES runs(id),action_id uuid NOT NULL REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
 effects jsonb NOT NULL CHECK(jsonb_typeof(effects)='array' AND jsonb_array_length(effects)<=32)
);
CREATE INDEX tactical_effect_carry_run ON tactical_effect_carryovers(run_id);
CREATE INDEX tactical_effect_carry_action ON tactical_effect_carryovers(action_id);
CREATE TRIGGER tactical_effect_carry_immutable BEFORE UPDATE OR DELETE ON tactical_effect_carryovers FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION guard_tactical_effect_carry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e encounter_records%ROWTYPE; owner uuid;
BEGIN
 SELECT * INTO e FROM encounter_records WHERE instance_id=NEW.instance_id FOR UPDATE;
 SELECT o.run_id INTO owner FROM tactical_encounter_origins o WHERE instance_id=NEW.instance_id;
 IF owner IS DISTINCT FROM NEW.run_id OR e.outcome IS NOT NULL OR e.checkpoint->'state'->>'outcome' IS NULL
  OR NEW.action_id IS DISTINCT FROM (SELECT action_id FROM tactical_steps WHERE instance_id=NEW.instance_id ORDER BY revision DESC LIMIT 1)
  OR e.checkpoint->'rules'->'roundEffects'->>'version' IS DISTINCT FROM '4' THEN
  RAISE EXCEPTION 'Persistent effects require the terminal authored combat settlement';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tactical_effect_carry_guard BEFORE INSERT ON tactical_effect_carryovers FOR EACH ROW EXECUTE FUNCTION guard_tactical_effect_carry();
CREATE FUNCTION guard_tactical_carry_origin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected jsonb;
BEGIN
 SELECT effects INTO expected FROM tactical_effect_carryovers WHERE instance_id=NEW.previous_instance_id;
 IF NEW.spec->'rules'->'roundEffects'->>'version'='4' THEN
  IF NEW.initial_checkpoint->'state'->'units'->0->'carryEffects' IS DISTINCT FROM coalesce(expected,'[]'::jsonb)
   OR NEW.initial_checkpoint->'state'->'units'->0->'effects' IS DISTINCT FROM coalesce(expected,'[]'::jsonb) THEN
   RAISE EXCEPTION 'Persistent effects must match their immutable predecessor';
  END IF;
 ELSIF coalesce(expected,'[]'::jsonb)<>'[]'::jsonb THEN RAISE EXCEPTION 'Encounter does not support the retained effect clocks';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tactical_carry_origin_guard BEFORE INSERT ON tactical_encounter_origins FOR EACH ROW EXECUTE FUNCTION guard_tactical_carry_origin();
CREATE FUNCTION guard_tactical_carry_recovery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT spec->'rules'->'roundEffects'->>'version' FROM tactical_encounter_origins WHERE instance_id=NEW.instance_id)='4'
  AND NOT EXISTS(SELECT 1 FROM tactical_effect_carryovers WHERE instance_id=NEW.instance_id AND action_id=NEW.action_id) THEN
  RAISE EXCEPTION 'Tactical recovery must settle its persistent effect clocks';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tactical_carry_recovery_guard BEFORE INSERT ON tactical_recoveries FOR EACH ROW EXECUTE FUNCTION guard_tactical_carry_recovery();
