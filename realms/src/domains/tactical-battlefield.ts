import { Ajv } from 'ajv';
import { DomainError } from '../foundation/errors.js';
import { resolveAttack,type CharacterStats } from './character-mechanics.js';
import { effectStats } from './tactical-effects.js';
import { resistanceFor } from './tactical-damage.js';
import type { TacticalRules,TacticalState,TacticalUnit } from './tactical-engine.js';

export type BattleRole='BALANCED'|'BRUTE'|'SKIRMISHER'|'ARTILLERY'|'SUPPORT';
export type BattlefieldRules={
 version:1;
 bosses?:{unitId:string;phases:{id:string;name:string;healthBelowBps:number;accuracy:number;armor:number;role:BattleRole}[];windups:{id:string;name:string;range:number;rounds:number;cooldownRounds:number;damage:number;type:string}[]}[];
 zones:{id:string;name:string;cover:number;elevation:number;tags:string[];hazard?:{damage:number;type:string;timing:'ENTER'|'OWNER_END';friendlyFire:boolean}}[];
 units:{id:string;row:'FRONT'|'BACK';role:BattleRole;staggerThreshold:number}[];
 formations:{id:string;name:string;positions:{unitId:string;zone:string;row:'FRONT'|'BACK'}[]}[];
 interactions:{id:string;name:string;zone:string;targetZone:string;action:'MAIN'|'QUICK';range:number;uses:number;difficulty:number;damage:number;type:string;addTags:string[];removeTags:string[];friendlyFire:boolean}[];
 combos:{id:string;tag:string;type:string;damageBonusBps:number;staggerBonus:number;consume:boolean}[];
 highGroundAccuracy:number;frontlineEvasion:number;
 stagger:{damageBps:number;decay:number;thresholdGrowth:number;breakRounds:number;recoveryRounds:number;brokenEvasionPenalty:number};
 danger:'TRIVIAL'|'STANDARD'|'DANGEROUS'|'ELITE'|'BOSS'|'CATASTROPHIC';
};
export type BattlefieldState={formation:string|null;rows:Record<string,'FRONT'|'BACK'>;tags:Record<string,string[]>;uses:Record<string,number>;stagger:Record<string,{value:number;breaks:number;brokenUntil:number;protectedUntil:number}>;disengaged:string[];bosses?:Record<string,{phase:string|null;pending:{id:string;zone:string;releaseRound:number}|null;cooldowns:Record<string,number>}>};
export type FieldEvent={kind:string;actorId:string;targetId?:string;source:string;damage?:number;before?:number;after?:number;threshold?:number;check?:ReturnType<typeof resolveAttack>['check'];tags?:string[]};
export type FormationPosition={unitId:string;zone:string;row:'FRONT'|'BACK'};
export type FieldIntent={actorId:string;kind:'CUSTOM_FORMATION';positions:FormationPosition[]}|{actorId:string;kind:'BOSS_WINDUP';windupId:string;zone:string}|{actorId:string;kind:'FORMATION';formationId:string}|{actorId:string;kind:'INTERACT';interactionId:string;roll:number}|{actorId:string;kind:'DISENGAGE'};
const id={type:'string',pattern:'^[a-z][a-z0-9_.-]{0,63}$'},int=(minimum:number,maximum:number)=>({type:'integer',minimum,maximum}),bool={type:'boolean'},row={enum:['FRONT','BACK']},tags={type:'array',maxItems:16,uniqueItems:true,items:id};
const shape=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',additionalProperties:false,required,properties});
const validate=new Ajv({strict:true}).compile(shape({
 version:{const:1},bosses:{type:'array',maxItems:4,items:shape({unitId:id,phases:{type:'array',maxItems:4,items:shape({id,name:{type:'string',minLength:1,maxLength:80},healthBelowBps:int(1,9999),accuracy:int(0,5),armor:int(0,100),role:{enum:['BALANCED','BRUTE','SKIRMISHER','ARTILLERY','SUPPORT']}})},windups:{type:'array',maxItems:4,items:shape({id,name:{type:'string',minLength:1,maxLength:80},range:int(0,31),rounds:int(1,2),cooldownRounds:int(2,10),damage:int(1,1000000),type:id})}})},zones:{type:'array',minItems:1,maxItems:32,items:shape({id,name:{type:'string',minLength:1,maxLength:80},cover:int(0,5),elevation:int(-10,10),tags,hazard:shape({damage:int(1,1000000),type:id,timing:{enum:['ENTER','OWNER_END']},friendlyFire:bool})},['id','name','cover','elevation','tags'])},
 units:{type:'array',minItems:2,maxItems:16,items:shape({id,row,role:{enum:['BALANCED','BRUTE','SKIRMISHER','ARTILLERY','SUPPORT']},staggerThreshold:int(1,1000000)})},
 formations:{type:'array',maxItems:4,items:shape({id,name:{type:'string',minLength:1,maxLength:80},positions:{type:'array',minItems:1,maxItems:6,items:shape({unitId:id,zone:id,row})}})},
 interactions:{type:'array',maxItems:12,items:shape({id,name:{type:'string',minLength:1,maxLength:80},zone:id,targetZone:id,action:{enum:['MAIN','QUICK']},range:int(0,31),uses:int(1,8),difficulty:int(1,40),damage:int(0,1000000),type:id,addTags:tags,removeTags:tags,friendlyFire:bool})},
 combos:{type:'array',maxItems:16,items:shape({id,tag:id,type:id,damageBonusBps:int(0,10000),staggerBonus:int(0,1000000),consume:bool})},highGroundAccuracy:int(0,5),frontlineEvasion:int(0,5),
 stagger:shape({damageBps:int(0,10000),decay:int(0,1000000),thresholdGrowth:int(1,1000000),breakRounds:int(1,2),recoveryRounds:int(1,10),brokenEvasionPenalty:int(0,5)}),danger:{enum:['TRIVIAL','STANDARD','DANGEROUS','ELITE','BOSS','CATASTROPHIC']}
},['version','zones','units','formations','interactions','combos','highGroundAccuracy','frontlineEvasion','stagger','danger']));
const invalid=():never=>{throw new DomainError(400,'INVALID_TACTICAL_BATTLEFIELD');};
export function validateBattlefield(r:TacticalRules,value:unknown):asserts value is BattlefieldRules{
 if(!r.typedDamage||!validate(value))invalid();const f=value as BattlefieldRules;
 const unique=(a:string[])=>new Set(a).size===a.length;
 if(!unique(f.zones.map(z=>z.id))||f.zones.length!==r.zones.length||f.zones.some(z=>!r.zones.includes(z.id))||!unique(f.units.map(u=>u.id))||!unique(f.interactions.map(i=>i.id))||!unique(f.formations.map(i=>i.id))||!unique(f.combos.map(i=>i.id)))invalid();
 const types=r.typedDamage?.types??[];
 if(!unique((f.bosses??[]).map(b=>b.unitId)))invalid();
 for(const b of f.bosses??[]){if(!f.units.some(u=>u.id===b.unitId)||!unique(b.phases.map(p=>p.id))||!unique(b.windups.map(w=>w.id))||b.phases.some((p,i)=>i>0&&p.healthBelowBps>=b.phases[i-1]!.healthBelowBps)||b.windups.some(w=>!types.includes(w.type)||w.cooldownRounds<=w.rounds))invalid();}
 if(f.zones.some(z=>z.hazard&&!types.includes(z.hazard.type))||f.interactions.some(i=>!r.zones.includes(i.zone)||!r.zones.includes(i.targetZone)||!types.includes(i.type)||i.addTags.some(t=>i.removeTags.includes(t)))||f.combos.some(c=>!types.includes(c.type)))invalid();
 for(const p of f.formations)if(!unique(p.positions.map(x=>x.unitId))||p.positions.some(x=>!f.units.some(u=>u.id===x.unitId)||!r.zones.includes(x.zone)))invalid();
}
export function fieldDistance(r:TacticalRules,a:string,b:string){const q:[string,number][]=[[a,0]],seen=new Set([a]);for(const [z,d]of q){if(z===b)return d;for(const [x,y]of r.edges){const n=x===z?y:y===z?x:null;if(n&&!seen.has(n)){seen.add(n);q.push([n,d+1]);}}}return Infinity;}
export function initializeBattlefield(r:TacticalRules,s:TacticalState){
 const f=r.battlefield;if(!f)return;validateBattlefield(r,f);
 if(f.units.some(u=>!s.units.some(v=>v.id===u.id))||s.units.some(u=>!f.units.some(v=>v.id===u.id)&&!(u.side==='PARTY'&&/^player\.[0-5]$/.test(u.id)))||f.formations.some(p=>p.positions.some(x=>s.units.find(u=>u.id===x.unitId)?.side!=='PARTY')))invalid();
 if(f.bosses?.some(b=>s.units.find(u=>u.id===b.unitId)?.side!=='ENEMY'))invalid();
 s.battlefield={...(f.bosses?{bosses:Object.fromEntries(f.bosses.map(b=>[b.unitId,{phase:null,pending:null,cooldowns:{}}]))}:{}),formation:null,rows:Object.fromEntries(s.units.map(u=>[u.id,f.units.find(v=>v.id===u.id)?.row??'FRONT'])),tags:Object.fromEntries(f.zones.map(z=>[z.id,[...z.tags]])),uses:Object.fromEntries(f.interactions.map(i=>[i.id,i.uses])),stagger:Object.fromEntries(s.units.map(u=>[u.id,{value:0,breaks:0,brokenUntil:0,protectedUntil:0}])),disengaged:[]};
}
export function isBroken(s:TacticalState,u:TacticalUnit){return !!s.battlefield&&s.round<s.battlefield.stagger[u.id]!.brokenUntil;}
export function battlefieldStats(r:TacticalRules,s:TacticalState,u:TacticalUnit):CharacterStats{const stats=effectStats(u),phase=r.battlefield?.bosses?.find(b=>b.unitId===u.id)?.phases.find(p=>p.id===s.battlefield?.bosses?.[u.id]?.phase);return {...stats,accuracy:Math.min(1000000,stats.accuracy+(phase?.accuracy??0)),armor:Math.min(1000000,stats.armor+(phase?.armor??0)),evasion:Math.max(0,stats.evasion-(r.battlefield&&isBroken(s,u)?r.battlefield.stagger.brokenEvasionPenalty:0))};}
export function positionAccuracy(r:TacticalRules,s:TacticalState,actor:TacticalUnit,target:TacticalUnit){
 const f=r.battlefield;if(!f||!s.battlefield)return 0;const a=f.zones.find(z=>z.id===actor.zone)!,t=f.zones.find(z=>z.id===target.zone)!;
 const distant=actor.zone!==target.zone;
 const cover=distant?t.cover:0,high=distant&&a.elevation>t.elevation?f.highGroundAccuracy:0;
 const screened=s.battlefield.rows[target.id]==='BACK'&&s.units.some(u=>u.id!==target.id&&u.side===target.side&&u.state==='ACTIVE'&&s.battlefield!.rows[u.id]==='FRONT'&&fieldDistance(r,u.zone,target.zone)<=1);
 return high-cover-(screened?f.frontlineEvasion:0);
}
export function comboDamage(r:TacticalRules,s:TacticalState,actor:TacticalUnit,target:TacticalUnit,type:string,raw:number,connected:boolean,events:FieldEvent[]){
 if(!r.battlefield||!s.battlefield||!connected)return {raw,stagger:0};let bonus=0,stagger=0;const zoneTags=s.battlefield.tags[target.zone]!;
 for(const c of r.battlefield.combos)if(c.type===type&&zoneTags.includes(c.tag)){bonus=Math.min(10000,bonus+c.damageBonusBps);stagger+=c.staggerBonus;events.push({kind:'COMBO',actorId:actor.id,targetId:target.id,source:c.id,tags:[c.tag]});if(c.consume)zoneTags.splice(zoneTags.indexOf(c.tag),1);}
 return {raw:Math.min(1000000,Math.floor(raw*(10000+bonus)/10000)),stagger};
}
export function applyStagger(r:TacticalRules,s:TacticalState,actor:TacticalUnit,target:TacticalUnit,damage:number,extra:number,events:FieldEvent[]){
 const f=r.battlefield,b=s.battlefield?.stagger[target.id];if(!f||!b||damage<=0||target.state!=='ACTIVE'||s.round<b.protectedUntil)return;
 const threshold=Math.min(1000000,(f.units.find(u=>u.id===target.id)??f.units.find(u=>u.id==='hero'))!.staggerThreshold+b.breaks*f.stagger.thresholdGrowth),before=b.value;
 b.value=Math.min(1000000,b.value+Math.floor(damage*f.stagger.damageBps/10000)+extra);
 events.push({kind:'STAGGER',actorId:actor.id,targetId:target.id,source:'damage',before,after:b.value,threshold});
 if(b.value>=threshold){b.value=0;b.breaks++;b.brokenUntil=s.round+f.stagger.breakRounds;b.protectedUntil=b.brokenUntil+f.stagger.recoveryRounds;s.budgets[target.id]!.reaction=0;target.guardReady=false;events.push({kind:'BREAK',actorId:actor.id,targetId:target.id,source:'stagger',threshold});}
}
function hurt(s:TacticalState,u:TacticalUnit,damage:number){if(damage<=0||u.state==='DEFEATED')return;if(u.state==='DOWNED'){if(u.stabilized)u.stabilized=false;else u.strikes++;if(u.strikes>=2)u.state='DEFEATED';}else {u.health=Math.max(0,u.health-damage);if(!u.health){u.state=u.side==='ENEMY'?'DEFEATED':'DOWNED';u.guardReady=false;s.budgets[u.id]={main:0,quick:0,reaction:0};}}}
function fieldDamage(r:TacticalRules,s:TacticalState,actor:TacticalUnit,target:TacticalUnit,raw:number,type:string,source:string,events:FieldEvent[]){
 const combo=comboDamage(r,s,actor,target,type,raw,true,events),stats=battlefieldStats(r,s,target);
 const result=resolveAttack(r.damage,{check:{roll:10,attributeScore:r.damage.check.attributeBaseline||1,proficiencyRank:0,situationalModifier:100,difficulty:0},rawDamage:combo.raw,armor:stats.armor,penetration:0,resistanceBps:resistanceFor(target.damageProfile,type,target.effects?.flatMap(e=>e.effect.tags)??[])});
 const before=target.health;hurt(s,target,result.damage);events.push({kind:'FIELD_DAMAGE',actorId:actor.id,targetId:target.id,source,damage:result.damage,before,after:target.health});applyStagger(r,s,actor,target,result.damage,combo.stagger,events);
}
export function interactBattlefield(r:TacticalRules,s:TacticalState,intent:FieldIntent,events:FieldEvent[]){
 const f=r.battlefield,b=s.battlefield,actor=s.units.find(u=>u.id===intent.actorId)!;if(!f||!b)throw new DomainError(409,'TACTICAL_BATTLEFIELD_DISABLED');
 if(intent.kind==='BOSS_WINDUP'){
  const boss=f.bosses?.find(b=>b.unitId===actor.id),w=boss?.windups.find(w=>w.id===intent.windupId),saved=b.bosses?.[actor.id];
  if(!w||!saved||saved.pending||isBroken(s,actor)||!r.zones.includes(intent.zone)||fieldDistance(r,actor.zone,intent.zone)>w.range||s.round<(saved.cooldowns[w.id]??0)||s.budgets[actor.id]!.main!==1)throw new DomainError(409,'ILLEGAL_BOSS_WINDUP');
  s.budgets[actor.id]!.main=0;saved.pending={id:w.id,zone:intent.zone,releaseRound:s.round+w.rounds};saved.cooldowns[w.id]=s.round+w.cooldownRounds;events.push({kind:'WINDUP',actorId:actor.id,source:w.id,tags:[intent.zone]});return;
 }
 if(intent.kind==='FORMATION'||intent.kind==='CUSTOM_FORMATION'){
  const p=intent.kind==='FORMATION'?f.formations.find(p=>p.id===intent.formationId):{id:'custom',positions:intent.positions};
  if(p&&(!Array.isArray(p.positions)||p.positions.length<1||p.positions.length>6||new Set(p.positions.map(x=>x.unitId)).size!==p.positions.length||p.positions.some(x=>Object.keys(x).sort().join()!=='row,unitId,zone'||!r.zones.includes(x.zone)||!['FRONT','BACK'].includes(x.row)||s.units.find(u=>u.id===x.unitId)?.side!=='PARTY')))throw new DomainError(409,'INVALID_CUSTOM_FORMATION');if(!p||s.revision!==0||actor.side!=='PARTY')throw new DomainError(409,'FORMATION_LOCKED');
  for(const x of p.positions){const u=s.units.find(u=>u.id===x.unitId)!;u.zone=x.zone;b.rows[u.id]=x.row;}b.formation=p.id;events.push({kind:'FORMATION',actorId:actor.id,source:p.id});return;
 }
 if(intent.kind==='DISENGAGE'){if(s.budgets[actor.id]!.main!==1)throw new DomainError(409,'TACTICAL_MAIN_SPENT');s.budgets[actor.id]!.main=0;b.disengaged.push(actor.id);events.push({kind:'DISENGAGE',actorId:actor.id,source:'main'});return;}
 const i=f.interactions.find(i=>i.id===intent.interactionId);if(!i||b.uses[i.id]!<=0||fieldDistance(r,actor.zone,i.zone)>i.range||s.budgets[actor.id]![i.action==='MAIN'?'main':'quick']!==1||!Number.isInteger(intent.roll)||intent.roll<1||intent.roll>20)throw new DomainError(409,'ILLEGAL_TACTICAL_INTERACTION');
 const check=resolveAttack(r.damage,{check:{roll:intent.roll,attributeScore:r.damage.check.attributeBaseline||1,proficiencyRank:0,situationalModifier:battlefieldStats(r,s,actor).accuracy,difficulty:i.difficulty},rawDamage:0,armor:0,penetration:0,resistanceBps:0}).check;
 b.uses[i.id]!--;s.budgets[actor.id]![i.action==='MAIN'?'main':'quick']=0;events.push({kind:check.success?'INTERACTION':'INTERACTION_FAILED',actorId:actor.id,source:i.id,check});
 if(!check.success)return;
 const zoneTags=b.tags[i.targetZone]!;b.tags[i.targetZone]=[...new Set([...zoneTags.filter(t=>!i.removeTags.includes(t)),...i.addTags])].sort();
 const prepared=[...b.tags[i.targetZone]!],consumed=new Set<string>();
 for(const u of [...s.units].sort((a,b)=>a.id<b.id?-1:1))if(u.zone===i.targetZone&&u.state!=='DEFEATED'&&(i.friendlyFire||u.side!==actor.side)){b.tags[i.targetZone]=[...prepared];fieldDamage(r,s,actor,u,i.damage,i.type,i.id,events);for(const tag of prepared)if(!b.tags[i.targetZone]!.includes(tag))consumed.add(tag);}
 b.tags[i.targetZone]=prepared.filter(t=>!consumed.has(t));
}
export function pulseBattlefield(r:TacticalRules,s:TacticalState,actor:TacticalUnit,timing:'ENTER'|'OWNER_END',events:FieldEvent[]){
 const f=r.battlefield,b=s.battlefield;if(!f||!b)return;const hazard=f.zones.find(z=>z.id===actor.zone)?.hazard;
 if(hazard?.timing===timing&&(hazard.friendlyFire||actor.side==='ENEMY'))fieldDamage(r,s,actor,actor,hazard.damage,hazard.type,'hazard.'+actor.zone,events);
 if(timing==='OWNER_END'){const x=b.stagger[actor.id]!;x.value=Math.max(0,x.value-f.stagger.decay);b.disengaged=b.disengaged.filter(id=>id!==actor.id);}
}

/** Boss commitments are visible saved state. Targets never follow a player who
 * leaves the marked zone. Breaking or suppressing the caster cancels the cast. */
export function reconcileBosses(r:TacticalRules,s:TacticalState,events:FieldEvent[],endingActor?:string){
 for(const boss of r.battlefield?.bosses??[]){const u=s.units.find(u=>u.id===boss.unitId)!,saved=s.battlefield!.bosses![u.id]!,controls=(u.effects??[]).flatMap(e=>e.effect.version===4&&e.effect.control?[e.effect.control]:[]);
  const index=boss.phases.findLastIndex(p=>u.health*10000<=u.stats.maxHealth*p.healthBelowBps),oldIndex=boss.phases.findIndex(p=>p.id===saved.phase);
  if(u.state==='ACTIVE'&&index>oldIndex){saved.phase=boss.phases[index]!.id;events.push({kind:'BOSS_PHASE',actorId:u.id,source:saved.phase});}
  const pending=saved.pending;if(!pending)continue;
  if(u.state!=='ACTIVE'||isBroken(s,u)||controls.some(c=>['STUN','SILENCE'].includes(c))){saved.pending=null;events.push({kind:'WINDUP_INTERRUPTED',actorId:u.id,source:pending.id});continue;}
  if(endingActor===u.id&&s.round>=pending.releaseRound){const w=boss.windups.find(w=>w.id===pending.id)!;saved.pending=null;s.budgets[u.id]!.main=0;events.push({kind:'WINDUP_RELEASE',actorId:u.id,source:w.id,tags:[pending.zone]});
   const setup=[...s.battlefield!.tags[pending.zone]!],consumed=new Set<string>();
   for(const target of [...s.units].sort((a,b)=>a.id<b.id?-1:1))if(target.side!==u.side&&target.zone===pending.zone&&target.state!=='DEFEATED'){s.battlefield!.tags[pending.zone]=[...setup];fieldDamage(r,s,u,target,w.damage,w.type,w.id,events);for(const t of setup)if(!s.battlefield!.tags[pending.zone]!.includes(t))consumed.add(t);}
   s.battlefield!.tags[pending.zone]=setup.filter(t=>!consumed.has(t));
  }
 }
}
