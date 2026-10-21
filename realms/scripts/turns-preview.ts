/** Disposable loopback playtest only. Never connects to a non-test database. */
import { testDatabase } from '../test/helpers.js';
import { tacticalPackage,tacticalFixture } from '../test/tactical-fixture.js';
import { turnsPackage } from '../test/turn-planner-fixture.js';
import { buildApp } from '../src/app.js';
import { configureSchedule } from '../src/scheduler.js';
import { setFeatureControl } from '../src/rules/controls.js';
import { spec } from '../test/shared-rules-fixture.js';
const db=await testDatabase();
try{
 const p=tacticalPackage();p.entities.push(...turnsPackage().entities);
 for(const [id,full,free]of [['activity.quick_rest',false,false],['activity.full_rest',true,false],['activity.free_rest',true,true]] as const){const a=spec('INTERACTION');a.check={...a.check,possibility:'AUTOMATIC'};a.costs={turns:free?0:1,worldTime:0,gold:'0',resources:[],rest:full?'FULL_REST':'REST'};a.effects=[];a.rewards=[];a.retry='PAID';p.entities.push({id,kind:'ACTIVITY',revision:1,schemaVersion:1,definition:{name:free?'Free full rest':full?'Full rest':'Quick rest',dependencies:[],public:{},mechanics:{sharedAction:a as any,turnRest:{version:1,healthBps:full?10000:2500,manaBps:full?10000:2500},...(free?{dailyAllowance:{version:1,refresh:1,capacity:2,banking:'BANK',turnBonus:0,autoCollect:false}}:{})}}});}
 const f=await tacticalFixture(db.pool,p,399);await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) SELECT $1,id,'DISCOVERED' FROM content_entities WHERE id LIKE 'activity.%' ON CONFLICT DO NOTHING",[f.account]);
 await db.pool.query("UPDATE accounts SET created_at=now()-interval '3 days'; UPDATE discoveries SET discovered_at=now()-interval '3 days'; INSERT INTO rollover_epochs VALUES(20261018,now()-interval '1 day',100,400)");
 await configureSchedule(db.pool,{id:'game-daily',hook:'DAILY_ROLLOVER',cadence:'DAILY',timezone:'America/Chicago',localTime:'00:00',startDate:'2026-01-01',config:{turns:100,cap:400}});
 const c=await db.pool.connect();try{await setFeatureControl(c,'shared.rules','RELEASE','ENABLED','Disposable Turns UI preview');}finally{c.release();}
 const app=buildApp(db.pool,{mode:'development',token:'turns-disposable-preview-token-2026',accountId:f.account});
 await app.listen({host:'127.0.0.1',port:3013});console.log('Disposable Turns playtest: http://127.0.0.1:3013; synthetic token: turns-disposable-preview-token-2026');
 for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>void (async()=>{await app.close();await db.close();})());
}catch(error){await db.close();throw error;}
