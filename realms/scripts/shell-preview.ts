import { randomBytes } from 'node:crypto';
import { testDatabase } from '../test/helpers.js';
import { advancementPackage,advancementFixture,advancementEnvelope } from '../test/advancement-fixture.js';
import { bookPackage } from '../test/character-book-fixture.js';
import { executeAction,advanceRevision } from '../src/foundation/action.js';
import { grantItem } from '../src/domains/item-accounting.js';
import { setEquipment } from '../src/domains/equipment.js';
import { enrollPassword } from '../src/auth/sessions.js';
import { buildApp } from '../src/app.js';
// Loopback and realms_test only. Content and accounts are synthetic, never production.
const url=new URL(process.env.TEST_DATABASE_URL??'postgres://invalid/invalid');
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Shell preview requires local disposable PostgreSQL');
const count=Number(process.env.PLAYTEST_SHELL_ITEMS??48);if(!Number.isInteger(count)||count<2||count>96)throw Error('Choose 2–96 fixture items');
const db=await testDatabase();let app:ReturnType<typeof buildApp>|undefined;
try{
 const p=advancementPackage(),book=bookPackage();p.version='shell-fixture';
 for(const e of book.entities)if(!p.entities.some(v=>v.id===e.id))p.entities.push(e);
 for(const id of ['class.one','class.two']){const target=p.entities.find(e=>e.id===id)!,source=book.entities.find(e=>e.id===id)!;for(const key of ['combatModifiers','tacticalKit','tacticalTechniques'])if(source.definition.mechanics?.[key])target.definition.mechanics![key]=source.definition.mechanics[key];for(const dep of source.definition.dependencies)if(!target.definition.dependencies.includes(dep))target.definition.dependencies.push(dep);}
 const f=await advancementFixture(db.pool,'class.one',p);await f.levels('class.one',4);
 const container=(await db.pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE run_id=$1 RETURNING id",[f.run])).rows[0].id as string,ids:string[]=[];
 await executeAction(db.pool,f.account,advancementEnvelope(await f.revision(),'FIXTURE_GEAR'),{},async c=>{for(let i=0;i<count;i++)ids.push((await grantItem(c,'gear.'+i,{containerId:container,definitionId:i%2?'item.shield':'item.sword',quantity:'1',sourceCode:'FIXTURE'},'VISUAL_FIXTURE')).itemId);return {revision:await advanceRevision(c)};});
 await setEquipment(db.pool,f.account,advancementEnvelope(await f.revision(),'SET_EQUIPMENT'),{activeSet:'A',slots:[{set:'A',slot:'MAIN_HAND',itemId:ids[0]!},{set:'A',slot:'OFF_HAND',itemId:ids[1]!}]});
 await db.pool.query("UPDATE discoveries SET knowledge_level='ADVANCED' WHERE account_id=$1",[f.account]);
 await enrollPassword(db.pool,f.account,'wayfarer','A road worth wandering 47!');
 app=buildApp(db.pool,{mode:'sessions',throttleKey:randomBytes(32).toString('hex')});await app.listen({host:'127.0.0.1',port:3005});console.log('Disposable shell preview: http://127.0.0.1:3005 · '+count+' fixture items');
 let closing=false;const close=async()=>{if(closing)return;closing=true;await app?.close();await db.close();};for(const signal of ['SIGINT','SIGTERM']as const)process.once(signal,()=>void close());
}catch(error){await app?.close();await db.close();throw error;}
