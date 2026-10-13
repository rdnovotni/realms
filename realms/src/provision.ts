import { provisionRole } from './provision-role.js';
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
  await provisionRole(client,password);
  await client.query('COMMIT');
  const appUrl=new URL(adminUrl);appUrl.username='realms_app';appUrl.password=password;
  const text=await readFile('.env','utf8'),values=text.split('\n').filter(line=>!line.startsWith('DATABASE_URL=')&&!line.startsWith('DATABASE_ADMIN_URL='));
  const updated=[...values.filter(Boolean),`DATABASE_ADMIN_URL=${adminUrl}`,`DATABASE_URL=${appUrl.toString()}`,''].join('\n');
  await writeFile('.env.provisioning',updated,{mode:0o600});await rename('.env.provisioning','.env');await chmod('.env',0o600);
  console.log('Restricted server role configured. Administration and server connections are separate.');
}catch(error){await client.query('ROLLBACK');throw error;}
finally{client.release();await pool.end();}
