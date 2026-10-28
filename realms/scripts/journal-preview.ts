/** Synthetic, loopback-only manual proof. testDatabase refuses all other DB names. */
import { testDatabase } from '../test/helpers.js';
import { questPackage } from '../test/quest-fixture.js';
import { noncombatPackage } from '../test/noncombat-fixture.js';
import { tacticalPackage,tacticalFixture,envelope } from '../test/tactical-fixture.js';
import { executeAction,advanceRevision } from '../src/foundation/action.js';
import { grantItem } from '../src/domains/item-accounting.js';
import { recruitCompanion } from '../src/domains/tactical-companions.js';
import { setFeatureControl } from '../src/rules/controls.js';
import { buildApp } from '../src/app.js';
const db=await testDatabase();
try{
 const p=tacticalPackage(),n=noncombatPackage();n.entities=n.entities.filter(e=>e.id!=='class.engineer');for(const e of [...n.entities,...p.entities.filter(e=>e.kind==='QUEST')]){e.definition.dependencies=e.definition.dependencies.map(id=>id==='class.engineer'?'class.one':id);if(e.id==='ability.unseal')(e.definition.mechanics!.noncombatAbility as any).classId='class.one';if(e.id==='activity.sluice'){const s=e.definition.mechanics!.noncombatObstacle as any;s.steps[0].approaches.find((a:any)=>a.id==='magic').ability.classId='class.one';s.steps[0].approaches.find((a:any)=>a.id==='lever').assistance=[{companionId:'npc.ally',bonus:3}];e.definition.dependencies.push('npc.ally');}}
 p.entities.push(...n.entities,...questPackage().entities.filter(e=>e.kind==='QUEST'));p.version='m04-disposable-browser';p.entities.find(e=>e.id==='npc.ally')!.definition.mechanics!.companion={version:1,access:'DISCOVERED'};
 const f=await tacticalFixture(db.pool,p,30);for(const e of [...n.entities,...p.entities.filter(e=>e.kind==='QUEST')])await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,$2,$3) ON CONFLICT(account_id,entity_id) DO UPDATE SET knowledge_level=excluded.knowledge_level",[f.account,e.id,e.id==='activity.lever'?'ADVANCED':'DISCOVERED']);await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,'npc.ally','DISCOVERED')",[f.account]);
 const recruited=await recruitCompanion(db.pool,f.account,envelope(f.revision,'RECRUIT_COMPANION'),'npc.ally');
 await executeAction(db.pool,f.account,envelope(recruited.revision as number,'M04_PLAYTEST'),{},async c=>{const container=(await c.client.query("SELECT b.id FROM inventory_containers b JOIN state_scopes s ON s.id=b.scope_id WHERE s.run_id=$1 AND b.kind='CARRIED'",[f.run])).rows[0].id;await grantItem(c,'wedge',{containerId:container,definitionId:'item.wedge',quantity:'2',sourceCode:'M04_PLAYTEST'},'M04_PLAYTEST');return {revision:await advanceRevision(c)};});
 const c=await db.pool.connect();try{for(const key of ['shared.rules','noncombat.pipeline','quests.journal'])await setFeatureControl(c,key,'RELEASE','ENABLED','Synthetic local M04 proof only');}finally{c.release();}
 const app=buildApp(db.pool,{mode:'development',token:'m04-disposable-preview-token-2026',accountId:f.account});await app.listen({host:'127.0.0.1',port:3025});console.log('M04 synthetic preview: http://127.0.0.1:3025 · synthetic token: m04-disposable-preview-token-2026');
 for(const signal of ['SIGINT','SIGTERM']as const)process.once(signal,()=>void(async()=>{await app.close();await db.close();})());
}catch(error){await db.close();throw error;}
