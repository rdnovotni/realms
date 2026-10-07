import { config } from './config.js';
import { migrate, poolFor } from './database.js';
const pool = poolFor(process.env.DATABASE_ADMIN_URL ?? config().databaseUrl);
try { await migrate(pool); console.log('Database migrations applied.'); }
finally { await pool.end(); }
