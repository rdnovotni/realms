import { randomBytes } from 'node:crypto';
import { testDatabase,actor } from '../test/helpers.js';
import { tacticalPackage,tacticalFixture,envelope } from '../test/tactical-fixture.js';
import { startTacticalCombat,takeTacticalAction } from '../src/domains/tactical-combat.js';
import { enrollPassword } from '../src/auth/sessions.js';
import { buildApp } from '../src/app.js';
const url=new URL(process.env.TEST_DATABASE_URL??'postgres://invalid/invalid');
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Campaign preview requires loopback realms_test PostgreSQL');
const db=await testDatabase();let app:ReturnType<typeof buildApp>|undefined;
try{
 const p=tacticalPackage();p.version='campaign-visual-fixture';
 const spec=p.entities.find(e=>e.id==='encounter.tactical')!.definition.mechanics!.tacticalCombat as any;
 spec.rules.roundEffects={version:1};spec.rules.roundLimit=20;spec.enemies.push({id:'watchtower_sentinel_of_the_long_forgotten_road',definitionId:'monster.tactical',zone:'balcony'});spec.allies.push({id:'road_companion',definitionId:'npc.ally',zone:'balcony'});
 (p.entities.find(e=>e.id==='monster.tactical')!.definition.mechanics!.tacticalUnit as any).stats.initiative=6;
 p.entities.find(e=>e.id==='encounter.tactical')!.definition.name='The Old Watchtower';p.entities.find(e=>e.id==='encounter.tactical')!.definition.public={summary:'A weathered watchtower overlooks the road. Join your companions for a short tactical encounter.'};
 p.entities.push({id:'effect.frayed',kind:'EFFECT',revision:1,schemaVersion:1,definition:{name:'Test frayed guard',dependencies:[],public:{},mechanics:{tacticalRoundEffect:{version:1,clock:'ROUNDS',tick:'OWNER_END',family:'frayed',stacking:'REFRESH',rounds:3,polarity:'HARMFUL',tags:['condition'],modifiers:[{stat:'armor',amount:-1}]}}}});
 for(const id of ['class.one','monster.tactical']){const e=p.entities.find(e=>e.id===id)!;e.definition.dependencies.push('effect.frayed');e.definition.mechanics!.tacticalOnHitEffects={version:1,minimumNativeLevel:id==='class.one'?1:0,effectIds:['effect.frayed']};}
 for(const name of ['road','player','server','exhausted','victory','defeat','spent','newcomer','viewer','dense']){
  const pack=structuredClone(p);if(name==='dense'){pack.version='campaign-dense-visual-fixture';for(const e of pack.entities)e.revision=2;const rules=(pack.entities.find(e=>e.id==='encounter.tactical')!.definition.mechanics!.tacticalCombat as any).rules;rules.techniques={version:1};for(const e of pack.entities)if(e.definition.mechanics?.tacticalUnit)(e.definition.mechanics.tacticalUnit as any).checkAttributes={strength:10,dexterity:10,constitution:10,intelligence:10,wisdom:10,charisma:10,luck:10};rules.typedDamage={version:1,types:['slashing'],defaultType:'slashing',resistanceStacking:'SUM_CAPPED'};pack.entities.find(e=>e.id==='class.one')!.definition.mechanics!.tacticalTechniques={version:1,resources:[{key:'focus',maximum:2,clock:'ENCOUNTER'}],abilities:Array.from({length:6},(_,i)=>({key:'practice_mend_'+(i+1),minimumNativeLevel:1,action:i%2?'QUICK':'MAIN',targetSide:'ALLY',range:1,area:'SINGLE',manaCost:1,resourceCost:{focus:1},cooldownRounds:1,effect:{kind:'HEAL',min:1,max:2}}))};}
  const f=name==='newcomer'?await actor(db.pool,await (await import('../src/domains/content.js')).publishContent(db.pool,pack),10):await tacticalFixture(db.pool,pack,name==='spent'?0:20);
  if(name==='newcomer')await db.pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,'encounter.tactical','DISCOVERED')",[f.account]);
  if(!['road','spent','newcomer'].includes(name)){
   let v=await startTacticalCombat(db.pool,f.account,envelope('revision' in f?f.revision as number:0,'START_TACTICAL'),'encounter.tactical') as any;
   const act=async(command:any)=>{v=await takeTacticalAction(db.pool,f.account,envelope(v.revision),v.instanceId,v.encounterRevision,v.tacticalRevision,command) as any;};
   if(name!=='server')while(v.currentActor!=='hero'&&!v.outcome)await act({actorId:'hero',kind:'CONTINUE'});
   if(name==='exhausted'){await act({actorId:'hero',kind:'ATTACK',targetId:'enemy'});await act({actorId:'hero',kind:'GUARD'});}
   if(name==='victory'||name==='defeat')for(let i=0;i<160&&!v.outcome;i++){
    const u=v.units.find((u:any)=>u.id===v.currentActor);
    if(u.side==='ENEMY'){await act({actorId:'hero',kind:'CONTINUE'});continue;}
    const target=v.units.find((x:any)=>x.side==='ENEMY'&&x.state==='ACTIVE');
    if(name==='victory'&&target&&v.budgets[u.id].main){if(target.zone!==u.zone&&v.budgets[u.id].quick)await act({actorId:u.id,kind:'MOVE',zone:target.zone});await act({actorId:u.id,kind:'ATTACK',targetId:target.id});}
    else await act({actorId:u.id,kind:'END'});
   }
   if(['victory','defeat'].includes(name)&&v.outcome!==name.toUpperCase())throw Error('Fixture did not reach '+name);
  }
  await enrollPassword(db.pool,f.account,name,'A road worth wandering 47!');
 }
 app=buildApp(db.pool,{mode:'sessions',throttleKey:randomBytes(32).toString('hex')});app.addHook('preValidation',async request=>{if(request.url==='/api/v1/auth/login'&&(request.body as {handle?:string}|undefined)?.handle==='viewer')(request.body as {readOnly?:boolean}).readOnly=true;});app.addHook('onSend',async(_request,reply,payload)=>{reply.header('X-Follybound-Fixture','disposable-visual');return payload;});await app.listen({host:'127.0.0.1',port:3011});console.log('Disposable campaign preview: http://127.0.0.1:3011 · road/player/server/exhausted/victory/defeat/spent/newcomer/viewer/dense');
 let closing=false;const close=async()=>{if(closing)return;closing=true;await app?.close();await db.close();};for(const sig of ['SIGINT','SIGTERM']as const)process.once(sig,()=>void close());
}catch(error){await app?.close();await db.close();throw error;}
