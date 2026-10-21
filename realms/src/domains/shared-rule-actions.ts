import { settleTurnRest } from './turn-rests.js';
import { consumeDailyAllowance } from './daily-allowances.js';
import { carryLoad } from './inventory-load.js';
import { carryCheckPenalty } from './inventory-rules.js';
import { retryFingerprint,retryAvailability } from '../rules/retries.js';
import { transaction } from '../foundation/transaction.js';
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { executeAction,advanceRevision,type ActionContext,type Envelope } from '../foundation/action.js';
import { type Json } from '../foundation/json.js';
import { randomInteger } from '../foundation/rng.js';
import { DomainError } from '../foundation/errors.js';
import { prerequisite } from '../rules/prerequisites.js';
import { runFacts } from '../rules/facts.js';
import { resolveSharedCheck,sharedCheckChance } from '../rules/checks.js';
import { effectTransition,effectContributions,effectCapabilities,type ActiveEffect,type EffectDefinition } from '../rules/effects.js';
import { runClocks,advanceLocalClocks,type LocalClocks } from '../rules/clocks.js';
import { validateRuleAction,type RuleAction } from '../rules/content.js';
import { payRuleCosts,grantRuleRewards } from '../rules/settlement.js';
import { requireFeature,featureAvailable } from '../rules/controls.js';
import { requireEntityPrerequisite } from '../rules/requirements.js';
import { beginEncounter,finishEncounter } from './encounters.js';
type SharedState={local:LocalClocks;effects:ActiveEffect[]};
async function loadDefinitions(c:ActionContext){
 const definitions=new Map<string,EffectDefinition>();
 for(const r of (await c.client.query(`SELECT e.entity_id,e.revision,v.definition->'mechanics'->'sharedEffect' AS spec,v.definition->'mechanics'->'dailyAllowance' AS daily,v.definition->'mechanics'->'turnRest' AS rest,v.definition->'mechanics'->'prerequisite' AS prerequisite FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=$1 AND v.definition->'mechanics'->'sharedEffect' IS NOT NULL`,[c.run.content_release_id])).rows)definitions.set(r.entity_id,{id:r.entity_id,revision:r.revision,spec:r.spec});
 return definitions;
}
export async function resolveDomain(c:ActionContext,entityId:string,domain:RuleAction['domain'],authorizationSource='MANUAL_UI'){
 await requireFeature(c.client,'shared.rules',c.accountId,false,true);
 await requireFeature(c.client,`content.${entityId}`,c.accountId);
 const row=(await c.client.query(`SELECT e.revision,v.definition->'mechanics'->'sharedAction' AS spec,v.definition->'mechanics'->'dailyAllowance' AS daily,v.definition->'mechanics'->'turnRest' AS rest,v.definition->'mechanics'->'prerequisite' AS prerequisite FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision JOIN discoveries d ON d.entity_id=e.entity_id AND d.account_id=$3 AND d.knowledge_level IN ('DISCOVERED','LEARNED','ADVANCED') WHERE e.release_id=$1 AND e.entity_id=$2`,[c.run.content_release_id,entityId,c.accountId])).rows[0];
 if(!row?.spec)throw new DomainError(404,'RULE_ACTION_NOT_KNOWN');validateRuleAction(row.spec,row.daily!==null);const spec=row.spec as RuleAction;
 if(authorizationSource==='AUTOMATION'&&spec.check.visibility==='HIDDEN')throw new DomainError(403,'UNKNOWN_CHECK_REQUIRES_EXPLICIT_ACTION');
 if(spec.domain!==domain)throw new DomainError(400,'RULE_DOMAIN_MISMATCH');
 if((await c.client.query("SELECT 1 FROM instance_participants p JOIN instances i ON i.id=p.instance_id WHERE p.run_id=$1 AND i.lifecycle='ACTIVE' LIMIT 1",[c.run.id])).rowCount)throw new DomainError(409,'INSTANCE_STILL_ACTIVE');
 await requireEntityPrerequisite(c,entityId);
 const definitions=await loadDefinitions(c);
 const before=(await c.client.query('SELECT state FROM shared_rules_state WHERE run_id=$1 FOR UPDATE',[c.run.id])).rows[0]?.state??{};
 const state:SharedState=Object.keys(before).length?structuredClone(before):{local:{rounds:0,rests:0,fullRests:0},effects:[]};
 const rawFacts=await runFacts(c),clocksBefore=await runClocks(c,state.local);
 const expiration=effectTransition(state.effects,definitions,clocksBefore,rawFacts,{kind:'CLOCK'});state.effects=expiration.effects;
 const facts=effectCapabilities(state.effects,rawFacts),eligibility=prerequisite(spec.prerequisite,facts);
 if(!eligibility.met)throw new DomainError(409,'PREREQUISITE_NOT_MET');
 const actor={attributeScore:Number(facts[spec.check.attribute]??0),rank:spec.check.skill?Number(facts[spec.check.skill]??0):0,canAttempt:facts['capability.act']!==false,modifiers:[...effectContributions(state.effects,`check.${spec.check.skill?.slice(6)??'general'}`),...carryCheckPenalty(await carryLoad(c.client,c.run.id),spec.check.skill)]};
 const fingerprint=retryFingerprint(spec,facts,actor.modifiers,row.prerequisite??undefined);
 if(await retryAvailability(c.client,c.run.id,entityId,spec,fingerprint,clocksBefore.WORLD_TIME))throw new DomainError(409,'RULE_RETRY_NOT_READY');
 const chance=sharedCheckChance(spec.check,actor);
 if(!actor.canAttempt||actor.rank<spec.check.minimumRank)throw new DomainError(409,'CHECK_CAPABILITY_NOT_MET');
 const seed=randomBytes(32),deterministic=spec.check.possibility!=='ROLL'||spec.check.mode==='PASSIVE',rolls=deterministic?[]:Array.from({length:spec.check.advantage!==spec.check.disadvantage?2:1},(_,i)=>randomInteger(seed,'shared.check',BigInt(i),20)+1);
 const check=resolveSharedCheck(spec.check,actor,rolls);
 let instanceId:string|null=null;
 if(domain==='COMBAT')instanceId=(await beginEncounter(c,entityId,{sharedRules:true})).instanceId;
 await consumeDailyAllowance(c,entityId);
 const costs=await payRuleCosts(c,spec.costs,domain==='COMBAT');
 const rest=await settleTurnRest(c,entityId);
 if(spec.costs.rest!=='NONE')state.local=advanceLocalClocks(state.local,spec.costs.rest);
 if(domain==='COMBAT')state.local=advanceLocalClocks(state.local,'ROUND_END');
 const rewards=check.success?await grantRuleRewards(c,spec.rewards,entityId):[];
 if(instanceId)await finishEncounter(c,instanceId,0,check.success?'VICTORY':'FAILED_FORWARD',async()=>({sharedRules:true,degree:check.degree}));
 const clocksAfter=await runClocks(c,state.local);
 const advanced=effectTransition(state.effects,definitions,clocksAfter,facts,{kind:'CLOCK'});state.effects=advanced.effects;
 const granted=check.success?effectTransition(state.effects,definitions,clocksAfter,facts,{kind:'APPLY',ids:spec.effects,source:entityId,application:c.actionId}):{effects:state.effects,events:[]};state.effects=granted.effects;
 const removed=check.success&&spec.remove?effectTransition(state.effects,definitions,clocksAfter,facts,{kind:'REMOVE',...spec.remove}):{effects:state.effects,events:[]};state.effects=removed.effects;
 // Round conditions belong to the encounter, not the next unrelated fight.
 const terminal=domain==='COMBAT'?effectTransition(state.effects,definitions,clocksAfter,facts,{kind:'END_ENCOUNTER'}):{effects:state.effects,events:[]};state.effects=terminal.effects;
 const stateRevision=Number((await c.client.query('SELECT revision FROM shared_rules_state WHERE run_id=$1',[c.run.id])).rows[0]?.revision??0)+1;
 const evidence={version:1,domain,check,actor,eligibility,fingerprint,worldTime:clocksBefore.WORLD_TIME,clocksBefore,clocksAfter,costs,rewards,...(rest?{rest}:{}),effectEvents:[...expiration.events,...advanced.events,...granted.events,...removed.events,...terminal.events],instanceId};
 await c.client.query(`INSERT INTO shared_rules_events(action_id,run_id,release_id,entity_id,entity_revision,seed,evidence,before_state,after_state,state_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[c.actionId,c.run.id,c.run.content_release_id,entityId,row.revision,seed,evidence,before,state,stateRevision]);
 // Hidden DCs/modifier sources stay in server evidence. Neither response exposes seeds.
 return {entityId,domain,degree:check.degree,...(rest?{rest}:{}),costs:costs as unknown as Json,rewards:rewards as unknown as Json,effectCount:state.effects.length,...(spec.check.visibility==='KNOWN'?{check:{roll:check.roll,total:check.total,difficulty:spec.check.difficulty,chance}}:{}),revision:await advanceRevision(c)};
}
export function resolveRuleCombat(pool:pg.Pool,accountId:string,envelope:Envelope,entityId:string){if(envelope.actionType!=='RESOLVE_RULE_COMBAT')throw new DomainError(400,'INVALID_RULE_ACTION');return executeAction(pool,accountId,envelope,{entityId},c=>resolveDomain(c,entityId,'COMBAT',envelope.authorizationSource));}
export function resolveRuleInteraction(pool:pg.Pool,accountId:string,envelope:Envelope,entityId:string){if(envelope.actionType!=='RESOLVE_RULE_INTERACTION')throw new DomainError(400,'INVALID_RULE_ACTION');return executeAction(pool,accountId,envelope,{entityId},c=>resolveDomain(c,entityId,'INTERACTION',envelope.authorizationSource));}

/** Discovery-safe query. Commitment repeats all eligibility checks under locks. */
export function ruleActionPreview(pool:pg.Pool,accountId:string,entityId:string){
 return transaction(pool,async client=>{
  await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const run=(await client.query(`SELECT r.* FROM runs r JOIN characters c ON c.id=r.character_id WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE')`,[accountId])).rows[0];
  if(!run)throw new DomainError(409,'NO_RUN');
  const c:ActionContext={client,accountId,run,actionId:'00000000-0000-0000-0000-000000000000',requestId:'00000000-0000-0000-0000-000000000000'};
  const row=(await client.query(`SELECT v.definition->'mechanics'->'sharedAction' AS spec,v.definition->'mechanics'->'dailyAllowance' AS daily,v.definition->'mechanics'->'turnRest' AS rest,v.definition->'mechanics'->'prerequisite' AS prerequisite FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision JOIN discoveries d ON d.entity_id=e.entity_id AND d.account_id=$3 AND d.knowledge_level IN ('DISCOVERED','LEARNED','ADVANCED') WHERE e.release_id=$1 AND e.entity_id=$2`,[run.content_release_id,entityId,accountId])).rows[0];
  if(!row?.spec)throw new DomainError(404,'RULE_ACTION_NOT_KNOWN');validateRuleAction(row.spec,row.daily!==null);const spec=row.spec as RuleAction;
  const state:SharedState=(await client.query('SELECT state FROM shared_rules_state WHERE run_id=$1',[run.id])).rows[0]?.state??{local:{rounds:0,rests:0,fullRests:0},effects:[]};
  const rawFacts=await runFacts(c),clocks=await runClocks(c,state.local),definitions=await loadDefinitions(c),current=effectTransition(state.effects,definitions,clocks,rawFacts,{kind:'CLOCK'}),facts=effectCapabilities(current.effects,rawFacts);
  const eligibility=prerequisite(spec.prerequisite,facts),entityEligibility=row.prerequisite?prerequisite(row.prerequisite,facts).met:true;
  const load=await carryLoad(client,run.id),carryEntry=spec.domain!=='COMBAT'||!['OVERLOADED','UNMEASURED'].includes(load.state);
  const actor={attributeScore:Number(facts[spec.check.attribute]??0),rank:spec.check.skill?Number(facts[spec.check.skill]??0):0,canAttempt:facts['capability.act']!==false,modifiers:[...effectContributions(current.effects,`check.${spec.check.skill?.slice(6)??'general'}`),...carryCheckPenalty(load,spec.check.skill)]};
  const flags=await featureAvailable(client,'shared.rules',accountId,true)&&await featureAvailable(client,'actions.global',accountId)&&await featureAvailable(client,`content.${entityId}`,accountId);
  const resources=(await client.query('SELECT p.resource_key,p.amount::text FROM resource_pools p JOIN state_scopes s ON s.id=p.scope_id WHERE s.run_id=$1',[run.id])).rows;
  const gold=(await client.query("SELECT w.balance::text FROM wallets w JOIN state_scopes s ON s.id=w.scope_id WHERE s.run_id=$1 AND w.currency_id='GOLD' AND w.purpose='PLAYER'",[run.id])).rows[0]?.balance??'0';
  const costsMet=run.turns>=spec.costs.turns&&BigInt(gold)>=BigInt(spec.costs.gold)&&spec.costs.resources.every(r=>BigInt(resources.find(p=>p.resource_key===r.key)?.amount??'0')>=BigInt(r.amount));
  const active=((await client.query("SELECT 1 FROM instance_participants p JOIN instances i ON i.id=p.instance_id WHERE p.run_id=$1 AND i.lifecycle='ACTIVE' LIMIT 1",[run.id])).rowCount??0)>0;
  const retry=await retryAvailability(client,run.id,entityId,spec,retryFingerprint(spec,facts,actor.modifiers,row.prerequisite??undefined),clocks.WORLD_TIME);
  const dailyBalance=row.daily?(await client.query('SELECT charges FROM daily_allowances WHERE account_id=$1 AND entity_id=$2',[accountId,entityId])).rows[0]?.charges??row.daily.refresh:null;
  const pendingDaily=row.daily&&!!(await client.query(`SELECT 1 FROM rollover_epochs e JOIN accounts a ON a.id=$1 WHERE e.effective_at<=now() AND e.effective_at>=a.created_at AND NOT EXISTS(SELECT 1 FROM run_rollovers r WHERE r.account_id=a.id AND r.epoch=e.epoch) LIMIT 1`,[accountId])).rowCount;
  const restPool=row.rest?(await client.query(`SELECT s.health,s.mana,o.initial_checkpoint->'state'->'units'->0->'stats' AS stats FROM tactical_run_state s JOIN tactical_all_origins o ON o.instance_id=s.last_instance_id WHERE s.run_id=$1`,[run.id])).rows[0]:null;
  const restPreview=row.rest&&restPool?{health:restPool.health,mana:restPool.mana,maxHealth:restPool.stats.maxHealth,maxMana:restPool.stats.maxMana,afterHealth:Math.min(restPool.stats.maxHealth,restPool.health+Math.max(1,Math.floor(restPool.stats.maxHealth*row.rest.healthBps/10000))),afterMana:Math.min(restPool.stats.maxMana,restPool.mana+Math.floor(restPool.stats.maxMana*row.rest.manaBps/10000))}:null;
  const restReason=row.rest?(!restPreview?'REST_HEALTH_UNAVAILABLE':restPreview.afterHealth===restPreview.health&&restPreview.afterMana===restPreview.mana?'NO_REST_NEEDED':null):null;
  const preview=effectTransition(current.effects,definitions,clocks,facts,{kind:'APPLY',ids:spec.effects,source:entityId,application:c.actionId});
  return {entityId,domain:spec.domain,revision:run.revision,retry,rest:restPreview,restReason,dailyCharges:dailyBalance,eligible:!restReason&&(dailyBalance===null||dailyBalance>0)&&!pendingDaily&&carryEntry&&!retry&&flags&&eligibility.met&&entityEligibility&&costsMet&&!active&&actor.canAttempt&&actor.rank>=spec.check.minimumRank,availability:flags?'ENABLED':'DISABLED',prerequisite:eligibility,costs:spec.costs,effects:preview.events.map(e=>({kind:e.kind,source:facts[`known.${e.effectId}`]?e.effectId:'unidentified.effect'})),...(spec.check.visibility==='KNOWN'?{check:{attribute:spec.check.attribute,skill:spec.check.skill,attributeModifier:Math.floor((actor.attributeScore-spec.check.attributeBaseline)/spec.check.attributeDivisor),proficiency:spec.check.rankBonuses[actor.rank],modifiers:actor.modifiers.map(m=>({...m,source:m.source.startsWith('encumbrance:')?'Encumbrance':facts[`known.${m.source}`]?m.source:'unidentified.effect'})),difficulty:spec.check.difficulty,chance:sharedCheckChance(spec.check,actor)}}:{})};
 });
}

/** Item effects use the same clock, stacking, bounded triggers and immutable
 * projection as interaction effects. No client supplies an effect definition. */
export async function applyItemEffects(c:ActionContext,entityId:string,revision:number,ids:string[]){
 await requireFeature(c.client,'shared.rules',c.accountId,false,true);
 const row=(await c.client.query('SELECT state,revision FROM shared_rules_state WHERE run_id=$1 FOR UPDATE',[c.run.id])).rows[0];
 const before=row?.state??{},state:SharedState=row?structuredClone(before):{local:{rounds:0,rests:0,fullRests:0},effects:[]};
 const definitions=await loadDefinitions(c),facts=await runFacts(c),clocks=await runClocks(c,state.local);
 const expired=effectTransition(state.effects,definitions,clocks,facts,{kind:'CLOCK'});
 const applied=effectTransition(expired.effects,definitions,clocks,effectCapabilities(expired.effects,facts),{kind:'APPLY',ids,source:entityId,application:c.actionId});state.effects=applied.effects;
 await c.client.query('INSERT INTO shared_rules_events(action_id,run_id,release_id,entity_id,entity_revision,seed,evidence,before_state,after_state,state_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[c.actionId,c.run.id,c.run.content_release_id,entityId,revision,randomBytes(32),{version:1,domain:'ITEM',clocks,effectEvents:[...expired.events,...applied.events]},before,state,Number(row?.revision??0)+1]);
 return applied.events.length;
}
