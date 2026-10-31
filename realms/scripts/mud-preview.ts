/** Synthetic scene proof on a disposable schema. Never connects to a production database. */
import {randomUUID} from 'node:crypto';
import {actor,testDatabase} from '../test/helpers.js';
import {mudPackage} from '../test/mud-fixture.js';
import {buildPackage} from '../test/build-fixture.js';
import {publishContent} from '../src/domains/content.js';
import {startBuild} from '../src/domains/builds.js';
import {executeAction,advanceRevision} from '../src/foundation/action.js';
import {grantItem} from '../src/domains/item-accounting.js';
import {setEquipment} from '../src/domains/equipment.js';
import {setFeatureControl} from '../src/rules/controls.js';
import {buildApp} from '../src/app.js';
const db=await testDatabase();
try{const p=mudPackage();p.version='mu01-disposable-browser';p.entities.push(...structuredClone(buildPackage.entities.filter(e=>e.kind==='TUNING')));const cls=p.entities.find(e=>e.id==='class.archive-engineer')!;cls.definition.dependencies=['rules.build'];cls.definition.mechanics={classProgression:{version:1,rulesId:'rules.build',access:'DISCOVERED',maximumNativeLevel:2}};
 const release=await publishContent(db.pool,p),f=await actor(db.pool,release,30);for(const e of p.entities)await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,$2,'DISCOVERED')",[f.account,e.id]);const env=(revision:number,actionType:string)=>({requestId:randomUUID(),actionType,expectedRevision:revision});await startBuild(db.pool,f.account,env(0,'START_BUILD'),'class.archive-engineer','balanced');let tabard='';await executeAction(db.pool,f.account,env(1,'MU01_FIXTURE'),{},async c=>{const container=(await c.client.query("SELECT b.id FROM inventory_containers b JOIN state_scopes s ON s.id=b.scope_id WHERE s.run_id=$1 AND b.kind='CARRIED'",[f.run])).rows[0]?.id??(await c.client.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE run_id=$1 RETURNING id",[f.run])).rows[0].id;for(const id of ['key','tools','tabard']){const item=await grantItem(c,id,{containerId:container,definitionId:'item.archive-'+id,quantity:'1',sourceCode:'MU01_FIXTURE'},'MU01_FIXTURE');if(id==='tabard')tabard=item.itemId;}return {revision:await advanceRevision(c)};});await setEquipment(db.pool,f.account,env(2,'SET_EQUIPMENT'),{activeSet:'A',slots:[{set:'WORN',slot:'CHEST',itemId:tabard}]});const c=await db.pool.connect();try{for(const key of ['shared.rules','scenes.interaction','quests.journal','npc.dialogue'])await setFeatureControl(c,key,'RELEASE','ENABLED','Synthetic local MU01 proof only');}finally{c.release();}
 const app=buildApp(db.pool,{mode:'development',token:'mu01-disposable-preview-token-2026',accountId:f.account});await app.listen({host:'127.0.0.1',port:3042});console.log('MU01 synthetic preview: http://127.0.0.1:3042 · synthetic token: mu01-disposable-preview-token-2026');for(const signal of ['SIGINT','SIGTERM']as const)process.once(signal,()=>void(async()=>{await app.close();await db.close();})());
}catch(error){await db.close();throw error;}
