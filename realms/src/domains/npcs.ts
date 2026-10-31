import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { executeAction,advanceRevision,type ActionContext,type Envelope } from '../foundation/action.js';
import { transaction } from '../foundation/transaction.js';
import { DomainError } from '../foundation/errors.js';
import type { Json } from '../foundation/json.js';
import { requireFeature,featureAvailable } from '../rules/controls.js';
import { requireEntityPrerequisite } from '../rules/requirements.js';
import { questEvidence } from './quests.js';
import { accountMemoryApprovals,interpretNpc,type NpcSpec,type NpcChoice } from './npc-content.js';
type Context=Pick<ActionContext,'client'|'run'|'accountId'>;
export type NpcCommand={npcId:string;nodeId:string;choiceId:string;confirm:boolean};
const known=`d.knowledge_level IN('DISCOVERED','LEARNED','ADVANCED')`;
async function definition(c:Context,id:string){
 const row=(await c.client.query(`SELECT e.revision,v.definition->>'name' name,v.definition->'mechanics'->'npcDialogue' spec FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision JOIN content_entities t ON t.id=e.entity_id JOIN discoveries d ON d.entity_id=e.entity_id AND d.account_id=$3 AND ${known} WHERE e.release_id=$1 AND e.entity_id=$2 AND t.kind='NPC' AND v.definition->'mechanics' ? 'npcDialogue'`,[c.run.content_release_id,id,c.accountId])).rows[0];
 if(!row)throw new DomainError(404,'NPC_NOT_KNOWN');if(row.spec.version!==1)throw new DomainError(409,'NPC_READER_INCOMPATIBLE');return {revision:Number(row.revision),name:String(row.name),spec:row.spec as NpcSpec};
}
async function history(c:Context,id:string,n:NpcSpec){const approved=!!n.accountMemoryApproval&&accountMemoryApprovals.get(id)===n.accountMemoryApproval;
 return (await c.client.query(`SELECT id,run_id,release_id,definition_revision,before_node,after_node,choice_id,label,response,consequence,memory,evidence,action_id,committed_revision,created_at FROM npc_conversation_events WHERE account_id=$1 AND npc_id=$2 AND (run_id=$3 OR ($4::boolean AND memory->>'scope'='ACCOUNT')) ORDER BY created_at DESC,id DESC LIMIT 1001`,[c.accountId,id,c.run.id,approved])).rows;
}
export async function npcPresence(c:Context,n:NpcSpec){
 const location=(await c.client.query(`SELECT v.definition->>'name' name FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision JOIN content_entities t ON t.id=e.entity_id JOIN discoveries d ON d.entity_id=e.entity_id AND d.account_id=$3 AND ${known} WHERE e.release_id=$1 AND e.entity_id=$2 AND t.kind='LOCATION'`,[c.run.content_release_id,n.locationId,c.accountId])).rows[0];
 if(!location)return {available:false,location:null,reason:'This contact location has not been discovered.'};
 const active=(await c.client.query("SELECT 1 FROM instance_participants p JOIN instances i ON i.id=p.instance_id WHERE p.run_id=$1 AND i.lifecycle='ACTIVE' AND i.kind IN('ENCOUNTER','COMBAT','ACTIVITY') LIMIT 1",[c.run.id])).rowCount;
 if(active)return {available:false,location:String(location.name),reason:'Finish your current encounter before opening this contact scene.'};
 if(!await questEvidence(c,n.presence))return {available:false,location:String(location.name),reason:'This contact is not present in the current story.'};
 return {available:true,location:String(location.name),reason:null};
}
async function handoff(c:Context,h:NpcChoice['handoff']){if(!h)return null;const found=(await c.client.query(`SELECT 1 FROM release_entries e JOIN content_entities t ON t.id=e.entity_id JOIN discoveries d ON d.entity_id=e.entity_id AND d.account_id=$3 AND ${known} WHERE e.release_id=$1 AND e.entity_id=$2`,[c.run.content_release_id,h.id,c.accountId])).rowCount;return found?h:null;}
async function state(c:Context,id:string){const owner=await definition(c,id),events=await history(c,id,owner.spec),current=events.filter(e=>e.run_id===c.run.id).sort((a,b)=>b.committed_revision-a.committed_revision),latest=current[0];
 if(latest&&(latest.release_id!==c.run.content_release_id||latest.definition_revision!==owner.revision))throw new DomainError(409,'NPC_RELEASE_INCOMPATIBLE');
 const node=owner.spec.nodes.find(n=>n.id===(latest?.after_node??owner.spec.start));if(!node)throw new DomainError(409,'NPC_READER_INCOMPATIBLE');
 const memories=events.filter(e=>e.memory).map(e=>e.memory as {id:string;text:string;scope:string});return {owner,events,current,node,memories};
}
async function choices(c:Context,id:string,s:Awaited<ReturnType<typeof state>>,available:boolean){const list=[];for(const option of s.node.choices){const proof=await questEvidence(c,option.requires);let prerequisite=true;try{await requireEntityPrerequisite(c,id);}catch{prerequisite=false;}
 const used=!!option.memory&&s.memories.some(m=>m.id===option.memory!.id&&m.scope===option.memory!.scope),enabled=await featureAvailable(c.client,'npc.dialogue',c.accountId,true)&&await featureAvailable(c.client,'actions.global',c.accountId)&&await featureAvailable(c.client,'action.NPC_CHOICE',c.accountId)&&await featureAvailable(c.client,`content.${id}`,c.accountId);
 list.push({id:option.id,label:option.label,aliases:option.aliases,eligible:available&&!!proof&&!used&&enabled&&prerequisite&&s.current.length<1000,reason:!available?'The NPC is unavailable.':!enabled?'Conversations are currently paused.':!prerequisite||!proof?'Continue the story to make this approach available.':used?'This event is already remembered.':s.current.length>=1000?'This life’s conversation limit has been reached.':null,consequence:option.consequence,cost:'No Turns or resources. Linked actions require their own preview and confirmation.',handoff:await handoff(c,option.handoff)});}
 return list;
}
export function npcChoice(pool:pg.Pool,accountId:string,envelope:Envelope,input:NpcCommand){
 if(envelope.actionType!=='NPC_CHOICE'||input.confirm!==true||!['MANUAL_UI','PARSER'].includes(envelope.authorizationSource??'MANUAL_UI')||Object.keys(input).some(k=>!['npcId','nodeId','choiceId','confirm'].includes(k)))throw new DomainError(400,'EXPLICIT_NPC_CHOICE_REQUIRED');
 return executeAction(pool,accountId,envelope,input as unknown as Json,async c=>{
 await requireFeature(c.client,'npc.dialogue',accountId,false,true);await requireFeature(c.client,`content.${input.npcId}`,accountId);await requireEntityPrerequisite(c,input.npcId);
 const s=await state(c,input.npcId),p=await npcPresence(c,s.owner.spec);if(!p.available)throw new DomainError(409,'NPC_NOT_PRESENT');if(s.node.id!==input.nodeId)throw new DomainError(409,'NPC_NODE_CHANGED');const option=s.node.choices.find(o=>o.id===input.choiceId);if(!option)throw new DomainError(404,'NPC_CHOICE_NOT_KNOWN');
 if(s.current.length>=1000)throw new DomainError(409,'NPC_CONVERSATION_LIMIT');if(option.memory&&s.memories.some(m=>m.id===option.memory!.id&&m.scope===option.memory!.scope))throw new DomainError(409,'NPC_EVENT_ALREADY_REMEMBERED');
 if(option.memory?.scope==='ACCOUNT'&&accountMemoryApprovals.get(input.npcId)!==s.owner.spec.accountMemoryApproval)throw new DomainError(409,'NPC_ACCOUNT_MEMORY_NOT_APPROVED');
 const proof=await questEvidence(c,option.requires);if(!proof)throw new DomainError(409,'NPC_EVIDENCE_REQUIRED');const id=randomUUID(),revision=await advanceRevision(c);
 // Only canonical authored values enter storage. Free text, model output and client rewards never do.
 await c.client.query(`INSERT INTO npc_conversation_events(id,account_id,run_id,npc_id,release_id,definition_revision,action_id,before_node,after_node,choice_id,label,response,consequence,memory,evidence,committed_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,[id,accountId,c.run.id,input.npcId,c.run.content_release_id,s.owner.revision,c.actionId,s.node.id,option.to,option.id,option.label,option.response,option.consequence,option.memory,JSON.stringify(proof),revision]);
 return {conversationEventId:id,npcId:input.npcId,speaker:s.owner.name,response:option.response,consequence:option.consequence,memory:option.memory as unknown as Json,handoff:await handoff(c,option.handoff) as unknown as Json,revision};
 });
}
async function readContext(client:pg.PoolClient,accountId:string){const run=(await client.query("SELECT r.* FROM runs r JOIN characters c ON c.id=r.character_id WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE')",[accountId])).rows[0];if(!run)throw new DomainError(409,'NO_RUN');return {client,accountId,run} as Context;}
export function npcView(pool:pg.Pool,accountId:string,selected?:string){return transaction(pool,async client=>{
 await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');const c=await readContext(client,accountId);
 const rows=(await client.query(`SELECT e.entity_id id,v.definition->>'name' name FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision JOIN content_entities t ON t.id=e.entity_id JOIN discoveries d ON d.entity_id=e.entity_id AND d.account_id=$2 AND ${known} WHERE e.release_id=$1 AND t.kind='NPC' AND v.definition->'mechanics' ? 'npcDialogue' ORDER BY e.entity_id LIMIT 101`,[c.run.content_release_id,accountId])).rows;
 const base={runId:c.run.id,revision:c.run.revision,npcs:rows.slice(0,100),hasMore:rows.length>100};if(!selected)return {...base,selected:null};
 const s=await state(c,selected),p=await npcPresence(c,s.owner.spec);const recall=s.node.recall.find(r=>s.memories.some(m=>m.id===r.memoryId));
 return {...base,selected:{id:selected,name:s.owner.name,role:s.owner.spec.role,pronouns:s.owner.spec.pronouns,contactMode:'Authored contact scene',location:p.location,available:p.available,reason:p.reason,definitionRevision:s.owner.revision,node:{id:s.node.id,text:p.available?(recall?.text??s.node.text):null},choices:p.available?await choices(c,selected,s,true):[],memories:s.memories.slice(0,32),history:s.current.slice(0,50).reverse().map(e=>({id:e.id,label:e.label,response:e.response,consequence:e.consequence,actionId:e.action_id,revision:e.committed_revision,createdAt:e.created_at})),historyHasMore:s.current.length>50}};
 });}
export function npcInterpret(pool:pg.Pool,accountId:string,input:{npcId:string;text:string}){if(typeof input.text!=='string'||!input.text.trim()||input.text.length>500)throw new DomainError(400,'INVALID_NPC_TEXT');return transaction(pool,async client=>{
 await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');const c=await readContext(client,accountId),s=await state(c,input.npcId),p=await npcPresence(c,s.owner.spec);if(!p.available)throw new DomainError(409,'NPC_NOT_PRESENT');
 const options=await choices(c,input.npcId,s,true),result=interpretNpc(input.text,options.filter(o=>o.eligible));return {runId:c.run.id,revision:c.run.revision,npcId:input.npcId,nodeId:s.node.id,kind:result.kind,choices:options.filter(o=>result.choiceIds.includes(o.id)).map(({aliases,...o})=>o),message:result.kind==='UNSUPPORTED'?'That request has no eligible authored action. Nothing changed. Choose a listed approach.':result.kind==='AMBIGUOUS'?'Several authored approaches match. Choose one; nothing changed.':'Review this authored approach and confirm it. Nothing has changed yet.'};
 });}
