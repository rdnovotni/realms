import { randomBytes } from 'node:crypto';
import { testDatabase,actor } from '../test/helpers.js';
import { historyFixture,historyPackage } from '../test/character-history-fixture.js';
import { publishContent } from '../src/domains/content.js';
import { enrollPassword } from '../src/auth/sessions.js';
import { buildApp } from '../src/app.js';
const url=new URL(process.env.TEST_DATABASE_URL??'postgres://invalid/invalid');if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('History preview requires a local disposable database');
const state=process.env.PLAYTEST_HISTORY_STATE??'available';if(!['available','setup','aftercore','empty','blocked'].includes(state))throw Error('Unknown preview state');
const db=await testDatabase();let app:ReturnType<typeof buildApp>|undefined;
try{
 let account:string;
 if(state==='setup'){const p=historyPackage(),release=await publishContent(db.pool,p),f=await actor(db.pool,release,20);account=f.account;for(const id of ['class.one','class.two'])await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,$2,'DISCOVERED')",[account,id]);}
 else {const f=await historyFixture(db.pool,true);await f.populate();account=f.account;if(state==='aftercore')await f.complete();if(state==='empty')await db.pool.query('DELETE FROM discoveries WHERE account_id=$1',[account]);if(state==='blocked')await f.begin();}
 await enrollPassword(db.pool,account,'wayfarer','A road worth wandering 47!');app=buildApp(db.pool,{mode:'sessions',throttleKey:randomBytes(32).toString('hex')});await app.listen({host:'127.0.0.1',port:3004});console.log('Disposable history preview: http://127.0.0.1:3004 · '+state);
 let closing=false;const close=async()=>{if(closing)return;closing=true;await app?.close();await db.close();};process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
}catch(error){await app?.close();await db.close();throw error;}
