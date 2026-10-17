import type pg from 'pg';
import { tacticalPackage,tacticalFixture,envelope } from './tactical-fixture.js';
export function bookPackage(){
 const p=tacticalPackage();p.version='character-book-fixture';const m=(id:string)=>p.entities.find(e=>e.id===id)!.definition.mechanics!;
 p.entities.find(e=>e.id==='class.one')!.definition.name='Warden';p.entities.find(e=>e.id==='class.two')!.definition.name='Wayfarer';
 m('class.two').combatModifiers={version:1,modifiers:[{stat:'initiative',amount:2,minimumNativeLevel:1}]};m('class.two').tacticalKit={version:1,minimumNativeLevel:1,heal:false,guard:true};
 p.entities.push({id:'skill.fixture',kind:'SKILL',revision:1,schemaVersion:1,definition:{name:'Weapon training',dependencies:[],public:{},mechanics:{skill:{version:1,family:'PHYSICAL',defaultAttribute:'strength',maximumRank:5,access:'DISCOVERED'}}}});
 p.entities.find(e=>e.id==='class.one')!.definition.dependencies.push('skill.fixture');
 m('class.one').tacticalTechniques={version:1,resources:[{key:'focus',maximum:3,clock:'ENCOUNTER'}],abilities:[{key:'riposte',minimumNativeLevel:1,action:'REACTION',targetSide:'ENEMY',range:0,area:'SINGLE',manaCost:1,resourceCost:{focus:1},cooldownRounds:2,check:{mode:'ATTACK',attribute:'strength',skillId:'skill.fixture',difficulty:10,modifier:0},effect:{kind:'DAMAGE',type:'physical',min:3,max:5,penetration:1}},{key:'mend',minimumNativeLevel:1,action:'QUICK',targetSide:'ALLY',range:1,area:'SINGLE',manaCost:1,resourceCost:{},cooldownRounds:0,effect:{kind:'HEAL',min:2,max:4}},{key:'future',minimumNativeLevel:2,action:'QUICK',targetSide:'ALLY',range:1,area:'SINGLE',manaCost:1,resourceCost:{},cooldownRounds:0,effect:{kind:'HEAL',min:4,max:8}}]};
 const spec=m('encounter.tactical').tacticalCombat as any;spec.rules.techniques={version:1};spec.rules.typedDamage={version:1,types:['physical','fire'],defaultType:'physical',resistanceStacking:'SUM_CAPPED'};
 for(const id of ['npc.ally','monster.tactical'])(m(id).tacticalUnit as any).checkAttributes={strength:10,dexterity:10,constitution:10,intelligence:10,wisdom:10,charisma:10,luck:10};
 spec.rules.roundEffects={version:1};spec.rules.statusDefense={version:2,tags:['poison']};
 m('item.shield').tacticalStatusTraits={version:2,minimumNativeLevel:0,immuneTags:['poison'],durationReductionBps:{}};m('item.shield').tacticalDamageTraits={version:1,minimumNativeLevel:0,resistances:{fire:2500}};
 return p;
}
export async function bookFixture(pool:pg.Pool){const f=await tacticalFixture(pool,bookPackage(),20);const assess=async(ids:string[])=>{for(const id of ids)await pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,$2,'ADVANCED') ON CONFLICT(account_id,entity_id) DO UPDATE SET knowledge_level='ADVANCED'",[f.account,id]);};const revision=async()=>Number((await pool.query('SELECT revision FROM runs WHERE id=$1',[f.run])).rows[0].revision);return {...f,currentRevision:revision,request:async(type:string)=>envelope(await revision(),type),assess};}
