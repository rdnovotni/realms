import Fastify from 'fastify';
import { readFile } from 'node:fs/promises';
import { visualManifest } from './visual-contract.mjs';
import { registerClient } from '../src/client-assets.js';
const app=Fastify();registerClient(app,{mode:'sessions',throttleKey:'unused-static-reference'},{previewOnly:true});
const scenes=['overview','progression','abilities','statistics','history','inventory','paperdoll','inspector','comparison','loadouts','adventure','combat','dialog','empty','loading','error','setup','stress','daily','daily-waiting','daily-confirmation','daily-loading','daily-error','daily-readonly','consumption','consumption-overdrunk','consumption-empty','consumption-loading','consumption-error','consumption-readonly','consumption-running','consumption-nightcap','consumption-meal','adventure-overdrunk'];
const modes=['normal','motion','contrast','forced','text200','coarse'];
const css=['folio','styles','welcome','shell','character-folio','inventory-folio','campaign-folio','interactions'];
app.get('/dev/manifest',async(_request,reply)=>reply.header('Cache-Control','no-store').send(visualManifest()));
const querySchema={type:'object',additionalProperties:false,properties:{scene:{type:'string',enum:scenes},mode:{type:'string',enum:modes},texture:{type:'string',enum:['on','off']}}}as const;
app.get<{Querystring:{scene?:string;mode?:string;texture?:string}}>('/dev/visual',{schema:{querystring:querySchema}},async(request,reply)=>{
 let html=await readFile(new URL('../client/index.html',import.meta.url),'utf8');
 html=html.replace('/assets/app.js','/assets/dev/visual-reference.js').replace(/href="\/assets\/([\w-]+)\.css"/g,(_m,name)=>'href="/dev/styles/'+name+'.css?mode='+ (request.query.mode??'normal')+'"');
 if(request.query.texture==='off')html=html.replace('<html lang="en">','<html lang="en" data-folio-texture="off">');
 return reply.header('Cache-Control','no-store').header('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'").type('text/html').send(html);
});
app.get('/assets/dev/consumption-fixture.js',async(_request,reply)=>reply.header('Cache-Control','no-store').type('text/javascript').send(await readFile(new URL('../dist/client/dev/consumption-fixture.js',import.meta.url))));
app.get('/assets/dev/turn-fixture.js',async(_request,reply)=>reply.header('Cache-Control','no-store').type('text/javascript').send(await readFile(new URL('../dist/client/dev/turn-fixture.js',import.meta.url))));
app.get('/assets/dev/visual-reference.js',async(_request,reply)=>reply.header('Cache-Control','no-store').type('text/javascript').send(await readFile(new URL('../dist/client/dev/visual-reference.js',import.meta.url))));
app.get<{Params:{name:string};Querystring:{mode?:string}}>('/dev/styles/:name.css',async(request,reply)=>{
 if(!css.includes(request.params.name)||!modes.includes(request.query.mode??'normal'))return reply.code(404).send();
 let source=await readFile(new URL('../client/'+request.params.name+'.css',import.meta.url),'utf8');
 const pattern=request.query.mode==='coarse'?/@media\s*\(\s*pointer\s*:\s*coarse\s*\)/g:request.query.mode==='motion'?/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/g:request.query.mode==='contrast'?/@media\s*\(\s*prefers-contrast\s*:\s*more\s*\)/g:request.query.mode==='forced'?/@media\s*\(\s*forced-colors\s*:\s*active\s*\)/g:null;
 if(pattern)source=source.replace(pattern,'@media all');
 if(request.query.mode==='text200'&&request.params.name==='folio')source+='\n:root {font-size:32px!important;}';
 return reply.header('Cache-Control','no-store').type('text/css').send(source);
});
app.get<{Params:{name:string}}>('/dev/fixture/:name',async(request,reply)=>{
 if(!['character','pack','combat','setup','adventure'].includes(request.params.name))return reply.code(404).send();
 return reply.header('Cache-Control','no-store').type('application/json').send(await readFile(new URL('../test/visual-fixtures/'+request.params.name+'.json',import.meta.url)));
});
await app.listen({host:'127.0.0.1',port:3012});console.log('Frozen visual reference: http://127.0.0.1:3012/dev/visual · no database or gameplay writes');
for(const signal of ['SIGINT','SIGTERM']as const)process.once(signal,()=>void app.close());
