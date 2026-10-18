import type pg from 'pg';
import { transaction } from '../foundation/transaction.js';
import { DomainError } from '../foundation/errors.js';
import { advancementScope,advancementStamp } from './advancement-view.js';
import { attributes } from './build-content.js';
import { proficiencyRanks } from './proficiency-content.js';
const pageSize=25;
type Scores=Partial<Record<typeof attributes[number],number|null>>;
type EvidenceFacts={beforeLevel?:number|null;afterLevel?:number|null;beforeNative?:number|null;afterNative?:number|null;preset?:string;startingAttributes?:Scores;className?:string;nativeLevel?:number;allocation?:Scores;before?:Scores;after?:Scores;beforeRank?:number;afterRank?:number};
export type HistoryChange={name:string;before:number|string|null;after:number|string|null};
/** Immutable current-run evidence only. Content names come from the recorded revision,
 * not today's catalog. Raw build snapshots/mechanics never leave this projection. */
export async function advancementHistory(pool:pg.Pool,accountId:string,expectedRevision:number,offset=0){
 if(!Number.isInteger(expectedRevision)||expectedRevision<0||expectedRevision>2147483647||!Number.isInteger(offset)||offset<0||offset>10000)throw new DomainError(400,'INVALID_HISTORY_QUERY');
 return transaction(pool,async client=>{
  await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');const run=await advancementScope(client,accountId);
  if(run.revision!==expectedRevision)throw new DomainError(409,'STALE_REVISION');
  const result=(await client.query(`WITH events AS (
   SELECT b.id,b.action_id,b.kind AS category,b.created_at AS at,v.definition->>'name' AS name,(b.after_state->>'level')::integer AS level,
    NULL::integer AS milestone,jsonb_build_object('beforeLevel',b.before_state->'level','afterLevel',b.after_state->'level',
    'beforeNative',(SELECT c->'nativeLevel' FROM jsonb_array_elements(b.before_state->'classes') c WHERE c->>'classId'=b.class_id),
    'afterNative',(SELECT c->'nativeLevel' FROM jsonb_array_elements(b.after_state->'classes') c WHERE c->>'classId'=b.class_id),
    'preset',b.preset_key,'startingAttributes',CASE WHEN b.kind='START_BUILD' THEN b.after_state->'attributes' ELSE NULL END) AS facts
   FROM run_build_events b JOIN content_versions v ON v.entity_id=b.class_id AND v.revision=b.class_revision WHERE b.run_id=$1
   UNION ALL
   SELECT s.id,s.action_id,'SUBCLASS',s.created_at,v.definition->>'name',(b.after_state->>'level')::integer,NULL,
    jsonb_build_object('className',cv.definition->>'name','nativeLevel',s.native_level_at_choice)
   FROM run_subclass_choices s JOIN content_versions v ON v.entity_id=s.subclass_id AND v.revision=s.subclass_revision
   JOIN content_versions cv ON cv.entity_id=s.class_id AND cv.revision=s.class_revision JOIN run_build_events b ON b.id=s.build_event_id WHERE s.run_id=$1
   UNION ALL
   SELECT f.id,f.action_id,'FEAT',f.created_at,v.definition->>'name',f.level_at_choice,f.milestone,'{}'::jsonb
   FROM run_feat_choices f JOIN content_versions v ON v.entity_id=f.feat_id AND v.revision=f.feat_revision WHERE f.run_id=$1
   UNION ALL
   SELECT a.id,a.action_id,'ATTRIBUTE',a.created_at,NULL,a.level_at_choice,a.milestone,
    jsonb_build_object('allocation',a.allocation,'before',a.before_attributes,'after',a.after_attributes)
   FROM run_attribute_choices a WHERE a.run_id=$1
   UNION ALL
   SELECT p.id,p.action_id,'PROFICIENCY',p.created_at,v.definition->>'name',p.level_at_choice,p.milestone,
    jsonb_build_object('beforeRank',p.before_rank,'afterRank',p.after_rank)
   FROM run_proficiency_choices p JOIN content_versions v ON v.entity_id=p.skill_id AND v.revision=p.skill_revision WHERE p.run_id=$1
  ), ordered AS (
   SELECT e.*,CASE WHEN a.result->>'revision' ~ '^[0-9]{1,10}$' THEN (a.result->>'revision')::bigint END AS action_revision
   FROM events e JOIN action_receipts a ON a.action_id=e.action_id AND a.account_id=$2
  ) SELECT (SELECT count(*)::integer FROM ordered) AS total,
   coalesce((SELECT jsonb_agg(p ORDER BY action_revision NULLS LAST,at,category,id) FROM
    (SELECT * FROM ordered ORDER BY action_revision NULLS LAST,at,category,id LIMIT $3 OFFSET $4) p),'[]'::jsonb) AS entries`,[run.id,accountId,pageSize,offset])).rows[0];
  const entries=result.entries.map((e:{id:string;category:string;at:string;name:string|null;level:number|null;milestone:number|null;facts:EvidenceFacts})=>{
   const f=e.facts,changes:HistoryChange[]=[];let name=e.name??'Attribute allocation';
   if(e.category==='START_BUILD'||e.category==='LEVEL_UP'){
    if(f.beforeLevel!==f.afterLevel)changes.push({name:'Character level',before:f.beforeLevel??null,after:f.afterLevel??null});
    changes.push({name:'Native class level',before:f.beforeNative??null,after:f.afterNative??null});
    if(e.category==='START_BUILD'){
     if(typeof f.preset==='string')changes.push({name:'Starting preset',before:null,after:f.preset});
     for(const a of attributes)if(typeof f.startingAttributes?.[a]==='number')changes.push({name:a,before:null,after:f.startingAttributes[a]});
    }
   }else if(e.category==='SUBCLASS'){
    if(typeof f.className==='string')name+=` · ${f.className}`;
    changes.push({name:'Native level at selection',before:null,after:f.nativeLevel??null});
   }else if(e.category==='ATTRIBUTE'){
    for(const a of attributes)if(Object.hasOwn(f.allocation??{},a))changes.push({name:a,before:f.before?.[a]??null,after:f.after?.[a]??null});
   }else if(e.category==='PROFICIENCY')changes.push({name:'Proficiency rank',before:f.beforeRank===undefined?null:proficiencyRanks[f.beforeRank]??null,after:f.afterRank===undefined?null:proficiencyRanks[f.afterRank]??null});
   return {id:e.category+':'+e.id,category:e.category,name,level:e.level,milestone:e.milestone,recordedAt:e.at,changes};
  });
  return {...advancementStamp(run),entries,total:result.total as number,offset,pageSize,hasMore:offset+entries.length<result.total};
 });
}
