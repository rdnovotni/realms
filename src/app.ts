import { startTacticalCombat,takeTacticalAction,tacticalView } from './domains/tactical-combat.js';
import type { TacticalPlayerCommand } from './domains/tactical-combat.js';
import { advanceProficiency,proficiencyView } from './domains/proficiencies.js';
import { allocateAttributes,attributeView } from './domains/attributes.js';
import { attributes as attributeNames } from './domains/build-content.js';
import type { AttributeAllocation } from './domains/attribute-content.js';
import { chooseFeat,featView } from './domains/feats.js';
import { chooseSubclass,subclassView } from './domains/subclasses.js';
import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify,{type FastifyRequest} from 'fastify';
import type pg from 'pg';
import { ActionError, spendTurns, type SpendTurns } from './actions.js';
import { assertSchema } from './database.js';
import { getInstanceView } from './domains/instances.js';
import { startCombat,takeCombatAction,combatView,type CombatIntent } from './domains/combat.js';
import { craftRoutine,routineRecipeView } from './domains/crafting.js';
import { saveLoadout,setLoadoutProtection,deleteLoadout,applyLoadout,loadoutsView,itemProtectionView } from './domains/loadouts.js';
import { itemBindingView } from './domains/item-binding.js';
import { setItemLock,itemLockView } from './domains/item-locks.js';
import { startBuild,levelUp,buildOptions } from './domains/builds.js';
import { progressionView } from './domains/progression.js';
import { setEquipment,equipmentView,type EquipmentPlan } from './domains/equipment.js';
import { equipmentSlots } from './domains/equipment-content.js';
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
    protectedApp.get('/api/v1/progression/proficiencies',async request=>proficiencyView(pool,actor(request)));
    protectedApp.get('/api/v1/progression/attributes',async request=>attributeView(pool,actor(request)));
    protectedApp.get('/api/v1/progression/feats',async request=>featView(pool,actor(request)));
    protectedApp.get('/api/v1/progression/subclasses',async request=>subclassView(pool,actor(request)));
    protectedApp.get('/api/v1/progression',async request=>progressionView(pool,actor(request)));
    protectedApp.get('/api/v1/progression/options',async request=>buildOptions(pool,actor(request)));
    const envelopeProperties={requestId:{type:'string',format:'uuid'},expectedRevision:{type:'integer',minimum:0,maximum:2147483646}};
    const classIdField={type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'};
    protectedApp.post<{Body:Envelope & {rulesId:string;skillId:string;milestone:number}}>('/api/v1/progression/proficiencies',{schema:{body:{type:'object',additionalProperties:false,required:['requestId','actionType','expectedRevision','rulesId','skillId','milestone'],properties:{...envelopeProperties,actionType:{type:'string',const:'ADVANCE_PROFICIENCY'},rulesId:classIdField,skillId:classIdField,milestone:{type:'integer',minimum:1,maximum:999}}}}},async request=>advanceProficiency(pool,actor(request),{...request.body,...(request.principal?{principal:request.principal}:{})},request.body.rulesId,request.body.skillId,request.body.milestone));
    protectedApp.post<{Body:Envelope & {rulesId:string;milestone:number;allocation:AttributeAllocation}}>('/api/v1/progression/attributes',{schema:{body:{type:'object',additionalProperties:false,required:['requestId','actionType','expectedRevision','rulesId','milestone','allocation'],properties:{...envelopeProperties,actionType:{type:'string',const:'ALLOCATE_ATTRIBUTES'},rulesId:classIdField,milestone:{type:'integer',minimum:1,maximum:999},allocation:{type:'object',additionalProperties:false,minProperties:1,properties:Object.fromEntries(attributeNames.map(a=>[a,{type:'integer',minimum:1,maximum:30}]))}}}}},async request=>allocateAttributes(pool,actor(request),{...request.body,...(request.principal?{principal:request.principal}:{})},request.body.rulesId,request.body.milestone,request.body.allocation));
    protectedApp.post<{Body:Envelope & {featId:string;milestone:number}}>('/api/v1/progression/feats',{schema:{body:{type:'object',additionalProperties:false,required:['requestId','actionType','expectedRevision','featId','milestone'],properties:{...envelopeProperties,actionType:{type:'string',const:'CHOOSE_FEAT'},featId:classIdField,milestone:{type:'integer',minimum:1,maximum:999}}}}},async request=>chooseFeat(pool,actor(request),{...request.body,...(request.principal?{principal:request.principal}:{})},request.body.featId,request.body.milestone));
    protectedApp.post<{Body:Envelope & {subclassId:string}}>('/api/v1/progression/subclasses',{schema:{body:{type:'object',additionalProperties:false,required:['requestId','actionType','expectedRevision','subclassId'],properties:{...envelopeProperties,actionType:{type:'string',const:'CHOOSE_SUBCLASS'},subclassId:classIdField}}}},async request=>chooseSubclass(pool,actor(request),{...request.body,...(request.principal?{principal:request.principal}:{})},request.body.subclassId));
    protectedApp.post<{Body:Envelope & {classId:string;presetKey:string}}>('/api/v1/progression/start',{schema:{body:{type:'object',additionalProperties:false,required:['requestId','actionType','expectedRevision','classId','presetKey'],properties:{...envelopeProperties,actionType:{type:'string',const:'START_BUILD'},classId:classIdField,presetKey:{type:'string',pattern:'^[a-z][a-z0-9_-]{0,39}$'}}}}},async request=>startBuild(pool,actor(request),{...request.body,...(request.principal?{principal:request.principal}:{})},request.body.classId,request.body.presetKey));
    protectedApp.post<{Body:Envelope & {classId:string}}>('/api/v1/progression/level',{schema:{body:{type:'object',additionalProperties:false,required:['requestId','actionType','expectedRevision','classId'],properties:{...envelopeProperties,actionType:{type:'string',const:'LEVEL_UP'},classId:classIdField}}}},async request=>levelUp(pool,actor(request),{...request.body,...(request.principal?{principal:request.principal}:{})},request.body.classId));
    const tacticalId={type:'string',pattern:'^[a-z][a-z0-9_.-]{0,63}$'};
    const tacticalCommand={anyOf:[
      {type:'object',additionalProperties:false,required:['actorId','kind'],properties:{actorId:tacticalId,kind:{type:'string',enum:['END','GUARD','RETREAT','CONTINUE']}}},
      {type:'object',additionalProperties:false,required:['actorId','kind','zone'],properties:{actorId:tacticalId,kind:{type:'string',const:'MOVE'},zone:tacticalId}},
      {type:'object',additionalProperties:false,required:['actorId','kind','targetId'],properties:{actorId:tacticalId,kind:{type:'string',enum:['ATTACK','HEAL']},targetId:tacticalId}},
      {type:'object',additionalProperties:false,required:['actorId','kind','targetId','abilityId'],properties:{actorId:tacticalId,kind:{type:'string',const:'USE_ABILITY'},targetId:tacticalId,abilityId:classIdField}},
      {type:'object',additionalProperties:false,required:['actorId','kind','targetId','abilityId','effectId'],properties:{actorId:tacticalId,kind:{type:'string',const:'CLEANSE'},targetId:tacticalId,abilityId:classIdField,effectId:classIdField}}
    ]};
    protectedApp.post<{Body:Envelope & {definitionId:string}}>('/api/v1/tactical/start',{schema:{body:{type:'object',additionalProperties:false,required:['requestId','actionType','expectedRevision','definitionId'],properties:{...envelopeProperties,actionType:{type:'string',const:'START_TACTICAL'},definitionId:classIdField}}}},async request=>startTacticalCombat(pool,actor(request),{...request.body,...(request.principal?{principal:request.principal}:{})},request.body.definitionId));
    protectedApp.post<{Body:Envelope & {instanceId:string;expectedEncounterRevision:number;expectedTacticalRevision:number;command:TacticalPlayerCommand}}>('/api/v1/tactical/actions',{schema:{body:{type:'object',additionalProperties:false,required:['requestId','actionType','expectedRevision','instanceId','expectedEncounterRevision','expectedTacticalRevision','command'],properties:{...envelopeProperties,actionType:{type:'string',const:'TACTICAL_ACTION'},instanceId:{type:'string',format:'uuid'},expectedEncounterRevision:{type:'integer',minimum:1,maximum:100000},expectedTacticalRevision:{type:'integer',minimum:0,maximum:100000},command:tacticalCommand}}}},async request=>takeTacticalAction(pool,actor(request),{...request.body,...(request.principal?{principal:request.principal}:{})},request.body.instanceId,request.body.expectedEncounterRevision,request.body.expectedTacticalRevision,request.body.command));
    protectedApp.get<{Params:{id:string}}>('/api/v1/tactical/:id',{schema:{params:{type:'object',additionalProperties:false,required:['id'],properties:{id:{type:'string',format:'uuid'}}}}},async request=>tacticalView(pool,actor(request),request.params.id));
    protectedApp.post<{Body:Envelope & {definitionId:string}}>('/api/v1/combat/start',{schema:{body:{type:'object',additionalProperties:false,required:['requestId','actionType','expectedRevision','definitionId'],properties:{...envelopeProperties,actionType:{type:'string',const:'START_COMBAT'},definitionId:{type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'}}}}},async request=>startCombat(pool,actor(request),{...request.body,...(request.principal?{principal:request.principal}:{})},request.body.definitionId));
    protectedApp.post<{Body:Envelope & {instanceId:string;expectedRound:number;intent:CombatIntent}}>('/api/v1/combat/actions',{schema:{body:{type:'object',additionalProperties:false,required:['requestId','actionType','expectedRevision','instanceId','expectedRound','intent'],properties:{...envelopeProperties,actionType:{type:'string',const:'COMBAT_ACTION'},instanceId:{type:'string',format:'uuid'},expectedRound:{type:'integer',minimum:0,maximum:1000},intent:{type:'string',enum:['ATTACK','GUARD','RETREAT']}}}}},async request=>takeCombatAction(pool,actor(request),{...request.body,...(request.principal?{principal:request.principal}:{})},request.body.instanceId,request.body.expectedRound,request.body.intent));
    protectedApp.get<{Params:{id:string}}>('/api/v1/combat/:id',{schema:{params:{type:'object',additionalProperties:false,required:['id'],properties:{id:{type:'string',format:'uuid'}}}}},async request=>combatView(pool,actor(request),request.params.id));
    protectedApp.get<{Params:{id:string}}>('/api/v1/crafting/recipes/:id',{schema:{params:{type:'object',additionalProperties:false,required:['id'],properties:{id:{type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'}}}}},async request=>routineRecipeView(pool,actor(request),request.params.id));
    protectedApp.post<{Body:Envelope & {recipeId:string;batches:number;itemIds:string[]}}>('/api/v1/crafting/routine',{schema:{body:{type:'object',additionalProperties:false,required:['requestId','actionType','expectedRevision','recipeId','batches','itemIds'],properties:{...envelopeProperties,actionType:{type:'string',const:'CRAFT_ROUTINE'},recipeId:{type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'},batches:{type:'integer',minimum:1,maximum:100},itemIds:{type:'array',minItems:1,maxItems:16,uniqueItems:true,items:{type:'string',format:'uuid'}}}}}},async request=>craftRoutine(pool,actor(request),{...request.body,...(request.principal?{principal:request.principal}:{})},request.body.recipeId,request.body.batches,request.body.itemIds));
    protectedApp.get<{Params:{id:string}}>('/api/v1/inventory/:id/binding',{schema:{params:{type:'object',additionalProperties:false,required:['id'],properties:{id:{type:'string',format:'uuid'}}}}},async request=>itemBindingView(pool,actor(request),request.params.id));
    protectedApp.get<{Params:{id:string}}>('/api/v1/inventory/:id/lock',{schema:{params:{type:'object',additionalProperties:false,required:['id'],properties:{id:{type:'string',format:'uuid'}}}}},async request=>itemLockView(pool,actor(request),request.params.id));
    protectedApp.post<{Body:Envelope & {itemId:string;locked:boolean}}>('/api/v1/inventory/lock',{schema:{body:{type:'object',additionalProperties:false,required:['requestId','actionType','expectedRevision','itemId','locked'],properties:{...envelopeProperties,actionType:{type:'string',const:'SET_ITEM_LOCK'},itemId:{type:'string',format:'uuid'},locked:{type:'boolean'}}}}},async request=>setItemLock(pool,actor(request),{...request.body,...(request.principal?{principal:request.principal}:{})},request.body.itemId,request.body.locked));
    protectedApp.get('/api/v1/equipment/loadouts',async request=>loadoutsView(pool,actor(request)));
    protectedApp.post<{Body:Envelope & {key:string;name:string}}>('/api/v1/equipment/loadouts/save',{schema:{body:{type:'object',additionalProperties:false,required:['requestId','actionType','expectedRevision','key','name'],properties:{...envelopeProperties,actionType:{type:'string',const:'SAVE_LOADOUT'},key:{type:'string',pattern:'^[a-z][a-z0-9_-]{0,39}$'},name:{type:'string',minLength:1,maxLength:80}}}}},async request=>saveLoadout(pool,actor(request),{...request.body,...(request.principal?{principal:request.principal}:{})},request.body.key,request.body.name));
    const loadoutParams={type:'object',additionalProperties:false,required:['key'],properties:{key:{type:'string',pattern:'^[a-z][a-z0-9_-]{0,39}$'}}};
    protectedApp.post<{Params:{key:string};Body:Envelope & {protectItems:boolean}}>('/api/v1/equipment/loadouts/:key/protection',{schema:{params:loadoutParams,body:{type:'object',additionalProperties:false,required:['requestId','actionType','expectedRevision','protectItems'],properties:{...envelopeProperties,actionType:{type:'string',const:'SET_LOADOUT_PROTECTION'},protectItems:{type:'boolean'}}}}},async request=>setLoadoutProtection(pool,actor(request),{...request.body,...(request.principal?{principal:request.principal}:{})},request.params.key,request.body.protectItems));
    protectedApp.post<{Params:{key:string};Body:Envelope}>('/api/v1/equipment/loadouts/:key/delete',{schema:{params:loadoutParams,body:{type:'object',additionalProperties:false,required:['requestId','actionType','expectedRevision'],properties:{...envelopeProperties,actionType:{type:'string',const:'DELETE_LOADOUT'}}}}},async request=>deleteLoadout(pool,actor(request),{...request.body,...(request.principal?{principal:request.principal}:{})},request.params.key));
    protectedApp.post<{Params:{key:string};Body:Envelope}>('/api/v1/equipment/loadouts/:key/apply',{schema:{params:loadoutParams,body:{type:'object',additionalProperties:false,required:['requestId','actionType','expectedRevision'],properties:{...envelopeProperties,actionType:{type:'string',const:'SET_EQUIPMENT'}}}}},async request=>applyLoadout(pool,actor(request),{...request.body,...(request.principal?{principal:request.principal}:{})},request.params.key));
    protectedApp.get<{Params:{id:string}}>('/api/v1/inventory/:id/protection',{schema:{params:{type:'object',additionalProperties:false,required:['id'],properties:{id:{type:'string',format:'uuid'}}}}},async request=>itemProtectionView(pool,actor(request),request.params.id));
    protectedApp.get('/api/v1/equipment',async request=>equipmentView(pool,actor(request)));
    protectedApp.post<{Body:Envelope & EquipmentPlan}>('/api/v1/equipment',{schema:{body:{type:'object',additionalProperties:false,required:['requestId','actionType','expectedRevision','activeSet','slots'],properties:{...envelopeProperties,actionType:{type:'string',const:'SET_EQUIPMENT'},activeSet:{type:'string',enum:['A','B']},slots:{type:'array',maxItems:16,items:{type:'object',additionalProperties:false,required:['set','slot','itemId'],properties:{set:{type:'string',enum:['WORN','A','B']},slot:{type:'string',enum:equipmentSlots},itemId:{type:'string',format:'uuid'}}}}}}}},async request=>setEquipment(pool,actor(request),{...request.body,...(request.principal?{principal:request.principal}:{})},{activeSet:request.body.activeSet,slots:request.body.slots}));
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
