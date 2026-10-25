import { readFileSync } from 'node:fs';
import { inspectPackage,previewPackage,sandboxEncounter,type syntheticBuilds } from '../src/domains/content-studio.js';
import { validateContent } from '../src/domains/content.js';
try{
 const input=JSON.parse(readFileSync(0,'utf8'));let result:unknown;
 // Malformed envelopes are rejected before attempting diagnostics/preview.
 if(!input.package||!Array.isArray(input.package.entities))throw Error('INVALID_CONTENT_PACKAGE');
 if(input.operation==='analyze')result=inspectPackage(input.package);
 else {validateContent(input.package);if(input.operation==='preview')result=previewPackage(input.package,input.known??{},input.mode);
 else if(input.operation==='sandbox')result=sandboxEncounter(input.package,input.encounterId,input.build,input.seed);
 else throw Error('UNKNOWN_STUDIO_OPERATION');}
 console.log(JSON.stringify(result));
}catch(error){console.error(error instanceof Error?error.message:'Invalid Studio input');process.exitCode=1;}
