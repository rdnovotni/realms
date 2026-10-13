import { Ajv } from 'ajv';
import type pg from 'pg';
import type { ContentEntity } from './content.js';
import { validateNativeClass } from './build-content.js';
import { executeAction,advanceRevision,type Envelope } from '../foundation/action.js';
import { transaction } from '../foundation/transaction.js';
import { DomainError } from '../foundation/errors.js';
export type SubclassSpec={version:1;ruleset:'SUBCLASS_CHOICE_V1';classId:string;unlockNativeLevel:5;access:'DISCOVERED'};
const validate=new Ajv({strict:true,allErrors:true}).compile({type:'object',additionalProperties:false,required:['version','ruleset','classId','unlockNativeLevel','access'],properties:{version:{type:'integer',const:1},ruleset:{type:'string',const:'SUBCLASS_CHOICE_V1'},classId:{type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'},unlockNativeLevel:{type:'integer',const:5},access:{type:'string',const:'DISCOVERED'}}});
export function validateSubclass(value:unknown):asserts value is SubclassSpec {if(!validate(value))throw new DomainError(400,'INVALID_SUBCLASS');}
export function validateSubclassReferences(entity:ContentEntity,entities:Map<string,ContentEntity>) {
  const spec=entity.definition.mechanics?.subclass;
  if(spec===undefined)return;
  if(entity.kind!=='ABILITY')throw new DomainError(400,'INVALID_SUBCLASS_KIND');
  validateSubclass(spec);const base=entities.get(spec.classId);
  if(base?.kind!=='CLASS' || !entity.definition.dependencies.includes(base.id))throw new DomainError(400,'INVALID_SUBCLASS_CLASS');
  validateNativeClass(base.definition.mechanics?.classProgression);
  if(base.definition.mechanics.classProgression.maximumNativeLevel<5)throw new DomainError(400,'UNREACHABLE_SUBCLASS');
}
export function chooseSubclass(pool:pg.Pool,accountId:string,envelope:Envelope,subclassId:string) {
  if(envelope.actionType!=='CHOOSE_SUBCLASS' || !/^[a-z][a-z0-9_.-]{2,119}$/.test(subclassId))throw new DomainError(400,'INVALID_SUBCLASS_ACTION');
  if(!['MANUAL_UI','API'].includes(envelope.authorizationSource??'MANUAL_UI'))throw new DomainError(403,'EXPLICIT_BUILD_CHOICE_REQUIRED');
  return executeAction(pool,accountId,envelope,{subclassId},async c=>{
    let row;
    try{row=(await c.client.query('INSERT INTO run_subclass_choices(run_id,action_id,subclass_id) VALUES($1,$2,$3) RETURNING class_id,subclass_id,subclass_revision,native_level_at_choice',[c.run.id,c.actionId,subclassId])).rows[0];}
    catch(error){const e=error as {code?:string;message?:string};const codes:Record<string,[number,string]>={
      'Subclass choice requires a configured normal run':[409,'BUILD_NOT_CONFIGURED'],
      'Subclass choices require leaving the active instance':[409,'INSTANCE_STILL_ACTIVE'],
      'Subclass has not been discovered':[403,'SUBCLASS_NOT_DISCOVERED'],
      'Subclass is not authored in the pinned release':[409,'SUBCLASS_NOT_IN_RULES_SNAPSHOT'],
      'Subclass requires native class level five':[409,'SUBCLASS_NOT_READY'],
      'Class already has a committed subclass':[409,'SUBCLASS_ALREADY_CHOSEN']
    };const failure=codes[e.message??''];if(e.code==='P0001' && failure)throw new DomainError(...failure);throw error;}
    return {classId:row.class_id as string,subclassId:row.subclass_id as string,subclassRevision:row.subclass_revision as number,nativeLevelAtChoice:row.native_level_at_choice as number,revision:await advanceRevision(c)};
  });
}
export async function subclassView(pool:pg.Pool,accountId:string) {
  return transaction(pool,async client=>{
  await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const selected=(await client.query(`SELECT s.class_id AS "classId",s.subclass_id AS "subclassId",s.subclass_revision AS "subclassRevision",v.definition->>'name' AS name
    FROM run_subclasses s JOIN runs r ON r.id=s.run_id JOIN characters c ON c.id=r.character_id
    JOIN content_versions v ON v.entity_id=s.subclass_id AND v.revision=s.subclass_revision
    WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE') ORDER BY s.class_id`,[accountId])).rows;
  const options=(await client.query(`SELECT e.entity_id AS "subclassId",e.revision AS "subclassRevision",v.definition->>'name' AS name,
    v.definition->'mechanics'->'subclass'->>'classId' AS "classId",coalesce(l.native_level,0) AS "nativeLevel",
    CASE WHEN s.class_id IS NOT NULL THEN 'ALREADY_CHOSEN' WHEN coalesce(l.native_level,0)<5 THEN 'NATIVE_LEVEL_REQUIRED'
      WHEN EXISTS(SELECT 1 FROM instance_participants ip JOIN instances i ON i.id=ip.instance_id WHERE ip.run_id=r.id AND i.lifecycle='ACTIVE') THEN 'ACTIVE_INSTANCE' ELSE 'AVAILABLE' END AS eligibility
    FROM runs r JOIN characters c ON c.id=r.character_id JOIN run_builds b ON b.run_id=r.id
    JOIN release_entries e ON e.release_id=r.content_release_id JOIN content_entities ce ON ce.id=e.entity_id AND ce.kind='ABILITY'
    JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision JOIN discoveries d ON d.entity_id=e.entity_id AND d.account_id=c.account_id
    LEFT JOIN run_class_levels l ON l.run_id=r.id AND l.class_id=v.definition->'mechanics'->'subclass'->>'classId'
    LEFT JOIN run_subclasses s ON s.run_id=r.id AND s.class_id=v.definition->'mechanics'->'subclass'->>'classId'
    WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE') AND r.mode IN('STANDARD','CASUAL') AND b.state->>'mode'='CONFIGURED'
      AND v.definition->'mechanics' ? 'subclass' ORDER BY e.entity_id`,[accountId])).rows;
  return {selected,options};
  });
}
