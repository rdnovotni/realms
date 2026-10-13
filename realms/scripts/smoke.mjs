import assert from 'node:assert/strict';
const base=new URL(process.env.SMOKE_BASE_URL??`http://127.0.0.1:${process.env.PORT??3000}`);
if(base.protocol!=='http:'||!['127.0.0.1','localhost'].includes(base.hostname))throw new Error('Smoke must target a local API');
for(const path of ['/health/live','/health/ready'])assert.equal((await fetch(new URL(path,base),{signal:AbortSignal.timeout(7000)})).status,200);
assert.equal((await fetch(new URL('/api/v1/state',base),{signal:AbortSignal.timeout(7000)})).status,401);
console.log('Local health and unauthenticated access boundaries passed. Full container acceptance uses backend.py.');
