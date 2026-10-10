-- Opt-in cooperative fights retain a personal encounter and reward commitment
-- for every consenting run; a separate shared journal owns tactical transitions.
CREATE TABLE shared_tactical_sessions (
 id uuid PRIMARY KEY,host_run_id uuid NOT NULL REFERENCES runs(id),release_id uuid NOT NULL REFERENCES content_releases(id),
 definition_id text NOT NULL,definition_revision integer NOT NULL,spec jsonb NOT NULL,
 lifecycle text NOT NULL DEFAULT 'LOBBY' CHECK(lifecycle IN('LOBBY','ACTIVE','TERMINAL','CANCELLED')),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),checkpoint jsonb,
 FOREIGN KEY(release_id,definition_id,definition_revision) REFERENCES release_entries(release_id,entity_id,revision)
);
CREATE TABLE shared_tactical_members (
 session_id uuid NOT NULL REFERENCES shared_tactical_sessions(id),run_id uuid NOT NULL REFERENCES runs(id),
 account_id uuid NOT NULL REFERENCES accounts(id),instance_id uuid NOT NULL UNIQUE REFERENCES encounter_records(instance_id),
 unit_id text NOT NULL,seat integer NOT NULL CHECK(seat BETWEEN 0 AND 5),
 action_id uuid NOT NULL REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
 previous_instance_id uuid,initial_checkpoint jsonb NOT NULL,
 PRIMARY KEY(session_id,run_id),UNIQUE(session_id,account_id),UNIQUE(session_id,seat),UNIQUE(session_id,unit_id)
);
CREATE INDEX shared_members_run ON shared_tactical_members(run_id);
CREATE INDEX shared_members_account ON shared_tactical_members(account_id);
CREATE TABLE shared_tactical_origins (
 session_id uuid PRIMARY KEY REFERENCES shared_tactical_sessions(id),checkpoint jsonb NOT NULL,
 action_id uuid NOT NULL REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE shared_tactical_steps (
 session_id uuid NOT NULL REFERENCES shared_tactical_origins(session_id),revision integer NOT NULL,
 action_id uuid NOT NULL REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
 control text NOT NULL CHECK(control IN('PLAYER','SERVER')),intent jsonb NOT NULL,evidence jsonb NOT NULL,state jsonb NOT NULL,
 PRIMARY KEY(session_id,revision)
);
CREATE TABLE shared_tactical_draws (
 session_id uuid NOT NULL REFERENCES shared_tactical_origins(session_id),counter bigint NOT NULL CHECK(counter>=0),
 draw_key text NOT NULL CHECK(draw_key ~ '^[a-z][a-z0-9_.-]{0,63}$'),bound bigint NOT NULL CHECK(bound BETWEEN 1 AND 4294967296),
 value bigint NOT NULL CHECK(value>=0 AND value<bound),action_id uuid NOT NULL REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
 PRIMARY KEY(session_id,counter),UNIQUE(session_id,draw_key)
);
CREATE TABLE shared_tactical_claims (
 instance_id uuid PRIMARY KEY REFERENCES shared_tactical_members(instance_id),
 action_id uuid NOT NULL UNIQUE REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TRIGGER shared_member_immutable BEFORE UPDATE OR DELETE ON shared_tactical_members FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER shared_origin_immutable BEFORE UPDATE OR DELETE ON shared_tactical_origins FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER shared_step_immutable BEFORE UPDATE OR DELETE ON shared_tactical_steps FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER shared_draw_immutable BEFORE UPDATE OR DELETE ON shared_tactical_draws FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER shared_claim_immutable BEFORE UPDATE OR DELETE ON shared_tactical_claims FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE VIEW tactical_all_origins AS
 SELECT * FROM tactical_encounter_origins
 UNION ALL
 SELECT m.instance_id,m.run_id,m.previous_instance_id,
 CASE WHEN m.run_id=s.host_run_id THEN s.spec ELSE jsonb_set(s.spec,'{allies}','[]'::jsonb) END,m.initial_checkpoint
 FROM shared_tactical_members m JOIN shared_tactical_sessions s ON s.id=m.session_id;
CREATE FUNCTION tactical_last_action(target uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT action_id FROM shared_tactical_claims WHERE instance_id=target),
 (SELECT action_id FROM tactical_steps WHERE instance_id=target ORDER BY revision DESC LIMIT 1))
$$;
ALTER TABLE encounter_records ADD UNIQUE(instance_id,run_id);
ALTER TABLE tactical_run_state DROP CONSTRAINT tactical_run_state_last_instance_id_run_id_fkey;
ALTER TABLE tactical_run_state ADD FOREIGN KEY(last_instance_id,run_id) REFERENCES encounter_records(instance_id,run_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE tactical_encounter_origins DROP CONSTRAINT tactical_encounter_origins_previous_instance_id_run_id_fkey;
ALTER TABLE tactical_encounter_origins ADD FOREIGN KEY(previous_instance_id,run_id) REFERENCES encounter_records(instance_id,run_id);
ALTER TABLE tactical_recoveries DROP CONSTRAINT tactical_recoveries_instance_id_fkey;
ALTER TABLE tactical_recoveries ADD FOREIGN KEY(instance_id) REFERENCES encounter_records(instance_id);
ALTER TABLE tactical_failure_costs DROP CONSTRAINT tactical_failure_costs_instance_id_fkey;
ALTER TABLE tactical_failure_costs ADD FOREIGN KEY(instance_id) REFERENCES encounter_records(instance_id);
ALTER TABLE tactical_effect_carryovers DROP CONSTRAINT tactical_effect_carryovers_instance_id_fkey;
ALTER TABLE tactical_effect_carryovers ADD FOREIGN KEY(instance_id) REFERENCES encounter_records(instance_id);
ALTER TABLE companion_tactical_recoveries DROP CONSTRAINT companion_tactical_recoveries_instance_id_fkey;
ALTER TABLE companion_tactical_recoveries ADD FOREIGN KEY(instance_id) REFERENCES encounter_records(instance_id);
CREATE FUNCTION guard_shared_member() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s shared_tactical_sessions%ROWTYPE; e encounter_records%ROWTYPE; snap jsonb; owner uuid; prior uuid; prior_health integer; prior_mana integer;
BEGIN
 SELECT * INTO s FROM shared_tactical_sessions WHERE id=NEW.session_id FOR UPDATE;
 SELECT * INTO e FROM encounter_records WHERE instance_id=NEW.instance_id;
 SELECT c.account_id INTO owner FROM runs r JOIN characters c ON c.id=r.character_id WHERE r.id=NEW.run_id;
 SELECT last_instance_id,health,mana INTO prior,prior_health,prior_mana FROM tactical_run_state WHERE run_id=NEW.run_id;
 SELECT derived->'stats' INTO snap FROM character_encounter_snapshots WHERE instance_id=NEW.instance_id;
 IF s.lifecycle IS DISTINCT FROM 'LOBBY' OR owner IS DISTINCT FROM NEW.account_id OR e.run_id IS DISTINCT FROM NEW.run_id
 OR e.start_action_id IS DISTINCT FROM NEW.action_id OR e.release_id IS DISTINCT FROM s.release_id OR e.definition_id IS DISTINCT FROM s.definition_id
 OR NEW.previous_instance_id IS DISTINCT FROM prior OR NEW.initial_checkpoint->'state'->'units'->0->'stats' IS DISTINCT FROM snap
 OR NEW.initial_checkpoint->'state'->'units'->0->>'id' IS DISTINCT FROM NEW.unit_id
 OR NEW.initial_checkpoint->'state'->'units'->0->'health' IS DISTINCT FROM to_jsonb(least(coalesce(prior_health,(snap->>'maxHealth')::integer),(snap->>'maxHealth')::integer))
 OR NEW.initial_checkpoint->'state'->'units'->0->'mana' IS DISTINCT FROM to_jsonb(least(coalesce(prior_mana,(snap->>'maxMana')::integer),(snap->>'maxMana')::integer))
 OR (NEW.seat=0 AND NEW.run_id IS DISTINCT FROM s.host_run_id)
 OR NEW.seat IS DISTINCT FROM (SELECT count(*)::integer FROM shared_tactical_members WHERE session_id=NEW.session_id)
 OR NEW.seat >= (s.spec->'sharedCombat'->>'maximumPlayers')::integer
 OR NEW.seat+jsonb_array_length(s.spec->'allies')>=6 THEN RAISE EXCEPTION 'Shared readiness requires an owned pinned personal encounter and an available party seat'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER shared_member_guard BEFORE INSERT ON shared_tactical_members FOR EACH ROW EXECUTE FUNCTION guard_shared_member();
CREATE FUNCTION guard_shared_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM shared_tactical_members m JOIN shared_tactical_sessions s ON s.id=m.session_id JOIN encounter_records e ON e.instance_id=m.instance_id
 WHERE m.instance_id=NEW.instance_id AND s.lifecycle IN('TERMINAL','CANCELLED') AND e.outcome IS NULL
 AND e.checkpoint->'state'->>'outcome' IS NOT NULL) THEN RAISE EXCEPTION 'Shared claim requires the terminal committed battle'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER shared_claim_guard BEFORE INSERT ON shared_tactical_claims FOR EACH ROW EXECUTE FUNCTION guard_shared_claim();
CREATE FUNCTION check_shared_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner uuid;
BEGIN
 IF TG_TABLE_NAME='shared_tactical_members' THEN owner:=NEW.account_id;
 ELSE SELECT account_id INTO owner FROM shared_tactical_members WHERE instance_id=NEW.instance_id; END IF;
 IF NOT EXISTS(SELECT 1 FROM action_receipts WHERE action_id=NEW.action_id AND account_id=owner AND action_type=(CASE WHEN TG_TABLE_NAME='shared_tactical_claims' THEN 'CLAIM_SHARED_TACTICAL' WHEN (to_jsonb(NEW)->>'seat')::integer=0 THEN 'CREATE_SHARED_TACTICAL' ELSE 'JOIN_SHARED_TACTICAL' END)) THEN RAISE EXCEPTION 'Shared readiness and claims require their owner receipt'; END IF;
 IF TG_TABLE_NAME='shared_tactical_claims' AND NOT EXISTS(SELECT 1 FROM encounter_records e JOIN tactical_recoveries recovery ON recovery.instance_id=e.instance_id JOIN shared_tactical_members m ON m.instance_id=e.instance_id JOIN shared_tactical_sessions s ON s.id=m.session_id WHERE e.instance_id=NEW.instance_id AND e.finish_action_id=NEW.action_id AND recovery.action_id=NEW.action_id AND e.outcome=s.checkpoint->'state'->>'outcome') THEN RAISE EXCEPTION 'Shared claims must finish their owned encounter and recovery in the same action'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER shared_member_receipt AFTER INSERT ON shared_tactical_members DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_shared_receipt();
CREATE CONSTRAINT TRIGGER shared_claim_receipt AFTER INSERT ON shared_tactical_claims DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_shared_receipt();

CREATE OR REPLACE FUNCTION guard_tactical_effect_carry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e encounter_records%ROWTYPE; owner uuid;
BEGIN
 SELECT * INTO e FROM encounter_records WHERE instance_id=NEW.instance_id FOR UPDATE;
 SELECT o.run_id INTO owner FROM tactical_all_origins o WHERE instance_id=NEW.instance_id;
 IF owner IS DISTINCT FROM NEW.run_id OR e.outcome IS NOT NULL OR e.checkpoint->'state'->>'outcome' IS NULL
  OR NEW.action_id IS DISTINCT FROM tactical_last_action(NEW.instance_id)
  OR e.checkpoint->'rules'->'roundEffects'->>'version' IS DISTINCT FROM '4' THEN
  RAISE EXCEPTION 'Persistent effects require the terminal authored combat settlement';
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_tactical_carry_recovery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT spec->'rules'->'roundEffects'->>'version' FROM tactical_all_origins WHERE instance_id=NEW.instance_id)='4'
  AND NOT EXISTS(SELECT 1 FROM tactical_effect_carryovers WHERE instance_id=NEW.instance_id AND action_id=NEW.action_id) THEN
  RAISE EXCEPTION 'Tactical recovery must settle its persistent effect clocks';
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_tactical_failure_costs() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o tactical_encounter_origins%ROWTYPE; e encounter_records%ROWTYPE; f jsonb; source wallets%ROWTYPE;
BEGIN
 SELECT * INTO o FROM tactical_all_origins WHERE instance_id=NEW.instance_id;
 SELECT * INTO e FROM encounter_records WHERE instance_id=NEW.instance_id FOR UPDATE;
 f:=o.spec->'failure';
 IF f->>'version' IS DISTINCT FROM '2' OR e.outcome IS NOT NULL OR e.checkpoint->'state'->>'outcome' IS NULL
  OR NEW.failed IS DISTINCT FROM (e.checkpoint->'state'->>'outcome' IN('DEFEAT','FAILED_FORWARD','SURRENDER'))
  OR NEW.action_id IS DISTINCT FROM tactical_last_action(NEW.instance_id)
  OR NEW.before_gold IS NOT NULL OR NEW.gold_lost IS NOT NULL OR NEW.source_wallet_id IS NOT NULL OR NEW.sink_wallet_id IS NOT NULL THEN
  RAISE EXCEPTION 'Tactical failure costs must be generated from the terminal disclosed contract';
 END IF;
 SELECT w.* INTO source FROM wallets w JOIN state_scopes s ON s.id=w.scope_id WHERE s.run_id=o.run_id AND s.lifecycle='ACTIVE' AND w.currency_id='GOLD' AND w.purpose='PLAYER' ORDER BY w.id LIMIT 1 FOR UPDATE OF w;
 NEW.source_wallet_id:=source.id;NEW.before_gold:=coalesce(source.balance,0);
 NEW.gold_lost:=CASE WHEN NEW.failed THEN least(floor(NEW.before_gold::numeric*(f->>'goldLossBps')::integer/10000)::bigint,(f->>'goldLossCap')::bigint) ELSE 0 END;
 IF NEW.gold_lost>0 THEN
  SELECT w.id INTO NEW.sink_wallet_id FROM wallets w JOIN state_scopes s ON s.id=w.scope_id WHERE w.currency_id='GOLD' AND w.purpose='FAUCET_SINK' AND s.kind='WORLD' AND s.lifecycle='ACTIVE' ORDER BY w.id LIMIT 1;
  IF NEW.sink_wallet_id IS NULL THEN RAISE EXCEPTION 'Tactical failure requires a configured Gold sink'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_tactical_wear() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run uuid; f jsonb;
BEGIN
 SELECT o.run_id,o.spec->'failure' INTO run,f FROM tactical_all_origins o JOIN tactical_failure_costs costs ON costs.instance_id=o.instance_id WHERE o.instance_id=NEW.instance_id AND costs.failed;
 IF run IS NULL OR NEW.maximum IS NOT NULL OR NEW.before_condition IS NOT NULL OR NEW.after_condition IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM equipment_slots s JOIN run_equipment g ON g.run_id=s.run_id WHERE s.run_id=run AND s.item_id=NEW.item_id AND (s.set_id='WORN' OR s.set_id=g.active_set)) THEN RAISE EXCEPTION 'Tactical wear requires active owned equipment and an authored failure'; END IF;
 SELECT (v.definition->'mechanics'->'tacticalDurability'->>'maximum')::integer INTO NEW.maximum FROM inventory_items i JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision WHERE i.id=NEW.item_id FOR UPDATE OF i;
 IF NEW.maximum IS NULL THEN RAISE EXCEPTION 'Equipment has no authored durability'; END IF;
 SELECT after_condition INTO NEW.before_condition FROM tactical_equipment_wear WHERE item_id=NEW.item_id ORDER BY id DESC LIMIT 1;
 NEW.before_condition:=coalesce(NEW.before_condition,NEW.maximum);
 NEW.after_condition:=greatest(1,NEW.before_condition-ceil(NEW.maximum::numeric*(f->>'durabilityWearBps')::integer/10000)::integer);
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_tactical_recovery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e encounter_records%ROWTYPE; spec jsonb; hero jsonb; available integer; failure boolean; terminal text; last_action uuid; expected_health integer; expected_cost integer; expected_destination text;
BEGIN
 SELECT * INTO e FROM encounter_records WHERE instance_id=NEW.instance_id FOR UPDATE;
 SELECT o.spec INTO spec FROM tactical_all_origins o WHERE instance_id=NEW.instance_id;
 SELECT turns INTO available FROM runs WHERE id=e.run_id;
 last_action:=tactical_last_action(NEW.instance_id);
 hero:=e.checkpoint->'state'->'units'->0;terminal:=e.checkpoint->'state'->>'outcome';
 failure:=terminal IN('DEFEAT','FAILED_FORWARD','SURRENDER');
 expected_health:=CASE WHEN (hero->>'health')::integer>0 THEN (hero->>'health')::integer ELSE least((hero->'stats'->>'maxHealth')::integer,(spec->'failure'->>'recoveryHealth')::integer) END;
 expected_cost:=CASE WHEN failure THEN least(available,(spec->'failure'->>'turnCost')::integer) ELSE 0 END;
 expected_destination:=CASE WHEN failure THEN spec->'failure'->>'destination' ELSE 'FIELD' END;
 IF terminal IS NULL OR terminal NOT IN('VICTORY','DEFEAT','FAILED_FORWARD','RETREAT','SURRENDER') OR e.outcome IS NOT NULL
   OR NEW.action_id IS DISTINCT FROM last_action
   OR NEW.health IS DISTINCT FROM expected_health
   OR NEW.mana IS DISTINCT FROM (hero->>'mana')::integer
   OR NEW.turn_cost IS DISTINCT FROM expected_cost
   OR NEW.destination IS DISTINCT FROM expected_destination THEN
   RAISE EXCEPTION 'Tactical recovery must match terminal state and disclosed costs';
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_tactical_full_costs() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f jsonb; cost tactical_failure_costs%ROWTYPE; owner uuid; expected_wear integer;
BEGIN
 SELECT spec->'failure',run_id INTO f,owner FROM tactical_all_origins WHERE instance_id=NEW.instance_id;
 IF f->>'version' IS DISTINCT FROM '2' THEN RETURN NEW; END IF;
 SELECT * INTO cost FROM tactical_failure_costs WHERE instance_id=NEW.instance_id;
 IF cost.instance_id IS NULL OR cost.action_id IS DISTINCT FROM NEW.action_id THEN RAISE EXCEPTION 'Recovery must pin disclosed failure costs'; END IF;
 IF (cost.gold_lost=0 AND EXISTS(SELECT 1 FROM currency_transfers WHERE action_id=NEW.action_id AND leg_key='tactical-death'))
  OR (cost.gold_lost>0 AND NOT EXISTS(SELECT 1 FROM currency_transfers WHERE action_id=NEW.action_id AND leg_key='tactical-death' AND from_wallet_id=cost.source_wallet_id AND to_wallet_id=cost.sink_wallet_id AND amount=cost.gold_lost AND reason='TACTICAL_FAILURE')) THEN RAISE EXCEPTION 'Failure Gold must reconcile its immutable transfer'; END IF;
 SELECT CASE WHEN cost.failed THEN count(DISTINCT s.item_id)::integer ELSE 0 END INTO expected_wear FROM equipment_slots s JOIN run_equipment g ON g.run_id=s.run_id JOIN inventory_items i ON i.id=s.item_id JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision WHERE s.run_id=owner AND (s.set_id='WORN' OR s.set_id=g.active_set) AND v.definition->'mechanics'->'tacticalDurability' IS NOT NULL;
 IF expected_wear<>(SELECT count(*) FROM tactical_equipment_wear WHERE instance_id=NEW.instance_id) THEN RAISE EXCEPTION 'Failure must settle every eligible active item'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_companion_recovery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE origin tactical_encounter_origins%ROWTYPE; e encounter_records%ROWTYPE; ally jsonb; unit jsonb; owner uuid;
BEGIN
 SELECT * INTO origin FROM tactical_all_origins WHERE instance_id=NEW.instance_id;
 SELECT * INTO e FROM encounter_records WHERE instance_id=NEW.instance_id FOR UPDATE;
 SELECT v INTO ally FROM jsonb_array_elements(origin.spec->'allies') v WHERE v->>'owned'='true' AND v->>'definitionId'=NEW.companion_id;
 SELECT v INTO unit FROM jsonb_array_elements(e.checkpoint->'state'->'units') v WHERE v->>'id'=ally->>'id';
 SELECT c.account_id INTO owner FROM runs r JOIN characters c ON c.id=r.character_id WHERE r.id=NEW.run_id;
 IF ally IS NULL OR origin.run_id IS DISTINCT FROM NEW.run_id OR e.outcome IS NOT NULL OR e.checkpoint->'state'->>'outcome' IS NULL
  OR NEW.action_id IS DISTINCT FROM tactical_last_action(NEW.instance_id)
  OR NEW.health IS DISTINCT FROM (CASE WHEN (unit->>'health')::integer>0 THEN (unit->>'health')::integer ELSE least((unit->'stats'->>'maxHealth')::integer,(origin.spec->'failure'->>'recoveryHealth')::integer) END)
  OR NEW.mana IS DISTINCT FROM (unit->>'mana')::integer OR NEW.terminal_state IS DISTINCT FROM unit->>'state'
  OR NEW.rescued IS DISTINCT FROM (unit->>'state'<>'ACTIVE' AND e.checkpoint->'state'->>'outcome'='VICTORY') THEN RAISE EXCEPTION 'Companion recovery must reconcile its owned terminal state'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION check_companion_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected integer;
BEGIN
 SELECT count(*)::integer INTO expected FROM tactical_all_origins o,jsonb_array_elements(o.spec->'allies') a WHERE o.instance_id=NEW.instance_id AND a->>'owned'='true';
 IF expected<>(SELECT count(*) FROM companion_tactical_recoveries WHERE instance_id=NEW.instance_id AND action_id=NEW.action_id) THEN RAISE EXCEPTION 'Recovery must settle every owned companion'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION check_tactical_pool() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM tactical_all_origins WHERE instance_id=NEW.last_instance_id AND run_id=NEW.run_id) THEN RAISE EXCEPTION 'Tactical retained pools require a managed solo or consented shared origin'; END IF;
 IF EXISTS(SELECT 1 FROM tactical_run_state s JOIN tactical_all_origins o ON o.instance_id=s.last_instance_id
   LEFT JOIN tactical_recoveries recovery ON recovery.instance_id=o.instance_id
   WHERE s.run_id=NEW.run_id AND (
     s.health IS DISTINCT FROM coalesce(recovery.health,(o.initial_checkpoint->'state'->'units'->0->>'health')::integer)
     OR s.mana IS DISTINCT FROM coalesce(recovery.mana,(o.initial_checkpoint->'state'->'units'->0->>'mana')::integer)
     OR EXISTS(SELECT 1 FROM tactical_all_origins child WHERE child.previous_instance_id=s.last_instance_id))) THEN
   RAISE EXCEPTION 'Tactical retained pool does not match its latest immutable encounter';
 END IF;
 RETURN NULL;
END $$;

CREATE OR REPLACE VIEW tactical_integrity_issues AS
SELECT e.instance_id FROM encounter_records e
JOIN content_versions v ON v.entity_id=e.definition_id AND v.revision=e.definition_revision
LEFT JOIN tactical_encounter_origins o ON o.instance_id=e.instance_id
LEFT JOIN LATERAL (SELECT CASE WHEN o.instance_id IS NOT NULL AND (e.checkpoint->'state'->>'revision') ~ '^(0|[1-9][0-9]{0,5})$' THEN (e.checkpoint->'state'->>'revision')::integer ELSE NULL END AS revision) progress ON true
LEFT JOIN tactical_steps last ON last.instance_id=o.instance_id AND last.revision=progress.revision
LEFT JOIN tactical_recoveries recovery ON recovery.instance_id=o.instance_id
JOIN runs r ON r.id=e.run_id JOIN characters owner ON owner.id=r.character_id
WHERE (v.definition->'mechanics'->'tacticalCombat' IS NOT NULL AND o.instance_id IS NULL AND NOT EXISTS(SELECT 1 FROM shared_tactical_members m WHERE m.instance_id=e.instance_id))
 OR (o.instance_id IS NOT NULL AND (
   NOT EXISTS(SELECT 1 FROM tactical_run_state pool WHERE pool.run_id=o.run_id)
   OR o.run_id<>e.run_id OR o.spec IS DISTINCT FROM v.definition->'mechanics'->'tacticalCombat'
   OR e.checkpoint-'state' IS DISTINCT FROM o.initial_checkpoint-'state'
   OR e.checkpoint->'rules' IS DISTINCT FROM o.initial_checkpoint->'rules'
   OR e.checkpoint->'controlledIds' IS DISTINCT FROM o.initial_checkpoint->'controlledIds'
   OR e.revision IS DISTINCT FROM 1+progress.revision+(CASE WHEN e.outcome IS NULL THEN 0 ELSE 1 END)
   OR coalesce(progress.revision,-1)<>(SELECT count(*) FROM tactical_steps WHERE instance_id=o.instance_id)
   OR e.checkpoint->'state' IS DISTINCT FROM coalesce(last.state,o.initial_checkpoint->'state')
   OR (e.outcome IS NULL AND (e.checkpoint->'state'->>'outcome' IS NOT NULL OR recovery.instance_id IS NOT NULL))
   OR (e.outcome IS NOT NULL AND (e.outcome IS DISTINCT FROM e.checkpoint->'state'->>'outcome' OR recovery.instance_id IS NULL OR recovery.action_id IS DISTINCT FROM e.finish_action_id))
   OR EXISTS(SELECT 1 FROM tactical_steps step LEFT JOIN action_receipts receipt ON receipt.action_id=step.action_id
      WHERE step.instance_id=o.instance_id AND receipt.account_id IS DISTINCT FROM owner.account_id)
   OR (e.outcome IS NOT NULL AND last.action_id IS DISTINCT FROM e.finish_action_id)
 ));
CREATE FUNCTION guard_shared_session() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE authored jsonb;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT definition->'mechanics'->'tacticalCombat' INTO authored FROM content_versions WHERE entity_id=NEW.definition_id AND revision=NEW.definition_revision;
  IF NEW.spec IS DISTINCT FROM authored OR authored->'sharedCombat' IS NULL OR NEW.lifecycle<>'LOBBY' OR NEW.revision<>0 OR NEW.checkpoint IS NOT NULL
   OR NOT EXISTS(SELECT 1 FROM runs WHERE id=NEW.host_run_id AND content_release_id=NEW.release_id AND status IN('ACTIVE','AFTERCORE')) THEN RAISE EXCEPTION 'Shared session must pin an eligible authored release'; END IF;
 ELSE
  IF TG_OP='DELETE' OR OLD.lifecycle IN('TERMINAL','CANCELLED') OR (to_jsonb(OLD)-ARRAY['lifecycle','revision','checkpoint']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['lifecycle','revision','checkpoint'])
   OR (OLD.lifecycle='LOBBY' AND (NEW.lifecycle NOT IN('ACTIVE','CANCELLED') OR NEW.revision<>0 OR NOT EXISTS(SELECT 1 FROM shared_tactical_origins WHERE session_id=NEW.id AND checkpoint=NEW.checkpoint)))
   OR (OLD.lifecycle='ACTIVE' AND (NEW.lifecycle NOT IN('ACTIVE','TERMINAL') OR NEW.revision<>OLD.revision+1 OR NEW.checkpoint-'state' IS DISTINCT FROM OLD.checkpoint-'state')) THEN RAISE EXCEPTION 'Shared identity, roster and committed transitions are immutable'; END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER shared_session_guard BEFORE INSERT OR UPDATE OR DELETE ON shared_tactical_sessions FOR EACH ROW EXECUTE FUNCTION guard_shared_session();
CREATE FUNCTION check_shared_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; s shared_tactical_sessions%ROWTYPE; last jsonb; count_steps integer;
BEGIN
 target:=CASE WHEN TG_TABLE_NAME='shared_tactical_sessions' THEN (to_jsonb(NEW)->>'id')::uuid ELSE (to_jsonb(NEW)->>'session_id')::uuid END;
 SELECT * INTO s FROM shared_tactical_sessions WHERE id=target;
 IF s.lifecycle='LOBBY' THEN
  IF NOT EXISTS(SELECT 1 FROM shared_tactical_members WHERE session_id=target AND run_id=s.host_run_id AND seat=0) THEN RAISE EXCEPTION 'A shared lobby requires its host commitment'; END IF;
  RETURN NULL; END IF;
 SELECT count(*)::integer INTO count_steps FROM shared_tactical_steps WHERE session_id=target;
 SELECT state INTO last FROM shared_tactical_steps WHERE session_id=target ORDER BY revision DESC LIMIT 1;
 IF s.revision<>count_steps OR s.checkpoint->'state' IS DISTINCT FROM coalesce(last,(SELECT checkpoint->'state' FROM shared_tactical_origins WHERE session_id=target))
 OR s.checkpoint->'rules' IS DISTINCT FROM s.spec->'rules'
 OR (s.lifecycle='ACTIVE' AND s.checkpoint->'state'->>'outcome' IS NOT NULL)
 OR (s.lifecycle='TERMINAL' AND s.checkpoint->'state'->>'outcome' IS NULL)
 OR (s.lifecycle='CANCELLED' AND (s.revision<>0 OR s.checkpoint->'state'->>'outcome' IS DISTINCT FROM 'RETREAT'))
 OR EXISTS(SELECT 1 FROM shared_tactical_steps step LEFT JOIN action_receipts a ON a.action_id=step.action_id WHERE step.session_id=target
 AND (step.intent IS DISTINCT FROM step.evidence->'intent' OR step.state->>'revision' IS DISTINCT FROM step.revision::text
 OR a.action_type IS DISTINCT FROM 'SHARED_TACTICAL_ACTION' OR NOT EXISTS(SELECT 1 FROM shared_tactical_members m WHERE m.session_id=target AND m.account_id=a.account_id)
 OR (step.control='PLAYER' AND NOT EXISTS(SELECT 1 FROM shared_tactical_members m WHERE m.session_id=target AND m.account_id=a.account_id
 AND (m.unit_id=step.intent->>'actorId' OR m.run_id=s.host_run_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.spec->'allies') ally WHERE ally->>'id'=step.intent->>'actorId' AND (ally->>'owned' IS DISTINCT FROM 'true' OR ally->>'manual'='true'))))))) THEN RAISE EXCEPTION 'Shared state must reconcile consecutive owner-authorized history'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER shared_history_check AFTER INSERT OR UPDATE ON shared_tactical_sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_shared_history();
CREATE CONSTRAINT TRIGGER shared_step_check AFTER INSERT ON shared_tactical_steps DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_shared_history();
CREATE FUNCTION shared_unit_name(id text,owner text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN id=owner THEN 'hero' WHEN id='hero' THEN 'player.0' ELSE id END
$$;
CREATE FUNCTION shared_personal_state(session uuid,owner text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE state jsonb; units jsonb; ordering jsonb; budget jsonb;
BEGIN
 SELECT checkpoint->'state' INTO state FROM shared_tactical_sessions WHERE id=session;
 SELECT jsonb_agg(jsonb_set(CASE WHEN u->'effects' IS NULL THEN u ELSE jsonb_set(u,'{effects}',
  coalesce((SELECT jsonb_agg(jsonb_set(e,'{sourceUnitId}',to_jsonb(shared_unit_name(e->>'sourceUnitId',owner)))) FROM jsonb_array_elements(u->'effects') e),'[]'::jsonb)) END,
  '{id}',to_jsonb(shared_unit_name(u->>'id',owner))) ORDER BY (u->>'id'=owner) DESC,pos) INTO units FROM jsonb_array_elements(state->'units') WITH ORDINALITY t(u,pos);
 SELECT jsonb_agg(shared_unit_name(id,owner) ORDER BY pos) INTO ordering FROM jsonb_array_elements_text(state->'order') WITH ORDINALITY t(id,pos);
 SELECT jsonb_object_agg(shared_unit_name(k,owner),v) INTO budget FROM jsonb_each(state->'budgets') t(k,v);
 RETURN jsonb_set(jsonb_set(jsonb_set(state,'{units}',units),'{order}',ordering),'{budgets}',budget);
END $$;
CREATE OR REPLACE FUNCTION guard_shared_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM shared_tactical_members m JOIN shared_tactical_sessions s ON s.id=m.session_id JOIN encounter_records e ON e.instance_id=m.instance_id
 WHERE m.instance_id=NEW.instance_id AND s.lifecycle IN('TERMINAL','CANCELLED') AND e.outcome IS NULL
 AND e.checkpoint=jsonb_build_object('engine','SHARED_TACTICAL_V1','rules',s.spec->'rules','state',shared_personal_state(s.id,m.unit_id))) THEN RAISE EXCEPTION 'Shared claim requires its exact owner projection of the terminal committed battle'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION guard_shared_draw() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM shared_tactical_sessions WHERE id=NEW.session_id AND lifecycle='ACTIVE')
 OR NEW.counter IS DISTINCT FROM (SELECT coalesce(max(counter)+1,0) FROM shared_tactical_draws WHERE session_id=NEW.session_id) THEN RAISE EXCEPTION 'Shared random draws require an active consecutive stream'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER shared_draw_guard BEFORE INSERT ON shared_tactical_draws FOR EACH ROW EXECUTE FUNCTION guard_shared_draw();
CREATE FUNCTION guard_shared_step() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM shared_tactical_sessions WHERE id=NEW.session_id AND lifecycle='ACTIVE' AND revision+1=NEW.revision)
 OR NEW.intent IS DISTINCT FROM NEW.evidence->'intent' OR NEW.state->>'revision' IS DISTINCT FROM NEW.revision::text THEN RAISE EXCEPTION 'Shared steps require an active consecutive transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER shared_step_guard BEFORE INSERT ON shared_tactical_steps FOR EACH ROW EXECUTE FUNCTION guard_shared_step();
-- Existing companion records receive an empty condition list; no earlier
-- version supported persistent condition carryover for NPCs.
ALTER TABLE companion_tactical_recoveries ADD effects jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(effects)='array' AND jsonb_array_length(effects)<=32);
CREATE FUNCTION guard_companion_effects() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rules jsonb;
BEGIN
 SELECT spec->'rules' INTO rules FROM tactical_all_origins WHERE instance_id=NEW.instance_id;
 IF (rules->'roundEffects'->>'version' IS DISTINCT FROM '4' AND NEW.effects<>'[]'::jsonb)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.effects) e WHERE e->'effect'->>'version' IS DISTINCT FROM '4' OR e->'effect'->>'clock'='ROUNDS' OR (e->>'remaining')::integer NOT BETWEEN 1 AND 100 OR e->'concentrationId' IS NOT NULL) THEN RAISE EXCEPTION 'Companion carryover requires persistent authored combat clocks'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER companion_effects_guard BEFORE INSERT ON companion_tactical_recoveries FOR EACH ROW EXECUTE FUNCTION guard_companion_effects();

CREATE OR REPLACE FUNCTION guard_companion_origin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ally jsonb; unit jsonb; owner uuid; prior companion_tactical_recoveries%ROWTYPE;
BEGIN
 SELECT c.account_id INTO owner FROM runs r JOIN characters c ON c.id=r.character_id WHERE r.id=NEW.run_id;
 FOR ally IN SELECT v FROM jsonb_array_elements(NEW.spec->'allies') v WHERE v->>'owned'='true' LOOP
  IF NOT EXISTS(SELECT 1 FROM owned_companions WHERE account_id=owner AND companion_id=ally->>'definitionId') THEN RAISE EXCEPTION 'Companion is not owned'; END IF;
  SELECT v INTO unit FROM jsonb_array_elements(NEW.initial_checkpoint->'state'->'units') v WHERE v->>'id'=ally->>'id';
  SELECT * INTO prior FROM companion_tactical_recoveries WHERE run_id=NEW.run_id AND companion_id=ally->>'definitionId' ORDER BY id DESC LIMIT 1;
  IF unit->>'companionRecoveryId' IS DISTINCT FROM prior.id::text
   OR (prior.id IS NOT NULL AND ((unit->>'health')::integer<>least(prior.health,(unit->'stats'->>'maxHealth')::integer) OR (unit->>'mana')::integer<>least(prior.mana,(unit->'stats'->>'maxMana')::integer))) THEN RAISE EXCEPTION 'Companion pools must pin their latest recovery'; END IF;
  IF NEW.spec->'rules'->'roundEffects'->>'version'='4' THEN
   IF unit->'carryEffects' IS DISTINCT FROM coalesce(prior.effects,'[]'::jsonb) THEN RAISE EXCEPTION 'Companion conditions must pin their latest recovery'; END IF;
  ELSIF coalesce(prior.effects,'[]'::jsonb)<>'[]'::jsonb THEN RAISE EXCEPTION 'Encounter cannot discard persistent companion conditions'; END IF;
 END LOOP;RETURN NEW;
END $$;
CREATE FUNCTION guard_shared_origin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s shared_tactical_sessions%ROWTYPE; member shared_tactical_members%ROWTYPE; unit jsonb; count_members integer;
BEGIN
 SELECT * INTO s FROM shared_tactical_sessions WHERE id=NEW.session_id FOR UPDATE;
 SELECT count(*)::integer INTO count_members FROM shared_tactical_members WHERE session_id=s.id;
 IF s.lifecycle IS DISTINCT FROM 'LOBBY' OR NEW.checkpoint->>'engine' IS DISTINCT FROM 'TACTICAL_TRANSITION_V1'
 OR NEW.checkpoint->'rules' IS DISTINCT FROM s.spec->'rules' OR NEW.checkpoint->'state'->'revision' IS DISTINCT FROM '0'::jsonb
 OR count_members<1 OR count_members>(s.spec->'sharedCombat'->>'maximumPlayers')::integer
 OR (count_members<2 AND NEW.checkpoint->'state'->>'outcome' IS DISTINCT FROM 'RETREAT')
 OR jsonb_array_length(NEW.checkpoint->'state'->'units') IS DISTINCT FROM count_members+jsonb_array_length(s.spec->'allies')+jsonb_array_length(s.spec->'enemies') THEN RAISE EXCEPTION 'Shared start requires its frozen consent roster and authored battlefield'; END IF;
 FOR member IN SELECT * FROM shared_tactical_members WHERE session_id=s.id LOOP
  SELECT u INTO unit FROM jsonb_array_elements(NEW.checkpoint->'state'->'units') u WHERE u->>'id'=member.unit_id;
  IF unit IS NULL OR NOT (unit @> (member.initial_checkpoint->'state'->'units'->0)) THEN RAISE EXCEPTION 'Shared player must retain every pinned readiness input'; END IF;
 END LOOP;RETURN NEW;
END $$;
CREATE TRIGGER shared_origin_guard BEFORE INSERT ON shared_tactical_origins FOR EACH ROW EXECUTE FUNCTION guard_shared_origin();
CREATE INDEX shared_session_host ON shared_tactical_sessions(host_run_id);
CREATE INDEX shared_session_release ON shared_tactical_sessions(release_id,definition_id,definition_revision);
CREATE INDEX shared_member_action ON shared_tactical_members(action_id);
CREATE INDEX shared_member_previous ON shared_tactical_members(previous_instance_id,run_id);
ALTER TABLE shared_tactical_members ADD FOREIGN KEY(previous_instance_id,run_id) REFERENCES encounter_records(instance_id,run_id);
CREATE INDEX shared_origin_action ON shared_tactical_origins(action_id);
CREATE INDEX shared_step_action ON shared_tactical_steps(action_id);
CREATE INDEX shared_draw_action ON shared_tactical_draws(action_id);
CREATE FUNCTION check_shared_origin_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM shared_tactical_sessions s JOIN runs r ON r.id=s.host_run_id JOIN characters c ON c.id=r.character_id JOIN action_receipts a ON a.action_id=NEW.action_id WHERE s.id=NEW.session_id AND a.account_id=c.account_id AND a.action_type=CASE WHEN s.lifecycle='CANCELLED' THEN 'CANCEL_SHARED_TACTICAL' ELSE 'START_SHARED_TACTICAL' END) THEN RAISE EXCEPTION 'Shared start and cancellation require the host action receipt'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER shared_origin_receipt AFTER INSERT ON shared_tactical_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_shared_origin_receipt();
