import {statSync} from 'node:fs';
try{process.exit(Date.now()-statSync('/tmp/worker-heartbeat').mtimeMs<25000?0:1);}catch{process.exit(1);}
