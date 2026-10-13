import { readFileSync } from 'node:fs';
import { migrate,poolFor,assertSchema } from '../dist/database.js';
import { importAuthoredContent } from '../dist/authored-content.js';
import { provisionScheduler } from '../dist/scheduler-role.js';
import { provisionRole } from '../dist/provision-role.js';
const name=process.env.DB_NAME;
if(!/^kol_(production|staging)$/.test(name??'')) throw new Error('Explicit project database required');
const password=readFileSync('/run/secrets/migration_password','utf8').trim();
const pool=poolFor(`postgresql://realms_migrator:${password}@db:5432/${name}`);
try {
  await migrate(pool);
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await provisionRole(client,'',{manageRole:false,databaseName:name});
    await client.query(`GRANT USAGE ON SCHEMA public TO realms_worker;
      REVOKE ALL ON ALL TABLES IN SCHEMA public FROM realms_worker;
      REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM realms_worker;
      GRANT SELECT ON schema_migrations,action_receipts TO realms_worker;
      GRANT SELECT,INSERT,UPDATE ON durable_jobs TO realms_worker;
      GRANT SELECT,UPDATE(delivered_at) ON outbox_events TO realms_worker;
      GRANT SELECT,INSERT ON job_execution_receipts,job_execution_log TO realms_worker;
      GRANT USAGE,SELECT ON SEQUENCE job_execution_log_id_seq TO realms_worker;`);
    await provisionScheduler(client);
    await client.query('COMMIT');
  } catch(error) {await client.query('ROLLBACK');throw error;}
  finally {client.release();}
  await assertSchema(pool);
  await importAuthoredContent(pool);
  console.log('Existing backend migrations and restricted application grants verified.');
} finally {await pool.end();}
