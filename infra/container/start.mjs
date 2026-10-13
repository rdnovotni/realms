import { readFileSync } from 'node:fs';
const secret=name=>readFileSync(`/run/secrets/${name}`,'utf8').trim();
// The administrative password is never mounted in this container.
const name=process.env.DB_NAME;
if(!/^kol_(production|staging)$/.test(name??''))throw new Error('Explicit project database required');
process.env.DATABASE_URL=`postgresql://realms_app:${encodeURIComponent(secret('app_password'))}@db:5432/${name}`;
process.env.CACHE_PASSWORD=secret('cache_password');
process.env.AUTH_MODE='sessions';
process.env.AUTH_THROTTLE_KEY=secret('throttle_key');
process.env.HOST='0.0.0.0';
process.env.PORT='3000';
process.env.KOL_CONTAINER_BIND='1';
await import('../dist/main.js');
