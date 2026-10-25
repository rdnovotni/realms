-- Extend the existing exact personal-claim projection for opted-in battlefields.
-- Unopted state keeps its previous shape; CREATE OR REPLACE preserves grants.
CREATE OR REPLACE FUNCTION shared_personal_state(session uuid,owner text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE state jsonb; units jsonb; ordering jsonb; budget jsonb; field_value jsonb;
BEGIN
 SELECT checkpoint->'state' INTO state FROM shared_tactical_sessions WHERE id=session;
 SELECT jsonb_agg(jsonb_set(CASE WHEN u->'effects' IS NULL THEN u ELSE jsonb_set(u,'{effects}',
  coalesce((SELECT jsonb_agg(jsonb_set(e,'{sourceUnitId}',to_jsonb(shared_unit_name(e->>'sourceUnitId',owner)))) FROM jsonb_array_elements(u->'effects') e),'[]'::jsonb)) END,
  '{id}',to_jsonb(shared_unit_name(u->>'id',owner))) ORDER BY (u->>'id'=owner) DESC,pos) INTO units FROM jsonb_array_elements(state->'units') WITH ORDINALITY t(u,pos);
 SELECT jsonb_agg(shared_unit_name(id,owner) ORDER BY pos) INTO ordering FROM jsonb_array_elements_text(state->'order') WITH ORDINALITY t(id,pos);
 SELECT jsonb_object_agg(shared_unit_name(k,owner),v) INTO budget FROM jsonb_each(state->'budgets') t(k,v);
 IF state ? 'battlefield' THEN
  SELECT jsonb_object_agg(shared_unit_name(k,owner),v) INTO field_value FROM jsonb_each(state->'battlefield'->'rows') t(k,v);
  state:=jsonb_set(state,'{battlefield,rows}',field_value);
  SELECT jsonb_object_agg(shared_unit_name(k,owner),v) INTO field_value FROM jsonb_each(state->'battlefield'->'stagger') t(k,v);
  state:=jsonb_set(state,'{battlefield,stagger}',field_value);
  SELECT coalesce(jsonb_agg(shared_unit_name(id,owner) ORDER BY pos),'[]'::jsonb) INTO field_value FROM jsonb_array_elements_text(state->'battlefield'->'disengaged') WITH ORDINALITY t(id,pos);
  state:=jsonb_set(state,'{battlefield,disengaged}',field_value);
 END IF;
 RETURN jsonb_set(jsonb_set(jsonb_set(state,'{units}',units),'{order}',ordering),'{budgets}',budget);
END $$;
