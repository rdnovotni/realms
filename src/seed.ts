import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { poolFor } from './database.js';
const settings = config();
const pool = poolFor(settings.databaseUrl);
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('INSERT INTO accounts(id) VALUES($1) ON CONFLICT DO NOTHING', [settings.accountId]);
  await client.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE', [settings.accountId]);
  await client.query('INSERT INTO characters(id,account_id) VALUES($1,$2) ON CONFLICT(account_id) DO NOTHING', [randomUUID(), settings.accountId]);
  await client.query('INSERT INTO runs(id,character_id,turns) SELECT $1,id,400 FROM characters WHERE account_id=$2 ON CONFLICT DO NOTHING', [randomUUID(), settings.accountId]);
  await client.query('COMMIT');
  console.log('Development account initialized; existing Turns preserved.');
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { client.release(); await pool.end(); }
