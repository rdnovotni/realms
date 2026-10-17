import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase,actor } from './helpers.js';
import { advancementFixture,advancementEnvelope } from './advancement-fixture.js';
import { buildApp } from '../src/app.js';
import { enrollPassword,requireLogin } from '../src/auth/sessions.js';
import { buildOptions } from '../src/domains/builds.js';
import { integrityReport } from '../src/foundation/integrity.js';
async function headers(pool:Awaited<ReturnType<typeof testDatabase>>['pool'],account:string){await enrollPassword(pool,account,'advance_user','An advancement test password 47!');const token=await requireLogin(pool,'advance_user','An advancement test password 47!','Fixture');return {authorization:`Bearer ${token.token}`};}
test('advancement HTTP scopes reads, commits all three choices and replays only once',async()=>{
 const db=await testDatabase(),app=buildApp(db.pool,{mode:'sessions',throttleKey:'a'.repeat(64)});try{
  const f=await advancementFixture(db.pool);await f.levels('class.one',4);const auth=await headers(db.pool,f.account);
  const read=async(path:string)=>{const r=await app.inject({url:'/api/v1/progression/'+path,headers:auth});assert.equal(r.statusCode,200,r.body);const data=r.json();assert.equal(data.runId,f.run);assert.equal(data.revision,await f.revision());return data;};
  assert.equal((await read('options')).classes.find((c:any)=>c.classId==='class.one').eligibility,'AVAILABLE');assert.ok(!JSON.stringify(await read('subclasses')).includes('Hidden subclass'));assert.ok(!JSON.stringify(await read('feats')).includes('Hidden feat'));
  for(const [path,type,parameters] of [['level','LEVEL_UP',{classId:'class.one'}],['subclasses','CHOOSE_SUBCLASS',{subclassId:'subclass.first'}],['feats','CHOOSE_FEAT',{featId:'feat.root',milestone:2}]] as const){const payload={...advancementEnvelope(await f.revision(),type),...parameters};const r=await app.inject({method:'POST',url:'/api/v1/progression/'+path,headers:auth,payload});assert.equal(r.statusCode,200,r.body);if(path==='feats')assert.equal((await app.inject({method:'POST',url:'/api/v1/progression/'+path,headers:auth,payload})).json().replayed,true);}
  assert.equal((await read('subclasses')).selected[0].name,'Sentinel');const feats=await read('feats');assert.equal(feats.selected[0].featId,'feat.root');assert.equal(feats.options.find((c:any)=>c.featId==='feat.root').eligibility,'ALREADY_CHOSEN');assert.equal(feats.options.find((c:any)=>c.featId==='feat.child').eligibility,'ELIGIBLE');assert.deepEqual(feats.options.find((c:any)=>c.featId==='feat.child').availableMilestones,[4,6]);assert.ok(Object.values(await integrityReport(db.pool)).every(n=>n===0));
 }finally{await app.close();await db.close();}
});
test('native multiclass gates, class limits and missing prerequisites/proficiencies are projected without writes',async()=>{
 const db=await testDatabase(),app=buildApp(db.pool,{mode:'sessions',throttleKey:'b'.repeat(64)});try{
  const f=await advancementFixture(db.pool);await f.levels('class.one',2);await f.levels('class.two',2);const auth=await headers(db.pool,f.account),before=await f.revision(),classes=await buildOptions(db.pool,f.account,true);
  assert.equal(classes.classes.find(c=>c.classId==='class.three')!.eligibility,'CLASS_LIMIT');assert.equal(classes.classes.find(c=>c.classId==='class.locked')!.eligibility,'PREREQUISITES_NOT_MET');
  const subs=(await app.inject({url:'/api/v1/progression/subclasses',headers:auth})).json();assert.equal(subs.options.find((c:any)=>c.subclassId==='subclass.first').nativeLevel,3);assert.equal(subs.options.find((c:any)=>c.subclassId==='subclass.first').eligibility,'NATIVE_LEVEL_REQUIRED');
  const feats=(await app.inject({url:'/api/v1/progression/feats',headers:auth})).json();assert.equal(feats.options.find((c:any)=>c.featId==='feat.child').eligibility,'PREREQUISITES_NOT_MET');assert.equal(feats.options.find((c:any)=>c.featId==='feat.trained').eligibility,'PROFICIENCY_NOT_MET');assert.equal(await f.revision(),before);
 }finally{await app.close();await db.close();}
});
test('active-instance decisions remain visible, read-only sessions inspect but cannot commit',async()=>{
 const db=await testDatabase(),app=buildApp(db.pool,{mode:'sessions',throttleKey:'c'.repeat(64)});try{
  const f=await advancementFixture(db.pool);await f.levels('class.one',4);await f.begin();const auth=await headers(db.pool,f.account),ro=await requireLogin(db.pool,'advance_user','An advancement test password 47!','Read only',true),readonly={authorization:`Bearer ${ro.token}`};
  for(const [path,id,field]of [['options','class.one','classId'],['subclasses','subclass.first','subclassId'],['feats','feat.root','featId']] as const){const r=await app.inject({url:'/api/v1/progression/'+path,headers:readonly});assert.equal(r.statusCode,200);assert.equal(r.json().activeInstance,true);assert.equal((r.json().classes??r.json().options).find((c:any)=>c[field]===id).eligibility,'ACTIVE_INSTANCE');}
  for(const [path,type,parameters]of [['level','LEVEL_UP',{classId:'class.one'}],['subclasses','CHOOSE_SUBCLASS',{subclassId:'subclass.first'}],['feats','CHOOSE_FEAT',{featId:'feat.root',milestone:2}]] as const){const payload={...advancementEnvelope(await f.revision(),type),...parameters};assert.equal((await app.inject({method:'POST',url:'/api/v1/progression/'+path,headers:readonly,payload})).statusCode,403);assert.equal((await app.inject({method:'POST',url:'/api/v1/progression/'+path,headers:auth,payload})).statusCode,409);}
 }finally{await app.close();await db.close();}
});
test('no earned milestone cannot be submitted; stale concurrent class requests commit once',async()=>{
 const db=await testDatabase(),app=buildApp(db.pool,{mode:'sessions',throttleKey:'d'.repeat(64)});try{
  const f=await advancementFixture(db.pool),auth=await headers(db.pool,f.account),feats=(await app.inject({url:'/api/v1/progression/feats',headers:auth})).json();assert.equal(feats.options.find((c:any)=>c.featId==='feat.root').eligibility,'ELIGIBLE');assert.deepEqual(feats.options.find((c:any)=>c.featId==='feat.root').availableMilestones,[]);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/progression/feats',headers:auth,payload:{...advancementEnvelope(await f.revision(),'CHOOSE_FEAT'),featId:'feat.root',milestone:2}})).statusCode,409);
  const revision=await f.revision(),results=await Promise.all(['class.one','class.two'].map(classId=>app.inject({method:'POST',url:'/api/v1/progression/level',headers:auth,payload:{...advancementEnvelope(revision,'LEVEL_UP'),classId}})));assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);assert.equal(await f.revision(),revision+1);
 }finally{await app.close();await db.close();}
});
test('empty foreign-account catalogs hide undiscovered content and capped native classes are explained',async()=>{
 const db=await testDatabase(),app=buildApp(db.pool,{mode:'sessions',throttleKey:'e'.repeat(64)});try{
  const f=await advancementFixture(db.pool,'class.three');await f.levels('class.three',1);assert.equal((await buildOptions(db.pool,f.account,true)).classes.find(c=>c.classId==='class.three')!.eligibility,'NATIVE_CLASS_LEVEL_LIMIT');const other=await actor(db.pool,f.release),auth=await headers(db.pool,other.account);
  for(const path of ['options','subclasses','feats']){const r=await app.inject({url:'/api/v1/progression/'+path,headers:auth});assert.equal(r.statusCode,200);assert.equal(r.json().runId,other.run);assert.deepEqual(r.json().classes??r.json().options,[]);assert.equal(JSON.stringify(r.json()).includes('Sentinel'),false);assert.equal((await app.inject({url:'/api/v1/progression/'+path})).statusCode,401);}
 }finally{await app.close();await db.close();}
});
