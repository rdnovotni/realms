import {readFileSync} from 'node:fs';
import {poolFor} from '../dist/database.js';
import {configureSchedule,dryRun,schedulerReport,planSchedules,schedulerStep,resumePeriod} from '../dist/scheduler.js';
const [mode,data]=process.argv.slice(2);const name=process.env.DB_NAME;
if(!/^kol_(production|staging)$/.test(name??''))throw new Error('Explicit project required');
const admin=['configure','resume','pause','enable'].includes(mode),key=admin?'migration_password':'scheduler_password',role=admin?'realms_migrator':'realms_scheduler';
const pool=poolFor(`postgresql://${role}:${readFileSync('/run/secrets/'+key,'utf8').trim()}@db:5432/${name}`);
try{
 if(mode==='configure')await configureSchedule(pool,JSON.parse(data));
 else if(mode==='resume')await resumePeriod(pool,data);
 else if(mode==='pause'||mode==='enable'){
  const changed=await pool.query('UPDATE game_schedules SET enabled=$2 WHERE id=$1 RETURNING id',[data,mode==='enable']);
  if(!changed.rowCount)throw new Error('SCHEDULE_NOT_FOUND');
 }else if(mode==='dry-run')console.log(JSON.stringify(await dryRun(pool),null,2));
 else if(mode==='run'){await planSchedules(pool);await schedulerStep(pool);console.log(JSON.stringify(await schedulerReport(pool),null,2));}
 else if(mode==='report')console.log(JSON.stringify(await schedulerReport(pool),null,2));
 else throw new Error('Unknown scheduler operation');
}finally{await pool.end();}
