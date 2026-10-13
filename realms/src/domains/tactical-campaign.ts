import { Ajv } from 'ajv';
import type { ContentEntity } from './content.js';
import type { ActionContext } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';

export type TacticalCampaign={version:1;ruleset:'TACTICAL_CAMPAIGN_V1';finalEncounterId:string;requiresEncounterIds:string[]};
const id={type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'};
const validate=new Ajv({strict:true}).compile({type:'object',additionalProperties:false,required:['version','ruleset','finalEncounterId','requiresEncounterIds'],properties:{version:{const:1},ruleset:{const:'TACTICAL_CAMPAIGN_V1'},finalEncounterId:id,requiresEncounterIds:{type:'array',maxItems:32,uniqueItems:true,items:id}}});
export function validateTacticalCampaign(value:unknown):asserts value is TacticalCampaign {
 if(!validate(value)||(value as TacticalCampaign).requiresEncounterIds.includes((value as TacticalCampaign).finalEncounterId))throw new DomainError(400,'INVALID_TACTICAL_CAMPAIGN');
}
export function validateTacticalCampaignContent(entity:ContentEntity,entities:Map<string,ContentEntity>) {
 const m=entity.definition.mechanics;
 if(m?.tacticalCampaign!==undefined){
  if(entity.kind!=='TUNING'||m.campaign!==undefined)throw new DomainError(400,'INVALID_TACTICAL_CAMPAIGN_KIND');
  validateTacticalCampaign(m.tacticalCampaign);const campaign=m.tacticalCampaign;
  const final=entities.get(campaign.finalEncounterId),f=final?.definition.mechanics;
  if(final?.kind!=='ENCOUNTER'||(f?.tacticalCombat as {campaignId?:string}|undefined)?.campaignId!==entity.id||typeof f?.characterProfileId!=='string')throw new DomainError(400,'INVALID_TACTICAL_CAMPAIGN_FINAL');
  for(const requiredId of campaign.requiresEncounterIds){
   const required=entities.get(requiredId),r=required?.definition.mechanics;
   if(required?.kind!=='ENCOUNTER'||!entity.definition.dependencies.includes(requiredId)||r?.tacticalCombat===undefined||(r.tacticalCombat as {campaignId?:string}).campaignId!==undefined||r.characterProfileId!==f.characterProfileId)throw new DomainError(400,'INVALID_TACTICAL_CAMPAIGN_PREREQUISITE');
  }
 }
 const campaignId=(m?.tacticalCombat as {campaignId?:string}|undefined)?.campaignId;
 if(campaignId){
  const target=entities.get(campaignId);
  if(entity.kind!=='ENCOUNTER'||target?.kind!=='TUNING'||!entity.definition.dependencies.includes(campaignId))throw new DomainError(400,'INVALID_TACTICAL_CAMPAIGN_REFERENCE');
  validateTacticalCampaign(target.definition.mechanics?.tacticalCampaign);
  if(target.definition.mechanics!.tacticalCampaign.finalEncounterId!==entity.id)throw new DomainError(400,'INVALID_TACTICAL_CAMPAIGN_FINAL');
 }
}
async function campaignFor(c:ActionContext,campaignId:string) {
 const row=(await c.client.query(`SELECT e.revision,v.definition->'mechanics'->'tacticalCampaign' AS spec FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=$1 AND e.entity_id=$2`,[c.run.content_release_id,campaignId])).rows[0];
 validateTacticalCampaign(row?.spec);return {revision:row.revision as number,spec:row.spec as TacticalCampaign};
}
/** Return concrete earlier victories, rather than trusting a progression flag.
 * Account/run locks serialize both start and settlement. Only managed tactical
 * victories from this run, release and character profile qualify.
 */
export async function tacticalCampaignPrerequisites(c:ActionContext,definitionId:string,campaignId:string,startRevision?:number) {
 if(c.run.status!=='ACTIVE')throw new DomainError(409,'CAMPAIGN_ALREADY_COMPLETE');
 const campaign=await campaignFor(c,campaignId);
 if(campaign.spec.finalEncounterId!==definitionId)throw new DomainError(409,'CAMPAIGN_FINAL_MISMATCH');
 const wins=(await c.client.query(`SELECT DISTINCT ON(e.definition_id) e.definition_id,e.instance_id,e.finish_action_id FROM encounter_records e JOIN action_receipts receipt ON receipt.action_id=e.finish_action_id JOIN tactical_encounter_origins origin ON origin.instance_id=e.instance_id JOIN content_versions v ON v.entity_id=e.definition_id AND v.revision=e.definition_revision JOIN release_entries final_pin ON final_pin.release_id=$2 AND final_pin.entity_id=$3 JOIN content_versions final ON final.entity_id=final_pin.entity_id AND final.revision=final_pin.revision WHERE e.run_id=$1 AND e.release_id=$2 AND e.outcome='VICTORY' AND (campaign_action_revision(receipt.result)<$4 OR $4::bigint IS NULL) AND v.definition->'mechanics'->>'characterProfileId'=final.definition->'mechanics'->>'characterProfileId' ORDER BY e.definition_id,e.finished_at,e.instance_id`,[c.run.id,c.run.content_release_id,definitionId,startRevision??null])).rows;
 if(campaign.spec.requiresEncounterIds.some(id=>!wins.some(w=>w.definition_id===id)))throw new DomainError(409,'CAMPAIGN_PREREQUISITES_MISSING');
 return {campaign,wins:wins.filter(w=>campaign.spec.requiresEncounterIds.includes(w.definition_id as string))};
}
export async function completeTacticalCampaign(c:ActionContext,instanceId:string,campaignId:string) {
 const final=(await c.client.query('SELECT e.definition_id,campaign_action_revision(receipt.result) AS start_revision FROM encounter_records e JOIN action_receipts receipt ON receipt.action_id=e.start_action_id WHERE e.instance_id=$1 AND e.run_id=$2',[instanceId,c.run.id])).rows[0];
 if(!final)throw new DomainError(409,'CAMPAIGN_FINAL_MISSING');
 const {campaign,wins}=await tacticalCampaignPrerequisites(c,final.definition_id as string,campaignId,Number(final.start_revision));
 await c.client.query(`INSERT INTO run_completions(run_id,release_id,campaign_id,definition_revision,final_instance_id,action_id,ruleset) VALUES($1,$2,$3,$4,$5,$6,'TACTICAL_CAMPAIGN_V1')`,[c.run.id,c.run.content_release_id,campaignId,campaign.revision,instanceId,c.actionId]);
 for(const win of wins)await c.client.query('INSERT INTO tactical_campaign_prerequisites(run_id,definition_id,instance_id,finish_action_id) VALUES($1,$2,$3,$4)',[c.run.id,win.definition_id,win.instance_id,win.finish_action_id]);
 await c.client.query("UPDATE runs SET status='AFTERCORE',completed_at=now() WHERE id=$1",[c.run.id]);
}
