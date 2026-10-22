import { DomainError } from '../foundation/errors.js';
import { checkSuccessChance } from './character-mechanics.js';
import { battlefieldStats,positionAccuracy,fieldDistance } from './tactical-battlefield.js';
import { opportunityAbilities,techniqueTargets,type TechniqueIntent } from './tactical-techniques.js';
import { stepTactical,type TacticalIntent,type TacticalState,type TacticalRules } from './tactical-engine.js';
import type { TacticalCommand } from './tactical-encounters.js';

/** A deterministic dry run validates intent only. It neither rolls the encounter RNG
 * nor supplies a result to a real action. Journal adapters own all actual draws. */
export function previewIntent(r:TacticalRules,s:TacticalState,c:TacticalCommand):TacticalIntent{
 const actor=s.units.find(u=>u.id===c.actorId);if(!actor)throw new DomainError(409,'INVALID_TACTICAL_ACTOR');
 if(c.kind==='INTERACT')return {...c,roll:10};
 if(c.kind==='RETREAT')return {...c,roll:10};
 if(c.kind==='ATTACK'||c.kind==='USE_ABILITY'){const a=c.kind==='USE_ABILITY'?actor.attackAbilities?.find(a=>a.id===c.abilityId):undefined;return {...c,roll:10,rawDamage:a?.spec.damage.min??actor.stats.attackMin};}
 if(c.kind==='USE_HEALING_ABILITY'){const a=actor.healingAbilities?.find(a=>a.id===c.abilityId);if(!a)throw new DomainError(409,'ILLEGAL_TACTICAL_HEALING_ABILITY');return {...c,amount:a.spec.min};}
 if(c.kind==='TECHNIQUE'){const a=actor.techniques?.abilities.find(a=>a.id===c.abilityId);if(!a)throw new DomainError(409,'ILLEGAL_TACTICAL_TECHNIQUE');return {...c,draws:techniqueTargets(r,s,actor,a,c.targetId).map(u=>({targetId:u.id,...(a.check?{roll:10}:{}),...('min'in a.effect?{amount:a.effect.min}:{})}))};}
 if(c.kind==='MOVE'&&r.techniques)return {...c,opportunities:opportunityAbilities(r,s,actor,c.zone).map(({actor,ability:a})=>{if(a.effect.kind!=='DAMAGE')throw new DomainError(409,'INVALID_TACTICAL_OPPORTUNITY');return {kind:'TECHNIQUE',actorId:actor.id,abilityId:a.id,targetId:c.actorId,draws:[{targetId:c.actorId,roll:10,amount:a.effect.min}]} as TechniqueIntent;})};
 return c as TacticalIntent;
}
export type TacticalOption={command:TacticalCommand;available:boolean;reason:string|null;action:'MAIN'|'QUICK'|'FREE';mana:number;hitChance:number|null;range:number|null;label:string};
export function tacticalOptions(r:TacticalRules,s:TacticalState,actorId:string){
 const actor=s.units.find(u=>u.id===actorId);if(!actor)return [];
 const options:TacticalOption[]=[];
 const add=(command:TacticalCommand,label:string,action:TacticalOption['action'],mana=0,range:number|null=null)=>{
  if(options.length>=256)return;let reason:string|null=null;
  try{stepTactical(r,s,s.revision,previewIntent(r,s,command));}catch(error){if(!(error instanceof DomainError))throw error;reason=error.message;}
  let hitChance:number|null=null;
  if((command.kind==='ATTACK'||command.kind==='USE_ABILITY')&&!reason){const target=s.units.find(u=>u.id===command.targetId)!,a=command.kind==='USE_ABILITY'?actor.attackAbilities?.find(a=>a.id===command.abilityId):undefined,stats=battlefieldStats(r,s,actor);const chance=checkSuccessChance({...r.damage.check,attributeBaseline:1},{attributeScore:1,proficiencyRank:0,situationalModifier:Math.max(-1000000,Math.min(1000000,stats.accuracy+(a?.spec.accuracyModifier??0)+positionAccuracy(r,s,actor,target))),difficulty:battlefieldStats(r,s,target).evasion});hitChance=chance.numerator*5;}
  options.push({command,label,action,mana,range,available:!reason,reason,hitChance});
 };
 for(const w of r.battlefield?.bosses?.find(b=>b.unitId===actorId)?.windups??[])for(const zone of r.zones)add({actorId,kind:'BOSS_WINDUP',windupId:w.id,zone},w.name,'MAIN',0,w.range);
 if(actor.prepared)for(const set of ['A','B']as const)add({actorId,kind:'SWAP_SET',set},'Prepared weapon set '+set,'QUICK');
 add({actorId,kind:'END'},'End turn','FREE');
 add({actorId,kind:'GUARD'},'Guard','QUICK');
 add({actorId,kind:'RETREAT'},'Attempt retreat','MAIN');
 if(r.surrender)add({actorId,kind:'SURRENDER'},'Surrender','MAIN');
 if(actor.concentration)add({actorId,kind:'DROP_CONCENTRATION'},'Drop concentration','FREE');
 if(r.battlefield){add({actorId,kind:'DISENGAGE'},'Disengage safely','MAIN');for(const i of r.battlefield.interactions)add({actorId,kind:'INTERACT',interactionId:i.id},i.name,i.action,0,i.range);if(s.revision===0)for(const p of r.battlefield.formations)add({actorId,kind:'FORMATION',formationId:p.id},p.name+' formation','FREE');}
 for(const zone of r.zones)if(fieldDistance(r,actor.zone,zone)===1)add({actorId,kind:'MOVE',zone},'Move to '+(r.battlefield?.zones.find(z=>z.id===zone)?.name??zone),'QUICK');
 for(const u of s.units){if(u.side!==actor.side&&u.state==='ACTIVE')add({actorId,kind:'ATTACK',targetId:u.id},'Attack '+u.id,'MAIN',0,r.attackRange);if(u.side===actor.side&&u.state!=='DEFEATED'&&actor.canHeal)add({actorId,kind:'HEAL',targetId:u.id},'Heal '+u.id,'MAIN',r.healManaCost??0,r.healRange);}
 for(const a of actor.attackAbilities??[])for(const u of s.units)if(u.side!==actor.side&&u.state==='ACTIVE')add({actorId,kind:'USE_ABILITY',abilityId:a.id,targetId:u.id},a.id+' → '+u.id,'MAIN',a.spec.manaCost,a.spec.range);
 for(const a of actor.healingAbilities??[])for(const u of s.units)if(u.side===actor.side&&u.state!=='DEFEATED')add({actorId,kind:'USE_HEALING_ABILITY',abilityId:a.id,targetId:u.id},a.id+' → '+u.id,'MAIN',a.spec.manaCost,a.spec.range);
 for(const a of actor.techniques?.abilities??[])if(a.action!=='REACTION')for(const u of s.units)if((a.targetSide==='ALLY')===(u.side===actor.side))add({actorId,kind:'TECHNIQUE',abilityId:a.id,targetId:u.id},a.id+' → '+u.id,a.action,a.manaCost,a.range);
 for(const a of actor.cleansingAbilities??[])for(const u of s.units)for(const e of u.effects??[])add({actorId,kind:'CLEANSE',abilityId:a.id,targetId:u.id,effectId:e.effectId},a.spec.method+' '+e.effect.family+' → '+u.id,'MAIN',a.spec.manaCost,a.spec.range);
 return options;
}
/** New battlefield encounters opt into tactical roles. Legacy AI stays frozen. */
export function battlefieldDecision(r:TacticalRules,s:TacticalState,actorId:string):TacticalCommand{
 const actor=s.units.find(u=>u.id===actorId)!,role=r.battlefield!.bosses?.find(b=>b.unitId===actorId)?.phases.find(p=>p.id===s.battlefield?.bosses?.[actorId]?.phase)?.role??r.battlefield!.units.find(u=>u.id===actorId)?.role??'BALANCED',options=tacticalOptions(r,s,actorId).filter(o=>{const c=o.command,a=c.kind==='TECHNIQUE'?actor.techniques?.abilities.find(a=>a.id===c.abilityId):undefined;return o.available&&!(actor.side==='PARTY'&&a&&Object.keys(a.resourceCost).some(k=>actor.techniques?.clocks?.[k]?.clock==='REST'));}),target=(o:TacticalOption)=>{const c=o.command;return 'targetId'in c?s.units.find(u=>u.id===c.targetId):undefined;},effect=(o:TacticalOption)=>{const c=o.command;return c.kind==='TECHNIQUE'?actor.techniques!.abilities.find(a=>a.id===c.abilityId)?.effect.kind:undefined;};
 const healing=options.filter(o=>['HEAL','USE_HEALING_ABILITY'].includes(o.command.kind)||o.command.kind==='TECHNIQUE'&&['HEAL','RESURRECT','STABILIZE'].includes(effect(o)??'')).filter(o=>{const u=target(o);return u&&(u.state!=='ACTIVE'||u.health/u.stats.maxHealth<(role==='SUPPORT'?0.8:0.4));}).sort((a,b)=>(target(a)!.health/target(a)!.stats.maxHealth)-(target(b)!.health/target(b)!.stats.maxHealth)||(a.label<b.label?-1:1));
 if(healing[0])return healing[0].command;
 const windup=options.find(o=>{const c=o.command;return c.kind==='BOSS_WINDUP'&&s.units.some(u=>u.side!==actor.side&&u.state==='ACTIVE'&&u.zone===c.zone);});if(windup)return windup.command;
 const attacks=options.filter(o=>['ATTACK','USE_ABILITY'].includes(o.command.kind)||o.command.kind==='TECHNIQUE'&&['DAMAGE','EFFECT'].includes(effect(o)??'')&&target(o)?.side!==actor.side);
 const score=(o:TacticalOption)=>{const u=target(o)!;return (role==='BRUTE'?-(s.battlefield!.rows[u.id]==='FRONT'?10:0):role==='ARTILLERY'?-(s.battlefield!.rows[u.id]==='BACK'?10:0):0)+u.health/u.stats.maxHealth*5-(o.hitChance??50)/100;};
 attacks.sort((a,b)=>score(a)-score(b)||(a.label<b.label?-1:1));if(attacks[0])return attacks[0].command;
 const opponents=s.units.filter(u=>u.side!==actor.side&&u.state==='ACTIVE').sort((a,b)=>a.health/a.stats.maxHealth-b.health/b.stats.maxHealth||(a.id<b.id?-1:1));
 const moves=options.filter(o=>o.command.kind==='MOVE');if(opponents[0]){const d=(o:TacticalOption)=>o.command.kind==='MOVE'?fieldDistance(r,o.command.zone,opponents[0]!.zone):Infinity;moves.sort((a,b)=>d(a)-d(b)||(a.label<b.label?-1:1));if(moves[0]&&d(moves[0])<fieldDistance(r,actor.zone,opponents[0].zone))return moves[0].command;}
 if(role==='SUPPORT'){const guard=options.find(o=>o.command.kind==='GUARD');if(guard)return guard.command;}
 return {actorId,kind:'END'};
}
