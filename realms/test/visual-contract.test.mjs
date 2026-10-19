import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { visualManifest,checkReports } from '../scripts/visual-contract.mjs';
test('frozen fixtures contain public, internally consistent scoped read models and no credentials',()=>{
 for(const name of ['character','pack','combat','setup','adventure']){const raw=readFileSync(new URL('./visual-fixtures/'+name+'.json',import.meta.url),'utf8'),f=JSON.parse(raw);assert.equal(f.schemaVersion,1);assert.doesNotMatch(raw,/"(?:password|token|authorization|throttleKey)"\s*:/i);const run=f.snapshot.game.run;assert.equal(f.snapshot.progression.revision,run.revision);for(const projection of [f.inventory,f.advancement,f.equipmentPreview,f.characterStats,f.abilityBook,f.characterHistory].filter(Boolean)){assert.equal(projection.runId,run.runId);assert.equal(projection.revision,run.revision);}for(const item of f.inventory?.items??[])assert.equal(item.inspectionToken,'');}
});
test('visual source manifest is deterministic and rejects stale or invalid browser evidence',()=>{
 const m=visualManifest();assert.deepEqual(visualManifest(),m);assert.match(m.sha256,/^[a-f0-9]{64}$/);
 const reports=[];for(const scene of ['overview','progression','inventory','paperdoll','inspector','adventure','combat','dialog','history','abilities'])for(const width of [320,375,768,1024,1440,1920])reports.push({scene,mode:'normal',manifest:m.sha256,horizontalOverflow:false,unnamedControls:0,tileCollisions:0,decorativeSvgErrors:0,headingSkips:0,smallTargets:0,contrastFailures:[],filteredItemArt:0,viewport:{width,height:1000}});
 for(const mode of ['motion','contrast','forced','text200'])reports.push({...reports[0],mode});assert.doesNotThrow(()=>checkReports(reports,m));
 const broken=structuredClone(reports);broken[0].tileCollisions=1;assert.throws(()=>checkReports(broken,m),/footer collision/);
 broken[0]={...reports[0],manifest:'stale'};assert.throws(()=>checkReports(broken,m),/sources changed/);
 assert.throws(()=>checkReports(reports.filter(r=>r.viewport.width!==1920),m),/Capture|1920/);
});
