import type pg from 'pg';
import { advancementPackage,advancementFixture,advancementEnvelope } from './advancement-fixture.js';
import { bookPackage } from './character-book-fixture.js';
import { chooseSubclass } from '../src/domains/subclasses.js';
import { chooseFeat } from '../src/domains/feats.js';
import { allocateAttributes } from '../src/domains/attributes.js';
import { advanceProficiency } from '../src/domains/proficiencies.js';
import { executeAction,advanceRevision } from '../src/foundation/action.js';
import { grantItem } from '../src/domains/item-accounting.js';
import { startTacticalCombat,takeTacticalAction } from '../src/domains/tactical-combat.js';
import { setEquipment } from '../src/domains/equipment.js';
export function historyPackage(long=false){
 const p=advancementPackage();p.version='character-history-fixture';const book=bookPackage();
 for(const e of book.entities)if(!p.entities.some(v=>v.id===e.id))p.entities.push(e);
 for(const id of ['class.one','class.two']){const target=p.entities.find(e=>e.id===id)!,source=book.entities.find(e=>e.id===id)!;for(const key of ['combatModifiers','tacticalKit','tacticalTechniques'])if(source.definition.mechanics?.[key])target.definition.mechanics![key]=source.definition.mechanics[key];for(const dep of source.definition.dependencies)if(!target.definition.dependencies.includes(dep))target.definition.dependencies.push(dep);}
 p.entities.find(e=>e.id==='feat.root')!.definition.mechanics!.combatModifiers={version:1,modifiers:[{stat:'maxHealth',amount:5,minimumNativeLevel:0}]};
 p.entities.find(e=>e.id==='subclass.first')!.definition.mechanics!.combatModifiers={version:1,modifiers:[{stat:'armor',amount:4,minimumNativeLevel:0}]};
 (p.entities.find(e=>e.id==='encounter.build')!.definition.mechanics!.resolutionXP as {amount:string}).amount=long?'2400':'800';
 const final=structuredClone(p.entities.find(e=>e.id==='encounter.tactical')!);final.id='encounter.history-finale';final.definition.name='Test campaign finale';final.definition.dependencies.push('campaign.history');(final.definition.mechanics!.tacticalCombat as {campaignId?:string}).campaignId='campaign.history';p.entities.push(final,{id:'campaign.history',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'Character lifecycle test campaign',dependencies:[],public:{},mechanics:{tacticalCampaign:{version:1,ruleset:'TACTICAL_CAMPAIGN_V1',finalEncounterId:'encounter.history-finale',requiresEncounterIds:[]}}}});
 (p.entities.find(e=>e.id==='monster.tactical')!.definition.mechanics!.tacticalUnit as {stats:{maxHealth:number}}).stats.maxHealth=1;return p;
}
export async function historyFixture(pool:pg.Pool,long=false){
 const f=await advancementFixture(pool,'class.one',historyPackage(long)),gear:Record<string,string>={};
 const container=(await pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE run_id=$1 RETURNING id",[f.run])).rows[0].id;
 await executeAction(pool,f.account,advancementEnvelope(await f.revision(),'FIXTURE_GEAR'),{},async c=>{for(const key of ['sword','shield'])gear[key]=(await grantItem(c,key,{containerId:container,definitionId:'item.'+key,quantity:'1',sourceCode:'FIXTURE'},'FIXTURE')).itemId;return {revision:await advanceRevision(c)};});
 await setEquipment(pool,f.account,advancementEnvelope(await f.revision(),'SET_EQUIPMENT'),{activeSet:'A',slots:[{set:'A',slot:'MAIN_HAND',itemId:gear.sword!},{set:'A',slot:'OFF_HAND',itemId:gear.shield!}]});
 await pool.query("UPDATE discoveries SET knowledge_level='ADVANCED' WHERE account_id=$1",[f.account]);
 return {...f,gear,complete:async()=>{const started=await startTacticalCombat(pool,f.account,advancementEnvelope(await f.revision(),'START_TACTICAL'),'encounter.history-finale') as {instanceId:string;encounterRevision:number;tacticalRevision:number};return takeTacticalAction(pool,f.account,advancementEnvelope(await f.revision(),'TACTICAL_ACTION'),started.instanceId,started.encounterRevision,started.tacticalRevision,{actorId:'hero',kind:'ATTACK',targetId:'enemy'});},populate:async()=>{
  await f.levels('class.one',long?19:4);if(long)await f.levels('class.two',5);
  await chooseSubclass(pool,f.account,advancementEnvelope(await f.revision(),'CHOOSE_SUBCLASS'),'subclass.first');
  await chooseFeat(pool,f.account,advancementEnvelope(await f.revision(),'CHOOSE_FEAT'),'feat.root',2);
  await allocateAttributes(pool,f.account,advancementEnvelope(await f.revision(),'ALLOCATE_ATTRIBUTES'),'rules.attributes',2,{luck:2});
  await advanceProficiency(pool,f.account,advancementEnvelope(await f.revision(),'ADVANCE_PROFICIENCY'),'rules.skills','skill.fixture',1);
 }};
}
