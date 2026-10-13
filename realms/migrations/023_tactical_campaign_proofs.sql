-- Extend completion provenance without rewriting old basic-duel evidence.
ALTER TABLE run_completions ADD COLUMN ruleset text NOT NULL DEFAULT 'BASIC_DUEL_V1'
 CHECK(ruleset IN('BASIC_DUEL_V1','TACTICAL_CAMPAIGN_V1'));
ALTER TABLE run_completions DROP CONSTRAINT run_completions_final_instance_id_fkey;
ALTER TABLE run_completions ADD FOREIGN KEY(final_instance_id) REFERENCES encounter_records(instance_id);

CREATE FUNCTION campaign_action_revision(result jsonb) RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN jsonb_typeof(result->'revision')='number' AND (result->>'revision') ~ '^(0|[1-9][0-9]{0,9})$'
 THEN (result->>'revision')::bigint ELSE NULL END
$$;
CREATE TABLE tactical_campaign_prerequisites (
 run_id uuid NOT NULL REFERENCES run_completions(run_id),
 definition_id text NOT NULL REFERENCES content_entities(id),
 instance_id uuid NOT NULL,
 finish_action_id uuid NOT NULL REFERENCES action_receipts(action_id),
 PRIMARY KEY(run_id,definition_id),
 FOREIGN KEY(instance_id,run_id) REFERENCES tactical_encounter_origins(instance_id,run_id)
);
CREATE INDEX tactical_campaign_instance ON tactical_campaign_prerequisites(instance_id,run_id);
CREATE INDEX tactical_campaign_definition ON tactical_campaign_prerequisites(definition_id);
CREATE INDEX tactical_campaign_action ON tactical_campaign_prerequisites(finish_action_id);
CREATE TRIGGER tactical_campaign_proof_immutable BEFORE UPDATE OR DELETE ON tactical_campaign_prerequisites FOR EACH ROW EXECUTE FUNCTION reject_record_change();

CREATE VIEW basic_run_completion_issues AS
SELECT r.id AS run_id FROM runs r LEFT JOIN run_completions proof ON proof.run_id=r.id
LEFT JOIN combat_states final ON final.instance_id=proof.final_instance_id LEFT JOIN encounter_records e ON e.instance_id=final.instance_id
LEFT JOIN content_versions campaign ON campaign.entity_id=proof.campaign_id AND campaign.revision=proof.definition_revision
WHERE (proof.ruleset IS NULL OR proof.ruleset='BASIC_DUEL_V1') AND ((r.completion_policy='CAMPAIGN' AND r.status='AFTERCORE' AND proof.run_id IS NULL)
 OR (proof.run_id IS NOT NULL AND (r.completion_policy<>'CAMPAIGN' OR r.status NOT IN('AFTERCORE','ARCHIVED') OR final.instance_id IS NULL OR final.run_id<>r.id OR final.outcome IS DISTINCT FROM 'VICTORY'
   OR proof.campaign_id IS DISTINCT FROM (SELECT definition->'mechanics'->'combat'->>'campaignId' FROM content_versions WHERE entity_id=e.definition_id AND revision=e.definition_revision)
   OR proof.release_id<>r.content_release_id OR e.finish_action_id<>proof.action_id
   OR campaign.definition->'mechanics'->'campaign'->>'finalEncounterId' IS DISTINCT FROM e.definition_id
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(campaign.definition->'mechanics'->'campaign'->'requiresEncounterIds') required WHERE NOT EXISTS(
     SELECT 1 FROM combat_states won JOIN encounter_records encounter ON encounter.instance_id=won.instance_id
     WHERE won.run_id=r.id AND won.outcome='VICTORY' AND encounter.definition_id=required AND encounter.release_id=r.content_release_id)))));

CREATE VIEW tactical_campaign_completion_issues AS
SELECT proof.run_id FROM run_completions proof JOIN runs r ON r.id=proof.run_id
JOIN characters owner ON owner.id=r.character_id
JOIN encounter_records final ON final.instance_id=proof.final_instance_id
LEFT JOIN tactical_encounter_origins origin ON origin.instance_id=final.instance_id
JOIN content_versions final_definition ON final_definition.entity_id=final.definition_id AND final_definition.revision=final.definition_revision
JOIN content_versions campaign ON campaign.entity_id=proof.campaign_id AND campaign.revision=proof.definition_revision
LEFT JOIN action_receipts receipt ON receipt.action_id=proof.action_id
LEFT JOIN action_receipts start_receipt ON start_receipt.action_id=final.start_action_id
WHERE proof.ruleset='TACTICAL_CAMPAIGN_V1' AND (
 r.completion_policy<>'CAMPAIGN' OR r.status NOT IN('AFTERCORE','ARCHIVED')
 OR final.run_id<>proof.run_id OR final.release_id<>proof.release_id OR proof.release_id<>r.content_release_id
 OR origin.instance_id IS NULL OR final.outcome IS DISTINCT FROM 'VICTORY'
 OR final.finish_action_id IS DISTINCT FROM proof.action_id OR proof.completed_at IS DISTINCT FROM final.finished_at
 OR receipt.account_id IS DISTINCT FROM owner.account_id OR receipt.action_type IS DISTINCT FROM 'TACTICAL_ACTION'
 OR campaign_action_revision(start_receipt.result) IS NULL OR campaign_action_revision(receipt.result) IS NULL
 OR campaign_action_revision(receipt.result)<=campaign_action_revision(start_receipt.result)
 OR final_definition.definition->'mechanics'->'tacticalCombat'->>'campaignId' IS DISTINCT FROM proof.campaign_id
 OR campaign.definition->'mechanics'->'tacticalCampaign'->>'ruleset' IS DISTINCT FROM 'TACTICAL_CAMPAIGN_V1'
 OR campaign.definition->'mechanics'->'tacticalCampaign'->'version' IS DISTINCT FROM '1'::jsonb
 OR campaign.definition->'mechanics'->'tacticalCampaign'->>'finalEncounterId' IS DISTINCT FROM final.definition_id
 OR jsonb_typeof(campaign.definition->'mechanics'->'tacticalCampaign'->'requiresEncounterIds') IS DISTINCT FROM 'array'
 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(campaign.definition->'mechanics'->'tacticalCampaign'->'requiresEncounterIds') required WHERE NOT EXISTS(
   SELECT 1 FROM tactical_campaign_prerequisites evidence WHERE evidence.run_id=proof.run_id AND evidence.definition_id=required))
 OR EXISTS(SELECT 1 FROM tactical_campaign_prerequisites evidence
   JOIN encounter_records won ON won.instance_id=evidence.instance_id
   JOIN content_versions won_definition ON won_definition.entity_id=won.definition_id AND won_definition.revision=won.definition_revision
   LEFT JOIN action_receipts win_receipt ON win_receipt.action_id=evidence.finish_action_id
   WHERE evidence.run_id=proof.run_id AND (
    NOT(campaign.definition->'mechanics'->'tacticalCampaign'->'requiresEncounterIds' ? evidence.definition_id)
    OR won.definition_id<>evidence.definition_id OR won.run_id<>proof.run_id OR won.release_id<>proof.release_id
    OR won.outcome IS DISTINCT FROM 'VICTORY' OR won.finish_action_id IS DISTINCT FROM evidence.finish_action_id
    OR won_definition.definition->'mechanics'->>'characterProfileId' IS DISTINCT FROM final_definition.definition->'mechanics'->>'characterProfileId'
    OR win_receipt.account_id IS DISTINCT FROM owner.account_id
    OR campaign_action_revision(win_receipt.result) IS NULL
    OR campaign_action_revision(win_receipt.result)>=campaign_action_revision(start_receipt.result)
  ))
);
CREATE OR REPLACE VIEW run_completion_issues AS
SELECT run_id FROM basic_run_completion_issues
UNION SELECT run_id FROM tactical_campaign_completion_issues
UNION SELECT proof.run_id FROM run_completions proof WHERE proof.ruleset='BASIC_DUEL_V1'
 AND EXISTS(SELECT 1 FROM tactical_campaign_prerequisites evidence WHERE evidence.run_id=proof.run_id);
CREATE CONSTRAINT TRIGGER tactical_campaign_evidence_check AFTER INSERT ON tactical_campaign_prerequisites
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_run_completion();
