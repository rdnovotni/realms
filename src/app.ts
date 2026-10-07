import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import type pg from 'pg';
import { ActionError, spendTurns, type SpendTurns } from './actions.js';
import { assertSchema } from './database.js';
import { getInstanceView } from './domains/instances.js';
import { contentView } from './domains/content.js';

export function buildApp(pool: pg.Pool, token: string, accountId: string, logger = false) {
  const app = Fastify({ logger: logger ? { redact: ['req.headers.authorization'] } : false, bodyLimit: 16384,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  app.get('/health/live', async () => ({ status: 'ok', service: 'realms-server' }));
  app.get('/health/ready', async (_request, reply) => {
    try { await assertSchema(pool); return { status: 'ready' }; }
    catch { return reply.code(503).send({ status: 'unavailable' }); }
  });
  app.register(async protectedApp => {
    protectedApp.addHook('onRequest', async (request, reply) => {
      const supplied = createHash('sha256').update(request.headers.authorization ?? '').digest();
      const expected = createHash('sha256').update(`Bearer ${token}`).digest();
      if (!timingSafeEqual(supplied, expected)) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    });
    protectedApp.get<{Params:{id:string}}>('/api/v1/instances/:id', {schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',format:'uuid'}}}}}, async request=>getInstanceView(pool,accountId,request.params.id));
    protectedApp.get<{Params:{release:string;entity:string}}>('/api/v1/content/:release/:entity',{schema:{params:{type:'object',required:['release','entity'],properties:{release:{type:'string',format:'uuid'},entity:{type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'}}}}},async request=>contentView(pool,accountId,request.params.release,request.params.entity));
    protectedApp.get('/api/v1/state', async (_request, reply) => {
      const result = await pool.query('SELECT r.id AS "runId",r.turns,r.revision,r.rules_version AS "rulesVersion" FROM runs r JOIN characters c ON c.id=r.character_id WHERE c.account_id=$1 AND r.status IN(\'ACTIVE\',\'AFTERCORE\')', [accountId]);
      if (!result.rows.length) return reply.code(404).send({ error: 'NO_ACTIVE_RUN' });
      return result.rows[0];
    });
    protectedApp.post<{ Body: SpendTurns }>('/api/v1/actions', {
      schema: { body: {
        type: 'object', additionalProperties: false,
        required: ['requestId', 'actionType', 'amount', 'expectedRevision'],
        properties: {
          requestId: { type: 'string', format: 'uuid' },
          actionType: { type: 'string', const: 'SPEND_TURNS' },
          amount: { type: 'integer', minimum: 1, maximum: 10 },
          expectedRevision: { type: 'integer', minimum: 0, maximum: 2147483646 }
        }
      } }
    }, async request => spendTurns(pool, accountId, request.body));
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ActionError) return reply.code(error.statusCode).send({ error: error.code, traceId: request.id });
    if (typeof error === 'object' && error !== null && 'validation' in error) return reply.code(400).send({ error: 'INVALID_ACTION', traceId: request.id });
    request.log.error({ traceId: request.id }, 'Request failed');
    return reply.code(503).send({ error: 'TECHNICAL_FAILURE', traceId: request.id });
  });
  return app;
}
