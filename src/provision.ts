import { randomBytes } from 'node:crypto';
import { readFile,writeFile,rename,chmod } from 'node:fs/promises';
import { poolFor } from './database.js';
// Local workstation administration only; never called by the HTTP server.
const adminUrl=process.env.DATABASE_ADMIN_URL??process.env.DATABASE_URL;
if(!adminUrl) throw new Error('An administration connection is required');
const parsed=new URL(adminUrl);
if(parsed.hostname!=='127.0.0.1' || parsed.pathname!=='/realms_dev') throw new Error('Provisioning is restricted to the local development database');
let password:string;
try{password=(await readFile('.state/app-password','utf8')).trim();}
catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;password=randomBytes(32).toString('hex');await writeFile('.state/app-password',password,{mode:0o600});}
const pool=poolFor(adminUrl),client=await pool.connect();
try{
  await client.query('BEGIN');
  if(!(await client.query("SELECT 1 FROM pg_roles WHERE rolname='realms_app'")).rows.length) await client.query('CREATE ROLE realms_app LOGIN');
  const ddl=(await client.query("SELECT format('ALTER ROLE realms_app PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', $1::text)",[password])).rows[0].format;
  await client.query(ddl);
  await client.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE TEMPORARY ON DATABASE realms_dev FROM PUBLIC;
    GRANT CONNECT ON DATABASE realms_dev TO realms_app; GRANT USAGE ON SCHEMA public TO realms_app;
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM realms_app;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO realms_app;
    GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO realms_app;
    GRANT INSERT,UPDATE ON accounts,characters,runs,state_scopes,run_progression,run_class_levels,resource_pools,run_consumption,
      inventory_containers,inventory_items,wallets,discoveries,quest_states,effect_instances,instances,instance_participants,
      guilds,guild_members,world_events,scoped_state,outbox_events,durable_jobs TO realms_app;
    GRANT INSERT ON action_receipts,turn_ledger,currency_transfers,inventory_movements,run_history,audit_events,run_rollovers TO realms_app;
    GRANT DELETE ON effect_instances TO realms_app;`);
  await client.query('COMMIT');
  const appUrl=new URL(adminUrl);appUrl.username='realms_app';appUrl.password=password;
  const text=await readFile('.env','utf8'),values=text.split('\n').filter(line=>!line.startsWith('DATABASE_URL=')&&!line.startsWith('DATABASE_ADMIN_URL='));
  const updated=[...values.filter(Boolean),`DATABASE_ADMIN_URL=${adminUrl}`,`DATABASE_URL=${appUrl.toString()}`,''].join('\n');
  await writeFile('.env.provisioning',updated,{mode:0o600});await rename('.env.provisioning','.env');await chmod('.env',0o600);
  console.log('Restricted server role configured. Administration and server connections are separate.');
}catch(error){await client.query('ROLLBACK');throw error;}
finally{client.release();await pool.end();}
