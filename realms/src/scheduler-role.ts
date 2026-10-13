import type pg from 'pg';
// Scheduler has no wallet, credential, content, enrollment or role-management grants.
export async function provisionScheduler(client:pg.PoolClient,schema="public"){
 if(!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw new Error("Invalid scheduler schema");
 await client.query(`GRANT USAGE ON SCHEMA public TO realms_scheduler;
 REVOKE ALL ON ALL TABLES IN SCHEMA public FROM realms_scheduler;
 REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM realms_scheduler;
 GRANT SELECT ON equipment_integrity_issues,run_completion_issues,schema_migrations,accounts,characters,runs,content_releases,instances,instance_participants,
  run_consumption,state_scopes,state_contracts,scoped_state,effect_instances,rollover_epochs,run_rollovers,
  game_schedules,scheduled_periods,rollover_subjects,scheduler_execution_log TO realms_scheduler;
 GRANT UPDATE(turns,revision) ON runs TO realms_scheduler;
 GRANT UPDATE(fullness,drunkenness,tolerance) ON run_consumption TO realms_scheduler;
 GRANT UPDATE(value,revision) ON scoped_state TO realms_scheduler;
 GRANT DELETE ON effect_instances TO realms_scheduler;
 GRANT INSERT ON rollover_epochs,run_rollovers,turn_ledger,audit_events,scheduler_execution_log TO realms_scheduler;
 GRANT INSERT,UPDATE ON scheduled_periods,rollover_subjects TO realms_scheduler;
 GRANT UPDATE(next_date,enabled,last_error,last_planned_at) ON game_schedules TO realms_scheduler;
 GRANT USAGE,SELECT ON SEQUENCE scheduler_execution_log_id_seq TO realms_scheduler;`.replaceAll("SCHEMA public",`SCHEMA ${schema}`));
}
