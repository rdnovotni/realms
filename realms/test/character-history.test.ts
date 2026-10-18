import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase,actor } from './helpers.js';
import { historyFixture,historyPackage } from './character-history-fixture.js';
import { advancementEnvelope } from './advancement-fixture.js';
import { advancementHistory } from '../src/domains/advancement-history.js';
import { buildApp } from '../src/app.js';
import { enrollPassword,requireLogin } from '../src/auth/sessions.js';
import { publishContent } from '../src/domains/content.js';
import { setEquipment } from '../src/domains/equipment.js';
import { startTacticalCombat,takeTacticalAction } from '../src/domains/tactical-combat.js';
import { progressionView } from '../src/domains/progression.js';
import { abilityBook } from '../src/domains/ability-book.js';
import { equipmentPreview } from '../src/domains/equipment-preview.js';
import { milestoneView } from '../src/domains/milestones.js';
import { allocateAttributes } from '../src/domains/attributes.js';
import { ascend } from '../src/domains/lifecycle.js';
test('history projects all six immutable categories, pinned names, meaningful values and actual recorded times',async()=>{
 const db=await testDatabase();try{const f=await historyFixture(db.pool);await f.populate();const before=await f.revision(),h=await advancementHistory(db.pool,f.account,before);assert.equal(h.runId,f.run);assert.equal(h.total,9);assert.equal(h.hasMore,false);assert.deepEqual([...new Set(h.entries.map((e:any)=>e.category))],['START_BUILD','LEVEL_UP','SUBCLASS','FEAT','ATTRIBUTE','PROFICIENCY']);
  assert.equal(h.entries[0].name,'Warden');assert.ok(h.entries[0].changes.some((c:any)=>c.name==='strength'&&c.before===null&&c.after===12));const native=h.entries.find((e:any)=>e.category==='LEVEL_UP');assert.ok(native.changes.some((c:any)=>c.name==='Native class level'&&c.before===1&&c.after===2));
  const attribute=h.entries.find((e:any)=>e.category==='ATTRIBUTE');assert.deepEqual(attribute.changes,[{name:'luck',before:10,after:12}]);assert.equal(attribute.milestone,2);assert.equal(attribute.level,5);
  const skill=h.entries.at(-1);assert.deepEqual(skill.changes,[{name:'Proficiency rank',before:'UNTRAINED',after:'NOVICE'}]);const at=(await db.pool.query('SELECT created_at FROM run_proficiency_choices WHERE run_id=$1',[f.run])).rows[0].created_at;assert.equal(new Date(skill.recordedAt).toISOString(),at.toISOString());
  assert.ok(!JSON.stringify(h).includes('before_state'));assert.ok(!JSON.stringify(h).includes('combatModifiers'));assert.ok(!JSON.stringify(h).includes('action_id'));assert.equal(await f.revision(),before);
  const newer=historyPackage();newer.version='history-renamed';const c=newer.entities.find(e=>e.id==='class.one')!;c.revision=2;c.definition.name='New class label';await publishContent(db.pool,newer);assert.equal((await advancementHistory(db.pool,f.account,before)).entries[0].name,'Warden');
  await assert.rejects(db.pool.query("UPDATE run_attribute_choices SET allocation='{}'"),/Immutable record/);
 }finally{await db.close();}
});
test('large current-run histories page deterministically and stale pages cannot silently shift',async()=>{
 const db=await testDatabase();try{const f=await historyFixture(db.pool,true);await f.populate();const revision=await f.revision(),a=await advancementHistory(db.pool,f.account,revision),b=await advancementHistory(db.pool,f.account,revision,25);assert.equal(a.total,29);assert.equal(a.entries.length,25);assert.equal(a.hasMore,true);assert.equal(b.entries.length,4);assert.equal(b.hasMore,false);assert.equal(new Set([...a.entries,...b.entries].map((e:any)=>e.id)).size,29);assert.deepEqual((await advancementHistory(db.pool,f.account,revision,25)).entries,b.entries);assert.equal(b.entries.at(-1).category,'PROFICIENCY');
  await allocateAttributes(db.pool,f.account,advancementEnvelope(revision,'ALLOCATE_ATTRIBUTES'),'rules.attributes',4,{constitution:1});await assert.rejects(advancementHistory(db.pool,f.account,revision,25),/STALE_REVISION/);const fresh=await advancementHistory(db.pool,f.account,await f.revision(),25);assert.equal(fresh.total,30);assert.equal(fresh.entries.at(-1).category,'ATTRIBUTE');await assert.rejects(advancementHistory(db.pool,f.account,await f.revision(),10001),/INVALID_HISTORY_QUERY/);
 }finally{await db.close();}
});
test('history HTTP is authenticated, read-only and account/current-run scoped',async()=>{
 const db=await testDatabase(),app=buildApp(db.pool,{mode:'sessions',throttleKey:'a'.repeat(64)});try{const f=await historyFixture(db.pool);await f.populate();await enrollPassword(db.pool,f.account,'history_reader','Character history test password 47!');const session=await requireLogin(db.pool,'history_reader','Character history test password 47!','Read only',true),headers={authorization:`Bearer ${session.token}`},revision=await f.revision();const r=await app.inject({url:'/api/v1/character/history?expectedRevision='+revision,headers});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().total,9);assert.equal(r.headers['cache-control'],'no-store');assert.equal((await app.inject({url:'/api/v1/character/history?expectedRevision='+revision})).statusCode,401);assert.equal((await app.inject({method:'POST',url:'/api/v1/character/history',headers,payload:{}})).statusCode,404);assert.equal((await app.inject({url:'/api/v1/character/history?expectedRevision='+revision+'&runId='+f.run,headers})).statusCode,400);
  const other=await actor(db.pool,f.release),empty=await advancementHistory(db.pool,other.account,0);assert.equal(empty.total,0);assert.deepEqual(empty.entries,[]);assert.equal(empty.runId,other.run);assert.ok(!JSON.stringify(empty).includes('Warden'));
 }finally{await app.close();await db.close();}
});
test('complete progression/equipment/reload/continued-play lifecycle keeps history accurate and separates Ascension',async()=>{
 const db=await testDatabase();try{const f=await historyFixture(db.pool);await f.populate();const revision=await f.revision(),history=await advancementHistory(db.pool,f.account,revision);assert.equal((await progressionView(db.pool,f.account)).level,5);assert.equal((await progressionView(db.pool,f.account)).build.attributes.luck,12);assert.ok((await abilityBook(db.pool,f.account)).entries.some(e=>e.source.kind==='FEAT'));assert.equal((await equipmentPreview(db.pool,f.account,revision,undefined,'encounter.tactical')).current!.stats.armor,7);
  await setEquipment(db.pool,f.account,advancementEnvelope(await f.revision(),'SET_EQUIPMENT'),{activeSet:'B',slots:[{set:'A',slot:'MAIN_HAND',itemId:f.gear.sword!},{set:'A',slot:'OFF_HAND',itemId:f.gear.shield!}]});assert.equal((await equipmentPreview(db.pool,f.account,await f.revision(),undefined,'encounter.tactical')).current!.stats.armor,6);assert.deepEqual((await advancementHistory(db.pool,f.account,await f.revision())).entries,history.entries);
  const started=await startTacticalCombat(db.pool,f.account,advancementEnvelope(await f.revision(),'START_TACTICAL'),'encounter.tactical') as any;await takeTacticalAction(db.pool,f.account,advancementEnvelope(await f.revision(),'TACTICAL_ACTION'),started.instanceId,started.encounterRevision,started.tacticalRevision,{actorId:'hero',kind:'RETREAT'});assert.equal((await advancementHistory(db.pool,f.account,await f.revision())).total,9);
  await f.complete();assert.equal((await db.pool.query('SELECT status FROM runs WHERE id=$1',[f.run])).rows[0].status,'AFTERCORE');await ascend(db.pool,f.account,advancementEnvelope(await f.revision(),'ASCEND'));const next=await progressionView(db.pool,f.account),newRun=(await db.pool.query("SELECT id,revision FROM runs WHERE status='ACTIVE'")).rows[0];assert.equal(next.build.mode,'UNCONFIGURED');assert.deepEqual((await advancementHistory(db.pool,f.account,newRun.revision)).entries,[]);assert.deepEqual((await milestoneView(db.pool,f.account)).milestones,[]);assert.deepEqual((await abilityBook(db.pool,f.account)).entries,[]);assert.equal((await db.pool.query('SELECT count(*)::integer n FROM run_build_events WHERE run_id=$1',[f.run])).rows[0].n,5);
 }finally{await db.close();}
});
