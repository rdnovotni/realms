INSERT INTO feature_controls(key,taxonomy,mode,reason) VALUES('noncombat.pipeline','RELEASE','DISABLED','M03 requires reviewed content and separate activation');
CREATE FUNCTION guard_noncombat_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_obstacles jsonb; new_obstacles jsonb; principal text; prior jsonb; next jsonb; owner_spec jsonb;
BEGIN
 old_obstacles:=coalesce(NEW.before_state->'obstacles','{}'); new_obstacles:=coalesce(NEW.after_state->'obstacles','{}');
 IF NEW.evidence ? 'noncombat' THEN
  principal:=NEW.evidence->'noncombat'->>'obstacleId';
  SELECT v.definition->'mechanics'->'noncombatObstacle' INTO owner_spec FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=NEW.release_id AND e.entity_id=principal AND e.revision=(NEW.evidence->'noncombat'->>'obstacleRevision')::integer;
  prior:=coalesce(old_obstacles->principal,'{"step":0,"failed":false,"alert":0,"flags":[],"complete":false}');next:=new_obstacles->principal;
  IF owner_spec IS NULL OR prior->>'complete'='true' OR next IS NULL OR (new_obstacles-principal) IS DISTINCT FROM (old_obstacles-principal)
   OR NEW.evidence->'noncombat'->>'principalId' IS DISTINCT FROM principal OR NEW.evidence->'coordinated'->>'principalId' IS DISTINCT FROM principal
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(owner_spec->'steps'->((prior->>'step')::integer)->'approaches') a WHERE a->>'id'=NEW.evidence->'noncombat'->>'approachId' AND a->>'actionId'=NEW.entity_id)
   OR NEW.evidence->>'domain'<>'INTERACTION' THEN RAISE EXCEPTION 'Noncombat requires pinned obstacle and a single unresolved principal'; END IF;
 ELSE
  IF new_obstacles IS DISTINCT FROM old_obstacles THEN RAISE EXCEPTION 'Obstacle state requires coordinated noncombat evidence'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER noncombat_evidence_guard BEFORE INSERT ON shared_rules_events FOR EACH ROW EXECUTE FUNCTION guard_noncombat_evidence();
CREATE FUNCTION noncombat_receipt_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.evidence ? 'noncombat' AND NOT EXISTS(SELECT 1 FROM action_receipts a JOIN runs r ON r.id=NEW.run_id JOIN characters c ON c.id=r.character_id WHERE a.action_id=NEW.action_id AND a.account_id=c.account_id AND a.action_type='RESOLVE_NONCOMBAT' AND a.authorization_source='MANUAL_UI') THEN RAISE EXCEPTION 'Noncombat evidence requires an explicit owner receipt'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER noncombat_owner_receipt AFTER INSERT ON shared_rules_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION noncombat_receipt_owner();
