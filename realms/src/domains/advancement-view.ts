import type pg from 'pg';
import { DomainError } from '../foundation/errors.js';
/** Read inside the caller's repeatable-read transaction; no action or preview writes. */
export async function advancementScope(client:pg.PoolClient,accountId:string){
 const row=(await client.query(`SELECT r.*,p.level,p.xp::text,b.state AS build,
 EXISTS(SELECT 1 FROM instance_participants ip JOIN instances i ON i.id=ip.instance_id WHERE ip.run_id=r.id AND i.lifecycle='ACTIVE') AS active_instance
 FROM runs r JOIN characters c ON c.id=r.character_id JOIN run_progression p ON p.run_id=r.id LEFT JOIN run_builds b ON b.run_id=r.id
 WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE')`,[accountId])).rows[0];
 if(!row)throw new DomainError(404,'PROGRESSION_NOT_FOUND');return row;
}
export const advancementStamp=(run:{id:string;revision:number;active_instance:boolean})=>({runId:run.id,revision:run.revision,activeInstance:run.active_instance});
