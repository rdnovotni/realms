import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { executeAction, requireActive, advanceRevision, type Envelope } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';
export function createInstance(pool: pg.Pool, accountId: string, envelope: Envelope, releaseId: string, kind: string) {
  const id = randomUUID(), seed = randomBytes(32);
  return executeAction(pool, accountId, envelope, { releaseId, kind }, async context => {
    requireActive(context);
    if (context.run.content_release_id !== releaseId) throw new DomainError(409, 'RULES_SNAPSHOT_MISMATCH');
    await context.client.query('INSERT INTO instances(id,kind,content_release_id,seed) VALUES($1,$2,$3,$4)', [id, kind, releaseId, seed]);
    await context.client.query('INSERT INTO instance_participants(instance_id,run_id) VALUES($1,$2)', [id, context.run.id]);
    return { instanceId: id, revision: await advanceRevision(context) };
  });
}
export async function getInstanceView(pool: pg.Pool, accountId: string, instanceId: string) {
  const result = await pool.query(`SELECT i.id,i.kind,i.lifecycle,i.revision::text,i.content_release_id AS "contentReleaseId"
    FROM instances i JOIN instance_participants p ON p.instance_id=i.id JOIN runs r ON r.id=p.run_id
    JOIN characters c ON c.id=r.character_id WHERE i.id=$1 AND c.account_id=$2`, [instanceId, accountId]);
  if (!result.rows.length) throw new DomainError(404, 'INSTANCE_NOT_FOUND');
  return result.rows[0];
}
