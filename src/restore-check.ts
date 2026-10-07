import { poolFor,assertSchema } from './database.js';
const url=process.env.RESTORE_DATABASE_URL;
if(!url || !/^\/realms_restore_[a-f0-9]{16}$/.test(new URL(url).pathname)) throw new Error('Restore verification requires its disposable database');
const pool=poolFor(url);
try{
  await assertSchema(pool);
  const count=(await pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")).rows[0].n;
  const validation=(await pool.query("SELECT count(*)::int AS n FROM pg_constraint WHERE contype IN('c','f') AND NOT convalidated")).rows[0].n;
  if(validation!==0)throw new Error('Restored constraints have not been validated');
  const totals=(await pool.query(`SELECT w.currency_id,sum(w.balance)::text AS balance FROM wallets w GROUP BY currency_id HAVING sum(w.balance)<>0`)).rows;
  if(totals.length)throw new Error('Restored currency totals are not conserved');
  console.log(`Restore verified: ${count} tables, matching migration checksums, validated constraints, conserved currencies.`);
}finally{await pool.end();}
