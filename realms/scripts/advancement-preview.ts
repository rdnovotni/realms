import { randomBytes } from 'node:crypto';
import { testDatabase } from '../test/helpers.js';
import { advancementFixture } from '../test/advancement-fixture.js';
import { enrollPassword } from '../src/auth/sessions.js';
import { buildApp } from '../src/app.js';
// Isolated fixtures only: the helper refuses every database except realms_test.
const url=new URL(process.env.TEST_DATABASE_URL??'postgres://invalid/invalid');
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Advancement preview requires local disposable PostgreSQL');
const state=process.env.PLAYTEST_ADVANCEMENT_STATE??'available';if(!['available','blocked','empty'].includes(state))throw Error('Unknown preview state');
const db=await testDatabase();let app:ReturnType<typeof buildApp>|undefined;
try{
 const f=await advancementFixture(db.pool);await f.levels('class.one',4);
 if(state==='blocked')await f.begin();if(state==='empty')await db.pool.query('DELETE FROM discoveries WHERE account_id=$1',[f.account]);
 await enrollPassword(db.pool,f.account,'wayfarer','A road worth wandering 47!');
 app=buildApp(db.pool,{mode:'sessions',throttleKey:randomBytes(32).toString('hex')});await app.listen({host:'127.0.0.1',port:3002});
 console.log('Disposable advancement preview: http://127.0.0.1:3002 · wayfarer / A road worth wandering 47! · '+state);
 let closing=false;const close=async()=>{if(closing)return;closing=true;await app?.close();await db.close();};process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
}catch(error){await app?.close();await db.close();throw error;}
