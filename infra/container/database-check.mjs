import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {poolFor,migrate,assertSchema,assertRuntimeRole} from '../dist/database.js';
const name=process.env.DB_NAME;
if(!/^kol_(production|staging)$/.test(name??'')) throw new Error('Project database required');
const secret=key=>readFileSync(`/run/secrets/${key}`,'utf8').trim();
const pool=role=>poolFor(`postgresql://${role}:${secret(role==='realms_app'?'app_password':'migration_password')}@db:5432/${name}`);
const app=pool('realms_app'),migration=pool('realms_migrator');
const ok=(value,label)=>{if(!value)throw new Error(label);console.log('PASS: '+label);};
const mode=process.argv[2]??'full';
async function denied(sql){
 try{await app.query(sql);throw new Error('Unexpected authorization: '+sql.split(' ')[0]);}
 catch(e){if(e.code!=='42501')throw e;}
}
try{
 if(mode==='full'){await Promise.all([migrate(migration),migrate(migration)]);console.log('PASS: repeated and concurrent migration runs agree on checksums');}
 await assertSchema(app);await assertRuntimeRole(app);
 ok(true,'schema checksums and restricted runtime role');
 const roles=(await app.query("SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolconnlimit FROM pg_roles WHERE rolname IN ('realms_app','realms_migrator') ORDER BY rolname")).rows;
 ok(roles.length===2&&roles.every(r=>!r.rolsuper&&!r.rolcreatedb&&!r.rolcreaterole&&!r.rolreplication&&!r.rolbypassrls),'neither application nor migration login is a cluster administrator');
 ok(roles.find(r=>r.rolname==='realms_app').rolconnlimit===10&&roles.find(r=>r.rolname==='realms_migrator').rolconnlimit===4,'role connection budgets');
 for(const sql of ['CREATE TABLE public.infra_unauthorized(id int)', 'UPDATE schema_migrations SET checksum=checksum WHERE false',
    'DELETE FROM turn_ledger WHERE false','UPDATE accounts SET access_status=access_status WHERE false','TRUNCATE turn_ledger','SET ROLE realms_migrator'])await denied(sql);
 ok(true,'runtime cannot create schema objects, rewrite migration/ledger data, change account status, truncate, or assume migration role');
 const invalid=poolFor(`postgresql://realms_app:invalid-infra-probe-password@db:5432/${name}`);
 try{await invalid.query('SELECT 1');throw new Error('Invalid password accepted');}catch(e){if(e.code!=='28P01')throw e;console.log('PASS: unauthorized password rejected');}finally{await invalid.end();}
 const config=(await app.query("SELECT current_setting('fsync') AS fsync,current_setting('synchronous_commit') AS commit,current_setting('full_page_writes') AS full_page_writes,current_setting('max_connections') AS connections")).rows[0];
 ok(config.fsync==='on'&&config.commit==='on'&&config.full_page_writes==='on'&&config.connections==='40','durability settings and connection cap');
 if(mode==='full'){
  await migration.query('CREATE SCHEMA IF NOT EXISTS infra_probe');
  await migration.query('CREATE TABLE IF NOT EXISTS infra_probe.counter(id text PRIMARY KEY,value integer NOT NULL CHECK(value>=0)); CREATE TABLE IF NOT EXISTS infra_probe.receipts(id uuid PRIMARY KEY,marker text NOT NULL)');
  await migration.query('GRANT USAGE ON SCHEMA infra_probe TO realms_app; GRANT SELECT,INSERT,UPDATE ON infra_probe.counter TO realms_app; GRANT SELECT,INSERT ON infra_probe.receipts TO realms_app');
  const marker=randomUUID();await app.query('INSERT INTO infra_probe.counter VALUES($1,0)',[marker]);
  const ids=Array.from({length:8},()=>randomUUID());
  async function transact(id){
   const c=await app.connect();
   try{await c.query('BEGIN');const receipt=await c.query('INSERT INTO infra_probe.receipts VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id',[id,marker]);
    if(receipt.rowCount)await c.query('UPDATE infra_probe.counter SET value=value+1 WHERE id=$1',[marker]);
    await c.query('COMMIT');
   }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  await Promise.all(ids.map(transact));await transact(ids[0]);
  ok((await app.query('SELECT value FROM infra_probe.counter WHERE id=$1',[marker])).rows[0].value===8,'concurrent transactions retain every increment; duplicate request is not applied twice');
  const c=await app.connect();try{await c.query('BEGIN');await c.query('UPDATE infra_probe.counter SET value=999 WHERE id=$1',[marker]);await c.query('ROLLBACK');}finally{c.release();}
  ok((await app.query('SELECT value FROM infra_probe.counter WHERE id=$1',[marker])).rows[0].value===8,'transaction rollback preserves committed state');
  // Retain only the newest durable probe; unrelated game tables are untouched.
  await migration.query('DELETE FROM infra_probe.receipts WHERE marker<>$1',[marker]);
  await migration.query('DELETE FROM infra_probe.counter WHERE id<>$1',[marker]);
 } else {
  const values=(await app.query('SELECT value FROM infra_probe.counter')).rows;
  ok(values.length===1&&values[0].value===8,'committed acceptance marker survived restart/reboot');
  ok((await app.query('SELECT count(*)::int AS n FROM infra_probe.receipts')).rows[0].n===8,'committed request receipts survived restart/reboot');
 }
 const stats=(await app.query('SELECT numbackends,xact_commit,xact_rollback,deadlocks,temp_bytes,blks_read,blks_hit FROM pg_stat_database WHERE datname=current_database()')).rows[0];
 console.log('Database counters: '+JSON.stringify(stats));
} finally{await app.end();await migration.end();}
