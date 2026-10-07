import { config } from './config.js';
import { migrate, poolFor } from './database.js';
const pool = poolFor(config().databaseUrl);
try { await migrate(pool); console.log('Database migrations applied.'); }
finally { await pool.end(); }
