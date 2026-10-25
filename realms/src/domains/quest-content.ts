import { Ajv } from 'ajv';
import { DomainError } from '../foundation/errors.js';
import type { ContentEntity } from './content.js';

/** Authoring contract only. A quest execution/reward handler is separate owning-domain work. */
export type QuestGraph={version:1;start:string;nodes:{id:string;name:string;type:'SCENE'|'OBJECTIVE'|'OUTCOME';next:string[];rewardKey?:string;encounterId?:string;lootTableId?:string;outcome?:'SUCCESS'|'FAIL_FORWARD'|'FAILURE'}[]};
const id={type:'string',pattern:'^[a-z][a-z0-9_.-]{0,119}$'};
const validate=new Ajv({strict:true}).compile({type:'object',additionalProperties:false,required:['version','start','nodes'],properties:{version:{const:1},start:id,nodes:{type:'array',minItems:2,maxItems:128,items:{type:'object',additionalProperties:false,required:['id','name','type','next'],properties:{id,name:{type:'string',minLength:1,maxLength:200},type:{enum:['SCENE','OBJECTIVE','OUTCOME']},next:{type:'array',maxItems:8,uniqueItems:true,items:id},rewardKey:id,encounterId:id,lootTableId:id,outcome:{enum:['SUCCESS','FAIL_FORWARD','FAILURE']}}}}}});
export function questDiagnostics(value:unknown){
 const errors:{code:string;node:string;message:string}[]=[];
 if(!validate(value))return [{code:'QUEST_SCHEMA',node:'',message:'Quest needs a start, named typed nodes and explicit connections.'}];
 const q=value as QuestGraph, nodes=new Map(q.nodes.map(n=>[n.id,n]));
 const add=(code:string,node:string,message:string)=>errors.push({code,node,message});
 if(nodes.size!==q.nodes.length)add('QUEST_DUPLICATE_NODE','','Node IDs must be unique.');
 if(!nodes.has(q.start))add('QUEST_START',q.start,'The starting node does not exist.');
 const rewards=new Set<string>();
 for(const n of q.nodes){
  if(n.type==='OUTCOME'?(n.next.length!==0||!n.outcome):(n.next.length===0||n.outcome!==undefined))add('QUEST_DEAD_END',n.id,'Only outcome nodes end a route; other nodes need a next step.');
  if(n.rewardKey){if(n.type!=='OBJECTIVE')add('QUEST_REWARD_OWNER',n.id,'Principal rewards belong to an objective, not each alternate outcome.');if(rewards.has(n.rewardKey))add('QUEST_DUPLICATE_REWARD',n.id,'This principal reward is owned by more than one objective.');rewards.add(n.rewardKey);}
  for(const next of n.next)if(!nodes.has(next))add('QUEST_BROKEN_EDGE',n.id,'Missing connected node: '+next);
 }
 const reachable=new Set<string>(),queue=[q.start];
 for(const id of queue){if(reachable.has(id))continue;reachable.add(id);queue.push(...(nodes.get(id)?.next??[]));}
 for(const n of q.nodes)if(!reachable.has(n.id))add('QUEST_UNREACHABLE',n.id,'This node/outcome cannot be reached from the start.');
 const canFinish=new Set(q.nodes.filter(n=>n.type==='OUTCOME').map(n=>n.id));
 for(let i=0;i<q.nodes.length;i++)for(const n of q.nodes)if(n.next.some(x=>canFinish.has(x)))canFinish.add(n.id);
 for(const n of q.nodes)if(!canFinish.has(n.id))add('QUEST_NO_OUTCOME',n.id,'This route cannot reach an authored outcome.');
 if(!q.nodes.some(n=>n.outcome==='SUCCESS'&&reachable.has(n.id)))add('QUEST_NO_SUCCESS','','A successful campaign route must remain reachable.');
 return errors;
}
export function validateQuestContent(entity:ContentEntity,entities:Map<string,ContentEntity>){
 const value=entity.definition.mechanics?.questObjectives;if(value===undefined)return;
 if(entity.kind!=='QUEST')throw new DomainError(400,'QUEST_SCHEMA_KIND');
 const errors=questDiagnostics(value);if(errors.length)throw new DomainError(400,errors[0]!.code);
 for(const n of (value as unknown as QuestGraph).nodes)for(const [key,kind] of [['encounterId','ENCOUNTER'],['lootTableId','LOOT_TABLE']] as const){
  const id=n[key];if(id&&(!entity.definition.dependencies.includes(id)||entities.get(id)?.kind!==kind))throw new DomainError(400,'QUEST_BROKEN_REFERENCE');
 }
}

/** A package-level principal reward key has one authored objective owner. */
export function validateQuestRewardOwners(entities:Map<string,ContentEntity>){
 const owners=new Set<string>();
 for(const entity of entities.values()){
  const graph=entity.definition.mechanics?.questObjectives;if(graph===undefined)continue;
  // Per-entity schema/graph validation has already completed before this pass.
  for(const node of (graph as unknown as QuestGraph).nodes)if(node.rewardKey){if(owners.has(node.rewardKey))throw new DomainError(400,'QUEST_DUPLICATE_REWARD');owners.add(node.rewardKey);}
 }
}
