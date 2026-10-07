import { serverConfig } from './config.js';
import { poolFor,assertSchema,assertRuntimeRole } from './database.js';
import { buildApp } from './app.js';

const settings = serverConfig();
const pool = poolFor(settings.databaseUrl);
const app = buildApp(pool, settings.auth, true);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, async () => {
  await app.close(); await pool.end(); process.exit(0);
});
try { await assertSchema(pool);await assertRuntimeRole(pool);await app.listen({ host: settings.host, port: settings.port }); }
catch { console.error('Server failed to start; check port and local configuration.'); await pool.end(); process.exitCode = 1; }
