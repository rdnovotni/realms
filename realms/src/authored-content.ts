import { readFile } from 'node:fs/promises';
import type pg from 'pg';
import { publishContent } from './domains/content.js';
// Definitions are sealed through the existing migration role. Runs retain their pinned release.
export async function importAuthoredContent(pool:pg.Pool,path='/app/content/game.json') {
  let text:string;
  try {text=await readFile(path,'utf8');}
  catch(error) {if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  const input=JSON.parse(text) as {entities?:unknown[]};
  if(input.entities?.length===0)return;
  const id=await publishContent(pool,input);
  console.log('Authored definitions sealed:',id,'; existing runs retain their content version.');
}
