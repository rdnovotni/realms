import type pg from 'pg';
import type { ActionContext } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';
import type { TacticalSpec } from './tactical-content.js';
import type { TacticalState } from './tactical-engine.js';
import { applyOnHitEffects,validateRoundEffect,type ActiveRoundEffect,type EffectGrant } from './tactical-effects.js';
/** Combat clock transitions are journaled with the encounter settlement. They do
 * not consume generic world effects or synthesize elapsed World Time. */
export async function readCarryEffects(client:pg.PoolClient,instanceId:string|null):Promise<ActiveRoundEffect[]>{
 if(!instanceId)return [];const row=(await client.query('SELECT effects FROM tactical_effect_carryovers WHERE instance_id=$1',[instanceId])).rows[0];return structuredClone(row?.effects??[]) as ActiveRoundEffect[];
}
export async function loadCarryEffects(client:pg.PoolClient,runId:string){const row=(await client.query('SELECT last_instance_id FROM tactical_run_state WHERE run_id=$1',[runId])).rows[0];return readCarryEffects(client,row?.last_instance_id??null);}
export async function loadInjuryGrant(client:pg.PoolClient,releaseId:string,definitionId:string,spec:TacticalSpec):Promise<EffectGrant|undefined>{
 const effectId=spec.failure.injuryEffectId;if(!effectId)return undefined;
 const row=(await client.query("SELECT e.revision,v.definition->'mechanics'->'tacticalRoundEffect' AS effect FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=$1 AND e.entity_id=$2",[releaseId,effectId])).rows[0];validateRoundEffect(row?.effect);
 const source=(await client.query('SELECT revision FROM release_entries WHERE release_id=$1 AND entity_id=$2',[releaseId,definitionId])).rows[0];if(!source)throw new DomainError(409,'TACTICAL_INJURY_SOURCE_NOT_PINNED');
 return {effectId,effectRevision:row!.revision as number,sourceId:definitionId,sourceRevision:source.revision as number,effect:row!.effect};
}
export function deriveCarryEffects(spec:TacticalSpec,state:TacticalState,turnCost:number,injury?:EffectGrant,unitId='hero'){
 const hero=state.units.find(u=>u.id===unitId)!,effects=structuredClone(hero.effects??[]).filter(e=>e.effect.clock!=='ROUNDS');
 for(const e of effects){if(e.effect.clock==='ENCOUNTERS')e.remaining--;if(e.effect.clock==='ADVENTURE_TURNS')e.remaining-=1+turnCost;}
 const owner={id:unitId,effects:effects.filter(e=>e.remaining>0)};
 if(injury&&['DEFEAT','FAILED_FORWARD','SURRENDER'].includes(state.outcome??''))applyOnHitEffects(owner,{id:'environment',onHitEffects:[injury]},state.revision);
 return owner.effects;
}
export async function settleCarryEffects(c:ActionContext,instanceId:string,spec:TacticalSpec,state:TacticalState,turnCost:number){
 const id=(await c.client.query('SELECT definition_id FROM encounter_records WHERE instance_id=$1',[instanceId])).rows[0].definition_id as string;
 const injury=await loadInjuryGrant(c.client,c.run.content_release_id!,id,spec),effects=deriveCarryEffects(spec,state,turnCost,injury);
 await c.client.query('INSERT INTO tactical_effect_carryovers(instance_id,run_id,action_id,effects) VALUES($1,$2,$3,$4)',[instanceId,c.run.id,c.actionId,JSON.stringify(effects)]);
}
