import { normalizeHealingAbilities,type HealingAbility,type HealingAbilityEvent } from './tactical-healing-abilities.js';
import { normalizeAttackAbilities,type AttackAbility,type AbilityEvent } from './tactical-abilities.js';
import { validateStatusProfile,deriveStatusProfile,statusTagShape,type StatusRules,type StatusProfile,type StatusEvent } from './tactical-status.js';
import { normalizeCleanseAbilities,removeRoundEffect,type CleanseAbility,type CleansingEvent } from './tactical-cleansing.js';
import { normalizeEffectGrants,validatePeriodicGrants,applyOnHitEffects,applyOnHealEffects,pulseRoundEffects,type PeriodicEvent,tickRoundEffects,effectStats,type EffectGrant,type ActiveRoundEffect,type EffectEvent } from './tactical-effects.js';
import { resistanceFor,validateDamageProfile,type DamageProfile,type TypedDamageRules } from './tactical-damage.js';
import { Ajv } from 'ajv';
import { DomainError } from '../foundation/errors.js';
import { resolveAttack,validateStats,validateDamageRules,type CharacterStats,type DamageRules } from './character-mechanics.js';

/** Internal authoritative inputs only. Network intents must never supply these stats or rolls. */
export type TacticalUnit={id:string;side:'PARTY'|'ENEMY';zone:string;stats:CharacterStats;health:number;strikes:number;state:'ACTIVE'|'DOWNED'|'DEFEATED';mana?:number;canHeal?:boolean;canGuard?:boolean;guardReady?:boolean;damageProfile?:DamageProfile;onHitEffects?:EffectGrant[];onHealEffects?:EffectGrant[];effects?:ActiveRoundEffect[];healingAbilities?:HealingAbility[];attackAbilities?:AttackAbility[];statusProfile?:StatusProfile;cleansingAbilities?:CleanseAbility[]};
export type TacticalRules={damage:DamageRules;zones:string[];edges:[string,string][];attackRange:number;healRange:number;healAmount:number;roundLimit:number;healManaCost?:number;guardArmorBonus?:number;retreatDifficulty?:number;healingAbilities?:{version:1};abilities?:{version:1};statusDefense?:StatusRules;typedDamage?:TypedDamageRules;roundEffects?:{version:1|2|3}};
export type TacticalState={version:1;round:number;revision:number;order:string[];cursor:number;units:TacticalUnit[];budgets:Record<string,{main:number;quick:number;reaction:number}>;outcome:null|'VICTORY'|'DEFEAT'|'FAILED_FORWARD'|'RETREAT'};
export type TacticalIntent={actorId:string;kind:'USE_HEALING_ABILITY';targetId:string;abilityId:string;amount:number}|{actorId:string;kind:'USE_ABILITY';targetId:string;abilityId:string;roll:number;rawDamage:number}|{actorId:string;kind:'CLEANSE';targetId:string;abilityId:string;effectId:string}|{actorId:string;kind:'END'}|{actorId:string;kind:'MOVE';zone:string}|{actorId:string;kind:'ATTACK';targetId:string;roll:number;rawDamage:number}|{actorId:string;kind:'HEAL';targetId:string}|{actorId:string;kind:'GUARD'}|{actorId:string;kind:'RETREAT';roll:number};
function fail(code:string):never {throw new DomainError(409,code);}
const validateRulesShape=new Ajv({strict:true}).compile({type:'object',additionalProperties:false,required:['damage','zones','edges','attackRange','healRange','healAmount','roundLimit'],properties:{
 damage:{type:'object'},zones:{type:'array',minItems:1,maxItems:32,uniqueItems:true,items:{type:'string',pattern:'^[a-z][a-z0-9_.-]{0,63}$'}},
 edges:{type:'array',maxItems:128,items:{type:'array',minItems:2,maxItems:2,items:{type:'string'}}},
 attackRange:{type:'integer',minimum:0,maximum:31},healRange:{type:'integer',minimum:0,maximum:31},healAmount:{type:'integer',minimum:1,maximum:1000000},roundLimit:{type:'integer',minimum:1,maximum:1000},
 healingAbilities:{type:'object',additionalProperties:false,required:['version'],properties:{version:{const:1}}},abilities:{type:'object',additionalProperties:false,required:['version'],properties:{version:{const:1}}},statusDefense:{type:'object',additionalProperties:false,required:['version','tags'],properties:{version:{const:1},tags:{type:'array',minItems:1,maxItems:32,uniqueItems:true,items:statusTagShape}}},healManaCost:{type:'integer',minimum:1,maximum:1000000},guardArmorBonus:{type:'integer',minimum:1,maximum:1000000},retreatDifficulty:{type:'integer',minimum:1,maximum:1000000},roundEffects:{type:'object',additionalProperties:false,required:['version'],properties:{version:{enum:[1,2,3]}}},typedDamage:{type:'object',additionalProperties:false,required:['version','types','defaultType','resistanceStacking'],properties:{version:{const:1},types:{type:'array',minItems:1,maxItems:32,uniqueItems:true,items:{type:'string',pattern:'^[a-z][a-z0-9_.-]{0,63}$'}},defaultType:{type:'string'},resistanceStacking:{const:'SUM_CAPPED'}}}
}});
export function validateTacticalRules(value:unknown):asserts value is TacticalRules {
 if(!validateRulesShape(value))fail('INVALID_TACTICAL_RULES');
  if((value as TacticalRules).statusDefense&&!(value as TacticalRules).roundEffects)fail('TACTICAL_STATUS_REQUIRES_EFFECTS');
 const r=value as TacticalRules;
  if(r.abilities&&!r.typedDamage)fail('TACTICAL_ABILITIES_REQUIRE_TYPED_DAMAGE');
  validateDamageRules(r.damage);
  if(r.typedDamage&&!r.typedDamage.types.includes(r.typedDamage.defaultType))fail('INVALID_TACTICAL_DAMAGE_TYPE');
  if(r.zones.length<1||r.zones.length>32||new Set(r.zones).size!==r.zones.length||r.zones.some(z=>!/^[a-z][a-z0-9_.-]{0,63}$/.test(z))||r.edges.length>128||
    r.edges.some(([a,b])=>a===b||!r.zones.includes(a)||!r.zones.includes(b))||
    [r.attackRange,r.healRange].some(n=>!Number.isInteger(n)||n<0||n>31)||!Number.isInteger(r.healAmount)||r.healAmount<1||r.healAmount>1000000||!Number.isInteger(r.roundLimit)||r.roundLimit<1||r.roundLimit>1000)fail('INVALID_TACTICAL_RULES');
}
export function tacticalDistance(r:TacticalRules,a:string,b:string) {
  const seen=new Set([a]),queue:[string,number][]=[[a,0]];
  for(const [zone,n] of queue) {if(zone===b)return n;for(const [x,y] of r.edges){const next=x===zone?y:y===zone?x:null;if(next!==null&&!seen.has(next)){seen.add(next);queue.push([next,n+1]);}}}
  return Infinity;
}
function resetBudgets(s:TacticalState) {s.budgets=Object.fromEntries(s.units.map(u=>[u.id,{main:1,quick:1,reaction:1}]));}
export function startTactical(r:TacticalRules,input:TacticalUnit[]):TacticalState {
  validateTacticalRules(r);
  if(input.length<2||input.length>16||new Set(input.map(u=>u.id)).size!==input.length||!input.some(u=>u.side==='PARTY')||!input.some(u=>u.side==='ENEMY'))fail('INVALID_TACTICAL_PARTY');
  for(const u of input){validateStats(u.stats);if(u.healingAbilities){if(!r.healingAbilities)fail('TACTICAL_HEALING_ABILITIES_DISABLED');normalizeHealingAbilities(u.healingAbilities);}if(u.attackAbilities){if(!r.abilities)fail('TACTICAL_ABILITIES_DISABLED');normalizeAttackAbilities(u.attackAbilities,r.typedDamage!);}if(u.statusProfile){if(!r.statusDefense)fail('TACTICAL_STATUS_DISABLED');validateStatusProfile(r.statusDefense,u.statusProfile);}if(u.onHitEffects){if(!r.roundEffects)fail('TACTICAL_EFFECTS_DISABLED');normalizeEffectGrants(u.onHitEffects);validatePeriodicGrants(u.onHitEffects,r.roundEffects.version,r.typedDamage?.types);}if(u.onHealEffects){if(!r.roundEffects||r.roundEffects.version<2)fail('TACTICAL_PERIODIC_EFFECTS_DISABLED');normalizeEffectGrants(u.onHealEffects);validatePeriodicGrants(u.onHealEffects,r.roundEffects.version,r.typedDamage?.types);}if(u.cleansingAbilities){if(r.roundEffects?.version!==3)fail('TACTICAL_CLEANSING_DISABLED');normalizeCleanseAbilities(u.cleansingAbilities);}if(u.effects!==undefined)fail('INVALID_INITIAL_TACTICAL_EFFECTS');if(u.damageProfile){if(!r.typedDamage)fail('UNTYPED_TACTICAL_PROFILE');validateDamageProfile(r.typedDamage,u.damageProfile);}if(!/^[a-z][a-z0-9_.-]{0,63}$/.test(u.id)||!['PARTY','ENEMY'].includes(u.side)||!r.zones.includes(u.zone)||u.state!=='ACTIVE'||u.strikes!==0||!Number.isInteger(u.health)||u.health<1||u.health>u.stats.maxHealth||(u.mana!==undefined&&(!Number.isInteger(u.mana)||u.mana<0||u.mana>u.stats.maxMana)))fail('INVALID_TACTICAL_UNIT');}
  const order=[...input].sort((a,b)=>b.stats.initiative-a.stats.initiative||(a.id<b.id?-1:1)).map(u=>u.id);
  const s:TacticalState={version:1,round:1,revision:0,order,cursor:0,units:structuredClone(input).map(u=>({...u,mana:u.mana??u.stats.maxMana,canHeal:u.canHeal??true,canGuard:u.canGuard??false,guardReady:false,...(r.healingAbilities?{healingAbilities:normalizeHealingAbilities(u.healingAbilities??[])}:{}),...(r.abilities?{attackAbilities:normalizeAttackAbilities(u.attackAbilities??[],r.typedDamage!)}:{}),...(r.statusDefense?{statusProfile:u.statusProfile??deriveStatusProfile(r.statusDefense,[])}:{}),...(r.roundEffects?.version===3?{cleansingAbilities:normalizeCleanseAbilities(u.cleansingAbilities??[])}:{}),...(r.roundEffects?{onHitEffects:normalizeEffectGrants(u.onHitEffects??[]),effects:[],...(r.roundEffects.version>=2?{onHealEffects:normalizeEffectGrants(u.onHealEffects??[])}:{})}: {})})),budgets:{},outcome:null};resetBudgets(s);return s;
}
/** Pure transition: rejected actions cannot mutate the caller's checkpoint.
 * Rolls are supplied by the encounter journal adapter, never generated here.
 */
export function stepTactical(r:TacticalRules,previous:TacticalState,expectedRevision:number,intent:TacticalIntent) {
  validateTacticalRules(r);
  if(previous.revision!==expectedRevision)fail('STALE_TACTICAL_REVISION');
  if(previous.outcome!==null)fail('TACTICAL_RESOLVED');
  const s=structuredClone(previous),actor=s.units.find(u=>u.id===intent.actorId);
  if(!actor||s.order[s.cursor]!==actor.id||actor.state!=='ACTIVE')fail('NOT_TACTICAL_TURN');
  const budget=s.budgets[actor.id]!;
  let attack:ReturnType<typeof resolveAttack>|null=null;
  let damageType:string|undefined;
  const effectEvents:EffectEvent[]=[],periodicEvents:PeriodicEvent[]=[];
  const actorStats=effectStats(actor),cleansingEvents:CleansingEvent[]=[],statusEvents:StatusEvent[]=[],abilityEvents:AbilityEvent[]=[],healingAbilityEvents:HealingAbilityEvent[]=[];
  if(intent.kind==='CLEANSE'){
    const ability=actor.cleansingAbilities?.find(a=>a.id===intent.abilityId),target=s.units.find(u=>u.id===intent.targetId);
    if(r.roundEffects?.version!==3||budget.main!==1||!ability||!target||target.state==='DEFEATED'||(ability.spec.targetSide==='ALLY'?target.side!==actor.side:target.side===actor.side)||tacticalDistance(r,actor.zone,target.zone)>ability.spec.range)fail('ILLEGAL_TACTICAL_CLEANSING');
    cleansingEvents.push(removeRoundEffect(actor,target,intent.abilityId,intent.effectId));budget.main=0;
  }else if(intent.kind==='MOVE') {
    if(budget.quick!==1||tacticalDistance(r,actor.zone,intent.zone)!==1)fail('ILLEGAL_TACTICAL_MOVE');
    actor.zone=intent.zone;budget.quick=0;
  } else if(intent.kind==='GUARD') {
    if(!actor.canGuard||budget.quick!==1||!r.guardArmorBonus)fail('ILLEGAL_TACTICAL_GUARD');
    actor.guardReady=true;budget.quick=0;
  } else if(intent.kind==='RETREAT') {
    if(actor.side!=='PARTY'||budget.main!==1||!Number.isInteger(intent.roll)||intent.roll<1||intent.roll>20)fail('ILLEGAL_TACTICAL_RETREAT');
    budget.main=0;if(intent.roll+actorStats.accuracy>=(r.retreatDifficulty??15))s.outcome='RETREAT';
  } else if(intent.kind==='ATTACK'||intent.kind==='HEAL'||intent.kind==='USE_ABILITY'||intent.kind==='USE_HEALING_ABILITY') {
    if(budget.main!==1)fail('TACTICAL_MAIN_SPENT');
    const target=s.units.find(u=>u.id===intent.targetId);if(!target||target.state==='DEFEATED')fail('INVALID_TACTICAL_TARGET');
    if(intent.kind==='HEAL'||intent.kind==='USE_HEALING_ABILITY') {
      const ability=intent.kind==='USE_HEALING_ABILITY'?actor.healingAbilities?.find(a=>a.id===intent.abilityId):undefined;
      if(intent.kind==='USE_HEALING_ABILITY'&&(!r.healingAbilities||!ability||!Number.isInteger(intent.amount)||intent.amount<ability.spec.min||intent.amount>ability.spec.max))fail('ILLEGAL_TACTICAL_HEALING_ABILITY');
      const amount=intent.kind==='USE_HEALING_ABILITY'?intent.amount:r.healAmount,cost=ability?.spec.manaCost??r.healManaCost??0;
      const healthBefore=target.health,stateBefore=target.state,strikesBefore=target.strikes;
      if((!ability&&!actor.canHeal)||(actor.mana??0)<cost||target.side!==actor.side||tacticalDistance(r,actor.zone,target.zone)>(ability?.spec.range??r.healRange))fail('ILLEGAL_TACTICAL_HEAL');
      actor.mana=(actor.mana??0)-cost;
      target.health=Math.min(target.stats.maxHealth,target.health+amount);target.state='ACTIVE';target.strikes=0;
      if(ability)healingAbilityEvents.push({actorId:actor.id,targetId:target.id,abilityId:ability.id,sourceRevision:ability.sourceRevision,sourceInstanceIds:[...ability.sourceInstanceIds],manaCost:cost,amount,healthBefore,healthAfter:target.health,stateBefore,stateAfter:target.state,strikesBefore,strikesAfter:target.strikes});
      if((r.roundEffects?.version??0)>=2)effectEvents.push(...applyOnHealEffects(target,actor,s.revision+1,r.statusDefense?statusEvents:undefined));
    } else {
      const ability=intent.kind==='USE_ABILITY'?actor.attackAbilities?.find(a=>a.id===intent.abilityId):undefined;
      if(intent.kind==='USE_ABILITY'&&(!r.abilities||!ability||(actor.mana??0)<ability.spec.manaCost))fail('ILLEGAL_TACTICAL_ABILITY');
      const min=ability?.spec.damage.min??actor.stats.attackMin,max=ability?.spec.damage.max??actor.stats.attackMax;
      if(target.side===actor.side||tacticalDistance(r,actor.zone,target.zone)>(ability?.spec.range??r.attackRange)||!Number.isInteger(intent.rawDamage)||intent.rawDamage<min||intent.rawDamage>max)fail('ILLEGAL_TACTICAL_ATTACK');
      if(ability){actor.mana=(actor.mana??0)-ability.spec.manaCost;abilityEvents.push({actorId:actor.id,targetId:target.id,abilityId:ability.id,sourceRevision:ability.sourceRevision,sourceInstanceIds:[...ability.sourceInstanceIds],manaCost:ability.spec.manaCost});}
      const attackType=ability?.spec.damage.type??actor.damageProfile?.attackType??r.typedDamage?.defaultType;
      const targetStats=effectStats(target);
      const reacting=Boolean(target.state==='ACTIVE'&&target.guardReady&&target.canGuard&&s.budgets[target.id]!.reaction===1);
      attack=resolveAttack({...r.damage,check:{...r.damage.check,attributeBaseline:1}},{check:{roll:intent.roll,attributeScore:1,proficiencyRank:0,situationalModifier:Math.max(-1000000,Math.min(1000000,actorStats.accuracy+(ability?.spec.accuracyModifier??0))),difficulty:targetStats.evasion},rawDamage:intent.rawDamage,armor:Math.min(1000000,targetStats.armor+(reacting?(r.guardArmorBonus??0):0)),penetration:r.typedDamage?(ability?.spec.damage.penetration??actor.damageProfile?.penetration??0):0,resistanceBps:r.typedDamage?resistanceFor(target.damageProfile,attackType!):0});
      if(r.typedDamage)damageType=attackType;
      if(reacting){target.guardReady=false;s.budgets[target.id]!.reaction=0;}
      if(attack.damage>0){if(target.state==='DOWNED'){target.strikes++;if(target.strikes>=2)target.state='DEFEATED';}else {target.health=Math.max(0,target.health-attack.damage);if(target.health===0){target.state=target.side==='ENEMY'?'DEFEATED':'DOWNED';target.guardReady=false;}}}
      if(r.roundEffects&&attack.check.success&&target.state==='ACTIVE')effectEvents.push(...applyOnHitEffects(target,actor,s.revision+1,r.statusDefense?statusEvents:undefined));
    }
    budget.main=0;
  } else if(intent.kind!=='END')fail('INVALID_TACTICAL_INTENT');
  if(r.roundEffects&&intent.kind==='END'){
   if(r.roundEffects.version>=2)periodicEvents.push(...pulseRoundEffects(actor,'OWNER_END'));
   effectEvents.push(...tickRoundEffects(actor));
  }
  if(s.outcome===null&&!s.units.some(u=>u.side==='ENEMY'&&u.state==='ACTIVE'))s.outcome='VICTORY';
  else if(s.outcome===null&&!s.units.some(u=>u.side==='PARTY'&&u.state==='ACTIVE'))s.outcome='DEFEAT';
  if(s.outcome===null&&intent.kind==='END') {
    do {s.cursor++;if(s.cursor===s.order.length){s.cursor=0;s.round++;resetBudgets(s);if(s.round>r.roundLimit){s.outcome='FAILED_FORWARD';break;}}}while(s.units.find(u=>u.id===s.order[s.cursor])!.state!=='ACTIVE');
    if(s.outcome===null&&(r.roundEffects?.version??0)>=2)periodicEvents.push(...pulseRoundEffects(s.units.find(u=>u.id===s.order[s.cursor])!,'OWNER_START'));
  }
  s.revision++;return {state:s,evidence:{intent:structuredClone(intent),attack,...(damageType?{damageType}:{}),...(r.roundEffects?{effectEvents}:{}),...((r.roundEffects?.version??0)>=2?{periodicEvents}:{}),...(r.roundEffects?.version===3?{cleansingEvents}:{}),...(r.statusDefense?{statusEvents}:{}),...(r.abilities?{abilityEvents}:{}),...(r.healingAbilities?{healingAbilityEvents}:{})}};
}
