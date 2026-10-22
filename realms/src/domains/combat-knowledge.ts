import type pg from 'pg';
import { DomainError } from '../foundation/errors.js';
/** Observations are derived from owned immutable encounters, never from the
 * current monster catalog. Account knowledge therefore survives Ascension. */
export async function monsterManual(pool:pg.Pool,accountId:string,offset=0){
 if(!Number.isInteger(offset)||offset<0||offset>100000)throw new DomainError(400,'INVALID_PAGE');
 const rows=(await pool.query(`WITH seen AS (SELECT x->>'definitionId' AS id,e.release_id,o.spec,e.outcome,o.instance_id FROM tactical_all_origins o JOIN runs r ON r.id=o.run_id JOIN characters c ON c.id=r.character_id JOIN encounter_records e ON e.instance_id=o.instance_id CROSS JOIN LATERAL jsonb_array_elements(o.spec->'enemies') x WHERE c.account_id=$1), counts AS (SELECT id,count(DISTINCT instance_id)::int AS encounters,count(DISTINCT instance_id) FILTER(WHERE outcome='VICTORY')::int AS victories FROM seen GROUP BY id) SELECT counts.*,v.definition->>'name' AS name,v.definition->'public' AS description FROM counts JOIN LATERAL(SELECT v.definition FROM seen s JOIN release_entries e ON e.release_id=s.release_id AND e.entity_id=s.id JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE s.id=counts.id ORDER BY e.revision DESC LIMIT 1) v ON true ORDER BY name,id LIMIT 51 OFFSET $2`,[accountId,offset])).rows;
 const entries=[];for(const row of rows.slice(0,50)){const abilities=(await pool.query(`SELECT DISTINCT id FROM (SELECT step.intent->>'abilityId' AS id FROM tactical_steps step JOIN tactical_encounter_origins o ON o.instance_id=step.instance_id JOIN runs r ON r.id=o.run_id JOIN characters c ON c.id=r.character_id WHERE c.account_id=$1 AND step.intent ? 'abilityId' AND EXISTS(SELECT 1 FROM jsonb_array_elements(o.spec->'enemies') u WHERE u->>'definitionId'=$2 AND u->>'id'=step.intent->>'actorId') UNION SELECT step.intent->>'abilityId' AS id FROM shared_tactical_steps step JOIN shared_tactical_sessions s ON s.id=step.session_id JOIN shared_tactical_members m ON m.session_id=s.id WHERE m.account_id=$1 AND step.intent ? 'abilityId' AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.spec->'enemies') u WHERE u->>'definitionId'=$2 AND u->>'id'=step.intent->>'actorId')) observed ORDER BY id LIMIT 32`,[accountId,row.id])).rows.map(r=>r.id);entries.push({...row,knowledge:'OBSERVED',abilities});}
 return {entries,offset,hasMore:rows.length>50};
}
export async function combatLog(pool:pg.Pool,accountId:string,id:string,after=0){
 if(!Number.isInteger(after)||after<0||after>100000)throw new DomainError(400,'INVALID_PAGE');
 const owned=(await pool.query(`SELECT coalesce(s.checkpoint->'state'->>'outcome',e.outcome) AS outcome,coalesce(s.checkpoint,e.checkpoint) AS checkpoint,coalesce(s.revision,e.revision) AS revision,m.session_id,coalesce(shared_origin.checkpoint,o.initial_checkpoint) AS origin FROM encounter_records e JOIN runs r ON r.id=e.run_id JOIN characters c ON c.id=r.character_id LEFT JOIN tactical_encounter_origins o ON o.instance_id=e.instance_id LEFT JOIN shared_tactical_members m ON m.instance_id=e.instance_id LEFT JOIN shared_tactical_sessions s ON s.id=m.session_id LEFT JOIN shared_tactical_origins shared_origin ON shared_origin.session_id=s.id WHERE e.instance_id=$1 AND c.account_id=$2 AND (o.instance_id IS NOT NULL OR m.instance_id IS NOT NULL)`,[id,accountId])).rows[0];if(!owned)throw new DomainError(404,'TACTICAL_NOT_FOUND');
 const steps=owned.session_id?(await pool.query('SELECT revision,intent,evidence,state FROM shared_tactical_steps WHERE session_id=$1 AND revision>$2 AND revision<=$3 ORDER BY revision LIMIT 51',[owned.session_id,after,owned.revision])).rows:(await pool.query('SELECT revision,intent,evidence,state FROM tactical_steps WHERE instance_id=$1 AND revision>$2 AND revision<=$3 ORDER BY revision LIMIT 51',[id,after,owned.checkpoint.state.revision])).rows;
 let before=owned.origin?.state;const first=steps[0]?.revision;
 if(first>1){const previous=owned.session_id?(await pool.query('SELECT state FROM shared_tactical_steps WHERE session_id=$1 AND revision=$2',[owned.session_id,first-1])).rows[0]:(await pool.query('SELECT state FROM tactical_steps WHERE instance_id=$1 AND revision=$2',[id,first-1])).rows[0];before=previous?.state;}
 const entries=steps.slice(0,50).map(row=>{const entry=combatLogEntry(row,before);before=row.state;return entry;});
 return {instanceId:id,outcome:owned.outcome,round:owned.checkpoint?.state?.round??0,revision:owned.revision,entries,hasMore:steps.length>50,nextAfter:entries.at(-1)?.revision??after};
}

/** Project only observed journal facts. Never return the source/checkpoint body. */
export function combatLogEntry(row:any,before:any){
 const e=row.evidence,techniques=[...(e.technique?.events??[]),...(e.combatItem?.technique?.events??[])],field=[...(e.fieldEvents??[]),...(e.combatItem?.technique?.fieldEvents??[]),...(e.opportunityEvents??[]).flatMap((o:any)=>o.fieldEvents??[])],reactions=(e.opportunityEvents??[]).flatMap((o:any)=>o.events??[]),periodic=e.periodicEvents??[];
 const genericHeal=row.intent.kind==='HEAL'?Math.max(0,(row.state?.units?.find((u:any)=>u.id===row.intent.targetId)?.health??0)-(before?.units?.find((u:any)=>u.id===row.intent.targetId)?.health??0)):0;
 const events=[
  ...(e.combatItem?.restored??[]).map((t:any)=>({kind:'ITEM_RESTORE',actorId:row.intent.actorId,targetId:t.targetId,amount:t.health,mana:t.mana})),
  ...techniques.map((t:any)=>({kind:t.damage?'DAMAGE':t.healthAfter>t.healthBefore?'HEALING':'ABILITY',actorId:t.actorId,targetId:t.targetId,amount:t.damage?.damage??Math.max(0,t.healthAfter-t.healthBefore)})),
  ...reactions.map((t:any)=>({kind:'OPPORTUNITY',actorId:t.actorId,targetId:t.targetId,amount:t.damage?.damage??0})),
  ...field.map((f:any)=>({kind:f.kind,actorId:f.actorId,targetId:f.targetId??null,source:f.source,amount:f.damage??0})),
  ...periodic.map((f:any)=>({kind:'PERIODIC_'+f.kind,actorId:f.sourceUnitId,targetId:f.ownerId,source:f.effectId,amount:f.kind==='HEAL'?Math.max(0,f.healthAfter-f.healthBefore):f.amount})),
  ...[...(e.effectEvents??[]),...(e.combatItem?.effects??[]),...(e.combatItem?.technique?.effectEvents??[]),...(e.opportunityEvents??[]).flatMap((o:any)=>o.effectEvents??[])].map((f:any)=>({kind:f.kind,actorId:f.sourceUnitId??null,targetId:f.ownerId??null,source:f.effectId})),
  ...[...(e.statusEvents??[]),...(e.combatItem?.technique?.statusEvents??[]),...(e.opportunityEvents??[]).flatMap((o:any)=>o.statusEvents??[])].map((f:any)=>({kind:f.kind,actorId:f.sourceUnitId,targetId:f.ownerId})),
  ...(e.cleansingEvents??[]).map((f:any)=>({kind:f.method,actorId:f.actorId,targetId:f.ownerId,source:f.removed.effectId})),
  ...(genericHeal?[{kind:'HEALING',actorId:row.intent.actorId,targetId:row.intent.targetId,amount:genericHeal}]:[])
 ];
 return {revision:row.revision,actorId:row.intent.actorId,kind:row.intent.kind,targetId:row.intent.targetId??null,source:row.intent.abilityId??row.intent.interactionId??row.intent.formationId??null,
 roll:e.attack?.check.roll??techniques[0]?.check?.roll??field.find((f:any)=>f.check)?.check.roll??null,hit:e.attack?.check.success??techniques[0]?.check?.success??null,
 damage:(e.attack?.damage??0)+[...techniques,...reactions].reduce((n:number,t:any)=>n+(t.damage?.damage??0),0)+field.reduce((n:number,f:any)=>n+(f.damage??0),0)+periodic.filter((f:any)=>f.kind==='DAMAGE').reduce((n:number,f:any)=>n+f.amount,0),
 healing:genericHeal+(e.healingAbilityEvents??[]).reduce((n:number,h:any)=>n+Math.max(0,h.healthAfter-h.healthBefore),0)+(e.combatItem?.restored??[]).reduce((n:number,t:any)=>n+t.health,0)+techniques.reduce((n:number,t:any)=>n+Math.max(0,t.healthAfter-t.healthBefore),0)+periodic.filter((f:any)=>f.kind==='HEAL').reduce((n:number,f:any)=>n+Math.max(0,f.healthAfter-f.healthBefore),0),events};
}
