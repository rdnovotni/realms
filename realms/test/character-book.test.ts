import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase,actor } from './helpers.js';
import { bookFixture } from './character-book-fixture.js';
import { abilityBook } from '../src/domains/ability-book.js';
import { equipmentPreview } from '../src/domains/equipment-preview.js';
import { setEquipment } from '../src/domains/equipment.js';
import { buildApp } from '../src/app.js';
import { enrollPassword,requireLogin } from '../src/auth/sessions.js';
import { levelUp } from '../src/domains/builds.js';
import { executeAction,advanceRevision } from '../src/foundation/action.js';
import { beginEncounter,finishEncounter } from '../src/domains/encounters.js';
test('Ability Book projects only assessed owned capabilities, native gates and whitelisted public fields',async()=>{
 const db=await testDatabase();try{const f=await bookFixture(db.pool),before=await f.currentRevision();assert.deepEqual((await abilityBook(db.pool,f.account)).entries,[]);await f.assess(['class.one','class.two']);const book=await abilityBook(db.pool,f.account);
  assert.equal(book.runId,f.run);assert.equal(book.revision,before);assert.ok(book.entries.some(a=>a.category==='REACTION'&&a.name==='Warden · riposte'));assert.ok(book.entries.some(a=>a.category==='UTILITY'));assert.ok(book.entries.some(a=>a.category==='PASSIVE'));assert.ok(book.entries.every(a=>a.source.kind==='CLASS'&&a.source.name==='Warden'));assert.ok(!book.entries.some(a=>a.name.includes('future')));
  const a=book.entries.find(a=>a.name.endsWith('riposte'))!;assert.equal(a.action,'REACTION');assert.equal(a.cooldownRounds,2);assert.deepEqual(a.costs,[{name:'Mana',amount:1,clock:null},{name:'focus',amount:1,clock:'ENCOUNTER'}]);assert.ok(!JSON.stringify(book).includes('combatModifiers'));assert.ok(!JSON.stringify(book).includes('difficulty'));assert.ok(book.entries.every(a=>a.duration==='OWNED'));assert.equal(await f.currentRevision(),before);
 }finally{await db.close();}
});
test('statistics conceal both sides and explanations for unassessed equipment, then match authoritative committed changes',async()=>{
 const db=await testDatabase();try{const f=await bookFixture(db.pool),draft={activeSet:'B' as const,slots:[{set:'A' as const,slot:'MAIN_HAND' as const,itemId:f.gear.sword!},{set:'A' as const,slot:'OFF_HAND' as const,itemId:f.gear.shield!}]};
  for(const plan of [undefined,draft,{activeSet:'A' as const,slots:[]}]){const v=await equipmentPreview(db.pool,f.account,await f.currentRevision(),plan);assert.equal(v.current,null);assert.equal(v.preview,null);assert.ok(!JSON.stringify(v).includes('breakdown'));}
  await f.assess(['item.sword','item.shield']);const before=await equipmentPreview(db.pool,f.account,await f.currentRevision(),draft);assert.equal(before.current!.stats.armor,3);assert.equal(before.preview!.stats.armor,2);assert.equal(before.current!.damage!.resistances.fire,2500);assert.deepEqual(before.current!.status!.immuneTags,['poison']);assert.equal(before.current!.capabilities.guard,true);
  const assessedBook=await abilityBook(db.pool,f.account);assert.ok(assessedBook.entries.some(a=>a.source.name==='Shield'));assert.equal(assessedBook.entries.find(a=>a.name==='Shield · Guard')!.action,'QUICK');await setEquipment(db.pool,f.account,await f.request('SET_EQUIPMENT'),draft);const after=await equipmentPreview(db.pool,f.account,await f.currentRevision());assert.deepEqual(after.current,before.preview);assert.ok((await abilityBook(db.pool,f.account)).entries.every(a=>a.source.kind!=='EQUIPMENT'));assert.equal((await abilityBook(db.pool,f.account)).activeSet,'B');
 }finally{await db.close();}
});
test('owned multiclass sources contribute independently; no context and foreign accounts reveal no statistics or capabilities',async()=>{
 const db=await testDatabase();try{const f=await bookFixture(db.pool);await f.assess(['class.one','class.two','item.sword','item.shield']);
  const start=await executeAction(db.pool,f.account,await f.request('FIXTURE'),{},async c=>({...await beginEncounter(c,'encounter.build',{}),revision:await advanceRevision(c)}));await executeAction(db.pool,f.account,await f.request('FIXTURE'),{},async c=>({...await finishEncounter(c,start.instanceId as string,0,'VICTORY',async()=>({})),revision:await advanceRevision(c)}));await levelUp(db.pool,f.account,await f.request('LEVEL_UP'),'class.two');
  const book=await abilityBook(db.pool,f.account);assert.deepEqual([...new Set(book.entries.filter(a=>a.source.kind==='CLASS').map(a=>a.source.name))].sort(),['Warden','Wayfarer']);assert.ok(book.entries.filter(a=>a.source.kind==='CLASS').every(a=>a.source.nativeLevel===1));const view=await equipmentPreview(db.pool,f.account,await f.currentRevision());assert.equal(view.current!.stats.initiative,7);
  const other=await actor(db.pool,f.release);assert.deepEqual((await abilityBook(db.pool,other.account)).entries,[]);const missing=await equipmentPreview(db.pool,other.account,0);assert.deepEqual(missing.contexts,[]);assert.equal(missing.current,null);assert.ok(!JSON.stringify(missing).includes('armor'));
  await db.pool.query("DELETE FROM discoveries WHERE account_id=$1 AND entity_id='encounter.tactical'",[f.account]);const absent=await equipmentPreview(db.pool,f.account,await f.currentRevision());assert.equal(absent.current,null);assert.deepEqual(absent.contexts,[]);assert.ok(!JSON.stringify(absent).includes('breakdown'));
 }finally{await db.close();}
});
test('authenticated read-only HTTP access is account scoped and cannot mutate the Ability Book',async()=>{
 const db=await testDatabase(),app=buildApp(db.pool,{mode:'sessions',throttleKey:'a'.repeat(64)});try{const f=await bookFixture(db.pool);await f.assess(['class.one','item.sword','item.shield']);await enrollPassword(db.pool,f.account,'book_reader','Character book test password 47!');const session=await requireLogin(db.pool,'book_reader','Character book test password 47!','Reader',true),headers={authorization:`Bearer ${session.token}`},before=await f.currentRevision();const book=await app.inject({url:'/api/v1/character/abilities',headers});assert.equal(book.statusCode,200,book.body);assert.equal(book.headers['cache-control'],'no-store');assert.equal(book.json().runId,f.run);const stats=await app.inject({url:'/api/v1/equipment/preview?expectedRevision='+before,headers});assert.equal(stats.statusCode,200,stats.body);assert.ok(stats.json().current);assert.equal((await app.inject({url:'/api/v1/character/abilities'})).statusCode,401);assert.equal((await app.inject({method:'POST',url:'/api/v1/character/abilities',headers,payload:{}})).statusCode,404);assert.equal(await f.currentRevision(),before);
 }finally{await app.close();await db.close();}
});
