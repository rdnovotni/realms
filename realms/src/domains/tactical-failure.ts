import type pg from 'pg';
import type { ActionContext } from '../foundation/action.js';
import type { TacticalSpec } from './tactical-content.js';
import { postTransfers } from './ledger.js';
/** SQL pins eligible liquid Gold and active equipment. Escrow, guild, market and
 * account legacy wallets are not ordinary run death funds. */
export async function settleFailureCosts(c:ActionContext,instanceId:string,failure:boolean){
 const row=(await c.client.query('INSERT INTO tactical_failure_costs(instance_id,action_id,failed) VALUES($1,$2,$3) RETURNING *',[instanceId,c.actionId,failure])).rows[0];
 if(BigInt(row.gold_lost)>0n)await postTransfers(c,[{key:'tactical-death',currencyId:'GOLD',from:row.source_wallet_id as string,to:row.sink_wallet_id as string,amount:row.gold_lost as string,reason:'TACTICAL_FAILURE'}]);
 const items=failure?(await c.client.query(`SELECT DISTINCT s.item_id FROM equipment_slots s JOIN run_equipment gear ON gear.run_id=s.run_id JOIN inventory_items i ON i.id=s.item_id JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision WHERE s.run_id=$1 AND (s.set_id='WORN' OR s.set_id=gear.active_set) AND v.definition->'mechanics'->'tacticalDurability' IS NOT NULL ORDER BY s.item_id`,[c.run.id])).rows:[];
 for(const item of items)await c.client.query('INSERT INTO tactical_equipment_wear(instance_id,item_id) VALUES($1,$2)',[instanceId,item.item_id]);
 return (await failureCostsView(c.client,instanceId)).costs!;
}
export async function failureCostsView(client:Pick<pg.PoolClient,'query'>,instanceId:string):Promise<{costs?:{goldLost:string;equipmentWear:{itemId:string;before:number;after:number;maximum:number}[]}}>{
 const row=(await client.query('SELECT gold_lost FROM tactical_failure_costs WHERE instance_id=$1',[instanceId])).rows[0];if(!row)return {};
 const wear=(await client.query('SELECT item_id AS "itemId",before_condition AS before,after_condition AS after,maximum FROM tactical_equipment_wear WHERE instance_id=$1 ORDER BY item_id',[instanceId])).rows;
 return {costs:{goldLost:row.gold_lost as string,equipmentWear:wear as {itemId:string;before:number;after:number;maximum:number}[]}};
}
export async function failureCostMismatch(client:pg.PoolClient,instanceId:string,spec:TacticalSpec,failure:boolean){
 if(spec.failure.version!==2)return false;const f=spec.failure;const row=(await client.query('SELECT * FROM tactical_failure_costs WHERE instance_id=$1',[instanceId])).rows[0];if(!row||row.failed!==failure)return true;
 const calculated=failure?BigInt(row.before_gold)*BigInt(spec.failure.goldLossBps)/10000n:0n,expected=calculated>BigInt(spec.failure.goldLossCap)?BigInt(spec.failure.goldLossCap):calculated;
 if(BigInt(row.gold_lost)!==expected)return true;
 const legs=(await client.query("SELECT * FROM currency_transfers WHERE action_id=$1 AND leg_key='tactical-death'",[row.action_id])).rows;
 if(expected===0n?legs.length!==0:legs.length!==1||legs[0].from_wallet_id!==row.source_wallet_id||legs[0].to_wallet_id!==row.sink_wallet_id||BigInt(legs[0].amount)!==expected||legs[0].reason!=='TACTICAL_FAILURE')return true;
 const wear=(await client.query(`SELECT w.*,i.definition_id,i.definition_revision,v.definition->'mechanics'->'tacticalDurability' AS authored,(SELECT after_condition FROM tactical_equipment_wear prior WHERE prior.item_id=w.item_id AND prior.id<w.id ORDER BY id DESC LIMIT 1) AS prior FROM tactical_equipment_wear w JOIN inventory_items i ON i.id=w.item_id JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision WHERE w.instance_id=$1`,[instanceId])).rows;
 const snapshot=(await client.query("SELECT equipment.after_state FROM tactical_all_origins o JOIN character_encounter_snapshots s ON s.instance_id=o.instance_id AND s.run_id=o.run_id LEFT JOIN equipment_events equipment ON equipment.id=(s.inputs->>'equipmentEventId')::uuid WHERE o.instance_id=$1",[instanceId])).rows[0]?.after_state;
 const activeIds=failure?[...new Set((snapshot?.slots??[]).filter((slot:any)=>slot.set==='WORN'||slot.set===snapshot.activeSet).map((slot:any)=>slot.itemId))]:[];
 const expectedItems=activeIds.length?(await client.query("SELECT i.id FROM inventory_items i JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision WHERE i.id=ANY($1::uuid[]) AND v.definition->'mechanics'->'tacticalDurability' IS NOT NULL",[activeIds])).rows.map(r=>r.id).sort():[];if(JSON.stringify(expectedItems)!==JSON.stringify(wear.map(w=>w.item_id).sort()))return true;
 return wear.some(w=>!failure||w.maximum!==w.authored?.maximum||w.before_condition!==(w.prior??w.maximum)||w.after_condition!==Math.max(1,w.before_condition-Math.ceil(w.maximum*f.durabilityWearBps/10000)));
}
