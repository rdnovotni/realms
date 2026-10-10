import Fastify from 'fastify';
import { registerClient } from '../src/client-assets.js';

// Public screen preview only: no database, login route, or account secrets.
const app=Fastify();
registerClient(app,{mode:'sessions',throttleKey:'unused-in-visual-preview'},{previewOnly:true});
await app.listen({host:'127.0.0.1',port:3010});
console.log('Realms front-page preview: http://127.0.0.1:3010/');
console.log('Visual preview only. Start the game server to use account login.');
for(const signal of ['SIGINT','SIGTERM']as const)process.once(signal,()=>{void app.close().then(()=>process.exit(0));});
