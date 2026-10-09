import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { buildPackage } from './build-fixture.js';
import { publishContent,type ContentPackage } from '../src/domains/content.js';
import { actor } from './helpers.js';
import { startBuild } from '../src/domains/builds.js';
import { executeAction,advanceRevision } from '../src/foundation/action.js';
import { grantItem } from '../src/domains/item-accounting.js';
import { setEquipment } from '../src/domains/equipment.js';
import { chooseFeat } from '../src/domains/feats.js';
import type { TacticalSpec } from '../src/domains/tactical-content.js';
export const envelope=(expectedRevision:number,actionType='TACTICAL_ACTION')=>({requestId:randomUUID(),expectedRevision,actionType});
export function tacticalPackage():ContentPackage {
 const p=structuredClone(buildPackage);p.version='tactical-fixture';
 const one=p.entities.find(e=>e.id==='class.one')!;
 (one.definition.mechanics!.classProgression as {maximumNativeLevel:number}).maximumNativeLevel=25;
 one.definition.mechanics!.combatModifiers={version:1,modifiers:[{stat:'accuracy',amount:1,minimumNativeLevel:1}]};
 one.definition.mechanics!.tacticalKit={version:1,minimumNativeLevel:1,heal:true,guard:false};
 const stats={maxHealth:30,maxMana:6,accuracy:20,evasion:10,armor:2,initiative:5,attackMin:6,attackMax:6};
 const spec:TacticalSpec={version:1,ruleset:'TACTICAL_ENCOUNTER_V1',rules:{damage:{version:1,ruleset:'TACTICAL_DAMAGE_V1',check:{version:1,ruleset:'D20_CHECK_V1',attributeDivisor:2,attributeBaseline:10,proficiencyPerRank:2,natural20:'SUCCESS',natural1:'NORMAL'},criticalOn20:false,criticalMultiplierBps:20000,minimumConnectedDamage:1},zones:['floor','balcony'],edges:[['floor','balcony']],attackRange:0,healRange:1,healAmount:5,healManaCost:2,guardArmorBonus:5,retreatDifficulty:15,roundLimit:5},playerZone:'floor',allies:[{id:'ally',definitionId:'npc.ally',zone:'floor'}],enemies:[{id:'enemy',definitionId:'monster.tactical',zone:'floor'}],failure:{destination:'HOME',turnCost:2,recoveryHealth:5}};
 p.entities.push(
  {id:'subclass.guard',kind:'ABILITY',revision:1,schemaVersion:1,definition:{name:'Guard subclass',dependencies:['class.one'],public:{},mechanics:{subclass:{version:1,ruleset:'SUBCLASS_CHOICE_V1',classId:'class.one',unlockNativeLevel:5,access:'DISCOVERED'},combatModifiers:{version:1,modifiers:[{stat:'armor',amount:4,minimumNativeLevel:0}]}}}},
  {id:'rules.character',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'Character',dependencies:['rules.build'],public:{},mechanics:{characterProfile:{version:1,ruleset:'CHARACTER_STATS_V1',buildRulesId:'rules.build',base:stats,scaling:[]}}}},
  {id:'npc.ally',kind:'NPC',revision:1,schemaVersion:1,definition:{name:'Ally',dependencies:[],public:{},mechanics:{tacticalUnit:{version:1,stats:{...stats,maxHealth:20,initiative:4,attackMin:4,attackMax:4},canHeal:true,canGuard:false}}}},
  {id:'monster.tactical',kind:'MONSTER',revision:1,schemaVersion:1,definition:{name:'Enemy',dependencies:[],public:{},mechanics:{tacticalUnit:{version:1,stats:{...stats,maxHealth:12,initiative:2,attackMin:8,attackMax:8,armor:0},canHeal:false,canGuard:false}}}},
  {id:'item.ore',kind:'ITEM',revision:1,schemaVersion:1,definition:{name:'Ore',dependencies:[],public:{},mechanics:{inventory:{version:1,storageMode:'STACK',category:'MATERIAL'}}}},
  {id:'loot.tactical',kind:'LOOT_TABLE',revision:1,schemaVersion:1,definition:{name:'Loot',dependencies:['item.ore'],public:{},mechanics:{loot:{version:1,commitment:'ENCOUNTER_START',groups:[{key:'ore',chance:{numerator:1,denominator:1},entries:[{itemId:'item.ore',weight:1,min:2,max:2,binding:'TRADEABLE',quality:'1'}]}]}}}},
  {id:'rules.feats',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'Feats',dependencies:['rules.build'],public:{},mechanics:{featRules:{version:1,ruleset:'FEAT_CHOICES_V1',buildRulesId:'rules.build',milestones:[1]}}}},
  {id:'feat.vigor',kind:'ABILITY',revision:1,schemaVersion:1,definition:{name:'Vigor',dependencies:['rules.feats'],public:{},mechanics:{feat:{version:1,rulesId:'rules.feats',access:'DISCOVERED',antiTaxReview:'PASS',prerequisites:{classes:[],feats:[]}},combatModifiers:{version:1,modifiers:[{stat:'maxHealth',amount:5,minimumNativeLevel:0}]}}}},
  {id:'item.sword',kind:'ITEM',revision:1,schemaVersion:1,definition:{name:'Sword',dependencies:[],public:{},mechanics:{inventory:{version:1,storageMode:'INSTANCE',category:'EQUIPMENT'},equipment:{version:1,slots:['MAIN_HAND'],hands:1,minimumLevel:1,bindingPolicy:'PRESERVE'},combatModifiers:{version:1,modifiers:[{stat:'attackMin',amount:2,minimumNativeLevel:0},{stat:'attackMax',amount:2,minimumNativeLevel:0}]}}}},
  {id:'item.shield',kind:'ITEM',revision:1,schemaVersion:1,definition:{name:'Shield',dependencies:[],public:{},mechanics:{inventory:{version:1,storageMode:'INSTANCE',category:'EQUIPMENT'},equipment:{version:1,slots:['OFF_HAND'],hands:1,minimumLevel:1,bindingPolicy:'PRESERVE'},combatModifiers:{version:1,modifiers:[{stat:'armor',amount:1,minimumNativeLevel:0}]},tacticalKit:{version:1,minimumNativeLevel:0,heal:false,guard:true}}}},
  {id:'encounter.tactical',kind:'ENCOUNTER',revision:1,schemaVersion:1,definition:{name:'Tactical',dependencies:['rules.character','npc.ally','monster.tactical','loot.tactical','curve.build'],public:{},mechanics:{encounter:{version:2,turnCost:1,lootTableId:'loot.tactical'},characterProfileId:'rules.character',tacticalCombat:spec as unknown as import('../src/foundation/json.js').Json,resolutionXP:{version:1,amount:'100',curveId:'curve.build'}}}}
 );return p;
}
export async function tacticalFixture(pool:pg.Pool,p=tacticalPackage(),turns=10) {
 const release=await publishContent(pool,p),f=await actor(pool,release,turns);
 for(const id of ['class.one','feat.vigor','encounter.tactical'])await pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,$2,'DISCOVERED')",[f.account,id]);
 let revision=0;
 const next=(type='TACTICAL_ACTION')=>envelope(revision++,type);
 await startBuild(pool,f.account,next('START_BUILD'),'class.one','balanced');
 await chooseFeat(pool,f.account,next('CHOOSE_FEAT'),'feat.vigor',1);
 const container=(await pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE run_id=$1 RETURNING id",[f.run])).rows[0].id;
 const gear:Record<string,string>={};
 await executeAction(pool,f.account,next('FIXTURE_GEAR'),{},async c=>{for(const key of ['sword','shield'])gear[key]=(await grantItem(c,key,{containerId:container,definitionId:`item.${key}`,quantity:'1',sourceCode:'FIXTURE'},'FIXTURE')).itemId;return {revision:await advanceRevision(c)};});
 await setEquipment(pool,f.account,next('SET_EQUIPMENT'),{activeSet:'A',slots:[{set:'A',slot:'MAIN_HAND',itemId:gear.sword!},{set:'A',slot:'OFF_HAND',itemId:gear.shield!}]});
 return {...f,release,gear,revision};
}
