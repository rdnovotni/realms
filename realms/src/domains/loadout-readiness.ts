import type pg from 'pg';
import { DomainError } from '../foundation/errors.js';
import { validateEquipment,type EquipmentPlan } from './equipment.js';
export async function loadoutReadiness(client:pg.PoolClient,runId:string,accountId:string,plans:{key:string;plan:EquipmentPlan}[]){
 const run=(await client.query('SELECT * FROM runs WHERE id=$1',[runId])).rows[0];
 const ids=[...new Set(plans.flatMap(p=>p.plan.slots.map(s=>s.itemId)))];
 const items=ids.length?(await client.query(`SELECT i.id,v.definition->>'name' AS name,i.quantity,b.kind,s.run_id,s.lifecycle,i.binding,v.definition->'mechanics'->'equipment'->>'bindingPolicy' AS policy FROM inventory_items i JOIN inventory_containers b ON b.id=i.container_id JOIN state_scopes s ON s.id=b.scope_id JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision WHERE i.id=ANY($1::uuid[])`,[ids])).rows:[];
 const build=(await client.query("SELECT state->>'mode' AS mode FROM run_builds WHERE run_id=$1",[runId])).rows[0];
 const results=new Map<string,{ready:boolean;issues:string[];binds:string[]}>();
 const reasons:Record<string,string>={EQUIPMENT_INELIGIBLE:'One or more items belong to a different rules release or are ineligible.',PREREQUISITE_NOT_MET:'A class, quest or other prerequisite is not met.',EQUIPMENT_REQUIREMENT_NOT_MET:'A level or slot requirement is not met.',EQUIPMENT_PROFICIENCY_NOT_MET:'An equipment proficiency is missing.',EQUIPMENT_DUPLICATE_IDENTITY:'One physical item occupies incompatible positions.',TWO_HANDED_CONFLICT:'A two-handed weapon conflicts with an off-hand assignment.'};
 for(const p of plans){const issues:string[]=[],binds:string[]=[];
  for(const slot of p.plan.slots){const item=items.find(i=>i.id===slot.itemId),position=`${slot.set} · ${slot.slot.replaceAll('_',' ')}`;
   if(!item||BigInt(item.quantity)===0n)issues.push(`${position}: item is missing or consumed.`);
   else if(item.lifecycle!=='ACTIVE'||item.run_id!==runId)issues.push(`${position}: ${item.name} belongs to an archived life or inaccessible storage.`);
   else if(item.kind!=='CARRIED')issues.push(`${position}: ${item.name} is in ${item.kind.toLowerCase().replaceAll('_',' ')}. Move it to your pack first.`);
   if(item?.binding==='TRADEABLE'&&item.policy==='ACCOUNT_ON_ACTIVE_EQUIP'&&(slot.set==='WORN'||slot.set===p.plan.activeSet))binds.push(item.name);
  }
  if(build?.mode!=='CONFIGURED')issues.push('Choose a starting character build before equipping.');
  try{await validateEquipment({client,run,accountId},p.plan);}catch(error){if(!(error instanceof DomainError))throw error;const code=error instanceof Error?error.message:'';if(!issues.length||code!=='EQUIPMENT_NOT_OWNED')issues.push(reasons[code]??code.replaceAll('_',' ').toLowerCase());}
  results.set(p.key,{ready:!issues.length,issues:[...new Set(issues)],binds:[...new Set(binds)]});
 }
 return results;
}
