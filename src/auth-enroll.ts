import { lstat,readFile,mkdir,open,unlink } from 'node:fs/promises';
import { resolve,sep } from 'node:path';
import { poolFor } from './database.js';
import { enrollPassword } from './auth/sessions.js';
const input=resolve(process.argv[2]??'');
if(!input.startsWith(resolve('.state')+sep))throw new Error('Enrollment input must be a private file in .state');
const stat=await lstat(input);
if(!stat.isFile() || stat.isSymbolicLink() || (stat.mode&0o077)!==0)throw new Error('Enrollment input must be a regular owner-only file');
const data=JSON.parse(await readFile(input,'utf8'));
if(Object.keys(data).some(k=>!['accountId','handle','password'].includes(k)) ||
  typeof data.accountId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.accountId) ||
  typeof data.handle!=='string' || typeof data.password!=='string')throw new Error('Invalid enrollment input');
const url=process.env.DATABASE_ADMIN_URL;
if(!url || new URL(url).hostname!=='127.0.0.1' || new URL(url).pathname!=='/realms_dev')throw new Error('This enrollment command requires the local development administration connection');
await mkdir('.state/recovery',{recursive:true,mode:0o700});
const output=`.state/recovery/${data.accountId.toLowerCase()}.json`,file=await open(output,'wx',0o600),pool=poolFor(url);
let enrolled=false;
try{
  const result=await enrollPassword(pool,data.accountId,data.handle,data.password);enrolled=true;
  await file.writeFile(JSON.stringify(result,null,2)+'\n');await file.sync();
  console.log(`Password enrolled. One-time recovery codes saved privately to ${output}. Remove the plaintext enrollment input after verifying the recovery file.`);
}finally{await file.close();await pool.end();if(!enrolled)await unlink(output);}
