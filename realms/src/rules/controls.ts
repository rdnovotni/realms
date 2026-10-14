import { createHash } from 'node:crypto';
import type pg from 'pg';
import { DomainError } from '../foundation/errors.js';
/** Read/receipt replay is never disabled. DRAIN permits only existing settlement. */
export async function requireFeature(client:pg.PoolClient,key:string,accountId:string,settlement=false,required=false){
 if(!(await client.query("SELECT to_regclass('feature_controls') AS table")).rows[0].table){if(required)throw new DomainError(409,'FEATURE_NOT_CONFIGURED');return;}
 const row=(await client.query('SELECT * FROM locked_feature_control($1)',[key])).rows[0];
 if(!row){if(required)throw new DomainError(409,'FEATURE_NOT_CONFIGURED');return;}
 const bucket=createHash('sha256').update(JSON.stringify([key,accountId])).digest().readUInt32BE(0)%100;
 if(row.mode==='DISABLED'||(row.mode==='DRAIN'&&!settlement)||bucket>=row.cohort_percent)throw new DomainError(503,'FEATURE_DISABLED');
}
export async function actionControls(client:pg.PoolClient,accountId:string,actionType:string){
 if(!(await client.query("SELECT to_regclass('feature_controls') AS table")).rows[0].table)return; // Historical pre-migration fixtures.
 const settlement=['COMBAT_ACTION','TACTICAL_ACTION','SHARED_TACTICAL_ACTION','CLAIM_SHARED_TACTICAL','CANCEL_SHARED_TACTICAL'].includes(actionType);
 await requireFeature(client,'actions.global',accountId,settlement);
 await requireFeature(client,`action.${actionType}`,accountId,settlement);
}
/** Query-side availability does not take operator locks or block inspection. */
export async function featureAvailable(client:pg.PoolClient,key:string,accountId:string,required=false){
 const row=(await client.query('SELECT mode,cohort_percent FROM feature_controls WHERE key=$1',[key])).rows[0];
 if(!row)return !required;
 const bucket=createHash('sha256').update(JSON.stringify([key,accountId])).digest().readUInt32BE(0)%100;
 return row.mode==='ENABLED'&&bucket<row.cohort_percent;
}
/** Administration connection only; runtime roles have SELECT, never write grants. */
export async function setFeatureControl(client:pg.PoolClient,key:string,taxonomy:string,mode:string,reason:string,cohortPercent=100){
 await client.query(`INSERT INTO feature_controls(key,taxonomy,mode,reason,cohort_percent) VALUES($1,$2,$3,$4,$5) ON CONFLICT(key) DO UPDATE SET mode=EXCLUDED.mode,reason=EXCLUDED.reason,cohort_percent=EXCLUDED.cohort_percent`,[key,taxonomy,mode,reason,cohortPercent]);
}
