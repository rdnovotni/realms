import { config } from './config.js';
import { poolFor } from './database.js';
import { integrityReport,unindexedForeignKeys } from './foundation/integrity.js';
const pool=poolFor(config().databaseUrl);
try{
  const data=await integrityReport(pool),indexes=await unindexedForeignKeys(pool);
  console.log(JSON.stringify({integrity:data,unindexedForeignKeys:indexes},null,2));
  if(Object.values(data).some(n=>n!==0) || indexes.length)process.exitCode=1;
}finally{await pool.end();}
