import { loadStatusProfile } from './tactical-status.js';
import type pg from 'pg';
import { transaction } from '../foundation/transaction.js';
import { DomainError } from '../foundation/errors.js';
import type { RunState } from '../foundation/action.js';
import { validateEquipment,type EquipmentPlan } from './equipment.js';
import { deriveProfileStats,type MechanicsSource } from './character-mechanics.js';
import type { CharacterInputs } from './character-snapshots.js';
import { applyCarrySnapshot,carryLoad,publicCarryLoad } from './inventory-load.js';
import { encumbrance,type CarryLoad } from './inventory-rules.js';
import { loadDamageProfile,type TypedDamageRules } from './tactical-damage.js';

/** Read-only preparation. Shares legality and derivation with committed equipment
 * and encounter snapshots; no binding, events, receipts or RNG are produced. */
export function equipmentPreview(pool:pg.Pool,accountId:string,expectedRevision:number,plan?:EquipmentPlan,contextId?:string){
 return transaction(pool,async client=>{
  await client.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE',[accountId]);
  const run=(await client.query<RunState>("SELECT r.* FROM runs r JOIN characters c ON c.id=r.character_id WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE') FOR UPDATE OF r",[accountId])).rows[0];
  if(!run)throw new DomainError(404,'NO_RUN');if(run.revision!==expectedRevision)throw new DomainError(409,'STALE_REVISION');
  const committed=(await client.query('SELECT equipment_snapshot($1) plan',[run.id])).rows[0].plan as EquipmentPlan;
  const {plan:draft,items}=await validateEquipment({client,run,accountId},plan===undefined?committed:plan);
  const contexts=(await client.query(`SELECT e.entity_id id,v.definition->>'name' name,v.definition->'mechanics'->>'characterProfileId' profile,
   v.definition->'mechanics'->'tacticalCombat'->'rules'->'typedDamage' damage,v.definition->'mechanics'->'tacticalCombat'->'rules'->'statusDefense' status
   FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision
   JOIN discoveries d ON d.entity_id=e.entity_id AND d.account_id=$1
   WHERE e.release_id=$2 AND v.definition->'mechanics'->>'characterProfileId' IS NOT NULL AND EXISTS(SELECT 1 FROM release_entries pe JOIN content_versions pv ON pv.entity_id=pe.entity_id AND pv.revision=pe.revision JOIN run_builds b ON b.run_id=$3 WHERE pe.release_id=$2 AND pe.entity_id=v.definition->'mechanics'->>'characterProfileId' AND b.state->>'mode'='CONFIGURED' AND pv.definition->'mechanics'->'characterProfile'->>'buildRulesId'=b.state->'rules'->>'id') ORDER BY e.entity_id LIMIT 100`,[accountId,run.content_release_id,run.id])).rows;
  // A profile is release scoped and must match the selected build. No guessed
  // universal resistance vocabulary: those totals belong to a known encounter.
  const selected=contextId?contexts.find(c=>c.id===contextId):contexts[0];
  const options=contexts.map(({id,name})=>({id,name}));
  if(contextId&&!selected)throw new DomainError(404,'STAT_CONTEXT_NOT_FOUND');
  if(!selected)return {runId:run.id,revision:run.revision,contexts:options,current:null,preview:null,reason:'Discover a character-stat encounter to view contextual totals.'};
  // Current totals also contain private modifiers. Suppress both sides when
  // either active setup includes an unassessed physical item, including removal
  // previews; otherwise subtraction would identify the hidden contribution.
  const exposedIds=[...new Set([committed,draft].flatMap(p=>p.slots.filter(s=>s.set==='WORN'||s.set===p.activeSet).map(s=>s.itemId)))];
  const unknown=(await client.query(`SELECT 1 FROM inventory_items i LEFT JOIN discoveries d ON d.account_id=$1 AND d.entity_id=i.definition_id
   WHERE i.id=ANY($2::uuid[]) AND d.knowledge_level IS DISTINCT FROM 'ADVANCED' LIMIT 1`,[accountId,exposedIds])).rowCount;
  if(unknown)return {runId:run.id,revision:run.revision,contexts:options,contextId:selected.id,current:null,preview:null,reason:'Assess all currently active and proposed active equipment before viewing numerical totals and comparisons. Hidden item mechanics remain concealed.'};
  const inputs=(await client.query('SELECT character_snapshot_inputs($1,$2) inputs',[run.id,selected.profile])).rows[0].inputs as CharacterInputs;
  const activeIds=new Set(draft.slots.filter(s=>s.set==='WORN'||s.set===draft.activeSet).map(s=>s.itemId));
  const afterSources:MechanicsSource[]=inputs.sources.filter(s=>!s.instanceId);
  for(const item of items.filter(i=>activeIds.has(i.id))){const definition=(await client.query('SELECT definition FROM content_versions WHERE entity_id=$1 AND revision=$2',[item.definition_id,item.definition_revision])).rows[0].definition;
   if(definition.mechanics?.combatModifiers)afterSources.push({entityId:item.definition_id,revision:item.definition_revision,instanceId:item.id,nativeLevel:0,spec:definition.mechanics.combatModifiers});
  }
  const currentLoad=await carryLoad(client,run.id),afterLoad:CarryLoad=structuredClone(currentLoad);
  afterLoad.sources=afterLoad.sources.filter(s=>!s.itemId);
  for(const item of items.filter(i=>activeIds.has(i.id))){const row=(await client.query("SELECT definition->>'name' name,definition->'mechanics'->'inventoryCapacity' bonus FROM content_versions WHERE entity_id=$1 AND revision=$2",[item.definition_id,item.definition_revision])).rows[0];if(row.bonus)afterLoad.sources.push({name:row.name,id:item.definition_id,revision:item.definition_revision,itemId:item.id,weight:String(row.bonus.weight),bulk:String(row.bonus.bulk)});}
  afterLoad.sources.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:(a.itemId??'')<(b.itemId??'')?-1:1);
  if(afterLoad.enabled&&afterLoad.rules&&afterLoad.strength!==null){const r=afterLoad.rules;afterLoad.weightCapacity=(BigInt(r.baseWeight)+BigInt(afterLoad.strength)*BigInt(r.weightPerStrength)+afterLoad.sources.reduce((n,s)=>n+BigInt(s.weight),0n)).toString();afterLoad.bulkCapacity=(BigInt(r.baseBulk)+BigInt(afterLoad.strength)*BigInt(r.bulkPerStrength)+afterLoad.sources.reduce((n,s)=>n+BigInt(s.bulk),0n)).toString();Object.assign(afterLoad,encumbrance(r,BigInt(afterLoad.weight),BigInt(afterLoad.bulk),BigInt(afterLoad.weightCapacity),BigInt(afterLoad.bulkCapacity),afterLoad.unmeasuredItems));}
  async function totals(sources:MechanicsSource[],load:CarryLoad){const derived=deriveProfileStats(inputs.profile,inputs.attributes,sources),stats=(load.enabled?applyCarrySnapshot(derived,load,inputs.attributes.strength):derived).stats;
   const damage=selected.damage?await loadDamageProfile(client,selected.damage as TypedDamageRules,sources):null;
   if(damage)for(const type of (selected.damage as TypedDamageRules).types)damage.resistances[type]??=0;
   let guard=false,heal=false;for(const source of sources){const kit=(await client.query("SELECT definition->'mechanics'->'tacticalKit' kit FROM content_versions WHERE entity_id=$1 AND revision=$2",[source.entityId,source.revision])).rows[0]?.kit;if(kit&&source.nativeLevel>=kit.minimumNativeLevel){guard ||=kit.guard;heal ||=kit.heal;}}
   const breakdown=Object.fromEntries(Object.keys(stats).map(key=>{const stat=key as keyof typeof stats;return [key,{base:inputs.profile.base[stat],attributes:derived.scaling.filter(s=>s.stat===stat).reduce((n,s)=>n+s.contribution,0),sources:derived.sources.filter(s=>s.stat===stat).reduce((n,s)=>n+s.amount,0),carrying:stat==='initiative'?load.penalties.initiative:0}];}));
   const status=selected.status?await loadStatusProfile(client,selected.status,sources):null;
   return {stats,breakdown,status,carry:publicCarryLoad(load),damage,capabilities:{guard,heal}};}
  const removed=committed.slots.filter(old=>!draft.slots.some(s=>s.itemId===old.itemId&&s.slot===old.slot&&s.set===old.set));
  return {runId:run.id,revision:run.revision,contexts:options,contextId:selected.id,current:await totals(inputs.sources,currentLoad),preview:await totals(afterSources,afterLoad),removed,activeSet:draft.activeSet,
   notes:['Preparation totals use the selected encounter’s pinned rules. Temporary battle effects, targets, rolls and conditional resistances can change outcomes.','Equipping does not reduce carried weight; equipment remains in your pack.']};
 });
}
