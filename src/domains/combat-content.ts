import { Ajv } from 'ajv';
import { DomainError } from '../foundation/errors.js';
import type { ContentEntity } from './content.js';
export type Chance={numerator:number;denominator:number};
export type Fighter={version:1;maxHealth:number;attack:{min:number;max:number;hit:Chance};armor:number;resistanceBps:number};
export type Profile=Fighter & {recoveryHealth:number};
export type CombatSpec={version:1;ruleset:'BASIC_DUEL_V1';access:'DISCOVERED_REPEATABLE';profileId:string;monsterId:string;roundLimit:number;retreat:Chance;failure:{kind:'RETURN_HOME';turnCost:number};gold?:{worldName:string;amount:number};campaignId?:string};
export type Campaign={version:1;finalEncounterId:string;requiresEncounterIds:string[]};
const ajv=new Ajv({strict:true,allErrors:true}),id={type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'},integer=(min:number,max:number)=>({type:'integer',minimum:min,maximum:max});
const chance={type:'object',additionalProperties:false,required:['numerator','denominator'],properties:{numerator:integer(0,1000000),denominator:integer(1,1000000)}};
const fighter={version:{type:'integer',const:1},maxHealth:integer(1,1000000),attack:{type:'object',additionalProperties:false,required:['min','max','hit'],properties:{min:integer(1,1000000),max:integer(1,1000000),hit:chance}},armor:integer(0,1000000),resistanceBps:integer(0,9999)};
const monsterValidator=ajv.compile({type:'object',additionalProperties:false,required:Object.keys(fighter),properties:fighter});
const profileValidator=ajv.compile({type:'object',additionalProperties:false,required:[...Object.keys(fighter),'recoveryHealth'],properties:{...fighter,recoveryHealth:integer(1,1000000)}});
const combatValidator=ajv.compile({type:'object',additionalProperties:false,required:['version','ruleset','access','profileId','monsterId','roundLimit','retreat','failure'],properties:{version:{type:'integer',const:1},ruleset:{type:'string',const:'BASIC_DUEL_V1'},access:{type:'string',const:'DISCOVERED_REPEATABLE'},profileId:id,monsterId:id,roundLimit:integer(1,1000),retreat:chance,failure:{type:'object',additionalProperties:false,required:['kind','turnCost'],properties:{kind:{type:'string',const:'RETURN_HOME'},turnCost:integer(1,3)}},gold:{type:'object',additionalProperties:false,required:['worldName','amount'],properties:{worldName:{type:'string',pattern:'^[a-z][a-z0-9_-]{0,79}$'},amount:integer(1,1000000)}},campaignId:id}});
const campaignValidator=ajv.compile({type:'object',additionalProperties:false,required:['version','finalEncounterId','requiresEncounterIds'],properties:{version:{type:'integer',const:1},finalEncounterId:id,requiresEncounterIds:{type:'array',uniqueItems:true,maxItems:32,items:id}}});
function validChance(c:Chance){return c.numerator<=c.denominator;}
export function validateFighter(value:unknown,profile=false):asserts value is Profile {
  if(!(profile?profileValidator:monsterValidator)(value)) throw new DomainError(400,'INVALID_COMBAT_FIGHTER');
  const f=value as Profile;
  if(f.attack.min>f.attack.max || !validChance(f.attack.hit) || (profile && f.recoveryHealth>f.maxHealth)) throw new DomainError(400,'INVALID_COMBAT_FIGHTER');
}
export function validateCombatSpec(value:unknown):asserts value is CombatSpec {
  if(!combatValidator(value) || !validChance((value as CombatSpec).retreat)) throw new DomainError(400,'INVALID_COMBAT_SPEC');
}
export function validateCampaign(value:unknown):asserts value is Campaign {
  if(!campaignValidator(value) || (value as Campaign).requiresEncounterIds.includes((value as Campaign).finalEncounterId)) throw new DomainError(400,'INVALID_CAMPAIGN_SPEC');
}
export function validateCombatReferences(entity:ContentEntity,entities:Map<string,ContentEntity>){
  const mechanics=entity.definition.mechanics;
  if(entity.kind==='MONSTER' && mechanics?.combatMonster!==undefined) validateFighter(mechanics.combatMonster);
  if(entity.kind==='TUNING' && mechanics?.combatProfile!==undefined) validateFighter(mechanics.combatProfile,true);
  if(entity.kind==='TUNING' && mechanics?.campaign!==undefined){
    validateCampaign(mechanics.campaign);
    const c=mechanics.campaign;
    const final=entities.get(c.finalEncounterId);
    if(final?.kind!=='ENCOUNTER' || (final.definition.mechanics?.combat as {campaignId?:string}|undefined)?.campaignId!==entity.id) throw new DomainError(400,'INVALID_CAMPAIGN_FINAL');
    validateCombatSpec(final.definition.mechanics?.combat);
    const finalSpec=final.definition.mechanics.combat;
    for(const id of c.requiresEncounterIds){
      const required=entities.get(id);
      if(required?.kind!=='ENCOUNTER' || !entity.definition.dependencies.includes(id)) throw new DomainError(400,'INVALID_CAMPAIGN_PREREQUISITE');
      validateCombatSpec(required.definition.mechanics?.combat);
      if(required.definition.mechanics.combat.profileId!==finalSpec.profileId) throw new DomainError(400,'CAMPAIGN_PROFILE_MISMATCH');
    }
  }
  if(entity.kind==='ENCOUNTER' && mechanics?.combat!==undefined){
    validateCombatSpec(mechanics.combat);const c=mechanics.combat;
    if((mechanics.encounter as {version?:number}|undefined)?.version!==2) throw new DomainError(400,'COMBAT_REQUIRES_AUTHORED_LOOT');
    for(const [id,kind,field] of [[c.profileId,'TUNING','combatProfile'],[c.monsterId,'MONSTER','combatMonster']] as const){
      const target=entities.get(id);
      if(target?.kind!==kind || !entity.definition.dependencies.includes(id)) throw new DomainError(400,'INVALID_COMBAT_REFERENCE');
      validateFighter(target.definition.mechanics?.[field],field==='combatProfile');
    }
    if(c.campaignId){const target=entities.get(c.campaignId);if(target?.kind!=='TUNING' || !entity.definition.dependencies.includes(c.campaignId)) throw new DomainError(400,'INVALID_CAMPAIGN_REFERENCE');validateCampaign(target.definition.mechanics?.campaign);if(target.definition.mechanics.campaign.finalEncounterId!==entity.id) throw new DomainError(400,'INVALID_CAMPAIGN_FINAL');}
  }
}
