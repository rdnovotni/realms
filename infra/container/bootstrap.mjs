import { readFileSync } from 'node:fs';
import { poolFor } from '../dist/database.js';
const name=process.env.DB_NAME;
if(!/^kol_(production|staging)$/.test(name??'')) throw new Error('Explicit project database required');
const secret=key=>readFileSync(`/run/secrets/${key}`,'utf8').trim();
const pool=poolFor(`postgresql://postgres:${secret('db_password')}@db:5432/${name}`);
const client=await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SET LOCAL log_min_duration_statement=-1');
  for(const [role,key,limit] of [['realms_migrator','migration_password',4],['realms_app','app_password',10],['realms_worker','worker_password',6],['realms_scheduler','scheduler_password',4]]){
    if(!(await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount) {
      const ddl=(await client.query("SELECT format('CREATE ROLE %I LOGIN', $1::text)",[role])).rows[0].format;
      await client.query(ddl);
    }
    if((await client.query('SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=$1)',[role])).rowCount) throw new Error('Unexpected inherited role membership; inspect before provisioning');
    const ddl=(await client.query("SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT %s',$1::text,$2::text,$3::integer)",[role,secret(key),limit])).rows[0].format;
    await client.query(ddl);
  }
  const sql=(await client.query("SELECT format('ALTER DATABASE %I OWNER TO realms_migrator; REVOKE ALL ON DATABASE %I FROM PUBLIC; GRANT CONNECT ON DATABASE %I TO realms_migrator, realms_app, realms_worker, realms_scheduler', $1::text,$1::text,$1::text)",[name])).rows[0].format;
  await client.query(sql);
  await client.query('ALTER SCHEMA public OWNER TO realms_migrator');
  await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await client.query('COMMIT');
  console.log('Separate non-superuser migration and application logins provisioned.');
} catch(error){await client.query('ROLLBACK');throw error;}
finally{client.release();await pool.end();}
