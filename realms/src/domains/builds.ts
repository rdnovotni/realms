import { advancementScope,advancementStamp } from './advancement-view.js';
import { transaction } from '../foundation/transaction.js';
import { progressionReadiness,type ProgressionCurve } from './progression-rules.js';
import { requireEntityPrerequisite } from '../rules/requirements.js';
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
    await requireEntityPrerequisite(c,classId);
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
    const effective=(await c.client.query("SELECT jsonb_build_object('strength',strength,'dexterity',dexterity,'constitution',constitution,'intelligence',intelligence,'wisdom',wisdom,'charisma',charisma,'luck',luck) AS attributes FROM run_progression WHERE run_id=$1",[c.run.id])).rows[0].attributes;
    return {build:{...row.after_state,attributes:effective},buildRevision:row.revision as number,revision:await advanceRevision(c)};
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
export async function buildOptions(pool:pg.Pool,accountId:string,advancement=false) {
  if(!advancement)return readBuildOptions(pool,accountId);
  return transaction(pool,async client=>{
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const run=await advancementScope(client,accountId),base=await readBuildOptions(client,accountId);
    const classes=[];
    for(const option of base.classes){
      const nativeLevel=(run.build?.classes??[]).find((c:{classId:string;nativeLevel:number})=>c.classId===option.classId)?.nativeLevel??0;
      let eligibility='AVAILABLE';
      if(run.build?.mode!=='CONFIGURED')eligibility='BUILD_NOT_CONFIGURED';
      else {
        // Call the exact immutable transition function used by guard_build_event.
        const pinned=(await client.query(`SELECT v.definition->'mechanics'->'classProgression' AS native,rv.definition->'mechanics'->'buildRules' AS rules,
          cv.definition->'mechanics'->'xpCurve' AS curve,jsonb_build_object('id',re.entity_id,'revision',re.revision,'curveId',ce.entity_id,'curveRevision',ce.revision,'releaseId',e.release_id::text) AS ref
          FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision
          JOIN release_entries re ON re.release_id=e.release_id AND re.entity_id=v.definition->'mechanics'->'classProgression'->>'rulesId'
          JOIN content_versions rv ON rv.entity_id=re.entity_id AND rv.revision=re.revision
          JOIN release_entries ce ON ce.release_id=e.release_id AND ce.entity_id=rv.definition->'mechanics'->'buildRules'->>'curveId'
          JOIN content_versions cv ON cv.entity_id=ce.entity_id AND cv.revision=ce.revision
          WHERE e.release_id=$1 AND e.entity_id=$2`,[run.content_release_id,option.classId])).rows[0];
        if(!pinned)eligibility='BUILD_CURVE_MISMATCH';
        else {
          await client.query('SAVEPOINT class_preview');
          try {
            await requireEntityPrerequisite({client,run,accountId},option.classId);
            await client.query("SELECT next_build_state($1::jsonb,'LEVEL_UP',$2,NULL,$3::jsonb,$4::jsonb,$5::jsonb)",[run.build,option.classId,pinned.native,pinned.rules,pinned.ref]);
            const mismatch=(await client.query('SELECT 1 FROM encounter_xp_plans WHERE run_id=$1 AND (curve_id<>$2 OR curve_revision<>$3) LIMIT 1',[run.id,pinned.ref.curveId,pinned.ref.curveRevision])).rows.length;
            if(mismatch)eligibility='BUILD_CURVE_MISMATCH';
            else if(progressionReadiness(pinned.curve as ProgressionCurve,run.xp,run.level).pendingLevels===0)eligibility='LEVEL_NOT_READY';
            else if(run.active_instance)eligibility='ACTIVE_INSTANCE';
          }catch(error){
            await client.query('ROLLBACK TO SAVEPOINT class_preview');
            const e=error as {code?:string;message?:string},codes:Record<string,string>={'Normal class limit reached':'CLASS_LIMIT','Authored native class level limit reached':'NATIVE_CLASS_LEVEL_LIMIT','Level choice requires the current configured build rules':'BUILD_RULES_MISMATCH'};
            if(e.code==='PREREQUISITE_NOT_MET')eligibility='PREREQUISITES_NOT_MET';
            else if(e.code==='P0001'&&codes[e.message??''])eligibility=codes[e.message!]!;
            else throw error;
          }finally{await client.query('RELEASE SAVEPOINT class_preview');}
        }
      }
      classes.push({...option,nativeLevel,nextNativeLevel:nativeLevel+1,eligibility});
    }
    return {...base,classes,...advancementStamp(run)};
  });
}
async function readBuildOptions(pool:pg.Pool|pg.PoolClient,accountId:string) {
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
  const classes: {classId:string;revision:number;name:string;rulesId:string;maximumNativeLevel:number;nativeLevel?:number;nextNativeLevel?:number;eligibility?:string}[]=[],rules=new Map<string,{rulesId:string;revision:number;curveId:string;presets:BuildRules['presets']}>();
  for(const row of rows) {
    validateNativeClass(row.spec);validateBuildRules(row.rules);
    classes.push({classId:row.entity_id,revision:row.revision,name:row.name,rulesId:row.rules_id,maximumNativeLevel:row.spec.maximumNativeLevel});
    rules.set(row.rules_id,{rulesId:row.rules_id,revision:row.rules_revision,curveId:row.rules.curveId,presets:row.rules.presets});
  }
  return {classes,rules:[...rules.values()]};
}
