import {readFileSync} from 'node:fs';
import { DisposableCache } from './cache.js';
import { serverConfig } from './config.js';
import { poolFor,assertSchema,assertRuntimeRole } from './database.js';
import { buildApp,type RuntimeLifecycle } from './app.js';
let settings:ReturnType<typeof serverConfig>;
try{settings=serverConfig();}catch{console.error(JSON.stringify({level:'error',event:'invalid_server_configuration'}));process.exit(1);}
const pool=poolFor(settings.databaseUrl);
const cache=process.env.CACHE_PASSWORD?new DisposableCache(process.env.CACHE_NAMESPACE??'',process.env.CACHE_PASSWORD):undefined;
const lifecycle:RuntimeLifecycle={draining:false,ready:false,check:async()=>{await assertSchema(pool);await assertRuntimeRole(pool);}};
const ingressKey=process.env.INGRESS_KEY_FILE?readFileSync(process.env.INGRESS_KEY_FILE,'utf8').trim():undefined;
if(ingressKey && !/^[0-9a-f]{64}$/.test(ingressKey))throw new Error('Invalid ingress credential');
const app=buildApp(pool,settings.auth,true,cache,lifecycle,ingressKey);
let shutdown:Promise<void>|undefined;
function stop(signal:string){
 if(shutdown)return shutdown;
 lifecycle.draining=true;lifecycle.ready=false;
 app.log.info({event:'server_draining',signal},'Draining requests');
 const deadline=setTimeout(()=>{console.error(JSON.stringify({level:'error',event:'shutdown_deadline'}));process.exit(1);},35000).unref();
 shutdown=(async()=>{
  try{await app.close();cache?.close();await pool.end();app.log.info({event:'server_stopped'},'Server stopped');}
  catch{process.exitCode=1;console.error(JSON.stringify({level:'error',event:'shutdown_failed'}));}
  finally{clearTimeout(deadline);}
 })();
 return shutdown;
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void stop(signal);});
// Listen even when PostgreSQL is temporarily unavailable. Readiness and API gating
// validate migrations and runtime privileges; a running listener is not readiness.
try{await app.listen({host:settings.host,port:settings.port});app.log.info({event:'server_listening'},'Server listening');}
catch{console.error(JSON.stringify({level:'error',event:'server_start_failed'}));cache?.close();await pool.end();process.exitCode=1;}
