import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { Authentication } from './config.js';

const policy="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
export function registerClient(app:FastifyInstance,auth:Authentication,options:{previewOnly?:boolean}={}) {
 app.get('/api/v1/client/config',async(_request,reply)=>reply.header('Cache-Control','no-store').send({protocolVersion:1,authMode:auth.mode,...(options.previewOnly?{previewOnly:true}:{})}));
 const assets=[...['/','/about','/announcements','/changelog','/guide','/community','/newsletter','/privacy','/monetization','/contact'].map(route=>[route,'../client/index.html','text/html; charset=utf-8']),['/assets/styles.css','../client/styles.css','text/css; charset=utf-8'],['/assets/welcome.css','../client/welcome.css','text/css; charset=utf-8'],['/assets/folio.css','../client/folio.css','text/css; charset=utf-8'],['/assets/shell.css','../client/shell.css','text/css; charset=utf-8'],['/assets/inventory-folio.css','../client/inventory-folio.css','text/css; charset=utf-8'],['/assets/interactions.css','../client/interactions.css','text/css; charset=utf-8'],['/assets/campaign-folio.css','../client/campaign-folio.css','text/css; charset=utf-8'],['/assets/character-folio.css','../client/character-folio.css','text/css; charset=utf-8'],['/assets/folio-grain.svg','../client/art/folio-grain.svg','image/svg+xml'],['/assets/realms-tavern.webp','../client/art/realms-tavern.webp','image/webp'],['/assets/realms-dawn.webp','../client/art/realms-dawn.webp','image/webp'],...['sword','greatsword','shield','ring','charm','medallion','compass','ore','vial','satchel','helmet','boots','armor'].map(name=>[`/assets/items/${name}.svg`,`../client/art/items/${name}.svg`,'image/svg+xml']),...['icons','notes','interactions','campaign','campaign-model','equipment-presentation','character-icons','character-presentation','character-presentation-model','shell','shell-model','app','api','session','views','types','character','character-model','character-book','character-book-model','character-history','character-history-model','character-preferences','section-navigation','advancement','advancement-model','advancement-controls','growth','equipment','landing','inventory','paperdoll','item-tiles','item-art','equipment-picker','equipment-drag','equipment-preview','item-context-menu','inventory-activation','inventory-usability','inventory-services','item-comparison','loadout-manager'].map(name=>[`/assets/${name}.js`,`../dist/client/${name}.js`,'text/javascript; charset=utf-8'])] as const;
 // Only local authored raster assets with bounded filenames are served.
 app.get<{Params:{name:string}}>('/assets/items/authored/:name',async(request,reply)=>{
  const name=request.params.name;if(!/^[a-z0-9][a-z0-9_-]{0,79}\.(png|webp|jpg|avif)$/.test(name))return reply.code(404).send();
  reply.header('Content-Security-Policy',policy).header('X-Content-Type-Options','nosniff').header('Cache-Control','no-store');
  try{return reply.type(name.endsWith('.jpg')?'image/jpeg':`image/${name.split('.').pop()}`).send(await readFile(new URL(`../client/art/items/authored/${name}`,import.meta.url)));}catch{return reply.code(404).send();}
 });
 for(const [route,path,type] of assets)app.get(route!,async(_request,reply)=>{
  reply.header('Content-Security-Policy',policy).header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer').header('Cache-Control','no-store');
  try{return reply.type(type!).send(await readFile(new URL(path!,import.meta.url)));}
  catch{return reply.code(503).type('text/plain').send('The client is not built yet. Run npm run build and try again.');}
 });
}
