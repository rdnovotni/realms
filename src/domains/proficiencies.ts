import type pg from 'pg';
import { executeAction,advanceRevision,type Envelope } from '../foundation/action.js';
import { transaction } from '../foundation/transaction.js';
import { DomainError } from '../foundation/errors.js';
import { proficiencyRanks } from './proficiency-content.js';
export function advanceProficiency(pool:pg.Pool,accountId:string,envelope:Envelope,rulesId:string,skillId:string,milestone:number){
  if(envelope.actionType!=='ADVANCE_PROFICIENCY' || !/^[a-z][a-z0-9_.-]{2,119}$/.test(rulesId) || !/^[a-z][a-z0-9_.-]{2,119}$/.test(skillId) || !Number.isInteger(milestone) || milestone<1 || milestone>999)throw new DomainError(400,'INVALID_PROFICIENCY_ACTION');
  if(!['MANUAL_UI','API'].includes(envelope.authorizationSource??'MANUAL_UI'))throw new DomainError(403,'EXPLICIT_BUILD_CHOICE_REQUIRED');
  return executeAction(pool,accountId,envelope,{rulesId,skillId,milestone},async c=>{
    let row;try{row=(await c.client.query('INSERT INTO run_proficiency_choices(run_id,action_id,rules_id,skill_id,milestone) VALUES($1,$2,$3,$4,$5) RETURNING skill_revision,after_rank,choice_no',[c.run.id,c.actionId,rulesId,skillId,milestone])).rows[0];}
    catch(error){const e=error as {code?:string;message?:string},codes:Record<string,[number,string]>={
      'Proficiency choice requires a configured normal run':[409,'BUILD_NOT_CONFIGURED'],
      'Proficiency choices require leaving the active instance':[409,'INSTANCE_STILL_ACTIVE'],
      'Skill has not been discovered':[403,'SKILL_NOT_DISCOVERED'],
      'Proficiency rules do not match the committed build':[409,'PROFICIENCY_RULES_MISMATCH'],
      'Skill is not allowed by the proficiency rules':[409,'SKILL_NOT_ALLOWED'],
      'Skill is not authored in the pinned release':[409,'SKILL_NOT_IN_RULES_SNAPSHOT'],
      'Proficiency milestone has not been earned or authored':[409,'PROFICIENCY_MILESTONE_NOT_READY'],
      'Proficiency milestone already has a choice':[409,'PROFICIENCY_MILESTONE_USED'],
      'Skill has reached its authored rank cap':[409,'SKILL_RANK_CAP_REACHED']};const f=codes[e.message??''];if(e.code==='P0001' && f)throw new DomainError(...f);throw error;}
    return {skillId,skillRevision:row.skill_revision as number,rank:proficiencyRanks[row.after_rank as number]!,choiceNumber:row.choice_no as number,milestone,revision:await advanceRevision(c)};
  });
}
export async function proficiencyView(pool:pg.Pool,accountId:string){
  return transaction(pool,async client=>{
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const selected=(await client.query(`SELECT p.skill_id AS "skillId",p.skill_revision AS "skillRevision",p.rank,v.definition->>'name' AS name,
      v.definition->'mechanics'->'skill'->>'family' AS family,v.definition->'mechanics'->'skill'->>'defaultAttribute' AS "defaultAttribute"
      FROM run_skill_ranks p JOIN runs r ON r.id=p.run_id JOIN characters c ON c.id=r.character_id
      JOIN content_versions v ON v.entity_id=p.skill_id AND v.revision=p.skill_revision WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE') ORDER BY p.skill_id`,[accountId])).rows;
    const choices=(await client.query(`SELECT p.skill_id AS "skillId",p.milestone,p.choice_no AS "choiceNumber",p.before_rank AS "beforeRank",p.after_rank AS "afterRank"
      FROM run_proficiency_choices p JOIN runs r ON r.id=p.run_id JOIN characters c ON c.id=r.character_id WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE') ORDER BY p.choice_no`,[accountId])).rows;
    const options=(await client.query(`SELECT e.entity_id AS "rulesId",se.entity_id AS "skillId",se.revision AS "skillRevision",sv.definition->>'name' AS name,
      sv.definition->'mechanics'->'skill'->>'family' AS family,sv.definition->'mechanics'->'skill'->>'defaultAttribute' AS "defaultAttribute",
      coalesce(p.rank,0) AS rank,(sv.definition->'mechanics'->'skill'->>'maximumRank')::integer AS "maximumRank",
      ARRAY(SELECT m::integer FROM jsonb_array_elements_text(rv.definition->'mechanics'->'proficiencyRules'->'milestones') m
        WHERE m::integer<=(b.state->>'level')::integer AND NOT EXISTS(SELECT 1 FROM run_proficiency_choices prior WHERE prior.run_id=r.id AND prior.milestone=m::integer)) AS "availableMilestones",
      EXISTS(SELECT 1 FROM instance_participants ip JOIN instances i ON i.id=ip.instance_id WHERE ip.run_id=r.id AND i.lifecycle='ACTIVE') AS "blockedByInstance"
      FROM runs r JOIN characters c ON c.id=r.character_id JOIN run_builds b ON b.run_id=r.id
      JOIN release_entries e ON e.release_id=r.content_release_id JOIN content_versions rv ON rv.entity_id=e.entity_id AND rv.revision=e.revision
      JOIN content_entities ce ON ce.id=e.entity_id AND ce.kind='TUNING'
      CROSS JOIN LATERAL jsonb_array_elements_text(rv.definition->'mechanics'->'proficiencyRules'->'skillIds') skill
      JOIN release_entries se ON se.release_id=r.content_release_id AND se.entity_id=skill
      JOIN content_entities sk ON sk.id=se.entity_id AND sk.kind='SKILL' JOIN content_versions sv ON sv.entity_id=se.entity_id AND sv.revision=se.revision
      JOIN discoveries d ON d.account_id=c.account_id AND d.entity_id=se.entity_id LEFT JOIN run_skill_ranks p ON p.run_id=r.id AND p.skill_id=se.entity_id
      WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE') AND r.mode IN('STANDARD','CASUAL') AND b.state->>'mode'='CONFIGURED'
        AND rv.definition->'mechanics'->'proficiencyRules'->>'buildRulesId'=b.state->'rules'->>'id'
        AND NOT EXISTS(SELECT 1 FROM run_proficiency_choices prior WHERE prior.run_id=r.id AND prior.rules_id<>e.entity_id) ORDER BY e.entity_id,se.entity_id`,[accountId])).rows;
    return {selected:selected.map(p=>({...p,rank:proficiencyRanks[p.rank as number]})),choices:choices.map(p=>({...p,beforeRank:proficiencyRanks[p.beforeRank as number],afterRank:proficiencyRanks[p.afterRank as number]})),options:options.map(p=>({...p,rank:proficiencyRanks[p.rank as number],maximumRank:proficiencyRanks[p.maximumRank as number],eligibility:p.blockedByInstance?'ACTIVE_INSTANCE':p.rank>=p.maximumRank?'RANK_CAP_REACHED':p.availableMilestones.length===0?'NO_EARNED_MILESTONE':'ELIGIBLE'}))};
  });
}
