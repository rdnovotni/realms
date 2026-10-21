import type pg from 'pg';
import type { ActionContext } from '../foundation/action.js';
import type { ContentEntity } from './content.js';
import { DomainError } from '../foundation/errors.js';
export type TurnRest={version:1;healthBps:number;manaBps:number};
export function validateTurnRests(entities:Map<string,ContentEntity>){
 for(const e of entities.values()){
  const rest=e.definition.mechanics?.turnRest as TurnRest|undefined;if(rest===undefined)continue;
  const action=e.definition.mechanics?.sharedAction as {domain:string;check:{possibility:string};costs:{turns:number;rest:string}}|undefined;
  if(e.kind!=='ACTIVITY'||!rest||Object.keys(rest).sort().join(',')!=='healthBps,manaBps,version'||rest.version!==1||!Number.isInteger(rest.healthBps)||rest.healthBps<1||rest.healthBps>10000||!Number.isInteger(rest.manaBps)||rest.manaBps<0||rest.manaBps>10000||!action||action.domain!=='INTERACTION'||action.check?.possibility!=='AUTOMATIC'||!['REST','FULL_REST'].includes(action.costs?.rest)||action.costs.turns!==(e.definition.mechanics?.dailyAllowance?0:1)||(action.costs.rest==='FULL_REST'&&(rest.healthBps!==10000||rest.manaBps!==10000)))throw new DomainError(400,'INVALID_TURN_REST');
 }
}
export async function lastRest(client:Pick<pg.PoolClient,'query'>,runId:string,previousInstance:string|null|undefined){return (await client.query('SELECT id FROM tactical_rest_events WHERE run_id=$1 AND after_instance_id=$2 ORDER BY id DESC LIMIT 1',[runId,previousInstance??null])).rows[0]?.id??null;}
export async function settleTurnRest(c:ActionContext,entityId:string){
 const row=(await c.client.query(`SELECT v.definition->'mechanics'->'turnRest' AS spec FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=$1 AND e.entity_id=$2`,[c.run.content_release_id,entityId])).rows[0];
 if(!row?.spec)return null;const rest=row.spec as TurnRest;
 const pool=(await c.client.query(`SELECT s.*,o.initial_checkpoint->'state'->'units'->0->'stats' AS stats FROM tactical_run_state s JOIN tactical_all_origins o ON o.instance_id=s.last_instance_id WHERE s.run_id=$1 FOR UPDATE OF s`,[c.run.id])).rows[0];
 if(!pool)throw new DomainError(409,'REST_HEALTH_UNAVAILABLE');
 const maxHealth=Number(pool.stats.maxHealth),maxMana=Number(pool.stats.maxMana);
 const health=Math.min(maxHealth,pool.health+Math.max(1,Math.floor(maxHealth*rest.healthBps/10000))),mana=Math.min(maxMana,pool.mana+Math.floor(maxMana*rest.manaBps/10000));
 if(health===pool.health&&mana===pool.mana)throw new DomainError(409,'NO_REST_NEEDED');
 const revision=(await c.client.query('SELECT revision FROM release_entries WHERE release_id=$1 AND entity_id=$2',[c.run.content_release_id,entityId])).rows[0].revision;
 const event=(await c.client.query(`INSERT INTO tactical_rest_events(action_id,run_id,after_instance_id,previous_rest_id,release_id,entity_id,entity_revision,before_health,before_mana,health,mana,max_health,max_mana)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,[c.actionId,c.run.id,pool.last_instance_id,await lastRest(c.client,c.run.id,pool.last_instance_id),c.run.content_release_id,entityId,revision,pool.health,pool.mana,health,mana,maxHealth,maxMana])).rows[0];
 return {id:String(event.id),beforeHealth:pool.health,beforeMana:pool.mana,health,mana,maxHealth,maxMana};
}
