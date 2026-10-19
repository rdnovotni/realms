import { effect } from '../test/shared-rules-fixture.js';
import { setFeatureControl } from '../src/rules/controls.js';
import { startBuild } from '../src/domains/builds.js';
import { setEquipment } from '../src/domains/equipment.js';
import { saveLoadout } from '../src/domains/loadouts.js';
import { startTacticalCombat,takeTacticalAction } from '../src/domains/tactical-combat.js';
import { postTransfers } from '../src/domains/ledger.js';
import { inventoryPackage } from '../test/inventory-fixture.js';
import { setItemLock } from '../src/domains/item-locks.js';
import { randomBytes } from 'node:crypto';
import { testDatabase,actor } from '../test/helpers.js';
import { tacticalPackage,envelope } from '../test/tactical-fixture.js';
import { publishContent } from '../src/domains/content.js';
import { enrollPassword } from '../src/auth/sessions.js';
import { buildApp } from '../src/app.js';
import { executeAction,advanceRevision } from '../src/foundation/action.js';
import { grantItem } from '../src/domains/item-accounting.js';

// Disposable local playtest. The test helper rejects every database except
// realms_test; production accounts, releases and saved runs are untouched.
const previewDatabase=new URL(process.env.TEST_DATABASE_URL??'postgresql://invalid/invalid');
if(!['127.0.0.1','localhost','[::1]'].includes(previewDatabase.hostname))throw new Error('Client preview requires a local test database');
const db=await testDatabase();
const folio=process.env.PLAYTEST_FOLIO==='1';
const p=tacticalPackage();p.version='client-playtest';
const greatblade=structuredClone(p.entities.find(e=>e.id==='item.sword')!);greatblade.id='item.greatblade';greatblade.definition.name='Practice greatblade';greatblade.definition.mechanics!.equipment={version:1,slots:['MAIN_HAND'],hands:2,minimumLevel:1,bindingPolicy:'PRESERVE'};p.entities.push(greatblade);
p.entities.find(e=>e.id==='item.sword')!.definition.mechanics!.equipment={version:2,slots:['MAIN_HAND'],hands:1,minimumLevel:1,bindingPolicy:'ACCOUNT_ON_ACTIVE_EQUIP'};
const names:Record<string,string>={'class.one':'Warden','class.two':'Wayfarer','class.three':'Arcanist','encounter.tactical':'The Old Watchtower','npc.ally':'Mira','monster.tactical':'Training Sentinel','item.ore':'Iron fragments'};
for(const entity of p.entities){if(names[entity.id])entity.definition.name=names[entity.id]!;}
p.entities.find(e=>e.id==='encounter.tactical')!.definition.public={summary:'A weathered watchtower overlooks the road. Join a companion for a short tactical encounter.'};
for(const [id,maximum]of [['item.sword',100],['item.shield',250],['item.greatblade',200]] as const)p.entities.find(e=>e.id===id)!.definition.mechanics!.tacticalDurability={version:1,maximum};
for(const [id,name,slots]of [['testring','Test copper ring',['RING_1','RING_2']],['testcharm','Test knotted charm',['TRINKET']],['testmedallion','Test road medallion',['TRINKET']]] as const)p.entities.push({id:'item.'+id,kind:'ITEM',revision:1,schemaVersion:1,definition:{name,dependencies:[],public:{description:'An accessory fixture for three interchangeable trinket positions.',rarity:'UNCOMMON',qualityLabel:'Standard'},mechanics:{inventory:{version:2,storageMode:'INSTANCE',category:'EQUIPMENT',unitWeight:1,unitBulk:1,mundane:true},equipment:{version:1,slots:[...slots],hands:0,minimumLevel:1,bindingPolicy:'PRESERVE'}}}});
const folioSlots=['HEAD','NECK','SHOULDERS','CHEST','HANDS','WAIST','LEGS','FEET'] as const;
if(folio)for(const slot of folioSlots){const item=structuredClone(p.entities.find(e=>e.id==='item.sword')!);item.id='item.folio.'+slot.toLowerCase();item.definition.name='Test '+slot.toLowerCase()+' gear';item.definition.public={description:'Disposable full-paperdoll visual fixture.',rarity:'UNCOMMON',itemArt:slot==='HEAD'?'helmet':slot==='FEET'?'boots':slot==='CHEST'?'armor':'charm'};item.definition.mechanics!.equipment={version:1,slots:[slot],hands:0,minimumLevel:1,bindingPolicy:'PRESERVE'};p.entities.push(item);}
const carrying=inventoryPackage().entities.find(e=>e.id==='rules.inventory')!;
carrying.definition.mechanics!.inventoryRules={...(carrying.definition.mechanics!.inventoryRules as Record<string,any>),baseWeight:folio?2000:process.env.PLAYTEST_SERVICES==='1'?200:60,weightPerStrength:2,baseBulk:folio?200:30,bulkPerStrength:1};p.entities.push(carrying);
p.entities.push(
 {id:'item.satchel',kind:'ITEM',revision:1,schemaVersion:1,definition:{name:'Test wayfarer satchel',dependencies:[],public:{description:'A fixture bag that demonstrates an explicit carrying bonus when worn.',rarity:'UNCOMMON'},mechanics:{inventory:{version:2,storageMode:'INSTANCE',category:'EQUIPMENT',unitWeight:3,unitBulk:2,mundane:true},equipment:{version:1,slots:['TOOL'],hands:0,minimumLevel:1,bindingPolicy:'PRESERVE'},inventoryCapacity:{version:1,weight:50,bulk:20,minimumNativeLevel:0}}}},
 {id:'item.testpotion',kind:'ITEM',revision:1,schemaVersion:1,definition:{name:'Test vial',dependencies:[],public:{description:'An inventory fixture. No consumption effect is implemented for this sample.',rarity:'COMMON'},mechanics:{inventory:{version:2,storageMode:'STACK',category:'CONSUMABLE',unitWeight:1,unitBulk:1,mundane:true}}}},
 {id:'item.testcurio',kind:'ITEM',revision:1,schemaVersion:1,definition:{name:'Test brass compass of the remarkably long and winding road',dependencies:[],public:{description:'A small fixture for inventory filters and item details.',rarity:'RARE'},mechanics:{inventory:{version:2,storageMode:'INSTANCE',category:'OTHER',unitWeight:2,unitBulk:1,mundane:false}}}}
);
const artwork:Record<string,string>={'item.sword':'sword','item.shield':'shield','item.greatblade':'greatsword','item.ore':'ore','item.satchel':'satchel','item.testpotion':'vial','item.testcurio':'compass','item.testring':'ring','item.testcharm':'charm','item.testmedallion':'medallion'};for(const item of p.entities)if(artwork[item.id])item.definition.public={...item.definition.public,itemArt:artwork[item.id]!};
for(const item of p.entities.filter(e=>e.kind==='ITEM')){const inv=item.definition.mechanics?.inventory as Record<string,any>|undefined;if(inv&&inv.version===1)item.definition.mechanics!.inventory={...inv,version:2,unitWeight:inv.category==='EQUIPMENT'?8:2,unitBulk:inv.category==='EQUIPMENT'?2:1,mundane:true};item.definition.public={rarity:'COMMON',qualityLabel:'Standard',...item.definition.public};}
p.entities.push({id:'effect.testfocus',kind:'EFFECT',revision:1,schemaVersion:1,definition:{name:'Test focus',dependencies:[],public:{description:'A short shared-check preparation effect.'},mechanics:{sharedEffect:effect as any}}},
 {id:'item.testparcel',kind:'ITEM',revision:1,schemaVersion:1,definition:{name:'Test ore parcel',dependencies:['item.ore'],public:{description:'A test container with three iron fragments.',itemArt:'satchel',rarity:'COMMON'},mechanics:{inventory:{version:2,storageMode:'STACK',category:'OTHER',unitWeight:1,unitBulk:1,mundane:true},itemUse:{version:1,kind:'OPEN',effects:[],rewards:[{kind:'ITEM',id:'item.ore',quantity:3}]}}}});
const vial=p.entities.find(e=>e.id==='item.testpotion')!;vial.definition.dependencies=['effect.testfocus'];vial.definition.public.description='A test tonic that applies a short preparation effect.';vial.definition.mechanics!.itemUse={version:1,kind:'USE',effects:['effect.testfocus'],rewards:[]};
for(const item of p.entities.filter(e=>e.definition.mechanics?.tacticalDurability))item.definition.mechanics!.repair={version:1,goldPerPoint:2};
const previewCombat=p.entities.find(e=>e.id==='encounter.tactical')!.definition.mechanics!.tacticalCombat as any;previewCombat.rules.surrender={version:1};previewCombat.failure={version:2,destination:'HOME',allowSurrender:true,turnCost:1,recoveryHealth:5,goldLossBps:0,goldLossCap:0,durabilityWearBps:1000};
const release=await publishContent(db.pool,p),f=await actor(db.pool,release,20);
for(const id of ['class.one','class.two','class.three','encounter.tactical'])await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,$2,'DISCOVERED')",[f.account,id]);
for(const item of p.entities.filter(e=>e.kind==='ITEM'))await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,$2,'ADVANCED')",[f.account,item.id]);
const carried=(await db.pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE run_id=$1 RETURNING id",[f.run])).rows[0].id;
const extraGear=Number(process.env.PLAYTEST_EQUIPMENT_COPIES??'0');if(!Number.isInteger(extraGear)||extraGear<0||extraGear>160)throw Error('PLAYTEST_EQUIPMENT_COPIES must be 0–160');
let protectedItem='';
await executeAction(db.pool,f.account,envelope(0,'PLAYTEST_GEAR'),{},async c=>{for(const key of ['sword','shield','greatblade','satchel','testcurio','testring','testcharm','testmedallion']){const grant=await grantItem(c,key,{containerId:carried,definitionId:`item.${key}`,quantity:'1',sourceCode:'FIXTURE'},'Disposable client playtest');if(key==='shield')protectedItem=grant.itemId;}for(const [key,quantity] of [['ore','25'],['ore','5'],['testpotion','5'],['testparcel','3']])await grantItem(c,key+'.'+quantity,{containerId:carried,definitionId:`item.${key}`,quantity:quantity!,sourceCode:'FIXTURE'},'Disposable inventory playtest');for(let n=0;n<extraGear;n++)await grantItem(c,'extra-ring.'+n,{containerId:carried,definitionId:'item.testring',quantity:'1',sourceCode:'FIXTURE'},'Disposable large-equipment playtest');if(folio)for(const slot of folioSlots)await grantItem(c,'folio.'+slot.toLowerCase(),{containerId:carried,definitionId:'item.folio.'+slot.toLowerCase(),quantity:'1',sourceCode:'FIXTURE'},'Disposable full-paperdoll playtest');return {revision:await advanceRevision(c)};});
await setItemLock(db.pool,f.account,envelope(1,'SET_ITEM_LOCK'),protectedItem,true);
const featureClient=await db.pool.connect();try{await setFeatureControl(featureClient,'shared.rules','RELEASE','ENABLED','Disposable client preview');}finally{featureClient.release();}
if(process.env.PLAYTEST_SERVICES==='1'){
 await startBuild(db.pool,f.account,envelope(2,'START_BUILD'),'class.one','balanced');
 const sword=(await db.pool.query("SELECT id FROM inventory_items WHERE definition_id='item.sword' AND quantity>0")).rows[0].id;
 const fullSlots: import('../src/domains/equipment.js').EquipmentPlan['slots']=[{set:'A',slot:'MAIN_HAND',itemId:sword}];
 if(folio){const items=(await db.pool.query('SELECT id,definition_id FROM inventory_items WHERE container_id=$1 AND quantity>0 ORDER BY id',[carried])).rows;for(const slot of folioSlots)fullSlots.push({set:'WORN',slot,itemId:items.find(i=>i.definition_id==='item.folio.'+slot.toLowerCase())!.id});for(const [slot,key]of [['RING_1','testring'],['RING_2','testcharm'],['TRINKET','testmedallion'],['TOOL','satchel']] as const)fullSlots.push({set:'WORN',slot,itemId:items.find(i=>i.definition_id==='item.'+key)!.id});fullSlots.push({set:'A',slot:'OFF_HAND',itemId:protectedItem},{set:'B',slot:'MAIN_HAND',itemId:items.find(i=>i.definition_id==='item.greatblade')!.id});}
 await setEquipment(db.pool,f.account,envelope(3,'SET_EQUIPMENT'),{activeSet:'A',slots:fullSlots});
 await saveLoadout(db.pool,f.account,envelope(4,'SAVE_LOADOUT'),'travel','Travel gear');
 let start=await startTacticalCombat(db.pool,f.account,envelope(5,'START_TACTICAL'),'encounter.tactical') as any;
 for(let n=0;n<10&&start.currentActor!=='hero'&&!start.outcome;n++)start=await takeTacticalAction(db.pool,f.account,envelope(start.revision),start.instanceId,start.encounterRevision,start.tacticalRevision,{actorId:start.currentActor,kind:'END'}) as any;
 const after=await takeTacticalAction(db.pool,f.account,envelope(start.revision),start.instanceId,start.encounterRevision,start.tacticalRevision,{actorId:'hero',kind:'SURRENDER'}) as any;
 await db.pool.query("INSERT INTO worlds(name) VALUES('Disposable repair preview')");
 const sink=(await db.pool.query("INSERT INTO wallets(scope_id,currency_id,purpose) SELECT id,'GOLD','FAUCET_SINK' FROM state_scopes WHERE kind='WORLD' RETURNING id")).rows[0].id;
 const source=(await db.pool.query("INSERT INTO wallets(scope_id,currency_id,purpose) SELECT id,'GOLD','PLAYER' FROM state_scopes WHERE run_id=$1 RETURNING id",[f.run])).rows[0].id;
 await executeAction(db.pool,f.account,envelope(after.revision,'PLAYTEST_GOLD'),{},async c=>{await postTransfers(c,[{key:'fund',currencyId:'GOLD',from:sink,to:source,amount:'100',reason:'DISPOSABLE_PLAYTEST'}]);return {revision:await advanceRevision(c)};});
}
await enrollPassword(db.pool,f.account,'wayfarer','A road worth wandering 47!');
const app=buildApp(db.pool,{mode:'sessions',throttleKey:randomBytes(32).toString('hex')});
app.addHook('onSend',async(_request,reply,payload)=>{reply.header('X-Follybound-Fixture','disposable-visual');return payload;});
try{await app.listen({host:'127.0.0.1',port:3001});}
catch(error){await app.close();await db.close();throw error;}
console.log('Disposable Follybound playtest: http://127.0.0.1:3001');
console.log('Account: wayfarer · Password: A road worth wandering 47!');
console.log('This isolated test schema is removed when the preview stops.');
let closing=false;
async function close(){if(closing)return;closing=true;await app.close();await db.close();}
process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
