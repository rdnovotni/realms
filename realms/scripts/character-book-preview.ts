import { randomBytes } from 'node:crypto';
import { testDatabase } from '../test/helpers.js';
import { bookFixture } from '../test/character-book-fixture.js';
import { enrollPassword } from '../src/auth/sessions.js';
import { buildApp } from '../src/app.js';
const url=new URL(process.env.TEST_DATABASE_URL??'postgres://invalid/invalid');
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Character preview requires local disposable PostgreSQL');
const state=process.env.PLAYTEST_CHARACTER_STATE??'assessed';if(!['assessed','unassessed','missing','empty'].includes(state))throw Error('Unknown preview state');
const db=await testDatabase();let app:ReturnType<typeof buildApp>|undefined;
try{
 const f=await bookFixture(db.pool);if(state!=='unassessed')await f.assess(['class.one','feat.vigor','item.sword','item.shield']);
 if(state==='missing')await db.pool.query("DELETE FROM discoveries WHERE account_id=$1 AND entity_id='encounter.tactical'",[f.account]);
 if(state==='empty')await db.pool.query("UPDATE discoveries SET knowledge_level='DISCOVERED' WHERE account_id=$1",[f.account]);
 await enrollPassword(db.pool,f.account,'wayfarer','A road worth wandering 47!');
 app=buildApp(db.pool,{mode:'sessions',throttleKey:randomBytes(32).toString('hex')});await app.listen({host:'127.0.0.1',port:3003});console.log('Disposable Character preview: http://127.0.0.1:3003 · '+state);
 let closing=false;const close=async()=>{if(closing)return;closing=true;await app?.close();await db.close();};process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
}catch(error){await app?.close();await db.close();throw error;}
