import type { ActionContext } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';
import { zeroClocks,type ClockValues } from './effects.js';
export type LocalClocks={rounds:number;rests:number;fullRests:number};
/** World time is authored in-game minutes, never wall time. Free actions and
 * logout cannot spend Turns. Full rest implies rest; rollover is a due receipt. */
export async function runClocks(c:ActionContext,local:LocalClocks):Promise<ClockValues>{
 const clocks=zeroClocks();
 const row=(await c.client.query(`SELECT
 (SELECT coalesce(sum(-delta),0)::text FROM turn_ledger WHERE run_id=$1 AND delta<0) AS turns,
 (SELECT count(*)::text FROM encounter_records WHERE run_id=$1 AND outcome IS NOT NULL) AS encounters,
 (SELECT count(*)::text FROM run_rollovers WHERE run_id=$1) AS rollovers,
 (SELECT world_time::text FROM run_progression WHERE run_id=$1) AS world_time,
 (extract(epoch FROM statement_timestamp())*1000)::bigint::text AS real_time`,[c.run.id])).rows[0];
 clocks.ADVENTURE_TURNS=Number(row.turns);clocks.ENCOUNTERS=Number(row.encounters);clocks.ROLLOVER=Number(row.rollovers);clocks.WORLD_TIME=Number(row.world_time??0);clocks.REAL_TIME=Number(row.real_time);clocks.ROUNDS=local.rounds;clocks.REST=local.rests;clocks.FULL_REST=local.fullRests;
 if(Object.values(clocks).some(v=>!Number.isSafeInteger(v)||v<0))throw new DomainError(409,'CLOCK_OVERFLOW');return clocks;
}
export function advanceLocalClocks(before:LocalClocks,event:'ROUND_END'|'REST'|'FULL_REST'):LocalClocks{const next={...before};if(event==='ROUND_END')next.rounds++;else {next.rests++;if(event==='FULL_REST')next.fullRests++;}if(Object.values(next).some(v=>!Number.isSafeInteger(v)||v<0))throw new DomainError(409,'CLOCK_OVERFLOW');return next;}
/** Shared countdown primitive also preserves legacy tactical tick behavior. */
export function durationRemaining(remaining:number,spent:number){if(!Number.isSafeInteger(remaining)||remaining<0||!Number.isSafeInteger(spent)||spent<0)throw new DomainError(409,'INVALID_CLOCK_ADVANCE');return Math.max(0,remaining-spent);}
