import { randomBytes } from 'node:crypto';
import { testDatabase,actor } from '../test/helpers.js';
import { tacticalPackage } from '../test/tactical-fixture.js';
import { publishContent } from '../src/domains/content.js';
import { enrollPassword } from '../src/auth/sessions.js';
import { buildApp } from '../src/app.js';

// Disposable local playtest. The test helper rejects every database except
// realms_test; production accounts, releases and saved runs are untouched.
const previewDatabase=new URL(process.env.TEST_DATABASE_URL??'postgresql://invalid/invalid');
if(!['127.0.0.1','localhost','[::1]'].includes(previewDatabase.hostname))throw new Error('Client preview requires a local test database');
const db=await testDatabase();
const p=tacticalPackage();p.version='client-playtest';
const names:Record<string,string>={'class.one':'Warden','class.two':'Wayfarer','class.three':'Arcanist','encounter.tactical':'The Old Watchtower','npc.ally':'Mira','monster.tactical':'Training Sentinel','item.ore':'Iron fragments'};
for(const entity of p.entities){if(names[entity.id])entity.definition.name=names[entity.id]!;}
p.entities.find(e=>e.id==='encounter.tactical')!.definition.public={summary:'A weathered watchtower overlooks the road. Join a companion for a short tactical encounter.'};
const release=await publishContent(db.pool,p),f=await actor(db.pool,release,20);
for(const id of ['class.one','class.two','class.three','encounter.tactical'])await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,$2,'DISCOVERED')",[f.account,id]);
await db.pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE run_id=$1",[f.run]);
await enrollPassword(db.pool,f.account,'wayfarer','A road worth wandering 47!');
const app=buildApp(db.pool,{mode:'sessions',throttleKey:randomBytes(32).toString('hex')});
try{await app.listen({host:'127.0.0.1',port:3001});}
catch(error){await app.close();await db.close();throw error;}
console.log('Disposable Realms playtest: http://127.0.0.1:3001');
console.log('Account: wayfarer · Password: A road worth wandering 47!');
console.log('This isolated test schema is removed when the preview stops.');
let closing=false;
async function close(){if(closing)return;closing=true;await app.close();await db.close();}
process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
