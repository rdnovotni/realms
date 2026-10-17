import type pg from 'pg';
import { transaction } from '../foundation/transaction.js';
import { advancementScope,advancementStamp } from './advancement-view.js';
import { loadTechniqueProfile } from './tactical-techniques.js';
import { loadHealingAbilities } from './tactical-healing-abilities.js';
import { loadCleanseAbilities } from './tactical-cleansing.js';
import { validateAttackAbility } from './tactical-abilities.js';
import type { MechanicsSource } from './character-mechanics.js';
export type BookEntry={id:string;name:string;category:'ACTIVE'|'REACTION'|'UTILITY'|'PASSIVE';source:{name:string;kind:string;nativeLevel:number};action:string|null;costs:{name:string;amount:number;clock:string|null}[]|null;cooldownRounds:number|null;effects:string[];restrictions:string[];duration:'OWNED'};
const label=(s:string)=>s.replaceAll('_',' ').replaceAll('-',' ');
const publicText=(v:unknown)=>typeof v==='string'?[v]:Array.isArray(v)?v.filter((s):s is string=>typeof s==='string'):[];
/** Bounded inspection of committed sources, never an execution/legality projection.
 * ADVANCED sources only: existence of a private capability is itself a mechanic. */
export async function abilityBook(pool:pg.Pool,accountId:string){
 return transaction(pool,async client=>{
  await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const run=await advancementScope(client,accountId);
  const rows=(await client.query(`WITH owned AS (
   SELECT class_id AS id,native_level AS level FROM run_class_levels WHERE run_id=$1
   UNION ALL SELECT feat_id,0 FROM run_feats WHERE run_id=$1
   UNION ALL SELECT subclass_id,0 FROM run_subclasses WHERE run_id=$1
   UNION ALL SELECT DISTINCT i.definition_id,0 FROM equipment_slots s JOIN inventory_items i ON i.id=s.item_id
    WHERE s.run_id=$1 AND (s.set_id='WORN' OR s.set_id=coalesce((SELECT active_set FROM run_equipment WHERE run_id=$1),'A'))
  ) SELECT DISTINCT e.entity_id AS id,e.revision,o.level,ce.kind,v.definition
   FROM owned o JOIN release_entries e ON e.entity_id=o.id AND e.release_id=$2
   JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision JOIN content_entities ce ON ce.id=e.entity_id
   JOIN discoveries d ON d.entity_id=e.entity_id AND d.account_id=$3 AND d.knowledge_level='ADVANCED'
   WHERE v.definition->'mechanics'->'combatModifiers' IS NOT NULL AND $4::boolean
   ORDER BY e.entity_id LIMIT 257`,[run.id,run.content_release_id,accountId,run.build?.mode==='CONFIGURED'&&['STANDARD','CASUAL'].includes(run.mode)])).rows;
  const entries:BookEntry[]=[];
  for(const row of rows.slice(0,256)){
   const m=row.definition.mechanics,source={name:row.definition.name as string,kind:row.kind==='CLASS'?'CLASS':row.kind==='ITEM'?'EQUIPMENT':m.subclass?'SUBCLASS':m.feat?'FEAT':'OTHER',nativeLevel:row.level as number};
   const sources:MechanicsSource[]=[{entityId:row.id,revision:row.revision,nativeLevel:row.level,spec:m.combatModifiers}];
   const add=(key:string,name:string,category:BookEntry['category'],action:string|null,effects:string[],costs:BookEntry['costs']=null,cooldownRounds:number|null=null,extra:string[]=[])=>entries.push({id:row.id+':'+key,name,category,source,action,costs,cooldownRounds,effects,restrictions:['Requires the owning source in the committed active setup. Encounter rules, targets, resources and action budgets determine actual availability.',...extra],duration:'OWNED'});
   for(const a of (await loadTechniqueProfile(client,run.content_release_id,sources)).abilities){
    const e=a.effect,effects=e.kind==='DAMAGE'?[`${e.min}–${e.max} ${e.type} damage; ${e.penetration} armor penetration.`]:e.kind==='HEAL'||e.kind==='RESURRECT'?[`${label(e.kind)}: ${e.min}–${e.max}.`]:e.kind==='STABILIZE'?['Stabilizes a downed ally.']:[];
    if(e.kind==='EFFECT')for(const id of e.effectIds){const known=(await client.query(`SELECT v.definition->>'name' name,v.definition->'public'->'description' description FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision JOIN discoveries d ON d.entity_id=e.entity_id AND d.account_id=$1 WHERE e.release_id=$2 AND e.entity_id=$3`,[accountId,run.content_release_id,id])).rows[0];effects.push(known?`${known.name}${typeof known.description==='string'?': '+known.description:''}`:'Effect details unavailable or undiscovered.');}
    const pack=m.tacticalTechniques as {resources:{key:string;clock:string}[]};
    add('technique:'+a.key,`${source.name} · ${label(a.key)}`,a.action==='REACTION'?'REACTION':e.kind==='DAMAGE'?'ACTIVE':'UTILITY',a.action,effects,[{name:'Mana',amount:a.manaCost,clock:null},...Object.entries(a.resourceCost).map(([key,amount])=>({name:label(key.slice(row.id.length+1)),amount,clock:pack.resources.find(r=>key===row.id+'.'+r.key)?.clock??null}))],a.cooldownRounds,[`Range ${a.range}; ${label(a.area)} area; ${label(a.targetSide)} targets.`,...(a.concentration?['Requires concentration.']:[])]);
   }
   if(m.tacticalAttackAbility){validateAttackAbility(m.tacticalAttackAbility);const a=m.tacticalAttackAbility;if(row.level>=a.minimumNativeLevel)add('attack',`${source.name} · Attack ability`,'ACTIVE','MAIN',[`${a.damage.min}–${a.damage.max} ${a.damage.type} damage; ${a.damage.penetration} armor penetration.`,`Accuracy modifier ${a.accuracyModifier}; range ${a.range}.`],[{name:'Mana',amount:a.manaCost,clock:null}],null,['Requires an encounter supporting attack abilities and its damage type.']);}
   for(const a of await loadHealingAbilities(client,sources))add('heal',`${source.name} · Healing ability`,'UTILITY','MAIN',[`Heals ${a.spec.min}–${a.spec.max}; range ${a.spec.range}.`],[{name:'Mana',amount:a.spec.manaCost,clock:null}],null,['Requires an encounter supporting healing abilities.']);
   for(const a of await loadCleanseAbilities(client,sources))add('cleanse',`${source.name} · ${label(a.spec.method)}`,'UTILITY','MAIN',[`${label(a.spec.method)} strength ${a.spec.strength}; range ${a.spec.range}; ${a.spec.tags.join(', ')}.`],[{name:'Mana',amount:a.spec.manaCost,clock:null}],null,['Requires compatible encounter effect and removal rules.']);
   const kit=m.tacticalKit;if(kit&&row.level>=kit.minimumNativeLevel){if(kit.guard)add('guard',`${source.name} · Guard`,'ACTIVE','QUICK',['Grants the Guard capability. Its armor benefit and action availability depend on encounter rules.']);if(kit.heal)add('basic-heal',`${source.name} · Basic healing`,'UTILITY','MAIN',['Grants basic healing. Amount, mana cost and range are set by the encounter rules.']);}
   const modifiers=m.combatModifiers.modifiers.filter((v:{minimumNativeLevel:number})=>row.level>=v.minimumNativeLevel);
   const passives=[...modifiers.map((v:{stat:string;amount:number})=>`${source.kind==='EQUIPMENT'?'Per active item: ':''}${v.stat}: ${v.amount>=0?'+':''}${v.amount} in compatible character profiles.`)];
   for(const key of ['tacticalOnHitEffects','tacticalOnHealEffects'])if(m[key]&&row.level>=m[key].minimumNativeLevel)passives.push(key==='tacticalOnHitEffects'?'Grants an on-hit effect in compatible encounters.':'Grants an on-heal effect in compatible encounters.');
   if(m.tacticalDamageTraits&&row.level>=m.tacticalDamageTraits.minimumNativeLevel)passives.push('Grants damage traits; inspect Statistics in a discovered rules context for authorized totals.');
   if(m.tacticalStatusTraits&&row.level>=m.tacticalStatusTraits.minimumNativeLevel)passives.push('Grants status defenses; inspect Statistics in a discovered rules context for authorized totals.');
   if(passives.length)add('passive',`${source.name} · Passive properties`,'PASSIVE',null,[...publicText(row.definition.public?.description),...publicText(row.definition.public?.effects),...passives]);
  }
  return {...advancementStamp(run),activeSet:(await client.query('SELECT active_set FROM run_equipment WHERE run_id=$1',[run.id])).rows[0]?.active_set??'A',entries:entries.slice(0,256),truncated:rows.length>256||entries.length>256,notes:['Only assessed (Advanced) owned sources are included. Unassessed or undiscovered capabilities are not exposed.','Prepared inactive weapon sets and uncommitted equipment drafts do not grant entries.','This book describes owned capabilities, not encounter action legality. Temporary encounter effects are excluded; inspect the battle view for those.','Mastery is not yet supported.']};
 });
}
