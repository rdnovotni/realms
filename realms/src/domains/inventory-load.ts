import type pg from 'pg';
import { DomainError } from '../foundation/errors.js';
import { checksum,type Json } from '../foundation/json.js';
import { encumbrance,type CarryLoad,validateCarryRules } from './inventory-rules.js';
import { validateStats,type StatBreakdown } from './character-mechanics.js';

export async function carryLoad(client:pg.PoolClient,runId:string):Promise<CarryLoad> {
 const load=(await client.query('SELECT inventory_carry_load($1) AS load',[runId])).rows[0].load;
 return {...load,strength:load.strength??null,weightCapacity:load.weightCapacity??null,bulkCapacity:load.bulkCapacity??null};
}
export async function requireCarryEntry(client:pg.PoolClient,runId:string) {
 // Releases predating carrying rules have no new entry condition. Keeping this
 // probe on release content also permits historical-schema upgrade rehearsals.
 if(!(await client.query(`SELECT 1 FROM runs r JOIN release_entries e ON e.release_id=r.content_release_id JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE r.id=$1 AND v.definition->'mechanics'->'inventoryRules' IS NOT NULL LIMIT 1`,[runId])).rowCount)return;
 const load=await carryLoad(client,runId);
 if(load.state==='OVERLOADED')throw new DomainError(409,'INVENTORY_OVERLOADED');
 if(load.state==='UNMEASURED')throw new DomainError(409,'INVENTORY_UNMEASURED');
}
/** Only display facts needed to manage owned possessions, never the rulebook's
 * hidden skill lists or other source mechanics. Totals cover all carried rows. */
export function publicCarryLoad(load:CarryLoad) {
 return {enabled:load.enabled,strength:load.strength,weight:load.weight,bulk:load.bulk,
 weightCapacity:load.weightCapacity,bulkCapacity:load.bulkCapacity,unmeasuredItems:load.unmeasuredItems,
 state:load.state,penalties:load.penalties,sources:load.sources,
 baseCapacity:load.rules?{weight:String(load.rules.baseWeight),bulk:String(load.rules.baseBulk)}:null,
 strengthBonus:load.rules&&load.strength!==null?{weight:(BigInt(load.strength)*BigInt(load.rules.weightPerStrength)).toString(),bulk:(BigInt(load.strength)*BigInt(load.rules.bulkPerStrength)).toString()}:null,
 thresholds:load.rules?{comfortableBps:load.rules.comfortableBps,burdenedBps:load.rules.burdenedBps,encumberedBps:load.rules.encumberedBps}:null};
}
export function applyCarrySnapshot<T extends StatBreakdown>(derived:T,load:CarryLoad|undefined,strength:number):T & {inventory?:CarryLoad} {
 if(!load)return derived;
 if(!load.enabled||!load.rules||load.strength!==strength||load.weightCapacity===null||load.bulkCapacity===null)throw new DomainError(409,'INVALID_CARRY_SNAPSHOT');
 validateCarryRules(load.rules);
 const weightCapacity=BigInt(load.rules.baseWeight)+BigInt(strength)*BigInt(load.rules.weightPerStrength)+load.sources.reduce((n,s)=>n+BigInt(s.weight),0n);
 const bulkCapacity=BigInt(load.rules.baseBulk)+BigInt(strength)*BigInt(load.rules.bulkPerStrength)+load.sources.reduce((n,s)=>n+BigInt(s.bulk),0n);
 const computed=encumbrance(load.rules,BigInt(load.weight),BigInt(load.bulk),weightCapacity,bulkCapacity,load.unmeasuredItems);
 if(weightCapacity.toString()!==load.weightCapacity||bulkCapacity.toString()!==load.bulkCapacity||computed.state!==load.state||checksum(computed.penalties as unknown as Json)!==checksum(load.penalties as unknown as Json))throw new DomainError(409,'INVALID_CARRY_SNAPSHOT');
 const stats={...derived.stats,initiative:derived.stats.initiative+computed.penalties.initiative};validateStats(stats);
 return {...derived,stats,inventory:load};
}
