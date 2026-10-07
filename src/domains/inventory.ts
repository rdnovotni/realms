import type pg from 'pg';
import { executeAction, requireActive, advanceRevision, type Envelope } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';
export function moveItem(pool: pg.Pool, accountId: string, envelope: Envelope, itemId: string, destinationId: string) {
  return executeAction(pool, accountId, envelope, { itemId,destinationId }, async context => {
    requireActive(context);
    const item = (await context.client.query('SELECT * FROM inventory_items WHERE id=$1 FOR UPDATE', [itemId])).rows[0];
    if (!item) throw new DomainError(404,'ITEM_NOT_FOUND');
    const containers = await context.client.query(`SELECT c.*,s.account_id,s.run_id,s.lifecycle FROM inventory_containers c
      JOIN state_scopes s ON s.id=c.scope_id WHERE c.id=ANY($1::uuid[]) ORDER BY c.id FOR UPDATE OF c`, [[item.container_id,destinationId]]);
    const from = containers.rows.find(c=>c.id===item.container_id), to = containers.rows.find(c=>c.id===destinationId);
    const owns = (c: { account_id:string; run_id:string; lifecycle:string } | undefined) => c && c.lifecycle==='ACTIVE' && (c.account_id===accountId || c.run_id===context.run.id);
    if (!owns(from) || !owns(to)) throw new DomainError(403,'CONTAINER_NOT_OWNED');
    if (item.container_id===destinationId) throw new DomainError(409,'SAME_CONTAINER');
    if (['ESCROW','GUILD_VAULT','MUSEUM'].includes(from.kind) || ['ESCROW','GUILD_VAULT','MUSEUM'].includes(to.kind)) throw new DomainError(409,'SPECIAL_CUSTODY_REQUIRED');
    if (item.binding==='SYSTEM_UNTRADEABLE' || (item.bound_account_id && item.bound_account_id!==accountId) || (item.bound_run_id && to.run_id!==item.bound_run_id)) throw new DomainError(409,'BINDING_RESTRICTED');
    if (context.run.mode!=='CASUAL' && (from.run_id!==context.run.id || to.run_id!==context.run.id)) throw new DomainError(409,'LEGACY_ACCESS_RESTRICTED');
    await context.client.query('UPDATE inventory_items SET container_id=$1 WHERE id=$2',[destinationId,itemId]);
    await context.client.query('INSERT INTO inventory_movements(item_id,from_container_id,to_container_id,action_id,reason) VALUES($1,$2,$3,$4,$5)', [itemId,from.id,to.id,context.actionId,'PLAYER_STORAGE_MOVE']);
    return { itemId,containerId:destinationId,revision:await advanceRevision(context) };
  });
}
