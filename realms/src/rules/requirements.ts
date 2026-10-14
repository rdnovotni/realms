import type { ActionContext } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';
import { runFacts } from './facts.js';
import { prerequisite,type Prerequisite } from './prerequisites.js';
/** The same expression is enforced at the owning domain's authoritative boundary. */
export async function requireEntityPrerequisite(c:ActionContext,id:string){
 const row=(await c.client.query(`SELECT v.definition->'mechanics'->'prerequisite' AS expr FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=$1 AND e.entity_id=$2`,[c.run.content_release_id,id])).rows[0];
 if(!row)throw new DomainError(409,'CONTENT_NOT_IN_RULES_SNAPSHOT');
 if(row.expr!==null&&!prerequisite(row.expr as Prerequisite,await runFacts(c)).met)throw new DomainError(409,'PREREQUISITE_NOT_MET');
}
