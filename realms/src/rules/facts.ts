import { createHash } from 'node:crypto';
import type { ActionContext } from '../foundation/action.js';
import type { Facts } from './prerequisites.js';
/** Only canonical, owned facts enter rules. No HTTP body supplies this object. */
export async function runFacts(c:Pick<ActionContext,'client'|'run'|'accountId'>):Promise<Facts>{
 const p=(await c.client.query('SELECT * FROM run_progression WHERE run_id=$1',[c.run.id])).rows[0];
 const facts:Facts={mode:c.run.mode,level:p?.level??1,'capability.act':true};
 for(const key of ['strength','dexterity','constitution','intelligence','wisdom','charisma','luck'])if(p?.[key]!==undefined)facts[`attribute.${key}`]=p[key];
 for(const r of (await c.client.query('SELECT class_id,native_level FROM run_class_levels WHERE run_id=$1',[c.run.id])).rows)facts[`class.${r.class_id}`]=r.native_level;
 for(const r of (await c.client.query('SELECT skill_id,rank FROM run_skill_ranks WHERE run_id=$1',[c.run.id])).rows)facts[`skill.${r.skill_id}`]=r.rank;
 for(const r of (await c.client.query('SELECT entity_id FROM discoveries WHERE account_id=$1',[c.accountId])).rows)facts[`known.${r.entity_id}`]=true;
 for(const r of (await c.client.query('SELECT quest_id,lifecycle FROM quest_states WHERE run_id=$1',[c.run.id])).rows)facts[`quest.${r.quest_id}`]=r.lifecycle;
 const items=await c.client.query(`SELECT i.definition_id,sum(i.quantity)::text AS quantity FROM inventory_items i JOIN inventory_containers b ON b.id=i.container_id JOIN state_scopes s ON s.id=b.scope_id WHERE s.run_id=$1 AND s.lifecycle='ACTIVE' AND b.kind='CARRIED' AND i.quantity>0 GROUP BY i.definition_id`,[c.run.id]);
 for(const r of items.rows)facts[`item.${r.definition_id}`]=Number(BigInt(r.quantity)>1000000n?1000000n:BigInt(r.quantity));
 // Known absence is distinct from unknown flag/capability. Release entries bound
 // this list and prevent a missing secret definition from becoming a fabricated fact.
 for(const r of (await c.client.query('SELECT entity_id FROM release_entries WHERE release_id=$1',[c.run.content_release_id])).rows){for(const prefix of ['class','skill','known','item','quest']){const key=`${prefix}.${r.entity_id}`;if(!Object.hasOwn(facts,key))facts[key]=prefix==='known'?false:prefix==='quest'?'NONE':0;}}
 if((await c.client.query("SELECT to_regclass('feature_controls') AS table")).rows[0].table)for(const r of (await c.client.query('SELECT key,mode,cohort_percent FROM feature_controls')).rows){const bucket=createHash('sha256').update(JSON.stringify([r.key,c.accountId])).digest().readUInt32BE(0)%100;facts[`flag.${r.key}`]=r.mode==='ENABLED'&&bucket<r.cohort_percent;}
 const obstacles=(await c.client.query("SELECT state->'obstacles' AS obstacles FROM shared_rules_state WHERE run_id=$1",[c.run.id])).rows[0]?.obstacles??{};
 for(const r of (await c.client.query("SELECT e.entity_id FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=$1 AND v.definition->'mechanics'->'noncombatObstacle' IS NOT NULL",[c.run.content_release_id])).rows){const state=obstacles[r.entity_id];facts[`obstacle.${r.entity_id}.complete`]=state?.complete??false;facts[`obstacle.${r.entity_id}.failed`]=state?.failed??false;facts[`obstacle.${r.entity_id}.alert`]=state?.alert??0;}
 return facts;
}
