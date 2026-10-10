CREATE TABLE owned_companions (
 account_id uuid NOT NULL REFERENCES accounts(id),companion_id text NOT NULL,
 companion_kind text NOT NULL DEFAULT 'NPC' CHECK(companion_kind='NPC'),companion_revision integer NOT NULL,
 run_id uuid NOT NULL REFERENCES runs(id),release_id uuid NOT NULL,
 action_id uuid NOT NULL UNIQUE REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
 PRIMARY KEY(account_id,companion_id),FOREIGN KEY(companion_id,companion_kind) REFERENCES content_entities(id,kind),
 FOREIGN KEY(release_id,companion_id,companion_revision) REFERENCES release_entries(release_id,entity_id,revision)
);
CREATE INDEX owned_companion_definition ON owned_companions(companion_id,companion_kind);
CREATE INDEX owned_companion_release ON owned_companions(release_id,companion_id,companion_revision);
CREATE INDEX owned_companion_run ON owned_companions(run_id);
CREATE TRIGGER owned_companion_immutable BEFORE UPDATE OR DELETE ON owned_companions FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION guard_companion_recruitment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner uuid; release uuid; definition jsonb;
BEGIN
 SELECT c.account_id,r.content_release_id INTO owner,release FROM runs r JOIN characters c ON c.id=r.character_id WHERE r.id=NEW.run_id AND r.status IN('ACTIVE','AFTERCORE');
 IF owner IS DISTINCT FROM NEW.account_id OR NEW.companion_revision IS NOT NULL OR NEW.release_id IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM discoveries WHERE account_id=owner AND entity_id=NEW.companion_id)
  OR EXISTS(SELECT 1 FROM instance_participants p JOIN instances i ON i.id=p.instance_id WHERE p.run_id=NEW.run_id AND i.lifecycle='ACTIVE') THEN RAISE EXCEPTION 'Companion recruitment requires discovery and an eligible uncommitted run'; END IF;
 SELECT e.revision,v.definition INTO NEW.companion_revision,definition FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=release AND e.entity_id=NEW.companion_id;
 IF definition->'mechanics'->'companion' IS DISTINCT FROM '{"version":1,"access":"DISCOVERED"}'::jsonb THEN RAISE EXCEPTION 'NPC is not authored as a recruitable companion'; END IF;
 NEW.release_id:=release;RETURN NEW;
END $$;
CREATE TRIGGER companion_recruitment_guard BEFORE INSERT ON owned_companions FOR EACH ROW EXECUTE FUNCTION guard_companion_recruitment();
CREATE TABLE companion_tactical_recoveries (
 id bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 instance_id uuid NOT NULL REFERENCES tactical_encounter_origins(instance_id),run_id uuid NOT NULL REFERENCES runs(id),
 companion_id text NOT NULL,companion_kind text NOT NULL DEFAULT 'NPC' CHECK(companion_kind='NPC'),
 action_id uuid NOT NULL REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
 health integer NOT NULL CHECK(health BETWEEN 1 AND 1000000),mana integer NOT NULL CHECK(mana BETWEEN 0 AND 1000000),
 terminal_state text NOT NULL CHECK(terminal_state IN('ACTIVE','DOWNED','DEFEATED')),rescued boolean NOT NULL,
 PRIMARY KEY(instance_id,companion_id),FOREIGN KEY(companion_id,companion_kind) REFERENCES content_entities(id,kind)
);
CREATE INDEX companion_recovery_run ON companion_tactical_recoveries(run_id,companion_id,id);
CREATE INDEX companion_recovery_definition ON companion_tactical_recoveries(companion_id,companion_kind);
CREATE INDEX companion_recovery_action ON companion_tactical_recoveries(action_id);
CREATE TRIGGER companion_recovery_immutable BEFORE UPDATE OR DELETE ON companion_tactical_recoveries FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION guard_companion_origin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ally jsonb; unit jsonb; owner uuid; prior companion_tactical_recoveries%ROWTYPE;
BEGIN
 SELECT c.account_id INTO owner FROM runs r JOIN characters c ON c.id=r.character_id WHERE r.id=NEW.run_id;
 FOR ally IN SELECT v FROM jsonb_array_elements(NEW.spec->'allies') v WHERE v->>'owned'='true' LOOP
  IF NOT EXISTS(SELECT 1 FROM owned_companions WHERE account_id=owner AND companion_id=ally->>'definitionId') THEN RAISE EXCEPTION 'Companion is not owned'; END IF;
  SELECT v INTO unit FROM jsonb_array_elements(NEW.initial_checkpoint->'state'->'units') v WHERE v->>'id'=ally->>'id';
  SELECT * INTO prior FROM companion_tactical_recoveries WHERE run_id=NEW.run_id AND companion_id=ally->>'definitionId' ORDER BY id DESC LIMIT 1;
  IF unit->>'companionRecoveryId' IS DISTINCT FROM prior.id::text
   OR (prior.id IS NOT NULL AND ((unit->>'health')::integer<>least(prior.health,(unit->'stats'->>'maxHealth')::integer) OR (unit->>'mana')::integer<>least(prior.mana,(unit->'stats'->>'maxMana')::integer))) THEN RAISE EXCEPTION 'Companion pools must pin their latest recovery'; END IF;
 END LOOP;RETURN NEW;
END $$;
CREATE TRIGGER companion_origin_guard BEFORE INSERT ON tactical_encounter_origins FOR EACH ROW EXECUTE FUNCTION guard_companion_origin();
CREATE FUNCTION guard_companion_recovery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE origin tactical_encounter_origins%ROWTYPE; e encounter_records%ROWTYPE; ally jsonb; unit jsonb; owner uuid;
BEGIN
 SELECT * INTO origin FROM tactical_encounter_origins WHERE instance_id=NEW.instance_id;
 SELECT * INTO e FROM encounter_records WHERE instance_id=NEW.instance_id FOR UPDATE;
 SELECT v INTO ally FROM jsonb_array_elements(origin.spec->'allies') v WHERE v->>'owned'='true' AND v->>'definitionId'=NEW.companion_id;
 SELECT v INTO unit FROM jsonb_array_elements(e.checkpoint->'state'->'units') v WHERE v->>'id'=ally->>'id';
 SELECT c.account_id INTO owner FROM runs r JOIN characters c ON c.id=r.character_id WHERE r.id=NEW.run_id;
 IF ally IS NULL OR origin.run_id IS DISTINCT FROM NEW.run_id OR e.outcome IS NOT NULL OR e.checkpoint->'state'->>'outcome' IS NULL
  OR NEW.action_id IS DISTINCT FROM (SELECT action_id FROM tactical_steps WHERE instance_id=NEW.instance_id ORDER BY revision DESC LIMIT 1)
  OR NEW.health IS DISTINCT FROM (CASE WHEN (unit->>'health')::integer>0 THEN (unit->>'health')::integer ELSE least((unit->'stats'->>'maxHealth')::integer,(origin.spec->'failure'->>'recoveryHealth')::integer) END)
  OR NEW.mana IS DISTINCT FROM (unit->>'mana')::integer OR NEW.terminal_state IS DISTINCT FROM unit->>'state'
  OR NEW.rescued IS DISTINCT FROM (unit->>'state'<>'ACTIVE' AND e.checkpoint->'state'->>'outcome'='VICTORY') THEN RAISE EXCEPTION 'Companion recovery must reconcile its owned terminal state'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER companion_recovery_guard BEFORE INSERT ON companion_tactical_recoveries FOR EACH ROW EXECUTE FUNCTION guard_companion_recovery();
CREATE FUNCTION check_companion_recruitment_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM action_receipts a WHERE a.action_id=NEW.action_id AND a.account_id=NEW.account_id AND a.action_type='RECRUIT_COMPANION') THEN RAISE EXCEPTION 'Recruitment requires its owner action receipt'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER companion_recruitment_receipt AFTER INSERT ON owned_companions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_companion_recruitment_receipt();
CREATE FUNCTION check_companion_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected integer;
BEGIN
 SELECT count(*)::integer INTO expected FROM tactical_encounter_origins o,jsonb_array_elements(o.spec->'allies') a WHERE o.instance_id=NEW.instance_id AND a->>'owned'='true';
 IF expected<>(SELECT count(*) FROM companion_tactical_recoveries WHERE instance_id=NEW.instance_id AND action_id=NEW.action_id) THEN RAISE EXCEPTION 'Recovery must settle every owned companion'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER companion_settlement_guard BEFORE INSERT ON tactical_recoveries FOR EACH ROW EXECUTE FUNCTION check_companion_settlement();
