/** Synthetic, loopback-only manual proof. testDatabase refuses all other DB names. */
import { actor,testDatabase } from '../test/helpers.js';
import { npcPackage } from '../test/npc-fixture.js';
const questPackage=npcPackage;
import { noncombatPackage } from '../test/noncombat-fixture.js';
import { tacticalPackage,tacticalFixture,envelope } from '../test/tactical-fixture.js';
import { executeAction,advanceRevision } from '../src/foundation/action.js';
import { grantItem } from '../src/domains/item-accounting.js';
import { recruitCompanion } from '../src/domains/tactical-companions.js';
import { setFeatureControl } from '../src/rules/controls.js';
import { buildApp } from '../src/app.js';
const db=await testDatabase();
try{
 const p=tacticalPackage(),n=noncombatPackage();n.entities=n.entities.filter(e=>e.id!=='class.engineer');for(const e of [...n.entities,...p.entities.filter(e=>['QUEST','NPC','FACTION','LOCATION'].includes(e.kind))]){e.definition.dependencies=e.definition.dependencies.map(id=>id==='class.engineer'?'class.one':id);if(e.id==='ability.unseal')(e.definition.mechanics!.noncombatAbility as any).classId='class.one';if(e.id==='activity.sluice'){const s=e.definition.mechanics!.noncombatObstacle as any;s.steps[0].approaches.find((a:any)=>a.id==='magic').ability.classId='class.one';s.steps[0].approaches.find((a:any)=>a.id==='lever').assistance=[{companionId:'npc.ally',bonus:3}];e.definition.dependencies.push('npc.ally');}}
 p.entities.push(...n.entities,...questPackage().entities.filter(e=>['QUEST','FACTION','LOCATION'].includes(e.kind)||e.id==='npc.sluice-keeper'));p.version='m05-disposable-browser';p.entities.find(e=>e.id==='npc.ally')!.definition.mechanics!.companion={version:1,access:'DISCOVERED'};
 const f=await tacticalFixture(db.pool,p,30);for(const e of [...n.entities,...p.entities.filter(e=>['QUEST','NPC','FACTION','LOCATION'].includes(e.kind))])await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,$2,$3) ON CONFLICT(account_id,entity_id) DO UPDATE SET knowledge_level=excluded.knowledge_level",[f.account,e.id,e.id==='activity.lever'?'ADVANCED':'DISCOVERED']);await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,'npc.ally','DISCOVERED') ON CONFLICT DO NOTHING",[f.account]);
 const recruited=await recruitCompanion(db.pool,f.account,envelope(f.revision,'RECRUIT_COMPANION'),'npc.ally');
 await executeAction(db.pool,f.account,envelope(recruited.revision as number,'M05_PLAYTEST'),{},async c=>{const container=(await c.client.query("SELECT b.id FROM inventory_containers b JOIN state_scopes s ON s.id=b.scope_id WHERE s.run_id=$1 AND b.kind='CARRIED'",[f.run])).rows[0].id;await grantItem(c,'wedge',{containerId:container,definitionId:'item.wedge',quantity:'2',sourceCode:'M05_PLAYTEST'},'M05_PLAYTEST');return {revision:await advanceRevision(c)};});
 const c=await db.pool.connect();try{for(const key of ['shared.rules','noncombat.pipeline','quests.journal','npc.dialogue'])await setFeatureControl(c,key,'RELEASE','ENABLED','Synthetic local M05 proof only');}finally{c.release();}
 const newcomer=await actor(db.pool,f.release,20);for(const id of ['class.one','encounter.tactical'])await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,$2,'DISCOVERED')",[newcomer.account,id]);const onboarding=buildApp(db.pool,{mode:'development',token:'m05-onboarding-preview-token-2026',accountId:newcomer.account});await onboarding.listen({host:'127.0.0.1',port:3038});console.log('M05 onboarding: http://127.0.0.1:3038 · synthetic token: m05-onboarding-preview-token-2026');
 const app=buildApp(db.pool,{mode:'development',token:'m05-disposable-preview-token-2026',accountId:f.account});await app.listen({host:'127.0.0.1',port:3037});console.log('M05 synthetic preview: http://127.0.0.1:3037 · synthetic token: m05-disposable-preview-token-2026');
 for(const signal of ['SIGINT','SIGTERM']as const)process.once(signal,()=>void(async()=>{await app.close();await onboarding.close();await db.close();})());
}catch(error){await db.close();throw error;}
