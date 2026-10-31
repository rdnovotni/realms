-- M05 is installed dark; publication and activation remain separate operations.
INSERT INTO feature_controls(key,taxonomy,mode,reason) VALUES('npc.dialogue','RELEASE','DISABLED','M05 requires reviewed authored NPCs and separate activation');
CREATE TABLE npc_conversation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES accounts(id),run_id uuid NOT NULL REFERENCES runs(id),
 npc_id text NOT NULL,release_id uuid NOT NULL,definition_revision integer NOT NULL,
 action_id uuid NOT NULL UNIQUE REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
 before_node text NOT NULL,after_node text NOT NULL,choice_id text NOT NULL,label text NOT NULL,response text NOT NULL,
 consequence text NOT NULL,memory jsonb,evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='array'),
 committed_revision integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(release_id,npc_id,definition_revision) REFERENCES release_entries(release_id,entity_id,revision),UNIQUE(run_id,committed_revision),
 CHECK(memory IS NULL OR (jsonb_typeof(memory)='object' AND memory->>'scope' IN('RUN','ACCOUNT') AND length(memory->>'text') BETWEEN 1 AND 1500))
);
CREATE INDEX npc_events_by_owner ON npc_conversation_events(account_id,npc_id,run_id,committed_revision DESC);
CREATE INDEX npc_events_by_run ON npc_conversation_events(run_id);
CREATE INDEX npc_events_by_release ON npc_conversation_events(release_id,npc_id,definition_revision);
CREATE TRIGGER npc_events_immutable BEFORE UPDATE OR DELETE ON npc_conversation_events FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION npc_event_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE option jsonb; opening text;
BEGIN
 SELECT ch.value INTO option FROM content_versions v CROSS JOIN LATERAL jsonb_array_elements(v.definition->'mechanics'->'npcDialogue'->'nodes') n(node) CROSS JOIN LATERAL jsonb_array_elements(n.node->'choices') ch(value) WHERE v.entity_id=NEW.npc_id AND v.revision=NEW.definition_revision AND v.definition->'mechanics'->'npcDialogue'->>'version'='1' AND n.node->>'id'=NEW.before_node AND ch.value->>'id'=NEW.choice_id;
 IF option IS NULL OR NEW.after_node IS DISTINCT FROM option->>'to' OR NEW.label IS DISTINCT FROM option->>'label' OR NEW.response IS DISTINCT FROM option->>'response' OR NEW.consequence IS DISTINCT FROM option->>'consequence' OR coalesce(NEW.memory,'null'::jsonb) IS DISTINCT FROM option->'memory' THEN RAISE EXCEPTION 'NPC evidence must match the authored choice';END IF;
 SELECT after_node INTO opening FROM npc_conversation_events WHERE run_id=NEW.run_id AND npc_id=NEW.npc_id AND committed_revision<NEW.committed_revision ORDER BY committed_revision DESC LIMIT 1;
 IF opening IS NULL THEN SELECT definition->'mechanics'->'npcDialogue'->>'start' INTO opening FROM content_versions WHERE entity_id=NEW.npc_id AND revision=NEW.definition_revision;END IF;
 IF opening IS DISTINCT FROM NEW.before_node THEN RAISE EXCEPTION 'NPC dialogue must continue its committed node';END IF;
 IF NOT EXISTS(SELECT 1 FROM runs r JOIN characters c ON c.id=r.character_id JOIN action_receipts a ON a.action_id=NEW.action_id WHERE r.id=NEW.run_id AND r.status IN('ACTIVE','AFTERCORE') AND r.content_release_id=NEW.release_id AND c.account_id=NEW.account_id AND a.account_id=NEW.account_id AND a.action_type='NPC_CHOICE' AND a.result->>'conversationEventId'=NEW.id::text AND a.result->>'npcId'=NEW.npc_id AND a.result->>'response'=NEW.response AND a.result->>'consequence'=NEW.consequence AND a.result->>'revision'=NEW.committed_revision::text AND r.revision=NEW.committed_revision) THEN RAISE EXCEPTION 'NPC event requires owner receipt';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER npc_event_receipt AFTER INSERT ON npc_conversation_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION npc_event_owner();
