/** Source gate + comparison of freshly recorded browser contracts; no browser emulator. */
import { readFileSync,readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
export function visualManifest(){
 const files=[...readdirSync(new URL('client/',root)).filter(n=>/\.(css|ts)$/.test(n)).map(n=>'client/'+n),...readdirSync(new URL('client/dev/',root)).filter(n=>n.endsWith('.ts')).map(n=>'client/dev/'+n),...['character','pack','combat','setup','adventure'].map(n=>'test/visual-fixtures/'+n+'.json')].sort();
 const hash=createHash('sha256');let bytes=0;
 for(const path of files){const data=readFileSync(new URL(path,root));hash.update(path+'\0');hash.update(data);bytes+=data.length;}
 return {schemaVersion:1,sha256:hash.digest('hex'),files:files.length,bytes};
}
export function checkReports(reports,manifest){
 assert.ok(Array.isArray(reports)&&reports.length>=60,'Capture the documented responsive and preference matrix');
 for(const r of reports){assert.equal(r.manifest,manifest.sha256,'Visual sources changed: capture/review fresh browser evidence before updating the baseline');assert.equal(r.horizontalOverflow,false,r.scene+': horizontal overflow');assert.equal(r.unnamedControls,0,r.scene+': unnamed control');assert.equal(r.tileCollisions,0,r.scene+': tile footer collision');assert.equal(r.decorativeSvgErrors,0,r.scene+': decorative SVG semantics');assert.equal(r.headingSkips,0,r.scene+': skipped heading level');assert.equal(r.smallTargets,0,r.scene+': target smaller than 24px');assert.deepEqual(r.contrastFailures,[],r.scene+': sampled text contrast');assert.equal(r.filteredItemArt,0,r.scene+': per-item visual filter');if(r.mode==='coarse')assert.equal(r.coarseSmallTargets,0,r.scene+': coarse target smaller than 44px');assert.ok(r.viewport.width>=320&&r.viewport.height>=600);}
 for(const scene of ['overview','progression','inventory','paperdoll','inspector','adventure','combat','dialog'])for(const width of [320,375,768,1024,1440,1920])assert.ok(reports.some(r=>r.scene===scene&&r.mode==='normal'&&r.viewport.width===width),scene+': missing '+width+'px baseline');
 for(const mode of ['motion','contrast','forced','text200'])assert.ok(reports.some(r=>r.mode===mode),'Missing projected '+mode+' CSS branch');
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const actualIndex=process.argv.indexOf('--actual'),path=actualIndex>=0?process.argv[actualIndex+1]:'docs/screenshots/vis-07/browser-contracts.json';assert.ok(path,'Supply --actual report.json');
 const reports=JSON.parse(readFileSync(new URL(path,root),'utf8')),manifest=visualManifest();checkReports(reports,manifest);
 console.log(`Visual contract: ${reports.length} recorded browser checks match ${manifest.files} current visual sources/fixtures. ${actualIndex>=0?'Fresh report validated.':'Stored baseline validated; this command does not launch a browser or compare pixels.'}`);
}
