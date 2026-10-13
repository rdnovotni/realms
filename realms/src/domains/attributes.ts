import type pg from 'pg';
import { executeAction,advanceRevision,type Envelope } from '../foundation/action.js';
import { transaction } from '../foundation/transaction.js';
import { DomainError } from '../foundation/errors.js';
import { validateAllocation,type AttributeAllocation } from './attribute-content.js';
export function allocateAttributes(pool:pg.Pool,accountId:string,envelope:Envelope,rulesId:string,milestone:number,allocation:AttributeAllocation) {
  if(envelope.actionType!=='ALLOCATE_ATTRIBUTES' || !/^[a-z][a-z0-9_.-]{2,119}$/.test(rulesId) || !Number.isInteger(milestone) || milestone<1 || milestone>999)throw new DomainError(400,'INVALID_ATTRIBUTE_ACTION');
  validateAllocation(allocation);if(!['MANUAL_UI','API'].includes(envelope.authorizationSource??'MANUAL_UI'))throw new DomainError(403,'EXPLICIT_BUILD_CHOICE_REQUIRED');
  return executeAction(pool,accountId,envelope,{rulesId,milestone,allocation},async c=>{
    let row;
    try{row=(await c.client.query('INSERT INTO run_attribute_choices(run_id,action_id,rules_id,milestone,allocation) VALUES($1,$2,$3,$4,$5) RETURNING after_attributes,choice_no',[c.run.id,c.actionId,rulesId,milestone,allocation])).rows[0];}
    catch(error){const e=error as {code?:string;message?:string},codes:Record<string,[number,string]>={
      'Attribute choice requires a configured normal run':[409,'BUILD_NOT_CONFIGURED'],
      'Attribute choices require leaving the active instance':[409,'INSTANCE_STILL_ACTIVE'],
      'Attribute rules do not match the committed build':[409,'ATTRIBUTE_RULES_MISMATCH'],
      'Attribute milestone has not been earned or authored':[409,'ATTRIBUTE_MILESTONE_NOT_READY'],
      'Attribute milestone already has a choice':[409,'ATTRIBUTE_MILESTONE_USED'],
      'Attribute allocation does not match its authored budget':[400,'INVALID_ATTRIBUTE_BUDGET'],
      'Attribute allocation exceeds authored caps':[409,'ATTRIBUTE_CAP_REACHED'],
      'Attribute allocation blocks remaining milestone capacity':[409,'ATTRIBUTE_CAPACITY_RESERVED']
    };const failure=codes[e.message??''];if(e.code==='P0001' && failure)throw new DomainError(...failure);throw error;}
    return {attributes:row.after_attributes,choiceNumber:row.choice_no as number,revision:await advanceRevision(c)};
  });
}
export async function attributeView(pool:pg.Pool,accountId:string) {
  return transaction(pool,async client=>{
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const current=(await client.query(`SELECT p.run_id,attribute_projection(p.run_id) AS attributes FROM run_progression p JOIN runs r ON r.id=p.run_id JOIN characters c ON c.id=r.character_id WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE')`,[accountId])).rows[0];
    if(!current)throw new DomainError(404,'PROGRESSION_NOT_FOUND');
    const choices=(await client.query('SELECT milestone,allocation,rules_id AS "rulesId",rules_revision AS "rulesRevision" FROM run_attribute_choices WHERE run_id=$1 ORDER BY choice_no',[current.run_id])).rows;
    const rules=(await client.query(`SELECT e.entity_id AS "rulesId",e.revision AS "rulesRevision",v.definition->'mechanics'->'attributeRules'->'maximumScores' AS "maximumScores",
      coalesce((SELECT jsonb_agg(m ORDER BY (m->>'level')::integer) FROM jsonb_array_elements(v.definition->'mechanics'->'attributeRules'->'milestones') m
        WHERE (m->>'level')::integer<=p.level AND NOT EXISTS(SELECT 1 FROM run_attribute_choices chosen WHERE chosen.run_id=r.id AND chosen.milestone=(m->>'level')::integer)),'[]'::jsonb) AS "availableMilestones",
      EXISTS(SELECT 1 FROM instance_participants ip JOIN instances i ON i.id=ip.instance_id WHERE ip.run_id=r.id AND i.lifecycle='ACTIVE') AS "blockedByInstance"
      FROM runs r JOIN run_progression p ON p.run_id=r.id JOIN run_builds b ON b.run_id=r.id JOIN release_entries e ON e.release_id=r.content_release_id
      JOIN content_entities ce ON ce.id=e.entity_id AND ce.kind='TUNING' JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision
      WHERE r.id=$1 AND r.mode IN('STANDARD','CASUAL') AND b.state->>'mode'='CONFIGURED'
        AND v.definition->'mechanics'->'attributeRules'->>'buildRulesId'=b.state->'rules'->>'id'
        AND NOT EXISTS(SELECT 1 FROM run_attribute_choices prior WHERE prior.run_id=r.id AND prior.rules_id<>e.entity_id) ORDER BY e.entity_id`,[current.run_id])).rows;
    return {attributes:current.attributes,choices,rules};
  });
}
