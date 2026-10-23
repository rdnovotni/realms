/** Disposable loopback playtest. testDatabase refuses every database except realms_test. */
import { testDatabase } from '../test/helpers.js';
import { tacticalPackage,tacticalFixture } from '../test/tactical-fixture.js';
import { consumptionPackage } from '../test/consumption-fixture.js';
import { turnsPackage } from '../test/turn-planner-fixture.js';
import { effect } from '../test/shared-rules-fixture.js';
import { executeAction,advanceRevision } from '../src/foundation/action.js';
import { grantItem } from '../src/domains/item-accounting.js';
import { buildApp } from '../src/app.js';
import { configureSchedule } from '../src/scheduler.js';
import { setFeatureControl } from '../src/rules/controls.js';
import { randomUUID } from 'node:crypto';
const db=await testDatabase();
try{
 const pkg=tacticalPackage();pkg.entities.push(...turnsPackage().entities,...consumptionPackage().entities);
 const names:Record<string,string>={'item.bread':"Wayfarer's loaf",'item.wine':'Dwarven stout','item.tonic':"Tracker's tonic",'item.medicine':'Ordinary medicine specimen'};
 for(const e of pkg.entities)if(names[e.id])e.definition.name=names[e.id]!;
 pkg.entities.push({id:'effect.focus',kind:'EFFECT',revision:1,schemaVersion:1,definition:{name:'Steady focus',dependencies:[],public:{description:'A sustained preparation effect.'},mechanics:{sharedEffect:effect as any}}});
 const tonic=pkg.entities.find(e=>e.id==='item.tonic')!;tonic.definition.dependencies.push('effect.focus');(tonic.definition.mechanics!.itemUse as any).effects=['effect.focus'];
 const f=await tacticalFixture(db.pool,pkg,399);
 await executeAction(db.pool,f.account,{requestId:randomUUID(),actionType:'CONSUMPTION_FIXTURE',expectedRevision:f.revision},{},async c=>{
  const container=(await c.client.query("SELECT b.id FROM inventory_containers b JOIN state_scopes s ON s.id=b.scope_id WHERE s.run_id=$1 AND b.kind='CARRIED' LIMIT 1",[f.run])).rows[0].id;
  for(const id of ['bread','wine','tonic']){await grantItem(c,id,{containerId:container,definitionId:'item.'+id,quantity:'10',quality:'100',sourceCode:'DISPOSABLE_PREVIEW'},'DISPOSABLE_PREVIEW');await c.client.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,$2,'DISCOVERED') ON CONFLICT DO NOTHING",[f.account,'item.'+id]);}
  return {revision:await advanceRevision(c)};
 });
 await db.pool.query("UPDATE accounts SET created_at=now()-interval '3 days'; INSERT INTO rollover_epochs VALUES(20261020,now()-interval '1 day',100,400)");
 await configureSchedule(db.pool,{id:'game-daily',hook:'DAILY_ROLLOVER',cadence:'DAILY',timezone:'America/Chicago',localTime:'00:00',startDate:'2026-01-01',config:{turns:100,cap:400}});
 const client=await db.pool.connect();try{await setFeatureControl(client,'shared.rules','RELEASE','ENABLED','Disposable consumption preview');}finally{client.release();}
 const app=buildApp(db.pool,{mode:'development',token:'consumption-disposable-preview-token-2026',accountId:f.account});await app.listen({host:'127.0.0.1',port:3014});console.log('Disposable consumption playtest: http://127.0.0.1:3014; synthetic token: consumption-disposable-preview-token-2026');
 for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>void(async()=>{await app.close();await db.close();})());
}catch(error){await db.close();throw error;}
