import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectPackage,previewPackage,sandboxEncounter } from '../src/domains/content-studio.js';
import { validateContent,type ContentPackage } from '../src/domains/content.js';
import { questDiagnostics,type QuestGraph } from '../src/domains/quest-content.js';
const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/studio-demo.json',import.meta.url),'utf8')) as ContentPackage;
const graph=(p:ContentPackage)=>p.entities.find(e=>e.kind==='QUEST')!.definition.mechanics!.questObjectives as unknown as QuestGraph;
test('author quest graphs reject dead ends, unreachable outcomes and duplicate principal rewards before seal',()=>{
 const p=fixture();validateContent(p);const q=graph(p);q.nodes.push({id:'unreachable',name:'Unreachable ending',type:'OUTCOME',next:[],outcome:'SUCCESS'},{id:'duplicate',name:'Duplicate reward',type:'OBJECTIVE',next:[],rewardKey:'cart.recovered'});
 const codes=questDiagnostics(q).map(d=>d.code);assert.ok(codes.includes('QUEST_DUPLICATE_REWARD'));assert.ok(codes.includes('QUEST_DEAD_END'));assert.ok(codes.includes('QUEST_UNREACHABLE'));assert.throws(()=>validateContent(p),/QUEST_/);assert.equal(inspectPackage(p).valid,false);
});
test('a reachable loop without an exit is rejected while alternative routes share one objective claim',()=>{
 const p=fixture(),q=graph(p);assert.deepEqual(questDiagnostics(q),[]);q.nodes[1]!.next=['recover'];const codes=questDiagnostics(q).map(d=>d.code);assert.ok(codes.includes('QUEST_NO_OUTCOME'));assert.ok(codes.includes('QUEST_UNREACHABLE'));assert.throws(()=>validateContent(p),/QUEST_/);
});
test('quest references must declare dependencies with the correct content kind',()=>{const p=fixture();graph(p).nodes[1]!.encounterId='item.ore';assert.throws(()=>validateContent(p),/QUEST_BROKEN_REFERENCE/);});
test('novice and advanced previews omit unknown entities and never include authoritative definitions',()=>{
 const p=fixture(),known={'quest.studio_cart':'DISCOVERED'};const novice=previewPackage(p,known,'NOVICE'),unlearned=previewPackage(p,known,'ADVANCED'),advanced=previewPackage(p,{'quest.studio_cart':'ADVANCED'},'ADVANCED');assert.equal(novice.length,1);assert.equal(novice[0]!.advanced,null);assert.equal(unlearned[0]!.advanced,null);assert.ok(advanced[0]!.advanced?.hint);for(const rows of [novice,unlearned,advanced]){const text=JSON.stringify(rows);assert.ok(!text.includes('author-only-secret-marker'));assert.ok(!text.includes('questObjectives'));assert.ok(!text.includes('dependencies'));}assert.deepEqual(previewPackage(p,{},'NOVICE'),[]);
});
test('offline tactical launch and seeded replay use authored units, keep inputs immutable and respond to definition changes',()=>{
 const p=fixture(),before=JSON.stringify(p),a=sandboxEncounter(p,'encounter.tactical','BALANCED','test-1'),b=sandboxEncounter(p,'encounter.tactical','BALANCED','test-1');assert.deepEqual(a,b);assert.ok(a.trace.length>0);assert.notEqual(a.outcome,'SIMULATION_BUDGET');assert.equal(JSON.stringify(p),before);assert.equal(a.scope,'AUTHOR_SANDBOX_ONLY_NO_REWARDS');const monster=p.entities.find(e=>e.kind==='MONSTER')!;const unit=monster.definition.mechanics!.tacticalUnit as unknown as {stats:{maxHealth:number}};unit.stats.maxHealth+=10;assert.notEqual(sandboxEncounter(p,'encounter.tactical','BALANCED','test-1').replayHash,a.replayHash);assert.throws(()=>sandboxEncounter(p,'item.ore','BALANCED','test-1'),/ENCOUNTER_REQUIRED/);
});
test('malformed envelope analysis fails closed without traversing missing definitions',()=>{const p=fixture();p.entities[0]=null as never;assert.equal(inspectPackage(p).valid,false);});

test('a second quest cannot become another owner of the same principal reward',()=>{
 const p=fixture(),clone=structuredClone(p.entities.find(e=>e.kind==='QUEST')!);clone.id='quest.duplicate';p.entities.push(clone);assert.throws(()=>validateContent(p),/QUEST_DUPLICATE_REWARD/);const report=inspectPackage(p);assert.equal(report.valid,false);assert.ok(report.quests.every(q=>q.diagnostics.some(d=>d.code==='QUEST_DUPLICATE_REWARD')));
});
