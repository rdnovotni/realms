import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { Authentication } from './config.js';

const policy="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
export function registerClient(app:FastifyInstance,auth:Authentication) {
 app.get('/api/v1/client/config',async(_request,reply)=>reply.header('Cache-Control','no-store').send({protocolVersion:1,authMode:auth.mode}));
 const assets=[['/','../client/index.html','text/html; charset=utf-8'],['/assets/styles.css','../client/styles.css','text/css; charset=utf-8'],...['app','api','session','views','types','equipment'].map(name=>[`/assets/${name}.js`,`../dist/client/${name}.js`,'text/javascript; charset=utf-8'])] as const;
 for(const [route,path,type] of assets)app.get(route!,async(_request,reply)=>{
  reply.header('Content-Security-Policy',policy).header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer').header('Cache-Control','no-store');
  try{return reply.type(type!).send(await readFile(new URL(path!,import.meta.url)));}
  catch{return reply.code(503).type('text/plain').send('The client is not built yet. Run npm run build and try again.');}
 });
}
