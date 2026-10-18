import Fastify from 'fastify';
import { readFile } from 'node:fs/promises';
import { registerClient } from '../src/client-assets.js';

// Public screen preview only: no database, login route, or account secrets.
const app=Fastify();
registerClient(app,{mode:'sessions',throttleKey:'unused-in-visual-preview'},{previewOnly:true});
// This internal reference is deliberately absent from production registerClient.
app.get<{Querystring:{texture?:'off'}}>('/dev/folio',{schema:{querystring:{type:'object',additionalProperties:false,properties:{texture:{type:'string',enum:['off']}}}}},async(request,reply)=>{
 const html=await readFile(new URL('../client/folio-reference.html',import.meta.url),'utf8');
 return reply.header('Cache-Control','no-store').header('Content-Security-Policy',"default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'").type('text/html').send(request.query.texture==='off'?html.replace('<html lang="en">','<html lang="en" data-folio-texture="off">'):html);
});
await app.listen({host:'127.0.0.1',port:3010});
console.log('Follybound front-page preview: http://127.0.0.1:3010/');
console.log('Visual preview only. Start the game server to use account login.');
for(const signal of ['SIGINT','SIGTERM']as const)process.once(signal,()=>{void app.close().then(()=>process.exit(0));});
