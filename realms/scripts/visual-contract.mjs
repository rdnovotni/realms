/** Source gate + comparison of freshly recorded browser contracts; no browser emulator. */
import { readFileSync,readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const scenes=['overview','progression','abilities','statistics','history','inventory','paperdoll','inspector','comparison','loadouts','adventure','combat','dialog','empty','loading','error','setup','stress','daily','daily-waiting','daily-confirmation','daily-loading','daily-error','daily-readonly','consumption','consumption-overdrunk','consumption-empty','consumption-loading','consumption-error','consumption-readonly','consumption-running','consumption-nightcap','consumption-meal','adventure-overdrunk','combat-field','combat-boss','combat-shared-lobby','combat-shared-waiting','combat-shared-claim','combat-readonly','combat-preparation','combat-item-review','combat-manual','combat-log','combat-routine','noncombat','noncombat-empty','noncombat-loading','noncombat-error','noncombat-readonly','noncombat-resolved'];
const widths=[320,375,768,1024,1440,1920];
const preferenceScenes=['overview','progression','inventory','inspector','comparison','adventure','combat','dialog','daily','consumption','combat-field','combat-boss','combat-item-review','combat-shared-lobby','noncombat'];
const preferenceModes=['motion','contrast','forced','text200','coarse'];
export function requiredVisualCases(){
 return [...scenes.flatMap(scene=>widths.map(width=>({scene,mode:'normal',width}))),...preferenceScenes.flatMap(scene=>[320,1440].flatMap(width=>preferenceModes.map(mode=>({scene,mode,width}))))];
}
export function visualManifest(base=root){
 const walk=(path)=>readdirSync(new URL(path,base),{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path+entry.name+'/'):[path+entry.name]);
 const files=['client/index.html',...walk('client/art/'),...readdirSync(new URL('client/',base)).filter(n=>/\.(css|ts)$/.test(n)).map(n=>'client/'+n),...readdirSync(new URL('client/dev/',base)).filter(n=>n.endsWith('.ts')).map(n=>'client/dev/'+n),...['character','pack','combat','setup','adventure'].map(n=>'test/visual-fixtures/'+n+'.json')].sort();
 const hash=createHash('sha256');let bytes=0;
 for(const path of files){const data=readFileSync(new URL(path,base));hash.update(path+'\0');hash.update(data);bytes+=data.length;}
 return {schemaVersion:1,sha256:hash.digest('hex'),files:files.length,bytes};
}
export function checkReports(reports,manifest){
 assert.ok(Array.isArray(reports)&&reports.length>=requiredVisualCases().length,'Capture the documented responsive and preference matrix');
 for(const r of reports){assert.equal(r.manifest,manifest.sha256,'Visual sources changed: capture/review fresh browser evidence before updating the baseline');assert.equal(r.horizontalOverflow,false,r.scene+': horizontal overflow');assert.equal(r.unnamedControls,0,r.scene+': unnamed control');assert.equal(r.tileCollisions,0,r.scene+': tile footer collision');assert.equal(r.headerCollisions,0,r.scene+': header collision');assert.equal(r.headerOverflow,0,r.scene+': header overflow');assert.equal(r.decorativeSvgErrors,0,r.scene+': decorative SVG semantics');assert.equal(r.headingSkips,0,r.scene+': skipped heading level');assert.equal(r.smallTargets,0,r.scene+': target smaller than 24px');assert.deepEqual(r.contrastFailures,[],r.scene+': sampled text contrast');assert.equal(r.filteredItemArt,0,r.scene+': per-item visual filter');if(r.mode==='text200')assert.equal(r.bodyFont,'32px','Enlarged-text branch must double root text');if(r.mode==='motion'){assert.equal(r.mainTransition,'0s','Reduced motion must disable main transitions');assert.equal(r.maximumControlTransitionMs,0,'Reduced motion must disable control transitions');}if(['contrast','forced'].includes(r.mode))assert.equal(r.texture,'none','Contrast branches must disable grain');if(r.mode==='coarse')assert.equal(r.coarseSmallTargets,0,r.scene+': coarse target smaller than 44px');assert.ok(r.viewport.width>=320&&r.viewport.height>=600);}
 for(const {scene,mode,width} of requiredVisualCases())assert.ok(reports.some(r=>r.scene===scene&&r.mode===mode&&r.viewport.width===width),scene+': missing '+mode+' '+width+'px case');
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const actualIndex=process.argv.indexOf('--actual'),path=actualIndex>=0?process.argv[actualIndex+1]:'docs/screenshots/m03/browser-contracts.json';assert.ok(path,'Supply --actual report.json');
 const reports=JSON.parse(readFileSync(new URL(path,root),'utf8')),manifest=visualManifest();checkReports(reports,manifest);
 console.log(`Visual contract: ${reports.length} recorded browser checks match ${manifest.files} current visual sources/fixtures. ${actualIndex>=0?'Fresh report validated.':'Stored baseline validated; this command does not launch a browser or compare pixels.'}`);
}
