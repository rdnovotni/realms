import { randomBytes } from 'node:crypto';
import { testDatabase,actor } from '../test/helpers.js';
import { historyFixture,historyPackage } from '../test/character-history-fixture.js';
import { publishContent } from '../src/domains/content.js';
import { enrollPassword } from '../src/auth/sessions.js';
import { buildApp } from '../src/app.js';
const url=new URL(process.env.TEST_DATABASE_URL??'postgres://invalid/invalid');if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Character folio preview requires a local disposable database');
const state=process.env.PLAYTEST_FOLIO_STATE??'multiclass';if(!['multiclass','single','pending','setup'].includes(state))throw Error('Unknown preview state');
const port=Number(process.env.PLAYTEST_FOLIO_PORT??3008);if(!Number.isInteger(port)||port<3006||port>3019)throw Error('Choose a loopback preview port between 3006 and 3019');
const db=await testDatabase();let app:ReturnType<typeof buildApp>|undefined;
try{
 let account:string;
 if(state==='setup'){const p=historyPackage(),release=await publishContent(db.pool,p),f=await actor(db.pool,release,20);account=f.account;for(const id of ['class.one','class.two'])await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,$2,'DISCOVERED')",[account,id]);}
 else {const f=await historyFixture(db.pool,state==='multiclass');if(state==='pending')await f.levels('class.one',4);else await f.populate();account=f.account;}
 await enrollPassword(db.pool,account,'wayfarer','A road worth wandering 47!');app=buildApp(db.pool,{mode:'sessions',throttleKey:randomBytes(32).toString('hex')});await app.listen({host:'127.0.0.1',port});console.log('Disposable Character folio preview: http://127.0.0.1:'+port+' · '+state);
 let closing=false;const close=async()=>{if(closing)return;closing=true;await app?.close();await db.close();};process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
}catch(error){await app?.close();await db.close();throw error;}
