import { validateTechniqueProfile,useTechnique,dropConcentration,reconcileConcentration,opportunityAbilities,type TechniqueProfile,type TechniqueIntent } from './tactical-techniques.js';
import { attributes,type StartingAttributes } from './build-content.js';
import { normalizeHealingAbilities,type HealingAbility,type HealingAbilityEvent } from './tactical-healing-abilities.js';
import { abilityResistance,normalizeAttackAbilities,type ResistanceEvent,type AttackAbility,type AbilityEvent } from './tactical-abilities.js';
import { validateStatusProfile,deriveStatusProfile,statusTagShape,type StatusRules,type StatusProfile,type StatusEvent } from './tactical-status.js';
import { normalizeCleanseAbilities,removeRoundEffect,type CleanseAbility,type CleansingEvent } from './tactical-cleansing.js';
import { decayBuildups,type BuildupState,normalizeEffectGrants,validatePeriodicGrants,applyOnHitEffects,applyOnHealEffects,pulseRoundEffects,type PeriodicEvent,tickRoundEffects,effectStats,type EffectGrant,type ActiveRoundEffect,type EffectEvent } from './tactical-effects.js';
import { typedDamageRulesShape,validateTypedDamageRules,resistanceFor,validateDamageProfile,type DamageProfile,type TypedDamageRules } from './tactical-damage.js';
import { Ajv } from 'ajv';
import { DomainError } from '../foundation/errors.js';
import { resolveAttack,validateStats,validateDamageRules,type CharacterStats,type DamageRules } from './character-mechanics.js';

/** Internal authoritative inputs only. Network intents must never supply these stats or rolls. */
export type TacticalUnit={companionRecoveryId?:string|null;carryEffects?:ActiveRoundEffect[];concentration?:{token:string;abilityId:string};buildups?:Record<string,BuildupState>;techniques?:TechniqueProfile;techniqueResources?:Record<string,number>;techniqueCooldowns?:Record<string,number>;checkAttributes?:StartingAttributes;checkSkills?:Record<string,number>;stabilized?:boolean;id:string;side:'PARTY'|'ENEMY';zone:string;stats:CharacterStats;health:number;strikes:number;state:'ACTIVE'|'DOWNED'|'DEFEATED';mana?:number;canHeal?:boolean;canGuard?:boolean;guardReady?:boolean;damageProfile?:DamageProfile;onHitEffects?:EffectGrant[];onHealEffects?:EffectGrant[];effects?:ActiveRoundEffect[];healingAbilities?:HealingAbility[];attackAbilities?:AttackAbility[];statusProfile?:StatusProfile;cleansingAbilities?:CleanseAbility[]};
export type TacticalRules={partyOwnership?:{version:1};surrender?:{version:1};surprise?:{unitId:string;initiativePenalty:number;loseMain:boolean;loseQuick:boolean;loseReaction:boolean}[];techniques?:{version:1};damage:DamageRules;zones:string[];edges:[string,string][];attackRange:number;healRange:number;healAmount:number;roundLimit:number;healManaCost?:number;guardArmorBonus?:number;retreatDifficulty?:number;healingAbilities?:{version:1};abilities?:{version:1|2};statusDefense?:StatusRules;typedDamage?:TypedDamageRules;roundEffects?:{version:1|2|3|4}};
export type TacticalState={version:1;round:number;revision:number;order:string[];cursor:number;units:TacticalUnit[];budgets:Record<string,{main:number;quick:number;reaction:number}>;outcome:null|'VICTORY'|'DEFEAT'|'FAILED_FORWARD'|'RETREAT'|'SURRENDER'};
export type TacticalIntent=TechniqueIntent|{actorId:string;kind:'DROP_CONCENTRATION'}|{actorId:string;kind:'USE_HEALING_ABILITY';targetId:string;abilityId:string;amount:number}|{actorId:string;kind:'USE_ABILITY';targetId:string;abilityId:string;roll:number;rawDamage:number}|{actorId:string;kind:'CLEANSE';targetId:string;abilityId:string;effectId:string}|{actorId:string;kind:'END'|'SURRENDER'}|{actorId:string;kind:'MOVE';zone:string;opportunities?:TechniqueIntent[]}|{actorId:string;kind:'ATTACK';targetId:string;roll:number;rawDamage:number}|{actorId:string;kind:'HEAL';targetId:string}|{actorId:string;kind:'GUARD'}|{actorId:string;kind:'RETREAT';roll:number};
function fail(code:string):never {throw new DomainError(409,code);}
const validateRulesShape=new Ajv({strict:true}).compile({type:'object',additionalProperties:false,required:['damage','zones','edges','attackRange','healRange','healAmount','roundLimit'],properties:{
 partyOwnership:{type:'object',additionalProperties:false,required:['version'],properties:{version:{const:1}}},surrender:{type:'object',additionalProperties:false,required:['version'],properties:{version:{const:1}}},surprise:{type:'array',maxItems:16,items:{type:'object',additionalProperties:false,required:['unitId','initiativePenalty','loseMain','loseQuick','loseReaction'],properties:{unitId:{type:'string',pattern:'^[a-z][a-z0-9_.-]{0,63}$'},initiativePenalty:{type:'integer',minimum:0,maximum:1000000},loseMain:{type:'boolean'},loseQuick:{type:'boolean'},loseReaction:{type:'boolean'}}}},techniques:{type:'object',additionalProperties:false,required:['version'],properties:{version:{const:1}}},damage:{type:'object'},zones:{type:'array',minItems:1,maxItems:32,uniqueItems:true,items:{type:'string',pattern:'^[a-z][a-z0-9_.-]{0,63}$'}},
 edges:{type:'array',maxItems:128,items:{type:'array',minItems:2,maxItems:2,items:{type:'string'}}},
 attackRange:{type:'integer',minimum:0,maximum:31},healRange:{type:'integer',minimum:0,maximum:31},healAmount:{type:'integer',minimum:1,maximum:1000000},roundLimit:{type:'integer',minimum:1,maximum:1000},
 healingAbilities:{type:'object',additionalProperties:false,required:['version'],properties:{version:{const:1}}},abilities:{type:'object',additionalProperties:false,required:['version'],properties:{version:{enum:[1,2]}}},statusDefense:{type:'object',additionalProperties:false,required:['version','tags'],properties:{version:{enum:[1,2]},tags:{type:'array',minItems:1,maxItems:32,uniqueItems:true,items:statusTagShape}}},healManaCost:{type:'integer',minimum:1,maximum:1000000},guardArmorBonus:{type:'integer',minimum:1,maximum:1000000},retreatDifficulty:{type:'integer',minimum:1,maximum:1000000},roundEffects:{type:'object',additionalProperties:false,required:['version'],properties:{version:{enum:[1,2,3,4]}}},typedDamage:typedDamageRulesShape
}});
export function validateTacticalRules(value:unknown):asserts value is TacticalRules {
 if(!validateRulesShape(value))fail('INVALID_TACTICAL_RULES');
  if((value as TacticalRules).statusDefense&&!(value as TacticalRules).roundEffects)fail('TACTICAL_STATUS_REQUIRES_EFFECTS');
 const r=value as TacticalRules;
  if(r.typedDamage?.version===3&&!r.roundEffects)fail('TACTICAL_CONDITIONAL_RESISTANCE_REQUIRES_EFFECTS');
  if(r.abilities&&!r.typedDamage)fail('TACTICAL_ABILITIES_REQUIRE_TYPED_DAMAGE');
  validateDamageRules(r.damage);
  if(r.typedDamage)validateTypedDamageRules(r.typedDamage);
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
  for(const u of input){validateStats(u.stats);if(u.techniques){if(!r.techniques)fail('TACTICAL_TECHNIQUES_DISABLED');validateTechniqueProfile(r,u.techniques);}if(u.concentration!==undefined||u.buildups!==undefined||u.techniqueResources!==undefined||u.techniqueCooldowns!==undefined||u.stabilized!==undefined)fail('INVALID_INITIAL_TACTICAL_TECHNIQUES');if(r.techniques&&(!u.checkAttributes||Object.keys(u.checkAttributes).length!==attributes.length||attributes.some(k=>!Number.isInteger(u.checkAttributes![k])||u.checkAttributes![k]<1||u.checkAttributes![k]>9999)||Object.entries(u.checkSkills??{}).some(([k,v])=>!/^([a-z][a-z0-9_.-]{2,119})$/.test(k)||!Number.isInteger(v)||v<0||v>5)))fail('INVALID_TACTICAL_CHECK_PROFILE');if(u.healingAbilities){if(!r.healingAbilities)fail('TACTICAL_HEALING_ABILITIES_DISABLED');normalizeHealingAbilities(u.healingAbilities);}if(u.attackAbilities){if(!r.abilities)fail('TACTICAL_ABILITIES_DISABLED');normalizeAttackAbilities(u.attackAbilities,r.typedDamage!);if(r.abilities.version===1&&u.attackAbilities.some(a=>a.spec.version===2))fail('TACTICAL_RESISTANCE_COUNTERPLAY_DISABLED');}if(u.statusProfile){if(!r.statusDefense)fail('TACTICAL_STATUS_DISABLED');validateStatusProfile(r.statusDefense,u.statusProfile);}if(u.onHitEffects){if(!r.roundEffects)fail('TACTICAL_EFFECTS_DISABLED');normalizeEffectGrants(u.onHitEffects);validatePeriodicGrants(u.onHitEffects,r.roundEffects.version,r.typedDamage?.types);}if(u.onHealEffects){if(!r.roundEffects||r.roundEffects.version<2)fail('TACTICAL_PERIODIC_EFFECTS_DISABLED');normalizeEffectGrants(u.onHealEffects);validatePeriodicGrants(u.onHealEffects,r.roundEffects.version,r.typedDamage?.types);}if(u.cleansingAbilities){if((r.roundEffects?.version??0)<3)fail('TACTICAL_CLEANSING_DISABLED');normalizeCleanseAbilities(u.cleansingAbilities);if(u.cleansingAbilities.some(a=>a.spec.version===2)&&r.roundEffects?.version!==4)fail('TACTICAL_REMOVE_CURSE_DISABLED');}if(u.carryEffects){if(r.roundEffects?.version!==4||u.carryEffects.length>32)fail('TACTICAL_PERSISTENT_EFFECTS_DISABLED');for(const e of u.carryEffects){normalizeEffectGrants([e]);if(e.effect.version!==4||e.effect.clock==='ROUNDS'||!Number.isInteger(e.remaining)||e.remaining<1||e.remaining>100||e.concentrationId)fail('INVALID_TACTICAL_CARRY_EFFECT');}}if(u.effects!==undefined)fail('INVALID_INITIAL_TACTICAL_EFFECTS');if(u.damageProfile){if(!r.typedDamage)fail('UNTYPED_TACTICAL_PROFILE');validateDamageProfile(r.typedDamage,u.damageProfile);}if(!/^[a-z][a-z0-9_.-]{0,63}$/.test(u.id)||!['PARTY','ENEMY'].includes(u.side)||!r.zones.includes(u.zone)||u.state!=='ACTIVE'||u.strikes!==0||!Number.isInteger(u.health)||u.health<1||u.health>u.stats.maxHealth||(u.mana!==undefined&&(!Number.isInteger(u.mana)||u.mana<0||u.mana>u.stats.maxMana)))fail('INVALID_TACTICAL_UNIT');}
  if(r.surprise&&(new Set(r.surprise.map(u=>u.unitId)).size!==r.surprise.length||r.surprise.some(u=>!input.some(v=>v.id===u.unitId))))fail('INVALID_TACTICAL_SURPRISE');
  if(r.partyOwnership&&input.filter(u=>u.side==='PARTY').length>6)fail('TACTICAL_PARTY_CAPACITY');
  const initiative=(u:TacticalUnit)=>u.stats.initiative-(r.surprise?.find(s=>s.unitId===u.id)?.initiativePenalty??0);
  const order=[...input].sort((a,b)=>initiative(b)-initiative(a)||(a.id<b.id?-1:1)).map(u=>u.id);
  const s:TacticalState={version:1,round:1,revision:0,order,cursor:0,units:structuredClone(input).map(u=>({...u,mana:u.mana??u.stats.maxMana,canHeal:u.canHeal??true,canGuard:u.canGuard??false,guardReady:false,...(r.techniques?{techniques:u.techniques??{version:1,abilities:[],maximums:{}},techniqueResources:structuredClone(u.techniques?.maximums??{}),techniqueCooldowns:{},stabilized:false}:{}),...(r.healingAbilities?{healingAbilities:normalizeHealingAbilities(u.healingAbilities??[])}:{}),...(r.abilities?{attackAbilities:normalizeAttackAbilities(u.attackAbilities??[],r.typedDamage!)}:{}),...(r.statusDefense?{statusProfile:u.statusProfile??deriveStatusProfile(r.statusDefense,[])}:{}),...((r.roundEffects?.version??0)>=3?{cleansingAbilities:normalizeCleanseAbilities(u.cleansingAbilities??[])}:{}),...(r.roundEffects?{onHitEffects:normalizeEffectGrants(u.onHitEffects??[]),effects:structuredClone(u.carryEffects??[]),...(r.roundEffects.version===4?{buildups:{}}:{}),...(r.roundEffects.version>=2?{onHealEffects:normalizeEffectGrants(u.onHealEffects??[])}:{})}: {})})),budgets:{},outcome:null};resetBudgets(s);for(const surprised of r.surprise??[]){const b=s.budgets[surprised.unitId]!;if(surprised.loseMain)b.main=0;if(surprised.loseQuick)b.quick=0;if(surprised.loseReaction)b.reaction=0;}return s;
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
  const controls=new Set((actor.effects??[]).flatMap(e=>e.effect.version===4&&e.effect.control?[e.effect.control]:[]));
  if(intent.kind!=='END'&&controls.has('STUN'))fail('TACTICAL_ACTOR_STUNNED');
  if(intent.kind==='MOVE'&&controls.has('ROOT'))fail('TACTICAL_ACTOR_ROOTED');
  if((intent.kind==='ATTACK'||intent.kind==='USE_ABILITY')&&controls.has('DISARM'))fail('TACTICAL_ACTOR_DISARMED');
  if(intent.kind==='GUARD'&&controls.has('REACTION_LOCK'))fail('TACTICAL_REACTION_SUPPRESSED');
  if(intent.kind!=='END'&&controls.has('DAZED')&&(budget.main===0||budget.quick===0))fail('TACTICAL_ACTOR_DAZED');
  let attack:ReturnType<typeof resolveAttack>|null=null;
  let damageType:string|undefined;
  const effectEvents:EffectEvent[]=[],periodicEvents:PeriodicEvent[]=[];
  const actorStats=effectStats(actor),cleansingEvents:CleansingEvent[]=[],statusEvents:StatusEvent[]=[],abilityEvents:AbilityEvent[]=[],healingAbilityEvents:HealingAbilityEvent[]=[],resistanceEvents:ResistanceEvent[]=[];
  const buildupEvents:ReturnType<typeof decayBuildups>=[];
  const opportunityEvents:ReturnType<typeof useTechnique>[]=[];
  let concentrationEnded:ReturnType<typeof dropConcentration>=null;
  let technique:ReturnType<typeof useTechnique>|null=null;
  if(intent.kind==='TECHNIQUE'){technique=useTechnique(r,s,intent);effectEvents.push(...technique.effectEvents);statusEvents.push(...technique.statusEvents);}
  else if(intent.kind==='DROP_CONCENTRATION'){if(!r.techniques||!actor.concentration)fail('NO_TACTICAL_CONCENTRATION');concentrationEnded=dropConcentration(s,actor.id);}
  else if(intent.kind==='CLEANSE'){
    const ability=actor.cleansingAbilities?.find(a=>a.id===intent.abilityId),target=s.units.find(u=>u.id===intent.targetId);
    if((r.roundEffects?.version??0)<3||budget.main!==1||!ability||!target||target.state==='DEFEATED'||(ability.spec.targetSide==='ALLY'?target.side!==actor.side:target.side===actor.side)||tacticalDistance(r,actor.zone,target.zone)>ability.spec.range)fail('ILLEGAL_TACTICAL_CLEANSING');
    cleansingEvents.push(removeRoundEffect(actor,target,intent.abilityId,intent.effectId));budget.main=0;
  }else if(intent.kind==='MOVE') {
    if(budget.quick!==1||tacticalDistance(r,actor.zone,intent.zone)!==1)fail('ILLEGAL_TACTICAL_MOVE');
    const threats=opportunityAbilities(r,s,actor,intent.zone);const reactions=intent.opportunities??[];if(reactions.length!==threats.length||reactions.some((v,i)=>v.kind!=='TECHNIQUE'||v.actorId!==threats[i]!.actor.id||v.abilityId!==threats[i]!.ability.id||v.targetId!==actor.id))fail('INVALID_TACTICAL_OPPORTUNITY');
    budget.quick=0;for(const reaction of reactions){if(actor.state!=='ACTIVE')break;opportunityEvents.push(useTechnique(r,s,reaction,true));}if(actor.state==='ACTIVE')actor.zone=intent.zone;
  } else if(intent.kind==='GUARD') {
    if(!actor.canGuard||budget.quick!==1||!r.guardArmorBonus)fail('ILLEGAL_TACTICAL_GUARD');
    actor.guardReady=true;budget.quick=0;
  } else if(intent.kind==='SURRENDER'){if(!r.surrender||actor.side!=='PARTY'||budget.main!==1)fail('ILLEGAL_TACTICAL_SURRENDER');budget.main=0;s.outcome='SURRENDER';
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
      target.health=Math.min(target.stats.maxHealth,target.health+amount);target.state='ACTIVE';target.strikes=0;if(r.techniques)target.stabilized=false;
      if(ability)healingAbilityEvents.push({actorId:actor.id,targetId:target.id,abilityId:ability.id,sourceRevision:ability.sourceRevision,sourceInstanceIds:[...ability.sourceInstanceIds],manaCost:cost,amount,healthBefore,healthAfter:target.health,stateBefore,stateAfter:target.state,strikesBefore,strikesAfter:target.strikes});
      if((r.roundEffects?.version??0)>=2)effectEvents.push(...applyOnHealEffects(target,actor,s.revision+1,r.statusDefense?statusEvents:undefined));
    } else {
      const ability=intent.kind==='USE_ABILITY'?actor.attackAbilities?.find(a=>a.id===intent.abilityId):undefined;
      if(intent.kind==='USE_ABILITY'&&(!r.abilities||!ability||(actor.mana??0)<ability.spec.manaCost))fail('ILLEGAL_TACTICAL_ABILITY');
      const min=ability?.spec.damage.min??actor.stats.attackMin,max=ability?.spec.damage.max??actor.stats.attackMax;
      if(target.side===actor.side||tacticalDistance(r,actor.zone,target.zone)>(ability?.spec.range??r.attackRange)||!Number.isInteger(intent.rawDamage)||intent.rawDamage<min||intent.rawDamage>max)fail('ILLEGAL_TACTICAL_ATTACK');
      if(ability){actor.mana=(actor.mana??0)-ability.spec.manaCost;abilityEvents.push({actorId:actor.id,targetId:target.id,abilityId:ability.id,sourceRevision:ability.sourceRevision,sourceInstanceIds:[...ability.sourceInstanceIds],manaCost:ability.spec.manaCost});}
      const attackType=ability?.spec.damage.type??actor.damageProfile?.attackType??r.typedDamage?.defaultType;
      if(ability?.spec.version===2&&r.abilities?.version!==2)fail('TACTICAL_RESISTANCE_COUNTERPLAY_DISABLED');
      const resistance=abilityResistance(ability?.spec,r.typedDamage?resistanceFor(target.damageProfile,attackType!,target.effects?.flatMap(e=>e.effect.tags)??[]):0);
      if(ability?.spec.version===2)resistanceEvents.push({actorId:actor.id,targetId:target.id,abilityId:ability.id,damageType:attackType!,...resistance});
      const targetStats=effectStats(target);
      const reacting=Boolean(target.state==='ACTIVE'&&target.guardReady&&target.canGuard&&!(target.effects??[]).some(e=>e.effect.version===4&&['STUN','REACTION_LOCK'].includes(e.effect.control??''))&&s.budgets[target.id]!.reaction===1);
      attack=resolveAttack({...r.damage,check:{...r.damage.check,attributeBaseline:1}},{check:{roll:intent.roll,attributeScore:1,proficiencyRank:0,situationalModifier:Math.max(-1000000,Math.min(1000000,actorStats.accuracy+(ability?.spec.accuracyModifier??0))),difficulty:targetStats.evasion},rawDamage:intent.rawDamage,armor:Math.min(1000000,targetStats.armor+(reacting?(r.guardArmorBonus??0):0)),penetration:r.typedDamage?(ability?.spec.damage.penetration??actor.damageProfile?.penetration??0):0,resistanceBps:resistance.effectiveResistanceBps});
      if(r.typedDamage)damageType=attackType;
      if(reacting){target.guardReady=false;s.budgets[target.id]!.reaction=0;}
      if(attack.damage>0){if(target.state==='DOWNED'){if(target.stabilized)target.stabilized=false;else target.strikes++;if(target.strikes>=2)target.state='DEFEATED';}else {target.health=Math.max(0,target.health-attack.damage);if(target.health===0){target.state=target.side==='ENEMY'?'DEFEATED':'DOWNED';target.guardReady=false;}}}
      if(r.roundEffects&&attack.check.success&&target.state==='ACTIVE')effectEvents.push(...applyOnHitEffects(target,actor,s.revision+1,r.statusDefense?statusEvents:undefined));
    }
    budget.main=0;
  } else if(intent.kind!=='END')fail('INVALID_TACTICAL_INTENT');
  // A reactive/self-inflicted incapacitation ends the active turn as well.
  // Keep this opt-in so historical transitions retain their original shape.
  const turnInterrupted=Boolean(r.techniques)&&intent.kind!=='END'&&actor.state!=='ACTIVE';
  const turnEnded=intent.kind==='END'||turnInterrupted;
  if(r.roundEffects&&turnEnded){
   if(r.roundEffects.version>=2)periodicEvents.push(...pulseRoundEffects(actor,'OWNER_END'));
   effectEvents.push(...tickRoundEffects(actor));if(r.roundEffects.version===4)buildupEvents.push(...decayBuildups(actor));
  }
  const concentrationEvents=r.techniques?reconcileConcentration(s):[];
  if(s.outcome===null&&!s.units.some(u=>u.side==='ENEMY'&&u.state==='ACTIVE'))s.outcome='VICTORY';
  else if(s.outcome===null&&!s.units.some(u=>u.side==='PARTY'&&u.state==='ACTIVE'))s.outcome='DEFEAT';
  if(s.outcome===null&&turnEnded) {
    do {s.cursor++;if(s.cursor===s.order.length){s.cursor=0;s.round++;resetBudgets(s);if(s.round>r.roundLimit){s.outcome='FAILED_FORWARD';break;}}}while(s.units.find(u=>u.id===s.order[s.cursor])!.state!=='ACTIVE');
    if(s.outcome===null&&(r.roundEffects?.version??0)>=2)periodicEvents.push(...pulseRoundEffects(s.units.find(u=>u.id===s.order[s.cursor])!,'OWNER_START'));
  }
  s.revision++;return {state:s,evidence:{intent:structuredClone(intent),attack,...(r.techniques?{technique,concentrationEnded,concentrationEvents,opportunityEvents,turnInterrupted}:{}),...(damageType?{damageType}:{}),...(r.roundEffects?.version===4?{buildupEvents}:{}),...(r.roundEffects?{effectEvents}:{}),...((r.roundEffects?.version??0)>=2?{periodicEvents}:{}),...((r.roundEffects?.version??0)>=3?{cleansingEvents}:{}),...(r.statusDefense?{statusEvents}:{}),...(r.abilities?{abilityEvents}:{}),...(r.abilities?.version===2?{resistanceEvents}:{}),...(r.healingAbilities?{healingAbilityEvents}:{})}};
}
