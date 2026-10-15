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
const p=tacticalPackage();p.version='client-playtest';
const greatblade=structuredClone(p.entities.find(e=>e.id==='item.sword')!);greatblade.id='item.greatblade';greatblade.definition.name='Practice greatblade';greatblade.definition.mechanics!.equipment={version:1,slots:['MAIN_HAND'],hands:2,minimumLevel:1,bindingPolicy:'PRESERVE'};p.entities.push(greatblade);
p.entities.find(e=>e.id==='item.sword')!.definition.mechanics!.equipment={version:2,slots:['MAIN_HAND'],hands:1,minimumLevel:1,bindingPolicy:'ACCOUNT_ON_ACTIVE_EQUIP'};
const names:Record<string,string>={'class.one':'Warden','class.two':'Wayfarer','class.three':'Arcanist','encounter.tactical':'The Old Watchtower','npc.ally':'Mira','monster.tactical':'Training Sentinel','item.ore':'Iron fragments'};
for(const entity of p.entities){if(names[entity.id])entity.definition.name=names[entity.id]!;}
p.entities.find(e=>e.id==='encounter.tactical')!.definition.public={summary:'A weathered watchtower overlooks the road. Join a companion for a short tactical encounter.'};
for(const [id,maximum]of [['item.sword',100],['item.shield',250],['item.greatblade',200]] as const)p.entities.find(e=>e.id===id)!.definition.mechanics!.tacticalDurability={version:1,maximum};
for(const [id,name,slots]of [['testring','Test copper ring',['RING_1','RING_2']],['testcharm','Test knotted charm',['TRINKET']],['testmedallion','Test road medallion',['TRINKET']]] as const)p.entities.push({id:'item.'+id,kind:'ITEM',revision:1,schemaVersion:1,definition:{name,dependencies:[],public:{description:'An accessory fixture for three interchangeable trinket positions.',rarity:'UNCOMMON',qualityLabel:'Standard'},mechanics:{inventory:{version:2,storageMode:'INSTANCE',category:'EQUIPMENT',unitWeight:1,unitBulk:1,mundane:true},equipment:{version:1,slots:[...slots],hands:0,minimumLevel:1,bindingPolicy:'PRESERVE'}}}});
const carrying=inventoryPackage().entities.find(e=>e.id==='rules.inventory')!;
carrying.definition.mechanics!.inventoryRules={...(carrying.definition.mechanics!.inventoryRules as Record<string,any>),baseWeight:60,weightPerStrength:2,baseBulk:30,bulkPerStrength:1};p.entities.push(carrying);
p.entities.push(
 {id:'item.satchel',kind:'ITEM',revision:1,schemaVersion:1,definition:{name:'Test wayfarer satchel',dependencies:[],public:{description:'A fixture bag that demonstrates an explicit carrying bonus when worn.',rarity:'UNCOMMON'},mechanics:{inventory:{version:2,storageMode:'INSTANCE',category:'EQUIPMENT',unitWeight:3,unitBulk:2,mundane:true},equipment:{version:1,slots:['TOOL'],hands:0,minimumLevel:1,bindingPolicy:'PRESERVE'},inventoryCapacity:{version:1,weight:50,bulk:20,minimumNativeLevel:0}}}},
 {id:'item.testpotion',kind:'ITEM',revision:1,schemaVersion:1,definition:{name:'Test vial',dependencies:[],public:{description:'An inventory fixture. No consumption effect is implemented for this sample.',rarity:'COMMON'},mechanics:{inventory:{version:2,storageMode:'STACK',category:'CONSUMABLE',unitWeight:1,unitBulk:1,mundane:true}}}},
 {id:'item.testcurio',kind:'ITEM',revision:1,schemaVersion:1,definition:{name:'Test brass compass',dependencies:[],public:{description:'A small fixture for inventory filters and item details.',rarity:'RARE'},mechanics:{inventory:{version:2,storageMode:'INSTANCE',category:'OTHER',unitWeight:2,unitBulk:1,mundane:false}}}}
);
for(const item of p.entities.filter(e=>e.kind==='ITEM')){const inv=item.definition.mechanics?.inventory as Record<string,any>|undefined;if(inv&&inv.version===1)item.definition.mechanics!.inventory={...inv,version:2,unitWeight:inv.category==='EQUIPMENT'?8:2,unitBulk:inv.category==='EQUIPMENT'?2:1,mundane:true};item.definition.public={rarity:'COMMON',qualityLabel:'Standard',...item.definition.public};}
const release=await publishContent(db.pool,p),f=await actor(db.pool,release,20);
for(const id of ['class.one','class.two','class.three','encounter.tactical'])await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,$2,'DISCOVERED')",[f.account,id]);
for(const item of p.entities.filter(e=>e.kind==='ITEM'))await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,$2,'ADVANCED')",[f.account,item.id]);
const carried=(await db.pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE run_id=$1 RETURNING id",[f.run])).rows[0].id;
let protectedItem='';
await executeAction(db.pool,f.account,envelope(0,'PLAYTEST_GEAR'),{},async c=>{for(const key of ['sword','shield','greatblade','satchel','testcurio','testring','testcharm','testmedallion']){const grant=await grantItem(c,key,{containerId:carried,definitionId:`item.${key}`,quantity:'1',sourceCode:'FIXTURE'},'Disposable client playtest');if(key==='shield')protectedItem=grant.itemId;}for(const [key,quantity] of [['ore','25'],['ore','5'],['testpotion','5']])await grantItem(c,key+'.'+quantity,{containerId:carried,definitionId:`item.${key}`,quantity:quantity!,sourceCode:'FIXTURE'},'Disposable inventory playtest');return {revision:await advanceRevision(c)};});
await setItemLock(db.pool,f.account,envelope(1,'SET_ITEM_LOCK'),protectedItem,true);
await enrollPassword(db.pool,f.account,'wayfarer','A road worth wandering 47!');
const app=buildApp(db.pool,{mode:'sessions',throttleKey:randomBytes(32).toString('hex')});
try{await app.listen({host:'127.0.0.1',port:3001});}
catch(error){await app.close();await db.close();throw error;}
console.log('Disposable Follybound playtest: http://127.0.0.1:3001');
console.log('Account: wayfarer · Password: A road worth wandering 47!');
console.log('This isolated test schema is removed when the preview stops.');
let closing=false;
async function close(){if(closing)return;closing=true;await app.close();await db.close();}
process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
