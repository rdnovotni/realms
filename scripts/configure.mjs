import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
mkdirSync('.state', { recursive: true, mode: 0o700 });
chmodSync('.state', 0o700);
if (!existsSync('.state/db-password')) writeFileSync('.state/db-password', randomBytes(32).toString('hex'), { mode: 0o600 });
const password = readFileSync('.state/db-password', 'utf8').trim();
if (!existsSync('.env')) {
  writeFileSync('.env', [
    'HOST=127.0.0.1', 'PORT=3000',
    `DATABASE_URL=postgresql://realms:${password}@127.0.0.1:55432/realms_dev`,
    `TEST_DATABASE_URL=postgresql://realms:${password}@127.0.0.1:55432/realms_test`,
    `DEV_API_TOKEN=${randomBytes(32).toString('hex')}`, `DEV_ACCOUNT_ID=${randomUUID()}`, ''
  ].join('\n'), { mode: 0o600 });
}
chmodSync('.env', 0o600);
console.log('Private local configuration ready; credentials were not printed.');
