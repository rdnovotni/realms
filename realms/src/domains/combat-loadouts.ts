import type { ActionContext } from '../foundation/action.js';
import type { CharacterInputs } from './character-snapshots.js';
import { deriveProfileStats,type StatBreakdown,type MechanicsSource } from './character-mechanics.js';
import { applyCarrySnapshot } from './inventory-load.js';
import { loadTacticalPlayer } from './tactical-encounters.js';
import { loadoutFields,type PreparedState,type CombatLoadout } from './tactical-prepared.js';
import type { EquipmentPlan } from './equipment.js';
import type { TacticalRules } from './tactical-engine.js';
import { DomainError } from '../foundation/errors.js';
/** Both sets come from the already sealed equipment event in the character
 * snapshot. Inventory item definitions/revisions are immutable source identity;
 * the current equipment projection never supplies an alternative combat kit. */
export async function prepareCombatLoadouts(c:ActionContext,instanceId:string,rules:TacticalRules,player:{id:string;zone:string;health?:number;mana?:number;loadKit?:boolean},snapshot:{inputs:CharacterInputs;derived:StatBreakdown},previousInstanceId?:string|null):Promise<PreparedState>{
 const inputs=snapshot.inputs,plan=inputs.equipmentEventId?(await c.client.query('SELECT after_state FROM equipment_events WHERE id=$1 AND run_id=$2',[inputs.equipmentEventId,c.run.id])).rows[0]?.after_state as EquipmentPlan:undefined;
 // character_snapshot_inputs pins the immutable equipment event primary key.
 if(inputs.equipmentEventId&&!plan)throw new DomainError(409,'PREPARED_EQUIPMENT_NOT_PINNED');const equipment=plan??{activeSet:'A' as const,slots:[]};
 const handIds=new Set(equipment.slots.filter(x=>x.set!=='WORN').map(x=>x.itemId));
 const gear=handIds.size?(await c.client.query("SELECT id,definition_id,definition_revision,v.definition->'mechanics'->'combatModifiers' AS modifiers FROM inventory_items i JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision WHERE i.id=ANY($1::uuid[])",[[...handIds]])).rows:[];
 if(gear.length!==handIds.size)throw new DomainError(409,'PREPARED_EQUIPMENT_NOT_PINNED');
 const sets={} as Record<'A'|'B',CombatLoadout>,resourceMaximums:Record<string,number>={},resourceClocks:PreparedState['resourceClocks']={};
 for(const set of ['A','B']as const){const sources:MechanicsSource[]=inputs.sources.filter(s=>!s.instanceId||!handIds.has(s.instanceId));for(const itemId of new Set(equipment.slots.filter(x=>x.set===set).map(x=>x.itemId))){const item=gear.find(x=>x.id===itemId)!;if(item.modifiers)sources.push({entityId:item.definition_id,revision:item.definition_revision,instanceId:item.id,nativeLevel:0,spec:item.modifiers});}
  const changed={...inputs,sources},derived=applyCarrySnapshot(deriveProfileStats(changed.profile,changed.attributes,changed.sources),changed.inventory,changed.attributes.strength),u=await loadTacticalPlayer(c,instanceId,rules,player,previousInstanceId,{inputs:changed,derived});sets[set]=Object.fromEntries(loadoutFields.filter(k=>u[k]!==undefined).map(k=>[k,u[k]])) as CombatLoadout;
  Object.assign(resourceMaximums,u.techniques?.maximums);for(const key of Object.keys(u.techniques?.maximums??{}))resourceClocks[key]=u.techniques?.clocks?.[key]??{clock:'ENCOUNTER'};
 }
 const cutoff=(await c.client.query('SELECT created_at FROM instances WHERE id=$1',[instanceId])).rows[0].created_at,quickslots=(await c.client.query('SELECT combat_quickslots_at($1,$2) AS slots',[c.accountId,cutoff])).rows[0].slots;
 return {activeSet:equipment.activeSet,sets,quickslots,resourceMaximums,resourceClocks};
}
