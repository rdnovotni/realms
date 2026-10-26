import type pg from 'pg';
import { executeAction,type ActionContext,type Envelope } from '../foundation/action.js';
import { transaction } from '../foundation/transaction.js';
import { DomainError } from '../foundation/errors.js';
import type { Json } from '../foundation/json.js';
import { resolveDomain,rulePreviewInTransaction,type SharedState,type ObstacleState,type RuleAdapter } from './shared-rule-actions.js';
import { validateObstacle,type Approach,type ObstacleSpec } from '../rules/noncombat.js';
import { grantRuleRewards } from '../rules/settlement.js';
import { consumeItem } from './item-accounting.js';
import { requireEntityPrerequisite } from '../rules/requirements.js';
import { requireFeature,featureAvailable } from '../rules/controls.js';
const fresh=():ObstacleState=>({step:0,failed:false,alert:0,flags:[],complete:false});
export type NoncombatChoice={obstacleId:string;stepId:string;approachId:string;itemInstanceId?:string;confirmItem?:boolean;companionId?:string;consentAssistance?:boolean};
async function obstacle(c:ActionContext,id:string){
 const row=(await c.client.query(`SELECT e.revision,v.definition->>'name' AS name,v.definition->'mechanics'->'noncombatObstacle' AS spec,d.knowledge_level FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision JOIN discoveries d ON d.entity_id=e.entity_id AND d.account_id=$3 AND d.knowledge_level IN('DISCOVERED','LEARNED','ADVANCED') WHERE e.release_id=$1 AND e.entity_id=$2`,[c.run.content_release_id,id,c.accountId])).rows[0];
 if(!row?.spec)throw new DomainError(404,'OBSTACLE_NOT_KNOWN');validateObstacle(row.spec);return {revision:Number(row.revision),name:String(row.name),knowledge_level:String(row.knowledge_level),spec:row.spec as ObstacleSpec};
}
async function support(c:ActionContext,a:Approach,companionId?:string){
 if(!companionId)return [];
 const contribution=a.assistance.find(x=>x.companionId===companionId);
 const owned=(await c.client.query(`SELECT o.companion_revision,e.revision FROM owned_companions o JOIN release_entries e ON e.release_id=$3 AND e.entity_id=o.companion_id WHERE o.account_id=$1 AND o.companion_id=$2`,[c.accountId,companionId,c.run.content_release_id])).rows[0];
 const recovery=(await c.client.query('SELECT health FROM companion_tactical_recoveries WHERE run_id=$1 AND companion_id=$2 ORDER BY id DESC LIMIT 1',[c.run.id,companionId])).rows[0];
 if(!contribution||!owned||owned.companion_revision!==owned.revision||recovery?.health===0)throw new DomainError(403,'COMPANION_NOT_ELIGIBLE');
 return [{source:companionId,amount:contribution.bonus}];
}
async function access(c:ActionContext,a:Approach,itemId?:string){
 if(a.ability){const level=(await c.client.query('SELECT native_level FROM run_class_levels WHERE run_id=$1 AND class_id=$2',[c.run.id,a.ability.classId])).rows[0]?.native_level??0;
 const known=(await c.client.query("SELECT 1 FROM discoveries WHERE account_id=$1 AND entity_id=$2 AND knowledge_level IN('DISCOVERED','LEARNED','ADVANCED')",[c.accountId,a.ability.id])).rowCount;
 if(level<a.ability.minimumLevel||!known)throw new DomainError(409,'NONCOMBAT_ABILITY_NOT_OWNED');}
 if(a.itemId){const row=(await c.client.query(`SELECT i.id FROM inventory_items i JOIN inventory_containers b ON b.id=i.container_id JOIN state_scopes s ON s.id=b.scope_id WHERE i.id=$1 AND i.definition_id=$2 AND s.run_id=$3 AND s.lifecycle='ACTIVE' AND b.kind='CARRIED' AND i.quantity>0`,[itemId??null,a.itemId,c.run.id])).rows[0];if(!row)throw new DomainError(409,'NONCOMBAT_ITEM_REQUIRED');}
}
/** Reserve the entire possible consequence before generating private rolls. Otherwise
 * an unaffordable failure could be used as a free technical reroll. */
async function reserveConsequences(c:ActionContext,actionId:string,failure:ObstacleSpec['steps'][number]['failure']){
 const row=(await c.client.query("SELECT v.definition->'mechanics'->'sharedAction'->'costs' AS costs FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=$1 AND e.entity_id=$2",[c.run.content_release_id,actionId])).rows[0];
 const costs=row.costs;if(c.run.turns<costs.turns+failure.costs.turns)throw new DomainError(409,'CONSEQUENCE_BUDGET_REQUIRED');
 const required=new Map<string,number>();for(const r of [...costs.resources,...failure.costs.resources])required.set(r.key,(required.get(r.key)??0)+r.amount);
 for(const [key,amount]of required){const available=(await c.client.query('SELECT p.amount::text AS amount FROM resource_pools p JOIN state_scopes s ON s.id=p.scope_id WHERE s.run_id=$1 AND p.resource_key=$2',[c.run.id,key])).rows[0]?.amount??'0';if(BigInt(available)<BigInt(amount))throw new DomainError(409,'CONSEQUENCE_BUDGET_REQUIRED');}
 const gold=BigInt(costs.gold)+BigInt(failure.costs.gold);if(gold){const available=(await c.client.query("SELECT w.balance::text AS balance FROM wallets w JOIN state_scopes s ON s.id=w.scope_id WHERE s.run_id=$1 AND w.currency_id='GOLD' AND w.purpose='PLAYER'",[c.run.id])).rows[0]?.balance??'0';if(BigInt(available)<gold)throw new DomainError(409,'CONSEQUENCE_BUDGET_REQUIRED');}
}
export function resolveNoncombat(pool:pg.Pool,accountId:string,envelope:Envelope,choice:NoncombatChoice){
 if(envelope.actionType!=='RESOLVE_NONCOMBAT'||(envelope.authorizationSource??'MANUAL_UI')!=='MANUAL_UI')throw new DomainError(400,'EXPLICIT_NONCOMBAT_INTENT_REQUIRED');
 return executeAction(pool,accountId,envelope,choice as unknown as Json,async c=>{
 await requireFeature(c.client,'noncombat.pipeline',c.accountId,false,true);await requireFeature(c.client,`content.${choice.obstacleId}`,c.accountId);
 const owner=await obstacle(c,choice.obstacleId);if(owner.spec.rewards.length){await requireFeature(c.client,'rewards.global',c.accountId);await requireFeature(c.client,`reward.${choice.obstacleId}`,c.accountId);}await requireEntityPrerequisite(c,choice.obstacleId);
 const current:SharedState=(await c.client.query('SELECT state FROM shared_rules_state WHERE run_id=$1 FOR UPDATE',[c.run.id])).rows[0]?.state??{local:{rounds:0,rests:0,fullRests:0},effects:[]};
 const before=current.obstacles?.[choice.obstacleId]??fresh();if(before.complete)throw new DomainError(409,'OBSTACLE_ALREADY_RESOLVED');
 const step=owner.spec.steps[before.step];if(!step||step.id!==choice.stepId)throw new DomainError(409,'OBSTACLE_STEP_CHANGED');const approach=step.approaches.find(a=>a.id===choice.approachId);if(!approach)throw new DomainError(404,'APPROACH_NOT_KNOWN');
 if(choice.companionId&&choice.consentAssistance!==true)throw new DomainError(409,'ASSISTANCE_CONSENT_REQUIRED');if(!choice.companionId&&choice.consentAssistance||!approach.itemId&&(choice.itemInstanceId||choice.confirmItem))throw new DomainError(400,'INVALID_NONCOMBAT_CHOICE');
 await reserveConsequences(c,approach.actionId,step.failure);
 const modifiers=await support(c,approach,choice.companionId);await access(c,approach,choice.itemInstanceId);
 if(approach.itemId&&choice.confirmItem!==true)throw new DomainError(409,'NONCOMBAT_ITEM_CONFIRMATION_REQUIRED');
 const itemOperation=approach.itemId?await consumeItem(c,'noncombat.item',choice.itemInstanceId!,'1','NONCOMBAT_ITEM_USE'):null;
 const sourceRevisions=(await c.client.query('SELECT entity_id AS id,revision FROM release_entries WHERE release_id=$1 AND entity_id=ANY($2::text[]) ORDER BY entity_id',[c.run.content_release_id,[choice.obstacleId,approach.actionId,...(approach.ability?[approach.ability.id,approach.ability.classId]:[]),...(approach.itemId?[approach.itemId]:[]),...(approach.contest?[approach.contest.targetId]:[]),...(choice.companionId?[choice.companionId]:[])]] )).rows;
 const adapter:RuleAdapter={obstacleId:choice.obstacleId,modifiers,context:{version:1,obstacleId:choice.obstacleId,obstacleRevision:owner.revision,stepId:step.id,approachId:approach.id,intent:approach.intent,principalId:choice.obstacleId,sourceRevisions,choice:choice as unknown as Json,itemOperation:itemOperation as unknown as Json},...(approach.contest?{contest:{check:approach.contest.check,actor:approach.contest.actor,target:approach.contest.targetId}}:{}),failure:{costs:step.failure.costs,effects:step.failure.effects},settle:async(state,success)=>{
 const prior=state.obstacles?.[choice.obstacleId]??fresh();const after={...prior,step:prior.step+(success||step.failure.advance?1:0),failed:prior.failed||!success,alert:Math.min(80,prior.alert+(success?0:step.failure.alert)),flags:success?prior.flags:[...new Set([...prior.flags,step.failure.flag])],complete:false};after.complete=after.step>=owner.spec.steps.length;state.obstacles={...state.obstacles,[choice.obstacleId]:after};
 const rewards=after.complete&&!after.failed?await grantRuleRewards(c,owner.spec.rewards,choice.obstacleId):[];
 return {id:choice.obstacleId,stepId:step.id,principalId:choice.obstacleId,complete:after.complete,nextStep:after.complete?null:owner.spec.steps[after.step]!.id,outcome:after.complete?(after.failed?'FAILED_FORWARD':'RESOLVED'):'IN_PROGRESS',alert:after.alert,rewards:rewards as unknown as Json,...(!success?{consequence:step.failure.text}:{})};
 }};
 return resolveDomain(c,approach.actionId,'INTERACTION','MANUAL_UI',adapter);
 });
}
export function noncombatView(pool:pg.Pool,accountId:string,selected?:string,companionId?:string){return transaction(pool,async client=>{
 await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const run=(await client.query("SELECT r.* FROM runs r JOIN characters c ON c.id=r.character_id WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE')",[accountId])).rows[0];if(!run)throw new DomainError(409,'NO_RUN');
 const c:ActionContext={client,run,accountId,actionId:'00000000-0000-0000-0000-000000000000',requestId:'00000000-0000-0000-0000-000000000000'};
 const rows=(await client.query(`SELECT e.entity_id AS id,v.definition->>'name' AS name FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision JOIN discoveries d ON d.entity_id=e.entity_id AND d.account_id=$2 AND d.knowledge_level IN('DISCOVERED','LEARNED','ADVANCED') WHERE e.release_id=$1 AND v.definition->'mechanics'->'noncombatObstacle' IS NOT NULL ORDER BY e.entity_id LIMIT 101`,[run.content_release_id,accountId])).rows;
 const shared:SharedState=(await client.query('SELECT state FROM shared_rules_state WHERE run_id=$1',[run.id])).rows[0]?.state??{local:{rounds:0,rests:0,fullRests:0},effects:[]};
 const base={runId:run.id,revision:run.revision,obstacles:rows.slice(0,100).map(r=>({...r,complete:shared.obstacles?.[r.id]?.complete??false})),hasMore:rows.length>100};if(!selected)return {...base,selected:null};
 const owner=await obstacle(c,selected),state=shared.obstacles?.[selected]??fresh();
 const history=(await client.query("SELECT evidence->'coordinated'->>'stepId' AS step, evidence->'coordinated'->>'outcome' AS outcome,evidence->'coordinated'->>'consequence' AS consequence,evidence->'coordinated'->'rewards' AS rewards FROM shared_rules_events WHERE run_id=$1 AND evidence->'noncombat'->>'obstacleId'=$2 ORDER BY state_revision DESC LIMIT 20",[run.id,selected])).rows;
 for(const event of history){const messages:string[]=[];for(const reward of event.rewards??[]){if(reward.kind==='GOLD'){messages.push(`Gained ${reward.quantity} Gold.`);continue;}const known=(await client.query("SELECT v.definition->>'name' AS name,v.definition->'public'->>'description' AS description FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision JOIN discoveries d ON d.entity_id=e.entity_id AND d.account_id=$3 AND d.knowledge_level IN('DISCOVERED','LEARNED','ADVANCED') WHERE e.release_id=$1 AND e.entity_id=$2",[run.content_release_id,reward.id,accountId])).rows[0];messages.push(reward.kind==='KNOWLEDGE'?`Learned ${known?.name??'new knowledge'}.${known?.description?' '+known.description.slice(0,1500):''}`:`Received ${reward.quantity} ${known?.name??'unidentified item(s)'}.`);}event.consequence=event.consequence??(messages.join(' ')||null);event.step=owner.spec.steps.find(s=>s.id===event.step)?.name??'Earlier step';delete event.rewards;}
 if(state.complete)return {...base,selected:{id:selected,name:owner.name,history,state:{step:state.step,failed:state.failed,alert:state.alert,complete:state.complete},step:null,approaches:[]}};
 let ownerReason:string|null=null;try{await requireEntityPrerequisite(c,selected);}catch{ownerReason='REQUIREMENTS_NOT_MET';}if(!await featureAvailable(client,'noncombat.pipeline',accountId,true)||!await featureAvailable(client,`content.${selected}`,accountId)||owner.spec.rewards.length&&(!await featureAvailable(client,'rewards.global',accountId)||!await featureAvailable(client,`reward.${selected}`,accountId)))ownerReason='CONTENT_UNAVAILABLE';
 const step=owner.spec.steps[state.step]!,approaches=[];
 for(const a of step.approaches){const known=(await client.query("SELECT knowledge_level FROM discoveries WHERE account_id=$1 AND entity_id=$2 AND knowledge_level IN('DISCOVERED','LEARNED','ADVANCED')",[accountId,a.actionId])).rows[0];if(!known)continue;
 let reason=ownerReason;try{await reserveConsequences(c,a.actionId,step.failure);}catch{reason='CONSEQUENCE_BUDGET_REQUIRED';}const assistants=[];for(const entry of a.assistance){try{await support(c,a,entry.companionId);assistants.push({...entry,name:(await client.query("SELECT v.definition->>'name' AS name FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=$1 AND e.entity_id=$2",[run.content_release_id,entry.companionId])).rows[0].name});}catch{}}
 let modifiers:{source:string;amount:number}[]=[];try{modifiers=await support(c,a,companionId);}catch{reason='COMPANION_NOT_ELIGIBLE';}
 const items=a.itemId?(await client.query(`SELECT i.id,i.quantity::text AS quantity,v.definition->>'name' AS name FROM inventory_items i JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision JOIN inventory_containers b ON b.id=i.container_id JOIN state_scopes s ON s.id=b.scope_id WHERE s.run_id=$1 AND s.lifecycle='ACTIVE' AND b.kind='CARRIED' AND i.definition_id=$2 AND i.quantity>0 ORDER BY i.id LIMIT 32`,[run.id,a.itemId])).rows:[];
 try{await access(c,a,items[0]?.id);}catch(e){reason=(e as DomainError).message;}
 const p=await rulePreviewInTransaction(client,accountId,a.actionId,{obstacleId:selected,modifiers,...(a.contest?{contest:{check:a.contest.check,actor:a.contest.actor,target:a.contest.targetId}}:{})});
 if(!p.eligible&&!reason)reason=p.disabledReason??p.retry??(p.availability==='DISABLED'?'CONTENT_UNAVAILABLE':'REQUIREMENTS_OR_RESOURCES_NOT_MET');
 const check=p.check;approaches.push({id:a.id,intent:a.intent,name:(await client.query("SELECT definition->>'name' AS name FROM content_versions WHERE entity_id=$1 AND revision=(SELECT revision FROM release_entries WHERE release_id=$2 AND entity_id=$1)",[a.actionId,run.content_release_id])).rows[0].name,eligible:!reason,reason,costs:p.costs,items,assistants,companionId:companionId??null,check:check?{chance:check.chance,mode:a.intent==='OBSERVE'?'PASSIVE':a.contest?'CONTESTED':'ACTIVE',...(known.knowledge_level==='ADVANCED'?{breakdown:check}:{})}:null});
 }
 return {...base,selected:{id:selected,name:owner.name,history,state:{step:state.step,failed:state.failed,alert:state.alert,complete:state.complete},step:{id:step.id,name:step.name,failure:{advance:step.failure.advance,alert:step.failure.alert,costs:step.failure.costs,text:step.failure.text}},approaches}};
 });}
