-- Reconcile the mutable account projection with immutable action/rollover facts.
CREATE VIEW daily_allowance_issues AS
 SELECT a.account_id,a.entity_id FROM daily_allowances a
 LEFT JOIN LATERAL (SELECT after_charges FROM daily_allowance_events e WHERE e.account_id=a.account_id AND e.entity_id=a.entity_id ORDER BY id DESC LIMIT 1) last ON true
 LEFT JOIN LATERAL (SELECT auto_collect FROM daily_allowance_events e WHERE e.account_id=a.account_id AND e.entity_id=a.entity_id AND e.kind='PREFERENCE' ORDER BY id DESC LIMIT 1) preference ON true
 WHERE a.charges IS DISTINCT FROM last.after_charges
 OR a.auto_collect IS DISTINCT FROM coalesce(preference.auto_collect,false)
 OR a.manual_uses IS DISTINCT FROM (SELECT count(*)::integer FROM daily_allowance_events e JOIN action_receipts r ON r.action_id=e.action_id WHERE e.account_id=a.account_id AND e.entity_id=a.entity_id AND e.kind='USE' AND r.authorization_source='MANUAL_UI')
 UNION
 SELECT e.account_id,e.entity_id FROM daily_allowance_events e
 JOIN runs run ON run.id=e.run_id JOIN characters owner ON owner.id=run.character_id
 LEFT JOIN action_receipts receipt ON receipt.action_id=e.action_id
 LEFT JOIN turn_ledger ledger ON ledger.run_id=e.run_id AND ledger.request_id=e.ledger_request_id
 WHERE owner.account_id<>e.account_id OR run.content_release_id IS DISTINCT FROM e.release_id
 OR (e.action_id IS NOT NULL AND receipt.account_id IS DISTINCT FROM e.account_id)
 OR (e.turn_bonus>0 AND (ledger.delta IS DISTINCT FROM e.turn_bonus OR ledger.reason IS DISTINCT FROM CASE WHEN e.kind='AUTO_COLLECT' THEN 'DAILY_AUTO:'||e.entity_id||':'||e.epoch::text ELSE 'DAILY:'||e.entity_id END))
 OR (e.kind='PREFERENCE' AND e.auto_collect IS DISTINCT FROM (receipt.result->>'enabled')::boolean);
CREATE FUNCTION check_daily_allowance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM daily_allowance_issues WHERE account_id=NEW.account_id AND entity_id=NEW.entity_id) THEN RAISE EXCEPTION 'Daily allowance projection or grant does not reconcile'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER daily_allowance_projection_check AFTER INSERT OR UPDATE ON daily_allowances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_daily_allowance();
CREATE CONSTRAINT TRIGGER daily_allowance_event_check AFTER INSERT ON daily_allowance_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_daily_allowance();
