-- Every new rollover records its effective release-pinned policy. Existing
-- historical receipts remain unchanged and continue using their original grant.
CREATE TABLE rollover_policy_receipts (
 run_id uuid NOT NULL,epoch bigint NOT NULL,
 release_id uuid NOT NULL REFERENCES content_releases(id),
 policy jsonb NOT NULL CHECK(jsonb_typeof(policy)='object'),
 PRIMARY KEY(run_id,epoch),
 FOREIGN KEY(run_id,epoch) REFERENCES run_rollovers(run_id,epoch)
);
CREATE INDEX rollover_policy_epoch ON rollover_policy_receipts(epoch);
CREATE INDEX rollover_policy_release ON rollover_policy_receipts(release_id);
CREATE TRIGGER immutable_rollover_policy BEFORE UPDATE OR DELETE ON rollover_policy_receipts FOR EACH ROW EXECUTE FUNCTION reject_record_change();
