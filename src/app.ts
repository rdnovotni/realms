import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify,{type FastifyRequest} from 'fastify';
import type pg from 'pg';
import { ActionError, spendTurns, type SpendTurns } from './actions.js';
import { assertSchema } from './database.js';
import { getInstanceView } from './domains/instances.js';
import { startCombat,takeCombatAction,combatView,type CombatIntent } from './domains/combat.js';
import { craftRoutine,routineRecipeView } from './domains/crafting.js';
import { ascend } from './domains/lifecycle.js';
import type { Envelope } from './foundation/action.js';
import { contentView } from './domains/content.js';
import type { Authentication } from './config.js';
import { authorizeSession,resolveSession,requireLogin,throttleAuth,listSessions,revokeSession,revokeAllSessions,changePassword,recoverPassword,type Principal } from './auth/sessions.js';

declare module 'fastify' { interface FastifyRequest { accountId:string|null; principal:Principal|null } }
const actor=(request:FastifyRequest)=>{if(!request.accountId) throw new ActionError(401,'UNAUTHORIZED');return request.accountId;};
const session=(request:FastifyRequest)=>{if(!request.principal) throw new ActionError(401,'SESSION_REQUIRED');return request.principal;};
const passwordField={type:'string',minLength:1,maxLength:128};

export function buildApp(pool: pg.Pool, auth:Authentication, logger = false) {
  const app = Fastify({ logger: logger ? { redact: ['req.headers.authorization','req.body'] } : false, bodyLimit: 16384,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  app.decorateRequest('accountId',null);app.decorateRequest('principal',null);
  app.addHook('onSend',async (request,reply,payload)=>{if(request.url.startsWith('/api/'))reply.header('Cache-Control','no-store');return payload;});
  app.get('/health/live', async () => ({ status: 'ok', service: 'realms-server' }));
  app.get('/health/ready', async (_request, reply) => {
    try { await assertSchema(pool); return { status: 'ready' }; }
    catch { return reply.code(503).send({ status: 'unavailable' }); }
  });
  if(auth.mode==='sessions'){
    app.post<{Body:{handle:string;password:string;deviceLabel:string;readOnly?:boolean}}>('/api/v1/auth/login',{schema:{body:{type:'object',additionalProperties:false,required:['handle','password','deviceLabel'],properties:{handle:{type:'string',pattern:'^[A-Za-z][A-Za-z0-9_]{2,39}$'},password:passwordField,deviceLabel:{type:'string',minLength:1,maxLength:80},readOnly:{type:'boolean'}}}}},async request=>{
      await throttleAuth(pool,auth.throttleKey,request.ip,request.body.handle);
      return requireLogin(pool,request.body.handle,request.body.password,request.body.deviceLabel,request.body.readOnly);
    });
    app.post<{Body:{handle:string;recoveryCode:string;newPassword:string}}>('/api/v1/auth/recover',{schema:{body:{type:'object',additionalProperties:false,required:['handle','recoveryCode','newPassword'],properties:{handle:{type:'string',pattern:'^[A-Za-z][A-Za-z0-9_]{2,39}$'},recoveryCode:{type:'string',pattern:'^rc1_[A-Za-z0-9_-]{43}$'},newPassword:passwordField}}}},async request=>{
      await throttleAuth(pool,auth.throttleKey,request.ip,request.body.handle);
      return recoverPassword(pool,request.body.handle,request.body.recoveryCode,request.body.newPassword);
    });
  }
  app.register(async protectedApp => {
    protectedApp.addHook('onRequest', async (request, reply) => {
      if(auth.mode==='development'){
        const supplied = createHash('sha256').update(request.headers.authorization ?? '').digest();
        const expected = createHash('sha256').update(`Bearer ${auth.token}`).digest();
        if (!timingSafeEqual(supplied, expected)) return reply.code(401).send({ error: 'UNAUTHORIZED' });
        const account=(await pool.query('SELECT access_status FROM accounts WHERE id=$1',[auth.accountId])).rows[0];
        if(!account || account.access_status!=='ACTIVE') return reply.code(401).send({error:'UNAUTHORIZED'});
        request.accountId=auth.accountId;
      }else{
        const supplied=/^Bearer (rs1_[A-Za-z0-9_-]{43})$/.exec(request.headers.authorization??'');
        if(!supplied) return reply.code(401).send({error:'UNAUTHORIZED'});
        request.principal=await resolveSession(pool,supplied[1]!);request.accountId=request.principal.accountId;
        const client=await pool.connect();try{await authorizeSession(client,request.principal,'GAME_READ');}finally{client.release();}
      }
    });
    const envelopeProperties={requestId:{type:'string',format:'uuid'},expectedRevision:{type:'integer',minimum:0,maximum:2147483646}};
    protectedApp.post<{Body:Envelope & {definitionId:string}}>('/api/v1/combat/start',{schema:{body:{type:'object',additionalProperties:false,required:['requestId','actionType','expectedRevision','definitionId'],properties:{...envelopeProperties,actionType:{type:'string',const:'START_COMBAT'},definitionId:{type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'}}}}},async request=>startCombat(pool,actor(request),{...request.body,...(request.principal?{principal:request.principal}:{})},request.body.definitionId));
    protectedApp.post<{Body:Envelope & {instanceId:string;expectedRound:number;intent:CombatIntent}}>('/api/v1/combat/actions',{schema:{body:{type:'object',additionalProperties:false,required:['requestId','actionType','expectedRevision','instanceId','expectedRound','intent'],properties:{...envelopeProperties,actionType:{type:'string',const:'COMBAT_ACTION'},instanceId:{type:'string',format:'uuid'},expectedRound:{type:'integer',minimum:0,maximum:1000},intent:{type:'string',enum:['ATTACK','GUARD','RETREAT']}}}}},async request=>takeCombatAction(pool,actor(request),{...request.body,...(request.principal?{principal:request.principal}:{})},request.body.instanceId,request.body.expectedRound,request.body.intent));
    protectedApp.get<{Params:{id:string}}>('/api/v1/combat/:id',{schema:{params:{type:'object',additionalProperties:false,required:['id'],properties:{id:{type:'string',format:'uuid'}}}}},async request=>combatView(pool,actor(request),request.params.id));
    protectedApp.get<{Params:{id:string}}>('/api/v1/crafting/recipes/:id',{schema:{params:{type:'object',additionalProperties:false,required:['id'],properties:{id:{type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'}}}}},async request=>routineRecipeView(pool,actor(request),request.params.id));
    protectedApp.post<{Body:Envelope & {recipeId:string;batches:number;itemIds:string[]}}>('/api/v1/crafting/routine',{schema:{body:{type:'object',additionalProperties:false,required:['requestId','actionType','expectedRevision','recipeId','batches','itemIds'],properties:{...envelopeProperties,actionType:{type:'string',const:'CRAFT_ROUTINE'},recipeId:{type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'},batches:{type:'integer',minimum:1,maximum:100},itemIds:{type:'array',minItems:1,maxItems:16,uniqueItems:true,items:{type:'string',format:'uuid'}}}}}},async request=>craftRoutine(pool,actor(request),{...request.body,...(request.principal?{principal:request.principal}:{})},request.body.recipeId,request.body.batches,request.body.itemIds));
    protectedApp.post<{Body:Envelope}>('/api/v1/ascend',{schema:{body:{type:'object',additionalProperties:false,required:['requestId','actionType','expectedRevision'],properties:{...envelopeProperties,actionType:{type:'string',const:'ASCEND'}}}}},async request=>ascend(pool,actor(request),{...request.body,...(request.principal?{principal:request.principal}:{})}));
    protectedApp.get<{Params:{id:string}}>('/api/v1/instances/:id', {schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',format:'uuid'}}}}}, async request=>getInstanceView(pool,actor(request),request.params.id));
    protectedApp.get<{Params:{release:string;entity:string}}>('/api/v1/content/:release/:entity',{schema:{params:{type:'object',required:['release','entity'],properties:{release:{type:'string',format:'uuid'},entity:{type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'}}}}},async request=>contentView(pool,actor(request),request.params.release,request.params.entity));
    protectedApp.get('/api/v1/state', async (request, reply) => {
      const result = await pool.query('SELECT r.id AS "runId",r.turns,r.revision,r.rules_version AS "rulesVersion" FROM runs r JOIN characters c ON c.id=r.character_id WHERE c.account_id=$1 AND r.status IN(\'ACTIVE\',\'AFTERCORE\')', [actor(request)]);
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
    }, async request => spendTurns(pool, actor(request), {...request.body,...(request.principal?{principal:request.principal}:{})}));
    if(auth.mode==='sessions'){
      protectedApp.get('/api/v1/auth/sessions',async request=>({sessions:await listSessions(pool,session(request))}));
      protectedApp.post('/api/v1/auth/logout',async request=>revokeSession(pool,session(request),session(request).sessionId));
      protectedApp.post('/api/v1/auth/logout-all',async request=>revokeAllSessions(pool,session(request)));
      protectedApp.delete<{Params:{id:string}}>('/api/v1/auth/sessions/:id',{schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',format:'uuid'}}}}},async request=>revokeSession(pool,session(request),request.params.id));
      protectedApp.post<{Body:{currentPassword:string;newPassword:string}}>('/api/v1/auth/password',{schema:{body:{type:'object',additionalProperties:false,required:['currentPassword','newPassword'],properties:{currentPassword:passwordField,newPassword:passwordField}}}},async request=>{
        const principal=session(request),client=await pool.connect();try{await authorizeSession(client,principal,'ACCOUNT_MANAGE');}finally{client.release();}
        await throttleAuth(pool,auth.throttleKey,request.ip,'password:'+principal.accountId);
        return changePassword(pool,principal,request.body.currentPassword,request.body.newPassword);
      });
    }
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ActionError) return reply.code(error.statusCode).send({ error: error.code, traceId: request.id });
    if (typeof error === 'object' && error !== null && 'validation' in error) return reply.code(400).send({ error: 'INVALID_ACTION', traceId: request.id });
    request.log.error({ traceId: request.id }, 'Request failed');
    return reply.code(503).send({ error: 'TECHNICAL_FAILURE', traceId: request.id });
  });
  return app;
}
