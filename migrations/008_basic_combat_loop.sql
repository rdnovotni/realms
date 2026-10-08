ALTER TABLE runs ADD COLUMN completion_policy text NOT NULL DEFAULT 'LEGACY' CHECK(completion_policy IN('LEGACY','CAMPAIGN'));
CREATE TABLE combat_run_state (
 run_id uuid PRIMARY KEY REFERENCES runs(id), release_id uuid NOT NULL, profile_id text NOT NULL,
 profile_kind text NOT NULL DEFAULT 'TUNING' CHECK(profile_kind='TUNING'), profile_revision integer NOT NULL,
 health integer NOT NULL CHECK(health>0), max_health integer NOT NULL CHECK(max_health>0 AND health<=max_health),
 location text NOT NULL CHECK(location IN('HOME','FIELD')), last_instance_id uuid,
 FOREIGN KEY(profile_id,profile_kind) REFERENCES content_entities(id,kind),
 FOREIGN KEY(release_id,profile_id,profile_revision) REFERENCES release_entries(release_id,entity_id,revision)
);
CREATE INDEX combat_run_profile ON combat_run_state(profile_id,profile_kind);
CREATE INDEX combat_run_release ON combat_run_state(release_id,profile_id,profile_revision);
CREATE TABLE combat_states (
 instance_id uuid PRIMARY KEY REFERENCES encounter_records(instance_id), run_id uuid NOT NULL REFERENCES combat_run_state(run_id),
 release_id uuid NOT NULL, profile_id text NOT NULL, profile_kind text NOT NULL DEFAULT 'TUNING' CHECK(profile_kind='TUNING'),profile_revision integer NOT NULL,
 monster_id text NOT NULL, monster_kind text NOT NULL DEFAULT 'MONSTER' CHECK(monster_kind='MONSTER'),monster_revision integer NOT NULL,
 player_health integer NOT NULL CHECK(player_health>=0),player_max_health integer NOT NULL CHECK(player_max_health>0 AND player_health<=player_max_health),
 enemy_health integer NOT NULL CHECK(enemy_health>=0),enemy_max_health integer NOT NULL CHECK(enemy_max_health>0 AND enemy_health<=enemy_max_health),
 round integer NOT NULL DEFAULT 0 CHECK(round>=0),revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 outcome text CHECK(outcome IN('VICTORY','DEFEAT','RETREAT','FAILED_FORWARD')),
 UNIQUE(instance_id,run_id),
 FOREIGN KEY(profile_id,profile_kind) REFERENCES content_entities(id,kind),
 FOREIGN KEY(release_id,profile_id,profile_revision) REFERENCES release_entries(release_id,entity_id,revision),
 FOREIGN KEY(monster_id,monster_kind) REFERENCES content_entities(id,kind),
 FOREIGN KEY(release_id,monster_id,monster_revision) REFERENCES release_entries(release_id,entity_id,revision),
 CHECK(CASE WHEN outcome IS NULL THEN player_health>0 AND enemy_health>0 ELSE
   (outcome='VICTORY' AND player_health>0 AND enemy_health=0) OR (outcome='DEFEAT' AND player_health=0 AND enemy_health>0) OR
   (outcome IN('RETREAT','FAILED_FORWARD') AND player_health>0 AND enemy_health>0) END)
);
CREATE INDEX combat_states_run ON combat_states(run_id);
CREATE INDEX combat_states_profile ON combat_states(profile_id,profile_kind);
CREATE INDEX combat_states_profile_release ON combat_states(release_id,profile_id,profile_revision);
CREATE INDEX combat_states_monster ON combat_states(monster_id,monster_kind);
CREATE INDEX combat_states_monster_release ON combat_states(release_id,monster_id,monster_revision);
ALTER TABLE combat_run_state ADD FOREIGN KEY(last_instance_id,run_id) REFERENCES combat_states(instance_id,run_id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX combat_run_last_instance ON combat_run_state(last_instance_id,run_id);
CREATE TABLE combat_steps (
 instance_id uuid NOT NULL REFERENCES combat_states(instance_id),round integer NOT NULL CHECK(round>0),
 action_id uuid NOT NULL UNIQUE REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
 intent text NOT NULL CHECK(intent IN('ATTACK','GUARD','RETREAT')),revision integer NOT NULL CHECK(revision>0),
 player_health integer NOT NULL CHECK(player_health>=0),enemy_health integer NOT NULL CHECK(enemy_health>=0),outcome text,
 PRIMARY KEY(instance_id,round)
);
CREATE TABLE combat_recoveries (
 instance_id uuid PRIMARY KEY REFERENCES combat_states(instance_id),action_id uuid NOT NULL UNIQUE REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
 restored_health integer NOT NULL CHECK(restored_health>0),turn_cost integer NOT NULL CHECK(turn_cost BETWEEN 0 AND 3),
 destination text NOT NULL DEFAULT 'HOME' CHECK(destination='HOME')
);
CREATE TABLE combat_gold_plans (
 instance_id uuid PRIMARY KEY REFERENCES combat_states(instance_id),amount bigint NOT NULL CHECK(amount BETWEEN 1 AND 1000000),
 from_wallet_id uuid NOT NULL REFERENCES wallets(id),to_wallet_id uuid NOT NULL REFERENCES wallets(id),CHECK(from_wallet_id<>to_wallet_id)
);
CREATE INDEX combat_gold_from ON combat_gold_plans(from_wallet_id);
CREATE INDEX combat_gold_to ON combat_gold_plans(to_wallet_id);
CREATE TABLE combat_gold_claims (
 instance_id uuid PRIMARY KEY REFERENCES combat_gold_plans(instance_id),transfer_id uuid NOT NULL UNIQUE REFERENCES currency_transfers(id)
);
CREATE TABLE run_completions (
 run_id uuid PRIMARY KEY REFERENCES runs(id),release_id uuid NOT NULL,campaign_id text NOT NULL,
 definition_kind text NOT NULL DEFAULT 'TUNING' CHECK(definition_kind='TUNING'),definition_revision integer NOT NULL,
 final_instance_id uuid NOT NULL UNIQUE REFERENCES combat_states(instance_id),
 action_id uuid NOT NULL UNIQUE REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,completed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(campaign_id,definition_kind) REFERENCES content_entities(id,kind),
 FOREIGN KEY(release_id,campaign_id,definition_revision) REFERENCES release_entries(release_id,entity_id,revision)
);
CREATE INDEX completions_definition ON run_completions(campaign_id,definition_kind);
CREATE INDEX completions_release ON run_completions(release_id,campaign_id,definition_revision);
CREATE FUNCTION guard_combat_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Combat history cannot be deleted'; END IF;
 IF OLD.outcome IS NOT NULL THEN RAISE EXCEPTION 'Combat outcome is terminal'; END IF;
 IF (to_jsonb(NEW)-ARRAY['player_health','enemy_health','round','revision','outcome'])<>(to_jsonb(OLD)-ARRAY['player_health','enemy_health','round','revision','outcome'])
   OR NEW.round<>OLD.round+1 OR NEW.revision<>OLD.revision+(CASE WHEN NEW.outcome IS NULL THEN 1 ELSE 2 END) THEN
   RAISE EXCEPTION 'Combat identity is immutable; rounds must advance once';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER combat_state_guard BEFORE UPDATE OR DELETE ON combat_states FOR EACH ROW EXECUTE FUNCTION guard_combat_state();
CREATE FUNCTION guard_combat_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Combat run state cannot be deleted'; END IF;
 IF (to_jsonb(NEW)-ARRAY['health','location','last_instance_id'])<>(to_jsonb(OLD)-ARRAY['health','location','last_instance_id']) THEN
   RAISE EXCEPTION 'Combat profile is immutable for this run';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER combat_run_guard BEFORE UPDATE OR DELETE ON combat_run_state FOR EACH ROW EXECUTE FUNCTION guard_combat_run();
CREATE TRIGGER immutable_combat_step BEFORE UPDATE OR DELETE ON combat_steps FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER immutable_combat_recovery BEFORE UPDATE OR DELETE ON combat_recoveries FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER immutable_combat_gold_plan BEFORE UPDATE OR DELETE ON combat_gold_plans FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER immutable_combat_gold_claim BEFORE UPDATE OR DELETE ON combat_gold_claims FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TRIGGER immutable_run_completion BEFORE UPDATE OR DELETE ON run_completions FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION guard_completion_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.completion_policy='CAMPAIGN' AND NEW.completion_policy<>'CAMPAIGN' THEN RAISE EXCEPTION 'Campaign completion policy cannot be bypassed'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER completion_policy_guard BEFORE UPDATE ON runs FOR EACH ROW EXECUTE FUNCTION guard_completion_policy();

CREATE VIEW combat_integrity_issues AS
SELECT e.instance_id FROM encounter_records e JOIN content_versions v ON v.entity_id=e.definition_id AND v.revision=e.definition_revision
LEFT JOIN combat_states c ON c.instance_id=e.instance_id
LEFT JOIN combat_run_state owner ON owner.run_id=c.run_id
LEFT JOIN content_versions profile ON profile.entity_id=c.profile_id AND profile.revision=c.profile_revision
LEFT JOIN content_versions monster ON monster.entity_id=c.monster_id AND monster.revision=c.monster_revision
LEFT JOIN combat_steps step ON step.instance_id=c.instance_id AND step.round=c.round
LEFT JOIN action_receipts receipt ON receipt.action_id=step.action_id
LEFT JOIN characters character ON character.id=(SELECT character_id FROM runs WHERE id=e.run_id)
LEFT JOIN combat_recoveries recovery ON recovery.instance_id=c.instance_id
LEFT JOIN action_receipts recovery_action ON recovery_action.action_id=recovery.action_id
LEFT JOIN turn_ledger cost ON cost.run_id=e.run_id AND cost.request_id=recovery_action.request_id
LEFT JOIN combat_gold_plans gold ON gold.instance_id=c.instance_id
LEFT JOIN wallets source ON source.id=gold.from_wallet_id LEFT JOIN state_scopes source_scope ON source_scope.id=source.scope_id LEFT JOIN worlds world ON world.id=source_scope.world_id
LEFT JOIN wallets target ON target.id=gold.to_wallet_id LEFT JOIN state_scopes target_scope ON target_scope.id=target.scope_id
LEFT JOIN combat_gold_claims claim ON claim.instance_id=c.instance_id LEFT JOIN currency_transfers transfer ON transfer.id=claim.transfer_id
WHERE
 (v.definition->'mechanics'->'combat' IS NOT NULL AND c.instance_id IS NULL)
 OR (c.instance_id IS NOT NULL AND (c.run_id<>e.run_id OR c.release_id<>e.release_id OR c.revision<>e.revision OR c.outcome IS DISTINCT FROM e.outcome
   OR c.profile_id IS DISTINCT FROM v.definition->'mechanics'->'combat'->>'profileId' OR c.monster_id IS DISTINCT FROM v.definition->'mechanics'->'combat'->>'monsterId'
   OR owner.max_health<>c.player_max_health OR owner.profile_id<>c.profile_id OR owner.release_id<>c.release_id OR owner.profile_revision<>c.profile_revision
   OR c.player_max_health IS DISTINCT FROM (profile.definition->'mechanics'->'combatProfile'->>'maxHealth')::integer
   OR c.enemy_max_health IS DISTINCT FROM (monster.definition->'mechanics'->'combatMonster'->>'maxHealth')::integer
   OR c.round<>coalesce((SELECT max(round) FROM combat_steps history WHERE history.instance_id=c.instance_id),0)
   OR c.round<>(SELECT count(*) FROM combat_steps history WHERE history.instance_id=c.instance_id)
   OR (c.outcome='VICTORY' AND step.intent<>'ATTACK') OR (c.outcome='RETREAT' AND step.intent<>'RETREAT')
   OR (c.round>0 AND (step.action_id IS NULL OR receipt.account_id IS DISTINCT FROM character.account_id OR step.revision<>c.revision
     OR step.player_health<>c.player_health OR step.enemy_health<>c.enemy_health OR step.outcome IS DISTINCT FROM c.outcome))
   OR (c.outcome IS NOT NULL AND step.action_id IS DISTINCT FROM e.finish_action_id)
   OR (c.outcome IN('DEFEAT','FAILED_FORWARD') AND (recovery.instance_id IS NULL OR recovery.action_id<>e.finish_action_id
     OR recovery.turn_cost>(v.definition->'mechanics'->'combat'->'failure'->>'turnCost')::integer
     OR recovery.restored_health IS DISTINCT FROM (profile.definition->'mechanics'->'combatProfile'->>'recoveryHealth')::integer
     OR cost.delta IS DISTINCT FROM -recovery.turn_cost OR cost.reason IS DISTINCT FROM 'COMBAT_RECOVERY'))
   OR (recovery.instance_id IS NOT NULL AND c.outcome NOT IN('DEFEAT','FAILED_FORWARD'))
   OR (owner.last_instance_id=c.instance_id AND (owner.health<>coalesce(recovery.restored_health,c.player_health)
     OR owner.location<>CASE WHEN recovery.instance_id IS NULL THEN 'FIELD' ELSE 'HOME' END))
   OR (v.definition->'mechanics'->'combat'->'gold' IS NOT NULL AND gold.instance_id IS NULL)
   OR (gold.instance_id IS NOT NULL AND (gold.amount IS DISTINCT FROM (v.definition->'mechanics'->'combat'->'gold'->>'amount')::bigint
     OR world.name IS DISTINCT FROM v.definition->'mechanics'->'combat'->'gold'->>'worldName' OR source.purpose<>'FAUCET_SINK' OR source.currency_id<>'GOLD'
     OR target.purpose<>'PLAYER' OR target.currency_id<>'GOLD' OR target_scope.run_id IS DISTINCT FROM e.run_id
     OR (c.outcome='VICTORY' AND claim.instance_id IS NULL)))
   OR (claim.instance_id IS NOT NULL AND (c.outcome IS DISTINCT FROM 'VICTORY' OR transfer.action_id IS DISTINCT FROM e.finish_action_id
     OR transfer.currency_id<>'GOLD' OR transfer.leg_key<>'combat.gold' OR transfer.amount<>gold.amount OR transfer.from_wallet_id<>gold.from_wallet_id OR transfer.to_wallet_id<>gold.to_wallet_id OR transfer.reason<>'COMBAT_REWARD'))));
CREATE VIEW run_completion_issues AS
SELECT r.id AS run_id FROM runs r LEFT JOIN run_completions proof ON proof.run_id=r.id
LEFT JOIN combat_states final ON final.instance_id=proof.final_instance_id LEFT JOIN encounter_records e ON e.instance_id=final.instance_id
LEFT JOIN content_versions campaign ON campaign.entity_id=proof.campaign_id AND campaign.revision=proof.definition_revision
WHERE (r.completion_policy='CAMPAIGN' AND r.status='AFTERCORE' AND proof.run_id IS NULL)
 OR (proof.run_id IS NOT NULL AND (r.completion_policy<>'CAMPAIGN' OR r.status NOT IN('AFTERCORE','ARCHIVED') OR final.run_id<>r.id OR final.outcome IS DISTINCT FROM 'VICTORY'
   OR proof.campaign_id IS DISTINCT FROM (SELECT definition->'mechanics'->'combat'->>'campaignId' FROM content_versions WHERE entity_id=e.definition_id AND revision=e.definition_revision)
   OR proof.release_id<>r.content_release_id OR e.finish_action_id<>proof.action_id
   OR campaign.definition->'mechanics'->'campaign'->>'finalEncounterId' IS DISTINCT FROM e.definition_id
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(campaign.definition->'mechanics'->'campaign'->'requiresEncounterIds') required WHERE NOT EXISTS(
     SELECT 1 FROM combat_states won JOIN encounter_records encounter ON encounter.instance_id=won.instance_id
     WHERE won.run_id=r.id AND won.outcome='VICTORY' AND encounter.definition_id=required AND encounter.release_id=r.content_release_id))));
CREATE FUNCTION check_combat_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM combat_integrity_issues WHERE instance_id=NEW.instance_id) THEN RAISE EXCEPTION 'Combat state, step, recovery or reward does not match encounter'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER combat_encounter_check AFTER INSERT OR UPDATE ON encounter_records DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_combat_integrity();
CREATE CONSTRAINT TRIGGER combat_state_check AFTER INSERT OR UPDATE ON combat_states DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_combat_integrity();
CREATE CONSTRAINT TRIGGER combat_step_check AFTER INSERT ON combat_steps DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_combat_integrity();
CREATE CONSTRAINT TRIGGER combat_recovery_check AFTER INSERT ON combat_recoveries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_combat_integrity();
CREATE CONSTRAINT TRIGGER combat_gold_plan_check AFTER INSERT ON combat_gold_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_combat_integrity();
CREATE CONSTRAINT TRIGGER combat_gold_claim_check AFTER INSERT ON combat_gold_claims DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_combat_integrity();
CREATE FUNCTION check_run_completion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 IF TG_TABLE_NAME='runs' THEN target:=NEW.id; ELSE target:=NEW.run_id; END IF;
 IF EXISTS(SELECT 1 FROM run_completion_issues WHERE run_id=target) THEN RAISE EXCEPTION 'Campaign completion evidence is missing or invalid'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER run_completion_check AFTER INSERT OR UPDATE ON runs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_run_completion();
CREATE CONSTRAINT TRIGGER completion_evidence_check AFTER INSERT ON run_completions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_run_completion();

CREATE FUNCTION guard_combat_step() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_state combat_states%ROWTYPE;
BEGIN
 SELECT * INTO current_state FROM combat_states WHERE instance_id=NEW.instance_id FOR UPDATE;
 IF NOT FOUND OR current_state.outcome IS NOT NULL OR NEW.round<>current_state.round+1 THEN RAISE EXCEPTION 'Combat steps must advance an open combat consecutively'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER combat_step_guard BEFORE INSERT ON combat_steps FOR EACH ROW EXECUTE FUNCTION guard_combat_step();
CREATE FUNCTION check_combat_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM combat_run_state owner WHERE owner.run_id=NEW.run_id AND
   (owner.last_instance_id IS NULL OR EXISTS(SELECT 1 FROM combat_integrity_issues WHERE instance_id=owner.last_instance_id))) THEN
   RAISE EXCEPTION 'Combat run health or location does not match encounter history';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER combat_owner_check AFTER INSERT OR UPDATE ON combat_run_state DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_combat_owner();
