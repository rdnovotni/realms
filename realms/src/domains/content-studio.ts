import { createHash } from 'node:crypto';
import { randomInteger } from '../foundation/rng.js';
import { validateContent,type ContentPackage,type ContentEntity } from './content.js';
import { questDiagnostics,type QuestGraph } from './quest-content.js';
import { projectKnownContent } from './content-projection.js';
import { startTactical,stepTactical,tacticalDistance,type TacticalIntent } from './tactical-engine.js';
import { tacticalAuthoringParty,type TacticalSpec } from './tactical-content.js';
import { type CombatSpec,type Fighter } from './combat-content.js';
import { mitigateDuelDamage } from './combat.js';
import { type LootSpec } from './loot.js';

export function inspectPackage(pkg:ContentPackage){
 if(!Array.isArray(pkg.entities)||pkg.entities.some(e=>!e||typeof e.id!=='string'||!e.definition||!Array.isArray(e.definition.dependencies)))return {valid:false,diagnostics:[{code:'INVALID_CONTENT_PACKAGE',entity:'',message:'Every definition needs a stable ID, typed envelope and dependency list.'}],edges:[],quests:[]};
 const diagnostics:{code:string;entity:string;node?:string;message:string}[]=[],map=new Map(pkg.entities.map(e=>[e.id,e]));
 const edges=pkg.entities.flatMap(e=>e.definition.dependencies.map(to=>({from:e.id,to})));
 for(const edge of edges)if(!map.has(edge.to))diagnostics.push({code:'MISSING_CONTENT_DEPENDENCY',entity:edge.from,message:'Missing dependency: '+edge.to});
 const quests=pkg.entities.filter(e=>e.kind==='QUEST'&&e.definition.mechanics?.questObjectives!==undefined).map(e=>{
  const graph=e.definition.mechanics!.questObjectives;const issues=questDiagnostics(graph);
  diagnostics.push(...issues.map(d=>({...d,entity:e.id})));return {id:e.id,graph,diagnostics:issues};
 });
 const rewardOwners=new Map<string,{quest:typeof quests[number];node:string}>();
 for(const quest of quests){if(quest.diagnostics.some(d=>d.code==='QUEST_SCHEMA'))continue;for(const node of (quest.graph as unknown as QuestGraph).nodes){if(!node.rewardKey)continue;const prior=rewardOwners.get(node.rewardKey);if(prior&&prior.quest.id!==quest.id){for(const [owner,id] of [[quest,node.id],[prior.quest,prior.node]] as const){const issue={code:'QUEST_DUPLICATE_REWARD',node:id,message:'This principal reward key is also owned by another quest.'};owner.diagnostics.push(issue);diagnostics.push({...issue,entity:owner.id});}}else rewardOwners.set(node.rewardKey,{quest,node:node.id});}}
 try{validateContent(pkg);}catch(e){const code=e instanceof Error?e.message:'INVALID_CONTENT_PACKAGE';if(!diagnostics.some(d=>d.code===code))diagnostics.push({code,entity:'',message:code});}
 return {valid:diagnostics.length===0,diagnostics,edges,quests};
}
export function previewPackage(pkg:ContentPackage,known:Record<string,string>,mode:'NOVICE'|'ADVANCED'){
 validateContent(pkg);if(!['NOVICE','ADVANCED'].includes(mode))throw Error('INVALID_PREVIEW_MODE');
 return pkg.entities.filter(e=>['DISCOVERED','LEARNED','ADVANCED'].includes(known[e.id]??'')).map(e=>projectKnownContent({id:e.id,revision:e.revision,name:e.definition.name,public:e.definition.public,advanced:e.definition.advanced},mode==='ADVANCED'&&known[e.id]==='ADVANCED'));
}
export const syntheticBuilds=['BALANCED','DURABLE','QUICK','ARCANE'] as const;
type Build=typeof syntheticBuilds[number];
function random(seed:string){const bytes=createHash('sha256').update(seed).digest();let counter=0n;return (bound:number)=>randomInteger(bytes,'studio.sandbox.v1',counter++,bound);}
export function sandboxEncounter(pkg:ContentPackage,encounterId:string,build:Build,seed:string){
 validateContent(pkg);if(!syntheticBuilds.includes(build)||typeof seed!=='string'||seed.length<1||seed.length>128)throw Error('INVALID_SANDBOX_INPUT');
 const entities=new Map(pkg.entities.map(e=>[e.id,e])),e=entities.get(encounterId);if(e?.kind!=='ENCOUNTER')throw Error('SANDBOX_ENCOUNTER_REQUIRED');
 const draw=random(seed),m=e.definition.mechanics??{},trace:Record<string,unknown>[]=[],warnings:string[]=[];
 let outcome:string|null=null;
 if(m.tacticalCombat){
  const spec=m.tacticalCombat as unknown as TacticalSpec,units=tacticalAuthoringParty(e,entities),hero=units[0]!;
  // Synthetic test profiles only; no account build or protected native class engine is granted.
  if(build==='DURABLE'){hero.stats={...hero.stats,maxHealth:hero.stats.maxHealth+10,armor:hero.stats.armor+2};hero.health=hero.stats.maxHealth;}
  if(build==='QUICK')hero.stats={...hero.stats,initiative:hero.stats.initiative+5,accuracy:hero.stats.accuracy+2};
  if(build==='ARCANE')hero.stats={...hero.stats,maxMana:hero.stats.maxMana+5,attackMin:hero.stats.attackMin+1,attackMax:hero.stats.attackMax+1};
  let state=startTactical(spec.rules,units);
  for(let step=0;!state.outcome&&step<4096;step++){
   const actor=state.units.find(u=>u.id===state.order[state.cursor])!,budget=state.budgets[actor.id]!;
   const target=state.units.filter(u=>u.side!==actor.side&&u.state==='ACTIVE').sort((a,b)=>tacticalDistance(spec.rules,actor.zone,a.zone)-tacticalDistance(spec.rules,actor.zone,b.zone)||(a.id<b.id?-1:a.id>b.id?1:0))[0];
   let intent:TacticalIntent={actorId:actor.id,kind:'END'};
   if(budget.main&&target){
    if(tacticalDistance(spec.rules,actor.zone,target.zone)<=spec.rules.attackRange)intent={actorId:actor.id,kind:'ATTACK',targetId:target.id,roll:draw(20)+1,rawDamage:actor.stats.attackMin+draw(actor.stats.attackMax-actor.stats.attackMin+1)};
    else if(budget.quick){const next=spec.rules.edges.flatMap(([a,b])=>a===actor.zone?[b]:b===actor.zone?[a]:[]).sort((a,b)=>tacticalDistance(spec.rules,a,target.zone)-tacticalDistance(spec.rules,b,target.zone)||(a<b?-1:a>b?1:0))[0];if(next)intent={actorId:actor.id,kind:'MOVE',zone:next};}
   }
   try{state=stepTactical(spec.rules,state,state.revision,intent).state;}
   catch(error){warnings.push(String(error instanceof Error?error.message:error));intent={actorId:actor.id,kind:'END'};state=stepTactical(spec.rules,state,state.revision,intent).state;}
   if(trace.length<512)trace.push({revision:state.revision,round:state.round,actor:actor.id,command:intent.kind,health:state.units.map(u=>({id:u.id,health:u.health,state:u.state})),outcome:state.outcome});
  }
  outcome=state.outcome??'SIMULATION_BUDGET';
 }else if(m.combat){
  const spec=m.combat as unknown as CombatSpec,profile=entities.get(spec.profileId)!.definition.mechanics!.combatProfile as unknown as Fighter,monster=entities.get(spec.monsterId)!.definition.mechanics!.combatMonster as unknown as Fighter;
  let hp=profile.maxHealth+(build==='DURABLE'?10:0),enemy=monster.maxHealth;
  const attack=(a:Fighter,b:Fighter)=>draw(a.attack.hit.denominator)<a.attack.hit.numerator?mitigateDuelDamage(a.attack.min+draw(a.attack.max-a.attack.min+1),b,false):0;
  for(let round=1;round<=spec.roundLimit&&!outcome;round++){enemy=Math.max(0,enemy-attack(profile,monster));if(!enemy)outcome='VICTORY';else{hp=Math.max(0,hp-attack(monster,profile));if(!hp)outcome='DEFEAT';}if(!outcome&&round===spec.roundLimit)outcome='FAILED_FORWARD';trace.push({round,playerHealth:hp,enemyHealth:enemy,outcome});}
 }else{outcome='NONCOMBAT_PREVIEW';warnings.push('No owning combat handler is declared; this previews the authored encounter/loot, without awarding anything.');}
 const encounter=m.encounter as {lootTableId?:string}|undefined,loot=encounter?.lootTableId?entities.get(encounter.lootTableId)?.definition.mechanics?.loot as unknown as LootSpec:undefined;
 const drops=[];for(const g of loot?.groups??[]){if(draw(g.chance.denominator)>=g.chance.numerator)continue;let roll=draw(g.entries.reduce((s,x)=>s+x.weight,0));const item=g.entries.find(x=>{if(roll<x.weight)return true;roll-=x.weight;return false;})!;drops.push({itemId:item.itemId,quantity:item.min+draw(item.max-item.min+1)});}
 const result={encounterId,build,seed,packageVersion:pkg.version,outcome,trace,drops,warnings:[...new Set(warnings)],scope:'AUTHOR_SANDBOX_ONLY_NO_REWARDS',policy:'BASIC_ATTACK_NEAREST_V1',rng:'HMAC_SHA256_V1_STUDIO_STREAM'};
 return {...result,replayHash:createHash('sha256').update(JSON.stringify(result)).digest('hex')};
}
