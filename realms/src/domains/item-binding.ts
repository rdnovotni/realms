import type pg from 'pg';
import { DomainError } from '../foundation/errors.js';
// An owned item's binding policy is actionable player information. Project only
// this explicit contract, never its hidden equipment stats or source metadata.
export async function itemBindingView(pool:pg.Pool,accountId:string,itemId:string){
 const row=(await pool.query(`SELECT i.id AS "itemId",i.binding,
  CASE WHEN v.definition->'mechanics'->'equipment'->>'version'='2' AND v.definition->'mechanics'->'equipment'->>'bindingPolicy'='ACCOUNT_ON_ACTIVE_EQUIP'
   THEN 'ACCOUNT_ON_ACTIVE_EQUIP' ELSE 'PRESERVE' END AS "bindingPolicy",
  coalesce(i.binding='TRADEABLE' AND v.definition->'mechanics'->'equipment'->>'version'='2' AND v.definition->'mechanics'->'equipment'->>'bindingPolicy'='ACCOUNT_ON_ACTIVE_EQUIP',false) AS "bindsOnActiveEquip"
 FROM inventory_items i JOIN inventory_containers b ON b.id=i.container_id JOIN state_scopes s ON s.id=b.scope_id
 JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision
 LEFT JOIN runs r ON r.id=s.run_id LEFT JOIN characters c ON c.id=r.character_id
 WHERE i.id=$1 AND i.quantity>0 AND s.lifecycle='ACTIVE' AND b.kind IN('CARRIED','MATERIAL_VAULT','HOME','LEGACY')
 AND (s.account_id=$2 OR c.account_id=$2)`,[itemId,accountId])).rows[0];
 if(!row)throw new DomainError(404,'ITEM_NOT_FOUND');return row;
}
