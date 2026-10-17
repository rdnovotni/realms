import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { buildPackage } from './build-fixture.js';
import { actor } from './helpers.js';
import { publishContent } from '../src/domains/content.js';
import { startBuild,levelUp } from '../src/domains/builds.js';
import { executeAction,advanceRevision } from '../src/foundation/action.js';
import { beginEncounter,finishEncounter } from '../src/domains/encounters.js';
export const advancementEnvelope=(revision:number,actionType:string)=>({requestId:randomUUID(),expectedRevision:revision,actionType});
export function advancementPackage(){
 const p=structuredClone(buildPackage);p.version='advancement-fixture';
 for(const e of p.entities.filter(e=>e.kind==='CLASS')){(e.definition.mechanics!.classProgression as {maximumNativeLevel:number}).maximumNativeLevel=e.id==='class.three'?2:20;e.definition.name=({'class.one':'Warden','class.two':'Wayfarer','class.three':'Arcanist'} as Record<string,string>)[e.id]!;}
 const locked=structuredClone(p.entities.find(e=>e.id==='class.one')!);locked.id='class.locked';locked.definition.name='Known restricted class';locked.definition.mechanics!.prerequisite={op:'FACT',key:'attribute.strength',test:'GTE',value:99};p.entities.push(locked);
 (p.entities.find(e=>e.id==='encounter.build')!.definition.mechanics!.resolutionXP as {amount:string}).amount='800';
 for(const [id,classId,name] of [['subclass.first','class.one','Sentinel'],['subclass.other','class.one','Vanguard'],['subclass.second','class.two','Pathfinder'],['subclass.hidden','class.one','Hidden subclass']] as const)p.entities.push({id,kind:'ABILITY',revision:1,schemaVersion:1,definition:{name,dependencies:[classId],public:{description:'A discovered specialization for its native class.'},mechanics:{subclass:{version:1,ruleset:'SUBCLASS_CHOICE_V1',classId,unlockNativeLevel:5,access:'DISCOVERED'}}}});
 p.entities.push({id:'rules.attributes',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'Fixture attribute schedule',dependencies:['rules.build'],public:{},mechanics:{attributeRules:{version:1,ruleset:'ATTRIBUTE_MILESTONES_V1',buildRulesId:'rules.build',maximumScores:{strength:13,dexterity:14,constitution:14,intelligence:14,wisdom:14,charisma:14,luck:12},milestones:[{level:2,points:2,allowedAttributes:['strength','dexterity','luck']},{level:4,points:1,allowedAttributes:['luck','constitution']},{level:8,points:1,allowedAttributes:['strength']}]}}}}, {id:'rules.feats',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'Fixture feat milestones',dependencies:['rules.build'],public:{},mechanics:{featRules:{version:1,ruleset:'FEAT_CHOICES_V1',buildRulesId:'rules.build',milestones:[2,4,6]}}}},
 {id:'skill.fixture',kind:'SKILL',revision:1,schemaVersion:1,definition:{name:'Fixture skill',dependencies:[],public:{},mechanics:{skill:{version:1,family:'PHYSICAL',defaultAttribute:'strength',maximumRank:5,access:'DISCOVERED'}}}},
 {id:'rules.skills',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'Fixture proficiency schedule',dependencies:['rules.build','skill.fixture'],public:{},mechanics:{proficiencyRules:{version:1,ruleset:'PROFICIENCY_CHOICES_V1',buildRulesId:'rules.build',skillIds:['skill.fixture'],milestones:[1,2,3,6,8]}}}});
 for(const [id,name,classes,prior,trained] of [['feat.root','Steady footing',[],[],false],['feat.other','Keen observer',[],[],false],['feat.child','Veteran footing',[{classId:'class.one',nativeLevel:5}],['feat.root'],false],['feat.trained','Practiced technique',[],[],true],['feat.hidden','Hidden feat',[],[],false]] as [string,string,{classId:string;nativeLevel:number}[],string[],boolean][])p.entities.push({id,kind:'ABILITY',revision:1,schemaVersion:1,definition:{name,dependencies:['rules.feats',...classes.map(c=>c.classId),...prior,...(trained?['skill.fixture']:[])],public:{description:'A known feat for explicit advancement choices.'},mechanics:{feat:{version:1,rulesId:'rules.feats',access:'DISCOVERED',antiTaxReview:'PASS',prerequisites:{classes,feats:prior}},...(trained?{proficiencyRequirements:{version:1,skills:[{skillId:'skill.fixture',minimumRank:2}]}}:{})}}});return p;
}
export async function advancementFixture(pool:pg.Pool,startClass='class.one',p=advancementPackage()){
 const release=await publishContent(pool,p),f=await actor(pool,release,20);
 for(const e of p.entities.filter(e=>!e.id.endsWith('.hidden')))await pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,$2,'DISCOVERED')",[f.account,e.id]);
 const revision=async()=>Number((await pool.query('SELECT revision FROM runs WHERE id=$1',[f.run])).rows[0].revision);
 await startBuild(pool,f.account,advancementEnvelope(0,'START_BUILD'),startClass,'balanced');
 const start=await executeAction(pool,f.account,advancementEnvelope(1,'FIXTURE'),{},async c=>({...await beginEncounter(c,'encounter.build',{}),revision:await advanceRevision(c)}));
 await executeAction(pool,f.account,advancementEnvelope(2,'FIXTURE'),{},async c=>({...await finishEncounter(c,start.instanceId as string,0,'VICTORY',async()=>({})),revision:await advanceRevision(c)}));
 return {...f,release,revision,levels:async(classId:string,n:number)=>{for(let i=0;i<n;i++)await levelUp(pool,f.account,advancementEnvelope(await revision(),'LEVEL_UP'),classId);},begin:async()=>executeAction(pool,f.account,advancementEnvelope(await revision(),'FIXTURE'),{},async c=>({...await beginEncounter(c,'encounter.build',{}),revision:await advanceRevision(c)}))};
}
