import { Ajv } from 'ajv';
import { DomainError } from '../foundation/errors.js';
import type { ContentEntity } from './content.js';
import { validateRewards,type Reward } from '../rules/settlement.js';
export type KnowledgeScope='RUN'|'ACCOUNT'|'WORLD';
export type Information={id:string;kind:'HINT'|'RUMOR'|'LEAD';scope:KnowledgeScope;worldId?:string;text:string;source:string;credibility:'UNKNOWN'|'QUESTIONABLE'|'PLAUSIBLE'|'CORROBORATED'};
export type QuestRequirement={kind:'OBSTACLE'|'ENCOUNTER'|'QUEST'|'KNOWLEDGE';id:string;outcome:string;scope?:KnowledgeScope;worldId?:string};
export type QuestEdge={id:string;label:string;to:string;requires:QuestRequirement[];grade:'SUCCESS'|'PARTIAL'|'FAIL_FORWARD';consequence:string;information:Information[]};
export type QuestNode={id:string;name:string;kind:'SCENE'|'OBJECTIVE'|'OUTCOME';optional:boolean;edges:QuestEdge[];outcome:'SUCCESS'|'FAIL_FORWARD'|null};
export type RuntimeQuest={version:1;principalId:string;start:string;availability:QuestRequirement[];nodes:QuestNode[];rewards:Reward[];repeat:null|{maxPerRun:number;cooldownActions:number;sourceId:string}};
const id={type:'string',pattern:'^[a-z][a-z0-9_.-]{0,119}$'},world={type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'},scope={enum:['RUN','ACCOUNT','WORLD']};
const requirement={type:'object',additionalProperties:false,required:['kind','id','outcome'],properties:{kind:{enum:['OBSTACLE','ENCOUNTER','QUEST','KNOWLEDGE']},id,outcome:{type:'string',minLength:1,maxLength:40},scope,worldId:world}};
const information={type:'object',additionalProperties:false,required:['id','kind','scope','text','source','credibility'],properties:{id,kind:{enum:['HINT','RUMOR','LEAD']},scope,worldId:world,text:{type:'string',minLength:1,maxLength:1500},source:{type:'string',minLength:1,maxLength:200},credibility:{enum:['UNKNOWN','QUESTIONABLE','PLAUSIBLE','CORROBORATED']}}};
const validate=new Ajv({strict:true}).compile({type:'object',additionalProperties:false,required:['version','principalId','start','availability','nodes','rewards','repeat'],properties:{version:{const:1},principalId:id,start:id,availability:{type:'array',maxItems:16,items:requirement},rewards:{type:'array',maxItems:16,items:{type:'object'}},repeat:{anyOf:[{type:'null'},{type:'object',additionalProperties:false,required:['maxPerRun','cooldownActions','sourceId'],properties:{maxPerRun:{type:'integer',minimum:2,maximum:20},cooldownActions:{type:'integer',minimum:1,maximum:10000},sourceId:id}}]},nodes:{type:'array',minItems:2,maxItems:64,items:{type:'object',additionalProperties:false,required:['id','name','kind','optional','edges','outcome'],properties:{id,name:{type:'string',minLength:1,maxLength:200},kind:{enum:['SCENE','OBJECTIVE','OUTCOME']},optional:{type:'boolean'},outcome:{enum:['SUCCESS','FAIL_FORWARD',null]},edges:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,required:['id','label','to','requires','grade','consequence','information'],properties:{id,label:{type:'string',minLength:1,maxLength:200},to:id,requires:{type:'array',maxItems:16,items:requirement},grade:{enum:['SUCCESS','PARTIAL','FAIL_FORWARD']},consequence:{type:'string',minLength:1,maxLength:1500},information:{type:'array',maxItems:8,items:information}}}}}}}}});
export function runtimeQuestDiagnostics(value:unknown){
 const errors:string[]=[];if(!validate(value))return ['QUEST_RUNTIME_SCHEMA'];const q=value as RuntimeQuest;try{validateRewards(q.rewards);}catch{return ['INVALID_RULE_REWARDS'];}
 const nodes=new Map(q.nodes.map(n=>[n.id,n]));if(nodes.size!==q.nodes.length||!nodes.has(q.start))errors.push('QUEST_RUNTIME_IDENTITY');
 const visit=new Set<string>(),active=new Set<string>();function walk(id:string){if(active.has(id)){errors.push('QUEST_RUNTIME_CYCLE');return;}if(visit.has(id))return;visit.add(id);active.add(id);for(const e of nodes.get(id)?.edges??[])walk(e.to);active.delete(id);}walk(q.start);
 for(const n of q.nodes){if(!visit.has(n.id))errors.push('QUEST_RUNTIME_UNREACHABLE');if(n.kind==='OUTCOME'?(n.edges.length!==0||n.outcome===null):(n.edges.length===0||n.outcome!==null))errors.push('QUEST_RUNTIME_DEAD_END');if(new Set(n.edges.map(e=>e.id)).size!==n.edges.length)errors.push('QUEST_RUNTIME_EDGE_ID');
 for(const e of n.edges){if(!nodes.has(e.to))errors.push('QUEST_RUNTIME_BROKEN_EDGE');for(const r of e.requires)checkRequirement(r);if(new Set(e.information.map(i=>i.id)).size!==e.information.length)errors.push('QUEST_INFORMATION_DUPLICATE');for(const i of e.information)if((i.scope==='WORLD')!==!!i.worldId)errors.push('QUEST_KNOWLEDGE_SCOPE');}}
 for(const r of q.availability)checkRequirement(r);
 function checkRequirement(r:QuestRequirement){if(r.kind==='KNOWLEDGE'){if(!r.scope||r.outcome!=='KNOWN'||(r.scope==='WORLD')!==!!r.worldId)errors.push('QUEST_KNOWLEDGE_SCOPE');}else if(r.scope||r.worldId||!({OBSTACLE:['RESOLVED','FAILED_FORWARD'],ENCOUNTER:['VICTORY','DEFEAT','RETREAT','SURRENDER','FAILED_FORWARD'],QUEST:['RESOLVED','FAILED_FORWARD']}[r.kind].includes(r.outcome)))errors.push('QUEST_REQUIREMENT_OUTCOME');}
 if(!q.nodes.some(n=>n.outcome==='SUCCESS'))errors.push('QUEST_RUNTIME_NO_SUCCESS');
 if(q.rewards.length&&q.nodes.filter(n=>n.kind==='OUTCOME').some(n=>!allPathsHaveSource(q,'*',n.id)))errors.push('QUEST_UNEARNED_REWARD_PATH');
 if(q.repeat&&q.nodes.filter(n=>n.kind==='OUTCOME').some(n=>!allPathsHaveSource(q,q.repeat!.sourceId,n.id)))errors.push('QUEST_CONTRACT_UNBOUNDED_SOURCE');return [...new Set(errors)];
}
function allPathsHaveSource(q:RuntimeQuest,source:string,target:string){const queue=[{id:q.start,source:false}],seen=new Set<string>();for(const s of queue){const key=s.id+String(s.source);if(seen.has(key))continue;seen.add(key);if(s.id===target&&!s.source)return false;for(const e of q.nodes.find(n=>n.id===s.id)?.edges??[])queue.push({id:e.to,source:s.source||e.requires.some(r=>source==='*'?['OBSTACLE','ENCOUNTER','QUEST'].includes(r.kind):r.kind==='ENCOUNTER'&&r.id===source)});}return true;}
/** Additive reader: legacy M02 questObjectives v1 stays unchanged. */
export function validateRuntimeQuests(entities:Map<string,ContentEntity>){
 const owners=new Set<string>(),dependencies=new Map<string,string[]>();
 for(const entity of entities.values()){
 const value=entity.definition.mechanics?.questRuntime;if(value===undefined)continue;if(entity.kind!=='QUEST')throw new DomainError(400,'QUEST_RUNTIME_KIND');const errors=runtimeQuestDiagnostics(value);if(errors.length)throw new DomainError(400,errors[0]!);const q=value as unknown as RuntimeQuest;
 if(owners.has(q.principalId))throw new DomainError(400,'QUEST_PRINCIPAL_DUPLICATE');owners.add(q.principalId);
 const refs=[...q.availability,...q.nodes.flatMap(n=>n.edges.flatMap(e=>e.requires))];dependencies.set(entity.id,refs.filter(r=>r.kind==='QUEST').map(r=>r.id));
 for(const r of refs){if(r.kind==='KNOWLEDGE')continue;const target=entities.get(r.id);if(!target||!entity.definition.dependencies.includes(r.id)||target.kind!==({OBSTACLE:'ACTIVITY',ENCOUNTER:'ENCOUNTER',QUEST:'QUEST'}[r.kind]))throw new DomainError(400,'QUEST_RUNTIME_REFERENCE');if(r.kind==='OBSTACLE'&&!target.definition.mechanics?.noncombatObstacle||r.kind==='QUEST'&&!target.definition.mechanics?.questRuntime)throw new DomainError(400,'QUEST_RUNTIME_REFERENCE');}
 for(const r of q.rewards)if(r.kind!=='GOLD'&&(!entity.definition.dependencies.includes(r.id)||!entities.has(r.id)||r.kind==='ITEM'&&entities.get(r.id)!.kind!=='ITEM'))throw new DomainError(400,'QUEST_REWARD_REFERENCE');
 // A repeat contract consumes fresh finished encounters. It cannot recycle one-shot obstacle state.
 if(q.repeat&&(!entities.has(q.repeat.sourceId)||entities.get(q.repeat.sourceId)!.kind!=='ENCOUNTER'||!entity.definition.dependencies.includes(q.repeat.sourceId)))throw new DomainError(400,'QUEST_CONTRACT_SOURCE');
 // Contradictory requirements in a conjunction are impossible by construction.
 for(const list of [q.availability,...q.nodes.flatMap(n=>n.edges.map(e=>e.requires))]){const seen=new Map<string,string>();for(const r of list){const key=r.kind+':'+r.id;if(seen.has(key)&&seen.get(key)!==r.outcome)throw new DomainError(400,'QUEST_IMPOSSIBLE_PREREQUISITE');seen.set(key,r.outcome);if(r.kind==='QUEST'&&r.id===entity.id)throw new DomainError(400,'QUEST_SELF_PREREQUISITE');}}
 }
 // An obstacle has one immutable outcome. Check whole routes, not only each edge.
 for(const entity of entities.values()){
  const q=entity.definition.mechanics?.questRuntime as unknown as RuntimeQuest|undefined;if(!q)continue;
  const queue:{id:string;facts:Record<string,string>}[]=[{id:q.start,facts:Object.fromEntries(q.availability.filter(r=>r.kind==='OBSTACLE').map(r=>[r.id,r.outcome]))}],reachable=new Set<string>(),edges=new Set<string>(),seen=new Set<string>();
  for(const state of queue){const key=state.id+JSON.stringify(Object.entries(state.facts).sort());if(seen.has(key))continue;if(seen.size>=4096)throw new DomainError(400,'QUEST_GRAPH_ANALYSIS_LIMIT');seen.add(key);reachable.add(state.id);
   for(const edge of q.nodes.find(n=>n.id===state.id)!.edges){const facts={...state.facts};let possible=true;for(const r of edge.requires)if(r.kind==='OBSTACLE'){if(facts[r.id]&&facts[r.id]!==r.outcome)possible=false;facts[r.id]=r.outcome;}if(possible){edges.add(state.id+':'+edge.id);queue.push({id:edge.to,facts});}}
  }
  if(q.nodes.some(n=>!reachable.has(n.id)||n.edges.some(e=>!edges.has(n.id+':'+e.id))))throw new DomainError(400,'QUEST_IMPOSSIBLE_ROUTE');
 }
 const done=new Set<string>(),active=new Set<string>();function check(id:string){if(active.has(id))throw new DomainError(400,'QUEST_PREREQUISITE_CYCLE');if(done.has(id))return;active.add(id);for(const next of dependencies.get(id)??[])check(next);active.delete(id);done.add(id);}for(const id of dependencies.keys())check(id);
}
