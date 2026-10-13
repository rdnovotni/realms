import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { poolFor } from './database.js';
import { publishContent } from './domains/content.js';
const settings = config();
const pool = poolFor(process.env.DATABASE_ADMIN_URL ?? settings.databaseUrl);
const release=await publishContent(pool,{version:'foundation-1',engineVersion:'foundation-1',entities:[{
  id:'tuning.turns',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'Development Turns policy',dependencies:[],public:{},mechanics:{initialTurns:100,rolloverGrant:100,softCap:400}}
}]});
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('INSERT INTO accounts(id) VALUES($1) ON CONFLICT DO NOTHING', [settings.accountId]);
  await client.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE', [settings.accountId]);
  await client.query('INSERT INTO characters(id,account_id) VALUES($1,$2) ON CONFLICT(account_id) DO NOTHING', [randomUUID(), settings.accountId]);
  await client.query('INSERT INTO runs(id,character_id,turns,content_release_id,rules_version) SELECT $1,id,100,$3,$4 FROM characters WHERE account_id=$2 ON CONFLICT DO NOTHING', [randomUUID(), settings.accountId,release,'foundation-1']);
  await client.query(`UPDATE runs SET content_release_id=$1,rules_version='foundation-1' WHERE content_release_id IS NULL AND character_id IN(SELECT id FROM characters WHERE account_id=$2)`,[release,settings.accountId]);
  await client.query('INSERT INTO run_progression(run_id) SELECT id FROM runs ON CONFLICT DO NOTHING');
  await client.query('INSERT INTO run_consumption(run_id) SELECT id FROM runs ON CONFLICT DO NOTHING');
  await client.query(`INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE kind='RUN' ON CONFLICT DO NOTHING`);
  await client.query(`INSERT INTO inventory_containers(scope_id,kind) SELECT id,'LEGACY' FROM state_scopes WHERE kind='ACCOUNT' ON CONFLICT DO NOTHING`);
  await client.query(`INSERT INTO wallets(scope_id,currency_id,purpose) SELECT id,'GOLD','PLAYER' FROM state_scopes WHERE kind='ACCOUNT' ON CONFLICT DO NOTHING`);
  await client.query(`INSERT INTO worlds(name) VALUES('development') ON CONFLICT DO NOTHING`);
  await client.query(`INSERT INTO wallets(scope_id,currency_id,purpose) SELECT s.id,'GOLD','FAUCET_SINK' FROM state_scopes s JOIN worlds w ON w.id=s.world_id WHERE w.name='development' ON CONFLICT DO NOTHING`);
  await client.query('COMMIT');
  console.log('Development account initialized; existing Turns preserved.');
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { client.release(); await pool.end(); }
