import {readFileSync} from 'node:fs';
try{if(Date.now()-Number(readFileSync('/tmp/scheduler-heartbeat','utf8'))>30000)process.exit(1);}catch{process.exit(1);}
