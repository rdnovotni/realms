import type pg from 'pg';
import { executeAction,advanceRevision,type Envelope } from '../foundation/action.js';
import { transaction } from '../foundation/transaction.js';
import { DomainError } from '../foundation/errors.js';
export function chooseFeat(pool:pg.Pool,accountId:string,envelope:Envelope,featId:string,milestone:number) {
  if(envelope.actionType!=='CHOOSE_FEAT' || !/^[a-z][a-z0-9_.-]{2,119}$/.test(featId) || !Number.isInteger(milestone) || milestone<1 || milestone>999)throw new DomainError(400,'INVALID_FEAT_ACTION');
  if(!['MANUAL_UI','API'].includes(envelope.authorizationSource??'MANUAL_UI'))throw new DomainError(403,'EXPLICIT_BUILD_CHOICE_REQUIRED');
  return executeAction(pool,accountId,envelope,{featId,milestone},async c=>{
    let row;
    try{row=(await c.client.query('INSERT INTO run_feat_choices(run_id,action_id,feat_id,milestone) VALUES($1,$2,$3,$4) RETURNING feat_id,feat_revision,milestone,choice_no',[c.run.id,c.actionId,featId,milestone])).rows[0];}
    catch(error){const e=error as {code?:string;message?:string},codes:Record<string,[number,string]>={
      'Feat choice requires a configured normal run':[409,'BUILD_NOT_CONFIGURED'],
      'Feat choices require leaving the active instance':[409,'INSTANCE_STILL_ACTIVE'],
      'Feat has not been discovered':[403,'FEAT_NOT_DISCOVERED'],
      'Feat is not authored in the pinned release':[409,'FEAT_NOT_IN_RULES_SNAPSHOT'],
      'Feat rules do not match the committed build':[409,'FEAT_RULES_MISMATCH'],
      'Feat milestone has not been earned or authored':[409,'FEAT_MILESTONE_NOT_READY'],
      'Feat milestone already has a choice':[409,'FEAT_MILESTONE_USED'],
      'Feat has already been selected':[409,'FEAT_ALREADY_CHOSEN'],
      'Feat prerequisites are not satisfied':[409,'FEAT_PREREQUISITES_NOT_MET']
    };const failure=codes[e.message??''];if(e.code==='P0001' && failure)throw new DomainError(...failure);throw error;}
    return {featId:row.feat_id as string,featRevision:row.feat_revision as number,milestone:row.milestone as number,choiceNumber:row.choice_no as number,revision:await advanceRevision(c)};
  });
}
export async function featView(pool:pg.Pool,accountId:string) {
  return transaction(pool,async client=>{
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const selected=(await client.query(`SELECT f.feat_id AS "featId",f.feat_revision AS "featRevision",f.milestone,v.definition->>'name' AS name
      FROM run_feats f JOIN runs r ON r.id=f.run_id JOIN characters c ON c.id=r.character_id JOIN content_versions v ON v.entity_id=f.feat_id AND v.revision=f.feat_revision
      WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE') ORDER BY f.milestone`,[accountId])).rows;
    const options=(await client.query(`SELECT e.entity_id AS "featId",e.revision AS "featRevision",v.definition->>'name' AS name,re.entity_id AS "rulesId",
      ARRAY(SELECT m::integer FROM jsonb_array_elements_text(rv.definition->'mechanics'->'featRules'->'milestones') m WHERE m::integer<=p.level
        AND NOT EXISTS(SELECT 1 FROM run_feats chosen WHERE chosen.run_id=r.id AND chosen.milestone=m::integer)) AS "availableMilestones",
      CASE WHEN EXISTS(SELECT 1 FROM run_feats chosen WHERE chosen.run_id=r.id AND chosen.feat_id=e.entity_id) THEN 'ALREADY_CHOSEN'
        WHEN NOT feat_eligible(v.definition->'mechanics'->'feat',b.state,ARRAY(SELECT feat_id FROM run_feats WHERE run_id=r.id)) THEN 'PREREQUISITES_NOT_MET'
        WHEN EXISTS(SELECT 1 FROM instance_participants ip JOIN instances i ON i.id=ip.instance_id WHERE ip.run_id=r.id AND i.lifecycle='ACTIVE') THEN 'ACTIVE_INSTANCE' ELSE 'ELIGIBLE' END AS eligibility
      FROM runs r JOIN characters c ON c.id=r.character_id JOIN run_builds b ON b.run_id=r.id JOIN run_progression p ON p.run_id=r.id
      JOIN release_entries e ON e.release_id=r.content_release_id JOIN content_entities ce ON ce.id=e.entity_id AND ce.kind='ABILITY'
      JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision JOIN discoveries d ON d.entity_id=e.entity_id AND d.account_id=c.account_id
      JOIN release_entries re ON re.release_id=r.content_release_id AND re.entity_id=v.definition->'mechanics'->'feat'->>'rulesId'
      JOIN content_versions rv ON rv.entity_id=re.entity_id AND rv.revision=re.revision
      WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE') AND r.mode IN('STANDARD','CASUAL') AND b.state->>'mode'='CONFIGURED'
        AND rv.definition->'mechanics'->'featRules'->>'buildRulesId'=b.state->'rules'->>'id'
        AND NOT EXISTS(SELECT 1 FROM run_feat_choices prior WHERE prior.run_id=r.id AND prior.rules_id<>re.entity_id) ORDER BY e.entity_id`,[accountId])).rows;
    return {selected,options};
  });
}
