import type pg from 'pg';
import { executeAction,advanceRevision,type Envelope } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';
import { validateBuildRules,validateNativeClass,type BuildRules } from './build-content.js';
function explicit(envelope:Envelope,type:string,classId:string) {
  if(envelope.actionType!==type || !/^[a-z][a-z0-9_.-]{2,119}$/.test(classId)) throw new DomainError(400,'INVALID_BUILD_ACTION');
  if(!['MANUAL_UI','API'].includes(envelope.authorizationSource??'MANUAL_UI')) throw new DomainError(403,'EXPLICIT_BUILD_CHOICE_REQUIRED');
}
function record(pool:pg.Pool,accountId:string,envelope:Envelope,classId:string,presetKey:string|null) {
  return executeAction(pool,accountId,envelope,{classId,presetKey},async c=>{
    if((await c.client.query("SELECT 1 FROM instance_participants p JOIN instances i ON i.id=p.instance_id WHERE p.run_id=$1 AND i.lifecycle='ACTIVE' LIMIT 1",[c.run.id])).rows.length) throw new DomainError(409,'INSTANCE_STILL_ACTIVE');
    // SQL derives the content pins, exact transition, XP snapshot and projections.
    // The client supplies one class choice and (on first setup only) a preset key.
    let row;
    try {row=(await c.client.query('INSERT INTO run_build_events(run_id,action_id,kind,class_id,preset_key) VALUES($1,$2,$3,$4,$5) RETURNING after_state,revision',[c.run.id,c.actionId,envelope.actionType,classId,presetKey])).rows[0];}
    catch(error) {
      const validation:Record<string,[number,string]>={
        'Run does not support normal class progression':[409,'UNSUPPORTED_BUILD_MODE'],
        'Build choices require leaving the active instance':[409,'INSTANCE_STILL_ACTIVE'],
        'Starting build must precede encounter progression':[409,'BUILD_SETUP_NOT_AVAILABLE'],
        'Build setup requires a fresh unconfigured run':[409,'BUILD_SETUP_NOT_AVAILABLE'],
        'Level choice requires the current configured build rules':[409,'BUILD_NOT_CONFIGURED'],
        'Class has not been discovered':[403,'CLASS_NOT_DISCOVERED'],
        'Class is not authored in the pinned release':[409,'CLASS_NOT_IN_RULES_SNAPSHOT'],
        'Unknown starting attribute preset':[400,'INVALID_BUILD_PRESET'],
        'Normal class limit reached':[409,'CLASS_LIMIT'],
        'Authored native class level limit reached':[409,'NATIVE_CLASS_LEVEL_LIMIT'],
        'Next character level has not been earned':[409,'LEVEL_NOT_READY'],
        'Build and encounter XP curves differ':[409,'BUILD_CURVE_MISMATCH']
      };
      const pgError=error as {code?:string;message?:string},failure=validation[pgError.message??''];
      if(pgError.code==='P0001' && failure) throw new DomainError(...failure);
      throw error;
    }
    return {build:row.after_state,buildRevision:row.revision as number,revision:await advanceRevision(c)};
  });
}
export function startBuild(pool:pg.Pool,accountId:string,envelope:Envelope,classId:string,presetKey:string) {
  explicit(envelope,'START_BUILD',classId);
  if(typeof presetKey!=='string' || !/^[a-z][a-z0-9_-]{0,39}$/.test(presetKey)) throw new DomainError(400,'INVALID_BUILD_PRESET');
  return record(pool,accountId,envelope,classId,presetKey);
}
export function levelUp(pool:pg.Pool,accountId:string,envelope:Envelope,classId:string) {
  explicit(envelope,'LEVEL_UP',classId);return record(pool,accountId,envelope,classId,null);
}
export async function buildOptions(pool:pg.Pool,accountId:string) {
  const rows=(await pool.query(`SELECT e.entity_id,e.revision,v.definition->>'name' AS name,v.definition->'mechanics'->'classProgression' AS spec,
    rules.entity_id AS rules_id,rules.revision AS rules_revision,rv.definition->'mechanics'->'buildRules' AS rules
    FROM runs r JOIN characters c ON c.id=r.character_id JOIN run_builds b ON b.run_id=r.id JOIN run_progression p ON p.run_id=r.id
    JOIN release_entries e ON e.release_id=r.content_release_id
    JOIN content_entities ce ON ce.id=e.entity_id AND ce.kind='CLASS'
    JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision
    JOIN discoveries d ON d.account_id=c.account_id AND d.entity_id=e.entity_id
    JOIN release_entries rules ON rules.release_id=r.content_release_id AND rules.entity_id=v.definition->'mechanics'->'classProgression'->>'rulesId'
    JOIN content_versions rv ON rv.entity_id=rules.entity_id AND rv.revision=rules.revision
    WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE') AND r.mode IN('STANDARD','CASUAL')
      AND ((b.state->>'mode'='UNCONFIGURED' AND p.xp=0 AND NOT EXISTS(SELECT 1 FROM encounter_records WHERE run_id=r.id))
        OR (b.state->>'mode'='CONFIGURED' AND b.state->'rules'->>'id'=rules.entity_id)) ORDER BY e.entity_id`,[accountId])).rows;
  const classes: {classId:string;revision:number;name:string;rulesId:string;maximumNativeLevel:number}[]=[],rules=new Map<string,{rulesId:string;revision:number;curveId:string;presets:BuildRules['presets']}>();
  for(const row of rows) {
    validateNativeClass(row.spec);validateBuildRules(row.rules);
    classes.push({classId:row.entity_id,revision:row.revision,name:row.name,rulesId:row.rules_id,maximumNativeLevel:row.spec.maximumNativeLevel});
    rules.set(row.rules_id,{rulesId:row.rules_id,revision:row.rules_revision,curveId:row.rules.curveId,presets:row.rules.presets});
  }
  return {classes,rules:[...rules.values()]};
}
