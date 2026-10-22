/** Disposable synthetic playtest. Requires a database named realms_test. */
import { randomUUID } from 'node:crypto';
import { testDatabase } from '../test/helpers.js';
import { tacticalPackage,tacticalFixture,envelope } from '../test/tactical-fixture.js';
import { battlefieldRules } from '../test/tactical-battlefield-fixture.js';
import { executeAction,advanceRevision } from '../src/foundation/action.js';
import { grantItem } from '../src/domains/item-accounting.js';
import { setEquipment } from '../src/domains/equipment.js';
import { setCombatQuickslots } from '../src/domains/combat-preparation.js';
import { startTacticalCombat } from '../src/domains/tactical-combat.js';
import { buildApp } from '../src/app.js';
const db=await testDatabase();
try{
 const p=tacticalPackage(),spec=p.entities.find(e=>e.id==='encounter.tactical')!.definition.mechanics!.tacticalCombat as any;
 spec.rules={...spec.rules,...battlefieldRules(),techniques:{version:1},preparation:{version:1},recharge:{version:1},roundEffects:{version:4}};spec.rules.roundLimit=20;spec.rules.battlefield.danger='BOSS';spec.rules.battlefield.units.push({id:'ally',row:'FRONT',role:'SUPPORT',staggerThreshold:20});spec.rules.battlefield.zones[1].hazard={damage:2,type:'fire',timing:'OWNER_END',friendlyFire:true};spec.rules.battlefield.bosses=[{unitId:'enemy',phases:[{id:'fury',name:'Fury of the ruined temple',healthBelowBps:5000,accuracy:1,armor:1,role:'BRUTE'}],windups:[{id:'eruption',name:'Marked eruption',range:1,rounds:1,cooldownRounds:3,damage:4,type:'fire'}]}];
 p.entities.find(e=>e.id==='encounter.tactical')!.definition.name='The ruined temple · combat playtest';p.entities.find(e=>e.id==='monster.tactical')!.definition.name='Temple guardian';
 const attrs={strength:10,dexterity:10,constitution:10,intelligence:10,wisdom:10,charisma:10,luck:10};for(const id of ['npc.ally','monster.tactical'])(p.entities.find(e=>e.id===id)!.definition.mechanics!.tacticalUnit as any).checkAttributes=attrs;
 Object.assign((p.entities.find(e=>e.id==='monster.tactical')!.definition.mechanics!.tacticalUnit as any).stats,{maxHealth:70,accuracy:10,attackMin:3,attackMax:3});
 p.entities.find(e=>e.id==='class.one')!.definition.mechanics!.tacticalTechniques={version:2,resources:[{key:'resolve',maximum:2,clock:'REST',refresh:'FULL_REST'}],abilities:[{key:'second_wind',minimumNativeLevel:1,action:'QUICK',targetSide:'ALLY',range:0,area:'SINGLE',manaCost:0,resourceCost:{resolve:1},cooldownRounds:1,effect:{kind:'HEAL',min:5,max:5}}]};
 p.entities.push({id:'skill.blast',kind:'SKILL',revision:1,schemaVersion:1,definition:{name:'Alchemical aim',dependencies:[],public:{},mechanics:{skill:{version:1,family:'KNOWLEDGE',defaultAttribute:'intelligence',maximumRank:5,access:'DISCOVERED'}}}});
 for(const [id,name,bomb]of [['potion','Elixir of the last lantern',false],['bomb','Ember flask',true]]as const)p.entities.push({id:'item.playtest_'+id,kind:'ITEM',revision:1,schemaVersion:1,definition:{name,dependencies:bomb?['skill.blast']:[],public:{description:'Synthetic combat specimen, not release balance.'},mechanics:{inventory:{version:1,storageMode:'STACK',category:'CONSUMABLE'},combatItem:{version:1,delivery:'OTHER',action:bomb?'MAIN':'QUICK',targetSide:bomb?'ENEMY':'ALLY',area:'SINGLE',range:1,heal:bomb?0:10,mana:bomb?0:2,effectIds:[],rare:!bomb,...(bomb?{damage:{type:'fire',min:8,max:10,penetration:0,attribute:'intelligence',skillId:'skill.blast',modifier:0}}:{})}}}});
 const f=await tacticalFixture(db.pool,p,100);const slots:{slot:number;itemId:string}[]=[];
 const granted=await executeAction(db.pool,f.account,{requestId:randomUUID(),actionType:'COMBAT_PLAYTEST',expectedRevision:f.revision},{},async c=>{const container=(await c.client.query("SELECT b.id FROM inventory_containers b JOIN state_scopes s ON s.id=b.scope_id WHERE s.run_id=$1 AND b.kind='CARRIED' LIMIT 1",[f.run])).rows[0].id;for(const [i,id]of ['potion','bomb'].entries()){const itemId=(await grantItem(c,id,{containerId:container,definitionId:'item.playtest_'+id,quantity:'3',sourceCode:'DISPOSABLE_COMBAT'},'DISPOSABLE_COMBAT')).itemId;slots.push({slot:i+1,itemId});await c.client.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,$2,'DISCOVERED')",[f.account,'item.playtest_'+id]);}return {revision:await advanceRevision(c)};});
 const equipped=await setEquipment(db.pool,f.account,envelope(granted.revision as number,'SET_EQUIPMENT'),{activeSet:'A',slots:[{set:'A',slot:'MAIN_HAND',itemId:f.gear.sword!},{set:'B',slot:'MAIN_HAND',itemId:f.gear.sword!},{set:'B',slot:'OFF_HAND',itemId:f.gear.shield!}]});
 const prepared=await setCombatQuickslots(db.pool,f.account,envelope(equipped.revision as number,'SET_COMBAT_QUICKSLOTS'),slots);await startTacticalCombat(db.pool,f.account,envelope(prepared.revision as number,'START_TACTICAL'),'encounter.tactical');
 const app=buildApp(db.pool,{mode:'development',token:'combat-disposable-preview-token-2026',accountId:f.account});await app.listen({host:'127.0.0.1',port:3015});console.log('Disposable combat playtest: http://127.0.0.1:3015 · synthetic token: combat-disposable-preview-token-2026');
 for(const signal of ['SIGINT','SIGTERM']as const)process.once(signal,()=>void(async()=>{await app.close();await db.close();})());
}catch(error){await db.close();throw error;}
