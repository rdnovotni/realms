import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL,fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { visualManifest,checkReports,requiredVisualCases } from '../scripts/visual-contract.mjs';
test('frozen fixtures contain public, internally consistent scoped read models and no credentials',()=>{
 for(const name of ['character','pack','combat','setup','adventure']){const raw=readFileSync(new URL('./visual-fixtures/'+name+'.json',import.meta.url),'utf8'),f=JSON.parse(raw);assert.equal(f.schemaVersion,1);assert.doesNotMatch(raw,/"(?:password|token|authorization|throttleKey)"\s*:/i);const run=f.snapshot.game.run;assert.equal(f.snapshot.progression.revision,run.revision);for(const projection of [f.inventory,f.advancement,f.equipmentPreview,f.characterStats,f.abilityBook,f.characterHistory].filter(Boolean)){assert.equal(projection.runId,run.runId);assert.equal(projection.revision,run.revision);}for(const item of f.inventory?.items??[])assert.equal(item.inspectionToken,'');}
});
test('visual source manifest is deterministic and rejects stale or invalid browser evidence',()=>{
 const m=visualManifest();assert.deepEqual(visualManifest(),m);assert.match(m.sha256,/^[a-f0-9]{64}$/);
 const reports=requiredVisualCases().map(({scene,mode,width})=>({scene,mode,manifest:m.sha256,horizontalOverflow:false,unnamedControls:0,tileCollisions:0,headerCollisions:0,headerOverflow:0,decorativeSvgErrors:0,headingSkips:0,smallTargets:0,contrastFailures:[],filteredItemArt:0,viewport:{width,height:1000},bodyFont:mode==='text200'?'32px':'16px',texture:['contrast','forced'].includes(mode)?'none':'grain',mainTransition:'0s',maximumControlTransitionMs:0,coarseSmallTargets:0}));
 assert.equal(reports.length,410);
 assert.doesNotThrow(()=>checkReports(reports,m));
 for(const [mode,key,value] of [['text200','bodyFont','16px'],['contrast','texture','grain'],['forced','texture','grain'],['motion','maximumControlTransitionMs',120],['coarse','coarseSmallTargets',1]]){const invalid=structuredClone(reports);invalid.find(r=>r.mode===mode)[key]=value;assert.throws(()=>checkReports(invalid,m));}
 const cliDir=mkdtempSync(tmpdir()+'/folio-contract-');try{const path=cliDir+'/reports.json';writeFileSync(path,JSON.stringify(reports));const cli=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/visual-contract.mjs',import.meta.url)),'--actual',path],{encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);assert.match(cli.stdout,/Fresh report validated/);}finally{rmSync(cliDir,{recursive:true,force:true});}
 for(const key of ['headerCollisions','headerOverflow']){const overlap=structuredClone(reports);overlap.find(r=>r.scene==='inventory'&&r.viewport.width===375)[key]=1;assert.throws(()=>checkReports(overlap,m),/header/);}
 for(const [scene,mode,width] of [['abilities','normal',375],['comparison','text200',1440],['combat','coarse',320]]){const omitted=reports.filter(r=>!(r.scene===scene&&r.mode===mode&&r.viewport.width===width));omitted.push({...omitted[0]});assert.throws(()=>checkReports(omitted,m),/missing/);}
 const broken=structuredClone(reports);broken[0].tileCollisions=1;assert.throws(()=>checkReports(broken,m),/footer collision/);
 broken[0]={...reports[0],manifest:'stale'};assert.throws(()=>checkReports(broken,m),/sources changed/);
 assert.throws(()=>checkReports(reports.filter(r=>r.viewport.width!==1920),m),/Capture|1920/);
});

test('HTML and nested artwork additions, edits and removals invalidate visual evidence',()=>{
 const dir=mkdtempSync(tmpdir()+'/folio-manifest-'),base=pathToFileURL(dir+'/');
 try{for(const path of ['client/dev','client/art/items','test/visual-fixtures'])mkdirSync(dir+'/'+path,{recursive:true});for(const name of ['character','pack','combat','setup','adventure'])writeFileSync(dir+'/test/visual-fixtures/'+name+'.json','{}');writeFileSync(dir+'/client/index.html','<main>One</main>');
 const original=visualManifest(base);writeFileSync(dir+'/client/index.html','<main>Two</main>');assert.notEqual(visualManifest(base).sha256,original.sha256);
 const html=visualManifest(base);writeFileSync(dir+'/client/art/items/item.svg','<svg/>');const art=visualManifest(base);assert.notEqual(art.sha256,html.sha256);writeFileSync(dir+'/client/art/items/item.svg','<svg><path/></svg>');assert.notEqual(visualManifest(base).sha256,art.sha256);rmSync(dir+'/client/art/items/item.svg');assert.equal(visualManifest(base).sha256,html.sha256);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
