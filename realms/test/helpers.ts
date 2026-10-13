import { randomUUID } from 'node:crypto';
import { migrate,poolFor } from '../src/database.js';
import { publishContent } from '../src/domains/content.js';
export async function testDatabase(applyMigrations=true){
  const url=process.env.TEST_DATABASE_URL;
  if(!url || new URL(url).pathname!=='/realms_test') throw new Error('Tests require the separate realms_test database');
  const admin=poolFor(url),schema=`test_${randomUUID().replaceAll('-','')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool=poolFor(url,schema);
  try{if(applyMigrations)await migrate(pool);}catch(error){await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();throw error;}
  return {pool,schema,close:async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}};
}
export async function actor(pool:ReturnType<typeof poolFor>,release:string|null=null,turns=3,mode='STANDARD'){
  release??=await publishContent(pool,{version:'empty-fixture',engineVersion:'foundation-1',entities:[]});
  const account=randomUUID(),character=randomUUID(),run=randomUUID();
  await pool.query('INSERT INTO accounts(id) VALUES($1)',[account]);
  await pool.query('INSERT INTO characters(id,account_id) VALUES($1,$2)',[character,account]);
  await pool.query('INSERT INTO runs(id,character_id,turns,content_release_id,mode) VALUES($1,$2,$3,$4,$5)',[run,character,turns,release,mode]);
  await pool.query('INSERT INTO run_consumption(run_id) VALUES($1)',[run]);
  await pool.query('INSERT INTO run_progression(run_id) VALUES($1)',[run]);
  return {account,character,run};
}
