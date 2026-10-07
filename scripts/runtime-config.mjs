import { parseEnv } from 'node:util';
import { readFile,writeFile,rename,chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const source=parseEnv(await readFile('.env','utf8'));
const mode=source.AUTH_MODE??'development';
if(!['development','sessions'].includes(mode)) throw new Error('Invalid AUTH_MODE');
if(mode==='sessions' && !/^[0-9a-f]{64}$/.test(source.AUTH_THROTTLE_KEY??'')){
  source.AUTH_THROTTLE_KEY=randomBytes(32).toString('hex');
  const original=await readFile('.env','utf8');
  if(/^AUTH_THROTTLE_KEY=/m.test(original)) throw new Error('Fix the existing authentication throttle key before startup');
  await writeFile('.env.runtime-config',original.trimEnd()+'\nAUTH_THROTTLE_KEY='+source.AUTH_THROTTLE_KEY+'\n',{mode:0o600});
  await rename('.env.runtime-config','.env');await chmod('.env',0o600);
}
const keys=['HOST','PORT','DATABASE_URL',...(mode==='development'?['DEV_API_TOKEN','DEV_ACCOUNT_ID']:['AUTH_THROTTLE_KEY'])];
const lines=['AUTH_MODE='+mode];
for(const key of keys){const value=source[key];if(value!==undefined){if(/[\r\n\0]/.test(value))throw new Error('Invalid runtime configuration value');lines.push(key+'='+JSON.stringify(value));}}
await writeFile('.state/runtime.env.tmp',lines.join('\n')+'\n',{mode:0o600});
await rename('.state/runtime.env.tmp','.state/runtime.env');await chmod('.state/runtime.env',0o600);
console.log('Runtime configuration prepared without administration or test credentials.');
