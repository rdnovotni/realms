-- Opt-in character-stat snapshots; historical/basic-duel encounters are unchanged.
CREATE FUNCTION character_snapshot_inputs(target uuid,profile text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r runs%ROWTYPE; b run_builds%ROWTYPE; p jsonb; rev integer; modifiers jsonb;
BEGIN
  SELECT * INTO r FROM runs WHERE id=target FOR NO KEY UPDATE;
  SELECT * INTO b FROM run_builds WHERE run_id=target FOR SHARE;
  IF r.id IS NULL OR r.status NOT IN('ACTIVE','AFTERCORE') OR r.mode NOT IN('STANDARD','CASUAL') OR b.state->>'mode' IS DISTINCT FROM 'CONFIGURED' THEN RAISE EXCEPTION 'Character snapshot requires a configured normal run'; END IF;
  SELECT e.revision,v.definition->'mechanics'->'characterProfile' INTO rev,p FROM release_entries e
    JOIN content_entities ce ON ce.id=e.entity_id AND ce.kind='TUNING'
    JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=r.content_release_id AND e.entity_id=profile;
  IF p IS NULL OR p->'version' IS DISTINCT FROM '1'::jsonb OR p->>'ruleset' IS DISTINCT FROM 'CHARACTER_STATS_V1' OR p->>'buildRulesId' IS DISTINCT FROM b.state->'rules'->>'id' THEN RAISE EXCEPTION 'Character profile does not match the pinned build'; END IF;
  IF EXISTS(SELECT 1 FROM equipment_integrity_issues WHERE run_id=target) THEN RAISE EXCEPTION 'Character equipment is inconsistent'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('entityId',entity_id,'revision',revision,'nativeLevel',native_level,'instanceId',instance_id,'spec',spec)) ORDER BY entity_id COLLATE "C",instance_id),'[]') INTO modifiers FROM (
    SELECT e.entity_id,e.revision,c.native_level,NULL::text AS instance_id,v.definition->'mechanics'->'combatModifiers' AS spec
      FROM run_class_levels c JOIN release_entries e ON e.release_id=r.content_release_id AND e.entity_id=c.class_id JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE c.run_id=target
    UNION ALL
    SELECT e.entity_id,e.revision,0,NULL::text,v.definition->'mechanics'->'combatModifiers'
      FROM run_feats f JOIN release_entries e ON e.release_id=r.content_release_id AND e.entity_id=f.feat_id AND e.revision=f.feat_revision JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE f.run_id=target
    UNION ALL
    SELECT e.entity_id,e.revision,0,NULL::text,v.definition->'mechanics'->'combatModifiers'
      FROM run_subclasses s JOIN release_entries e ON e.release_id=r.content_release_id AND e.entity_id=s.subclass_id AND e.revision=s.subclass_revision JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE s.run_id=target
    UNION ALL
    SELECT DISTINCT e.entity_id,e.revision,0,i.id::text,v.definition->'mechanics'->'combatModifiers'
      FROM equipment_slots s JOIN inventory_items i ON i.id=s.item_id
      JOIN release_entries e ON e.release_id=r.content_release_id AND e.entity_id=i.definition_id AND e.revision=i.definition_revision
      JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision
      WHERE s.run_id=target AND (s.set_id='WORN' OR s.set_id=coalesce((SELECT active_set FROM run_equipment WHERE run_id=target),'A'))
  ) selected WHERE spec IS NOT NULL;
  RETURN jsonb_build_object('version',1,'runId',target::text,'releaseId',r.content_release_id::text,'profileId',profile,'profileRevision',rev,'profile',p,
    'attributes',attribute_projection(target),'buildEventId',b.last_event_id::text,
    'attributeChoiceId',(SELECT id::text FROM run_attribute_choices WHERE run_id=target ORDER BY choice_no DESC LIMIT 1),
    'equipmentEventId',(SELECT last_event_id::text FROM run_equipment WHERE run_id=target),'sources',modifiers);
END $$;

-- Independently recompute the TypeScript evaluator's integer formulas at insert.
CREATE FUNCTION character_stats_valid(stats jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE key text; x jsonb;
BEGIN
  IF jsonb_typeof(stats) IS DISTINCT FROM 'object' OR NOT(stats ?& ARRAY['maxHealth','maxMana','accuracy','evasion','armor','initiative','attackMin','attackMax']) OR (stats-ARRAY['maxHealth','maxMana','accuracy','evasion','armor','initiative','attackMin','attackMax'])<>'{}' THEN RETURN false; END IF;
  FOREACH key IN ARRAY ARRAY['maxHealth','maxMana','accuracy','evasion','armor','initiative','attackMin','attackMax'] LOOP
    x:=stats->key;IF jsonb_typeof(x) IS DISTINCT FROM 'number' OR x#>>'{}' !~ '^-?[0-9]+$' OR abs((x#>>'{}')::numeric)>1000000 THEN RETURN false; END IF;
  END LOOP;
  RETURN (stats->>'maxHealth')::integer>=1 AND (stats->>'maxMana')::integer>=0 AND (stats->>'armor')::integer>=0 AND (stats->>'attackMin')::integer>=1 AND (stats->>'attackMax')::integer>=(stats->>'attackMin')::integer;
END $$;
CREATE FUNCTION character_snapshot_derived(input jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE stats jsonb:=input->'profile'->'base'; scaling jsonb:='[]'; sources jsonb:='[]'; rule jsonb; source jsonb; modifier jsonb; n bigint; score integer; key text;
BEGIN
  FOR rule IN SELECT x FROM jsonb_array_elements(input->'profile'->'scaling') x LOOP
    score:=(input->'attributes'->>(rule->>'attribute'))::integer;
    n:=floor((score-(rule->>'baseline')::numeric)/(rule->>'divisor')::numeric)::bigint*(rule->>'amount')::bigint;
    key:=rule->>'stat';stats:=jsonb_set(stats,ARRAY[key],to_jsonb((stats->>key)::bigint+n));
    scaling:=scaling||jsonb_build_array(rule||jsonb_build_object('score',score,'contribution',n));
  END LOOP;
  IF NOT character_stats_valid(stats) THEN RAISE EXCEPTION 'Invalid attribute-scaled character stats'; END IF;
  FOR source IN SELECT x FROM jsonb_array_elements(input->'sources') x ORDER BY x->>'entityId' COLLATE "C",coalesce(x->>'instanceId','') COLLATE "C" LOOP
    FOR modifier IN SELECT x FROM jsonb_array_elements(source->'spec'->'modifiers') x LOOP
      IF (source->>'nativeLevel')::integer<(modifier->>'minimumNativeLevel')::integer THEN CONTINUE; END IF;
      key:=modifier->>'stat';n:=(modifier->>'amount')::bigint;
      stats:=jsonb_set(stats,ARRAY[key],to_jsonb((stats->>key)::bigint+n));
      sources:=sources||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('entityId',source->>'entityId','revision',source->'revision','instanceId',source->>'instanceId','stat',key,'amount',n)));
    END LOOP;
  END LOOP;
  IF NOT character_stats_valid(stats) THEN RAISE EXCEPTION 'Invalid derived character stats'; END IF;
  RETURN jsonb_build_object('stats',stats,'sources',sources,'scaling',scaling);
END $$;

CREATE TABLE character_encounter_snapshots (
  instance_id uuid PRIMARY KEY REFERENCES encounter_records(instance_id),run_id uuid NOT NULL REFERENCES runs(id),
  profile_id text NOT NULL REFERENCES content_entities(id),release_id uuid NOT NULL,profile_revision integer NOT NULL,
  build_event_id uuid NOT NULL REFERENCES run_build_events(id),attribute_choice_id uuid REFERENCES run_attribute_choices(id),equipment_event_id uuid REFERENCES equipment_events(id),
  inputs jsonb NOT NULL CHECK(jsonb_typeof(inputs)='object'),
  derived jsonb NOT NULL CHECK(jsonb_typeof(derived)='object'),created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(release_id,profile_id,profile_revision) REFERENCES release_entries(release_id,entity_id,revision)
);
CREATE INDEX character_snapshots_run ON character_encounter_snapshots(run_id);
CREATE INDEX character_snapshots_profile ON character_encounter_snapshots(profile_id);
CREATE INDEX character_snapshots_profile_release ON character_encounter_snapshots(release_id,profile_id,profile_revision);
CREATE INDEX character_snapshots_build ON character_encounter_snapshots(build_event_id);
CREATE INDEX character_snapshots_attributes ON character_encounter_snapshots(attribute_choice_id);
CREATE INDEX character_snapshots_equipment ON character_encounter_snapshots(equipment_event_id);
CREATE TRIGGER immutable_character_snapshot BEFORE UPDATE OR DELETE ON character_encounter_snapshots FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION guard_character_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE encounter encounter_records%ROWTYPE; authored_profile text;
BEGIN
  SELECT * INTO encounter FROM encounter_records WHERE instance_id=NEW.instance_id FOR SHARE;
  SELECT definition->'mechanics'->>'characterProfileId' INTO authored_profile FROM content_versions WHERE entity_id=encounter.definition_id AND revision=encounter.definition_revision;
  IF encounter.run_id IS DISTINCT FROM NEW.run_id OR encounter.revision<>0 OR encounter.outcome IS NOT NULL OR authored_profile IS DISTINCT FROM NEW.profile_id THEN RAISE EXCEPTION 'Character snapshot must match its opted-in encounter start'; END IF;
  IF NEW.inputs IS DISTINCT FROM character_snapshot_inputs(NEW.run_id,NEW.profile_id) THEN RAISE EXCEPTION 'Character snapshot inputs are server-derived'; END IF;
  IF NEW.derived IS DISTINCT FROM character_snapshot_derived(NEW.inputs) THEN RAISE EXCEPTION 'Character snapshot stats are server-derived'; END IF;
  IF NEW.release_id IS NOT NULL OR NEW.profile_revision IS NOT NULL OR NEW.build_event_id IS NOT NULL OR NEW.attribute_choice_id IS NOT NULL OR NEW.equipment_event_id IS NOT NULL THEN RAISE EXCEPTION 'Character snapshot pins are server-derived'; END IF;
  NEW.release_id:=(NEW.inputs->>'releaseId')::uuid;NEW.profile_revision:=(NEW.inputs->>'profileRevision')::integer;
  NEW.build_event_id:=(NEW.inputs->>'buildEventId')::uuid;NEW.attribute_choice_id:=(NEW.inputs->>'attributeChoiceId')::uuid;NEW.equipment_event_id:=(NEW.inputs->>'equipmentEventId')::uuid;
  NEW.created_at:=now();
  RETURN NEW;
END $$;
CREATE TRIGGER character_snapshot_guard BEFORE INSERT ON character_encounter_snapshots FOR EACH ROW EXECUTE FUNCTION guard_character_snapshot();
CREATE FUNCTION check_encounter_character_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE required text;
BEGIN
  SELECT definition->'mechanics'->>'characterProfileId' INTO required FROM content_versions WHERE entity_id=NEW.definition_id AND revision=NEW.definition_revision;
  IF required IS NOT NULL AND NOT EXISTS(SELECT 1 FROM character_encounter_snapshots WHERE instance_id=NEW.instance_id AND run_id=NEW.run_id AND profile_id=required) THEN RAISE EXCEPTION 'Opted-in encounter requires its character snapshot'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER encounter_requires_character_snapshot AFTER INSERT ON encounter_records DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_encounter_character_snapshot();

CREATE VIEW character_snapshot_integrity_issues AS
SELECT e.instance_id FROM encounter_records e JOIN content_versions v ON v.entity_id=e.definition_id AND v.revision=e.definition_revision
LEFT JOIN character_encounter_snapshots s ON s.instance_id=e.instance_id
WHERE v.definition->'mechanics'->>'characterProfileId' IS NOT NULL AND (s.instance_id IS NULL OR s.run_id<>e.run_id OR s.profile_id IS DISTINCT FROM v.definition->'mechanics'->>'characterProfileId')
UNION
SELECT s.instance_id FROM character_encounter_snapshots s JOIN encounter_records e ON e.instance_id=s.instance_id
LEFT JOIN release_entries p ON p.release_id=e.release_id AND p.entity_id=s.profile_id AND p.revision=(s.inputs->>'profileRevision')::integer
LEFT JOIN content_versions v ON v.entity_id=p.entity_id AND v.revision=p.revision
WHERE s.inputs->>'runId' IS DISTINCT FROM s.run_id::text OR s.inputs->>'releaseId' IS DISTINCT FROM e.release_id::text
 OR s.inputs->>'profileId' IS DISTINCT FROM s.profile_id OR s.inputs->'profile' IS DISTINCT FROM v.definition->'mechanics'->'characterProfile'
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(s.inputs->'sources') source WHERE NOT EXISTS(
   SELECT 1 FROM release_entries pin JOIN content_versions version ON version.entity_id=pin.entity_id AND version.revision=pin.revision
   WHERE pin.release_id=e.release_id AND pin.entity_id=source->>'entityId' AND pin.revision=(source->>'revision')::integer AND version.definition->'mechanics'->'combatModifiers'=source->'spec'))
UNION
SELECT s.instance_id FROM character_encounter_snapshots s
JOIN run_build_events b ON b.id=s.build_event_id LEFT JOIN run_attribute_choices a ON a.id=s.attribute_choice_id LEFT JOIN equipment_events gear ON gear.id=s.equipment_event_id
WHERE b.run_id<>s.run_id OR b.release_id<>s.release_id OR s.release_id::text IS DISTINCT FROM s.inputs->>'releaseId' OR s.profile_revision IS DISTINCT FROM (s.inputs->>'profileRevision')::integer
 OR s.build_event_id::text IS DISTINCT FROM s.inputs->>'buildEventId' OR s.attribute_choice_id::text IS DISTINCT FROM s.inputs->>'attributeChoiceId' OR s.equipment_event_id::text IS DISTINCT FROM s.inputs->>'equipmentEventId'
 OR b.rules_id IS DISTINCT FROM s.inputs->'profile'->>'buildRulesId'
 OR (a.id IS NOT NULL AND a.run_id<>s.run_id) OR (gear.id IS NOT NULL AND gear.run_id<>s.run_id)
 OR s.inputs->'attributes' IS DISTINCT FROM CASE WHEN a.id IS NULL THEN b.after_state->'attributes' ELSE a.after_attributes END
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(s.inputs->'sources') source JOIN content_entities ce ON ce.id=source->>'entityId' WHERE
   (ce.kind='CLASS' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b.after_state->'classes') chosen WHERE chosen->>'classId'=ce.id AND chosen->'nativeLevel'=source->'nativeLevel'))
   OR (ce.kind='ABILITY' AND NOT EXISTS(SELECT 1 FROM run_feat_choices f WHERE f.run_id=s.run_id AND f.feat_id=ce.id AND f.feat_revision=(source->>'revision')::integer AND f.created_at<=s.created_at)
     AND NOT EXISTS(SELECT 1 FROM run_subclass_choices sub WHERE sub.run_id=s.run_id AND sub.subclass_id=ce.id AND sub.subclass_revision=(source->>'revision')::integer AND sub.created_at<=s.created_at))
   OR (ce.kind='ITEM' AND NOT EXISTS(SELECT 1 FROM inventory_items item WHERE item.id=(source->>'instanceId')::uuid AND item.definition_id=ce.id AND item.definition_revision=(source->>'revision')::integer AND item.release_id=s.release_id
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(gear.after_state->'slots') slot WHERE slot->>'itemId'=item.id::text AND (slot->>'set'='WORN' OR slot->>'set'=gear.after_state->>'activeSet'))))
 );
