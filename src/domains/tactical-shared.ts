import { failureCostsView } from './tactical-failure.js';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { executeAction,advanceRevision,type ActionContext,type Envelope } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';
import type { Json } from '../foundation/json.js';
import { randomInteger } from '../foundation/rng.js';
import { authored,spawned,enemyCommand,settle,tacticalPublic,recoveryView } from './tactical-combat.js';
import { beginAuthoredEncounter } from './loot.js';
import { saveEncounterCheckpoint } from './encounters.js';
import { loadTacticalPlayer,resolveTacticalIntent,type TacticalCommand,type TacticalCheckpoint } from './tactical-encounters.js';
import { startTactical,stepTactical,type TacticalState,type TacticalUnit } from './tactical-engine.js';
import type { TacticalSpec } from './tactical-content.js';
const json=(v:unknown)=>v as Record<string,Json>;
const bounded=(checkpoint:unknown)=>{if(Buffer.byteLength(JSON.stringify(checkpoint))>65536)throw new DomainError(409,'SHARED_TACTICAL_STATE_TOO_LARGE');};
const requireAction=(envelope:Envelope,type:string)=>{if(envelope.actionType!==type)throw new DomainError(400,'INVALID_SHARED_TACTICAL_ACTION');};
const key=(id:string)=>`shared-tactical:${id.toLowerCase()}`;
async function session(c:ActionContext,id:string,member=true){
 const s=(await c.client.query('SELECT * FROM shared_tactical_sessions WHERE id=$1 FOR UPDATE',[id])).rows[0];
 if(!s||member&&!(await c.client.query('SELECT 1 FROM shared_tactical_members WHERE session_id=$1 AND account_id=$2',[id,c.accountId])).rows.length)throw new DomainError(404,'SHARED_TACTICAL_NOT_FOUND');
 return s;
}
async function ready(c:ActionContext,id:string,spec:TacticalSpec){
 if(!(await c.client.query('SELECT 1 FROM discoveries WHERE account_id=$1 AND entity_id=$2',[c.accountId,(await session(c,id,false)).definition_id])).rows.length)throw new DomainError(404,'TACTICAL_NOT_DISCOVERED');
 const s=await session(c,id,false);if(s.lifecycle!=='LOBBY')throw new DomainError(409,'SHARED_TACTICAL_ALREADY_STARTED');
 if(c.run.content_release_id!==s.release_id)throw new DomainError(409,'SHARED_TACTICAL_RELEASE_MISMATCH');
 const members=(await c.client.query('SELECT * FROM shared_tactical_members WHERE session_id=$1 ORDER BY seat',[id])).rows;
 if(members.some(m=>m.account_id===c.accountId)||members.length>=spec.sharedCombat!.maximumPlayers)throw new DomainError(409,'SHARED_TACTICAL_PARTY_FULL');
 const previous=(await c.client.query('SELECT * FROM tactical_run_state WHERE run_id=$1 FOR UPDATE',[c.run.id])).rows[0];
 const started=await beginAuthoredEncounter(c,s.definition_id,{}),unitId=members.length===0?'hero':`player.${members.length}`;
 const unit=await loadTacticalPlayer(c,started.instanceId,spec.rules,{id:unitId,zone:spec.playerZone,loadKit:true,...(previous?{health:previous.health as number,mana:previous.mana as number}:{})});
 const hostRun=(await c.client.query('SELECT r.*,ch.account_id FROM runs r JOIN characters ch ON ch.id=r.character_id WHERE r.id=$1',[s.host_run_id])).rows[0];
 const hostContext={...c,accountId:hostRun.account_id,run:hostRun};
 const candidate=startTactical(spec.rules,[...members.map(m=>m.initial_checkpoint.state.units[0]),unit,...await spawned(hostContext,spec)]);
 bounded({engine:'TACTICAL_TRANSITION_V1',rules:spec.rules,state:candidate,controlledIds:[...candidate.units.filter(u=>u.side==='PARTY').map(u=>u.id)],serverControlledIds:spec.allies.filter(a=>a.owned&&!a.manual).map(a=>a.id)});
 const initial={engine:'SHARED_READY_V1',rules:spec.rules,state:{units:[unit]}};
 await c.client.query('INSERT INTO shared_tactical_members(session_id,run_id,account_id,instance_id,unit_id,seat,action_id,previous_instance_id,initial_checkpoint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,c.run.id,c.accountId,started.instanceId,unitId,members.length,c.actionId,previous?.last_instance_id??null,initial]);
 await c.client.query('INSERT INTO tactical_run_state(run_id,health,mana,last_instance_id) VALUES($1,$2,$3,$4) ON CONFLICT(run_id) DO UPDATE SET health=EXCLUDED.health,mana=EXCLUDED.mana,last_instance_id=EXCLUDED.last_instance_id',[c.run.id,unit.health,unit.mana,started.instanceId]);
 return {sessionId:id,instanceId:started.instanceId,unitId,turnCost:1,revision:await advanceRevision(c)};
}
/** Readiness spends the disclosed entry Turn and pins personal loot and build.
 * The session id is an invitation; it never authorizes another account's run. */
export function createSharedTactical(pool:pg.Pool,accountId:string,envelope:Envelope,definitionId:string){
 requireAction(envelope,'CREATE_SHARED_TACTICAL');const id=randomUUID();return executeAction(pool,accountId,envelope,{definitionId},async c=>{
 const spec=await authored(c,definitionId);if(!spec.sharedCombat)throw new DomainError(409,'SHARED_TACTICAL_NOT_ENABLED');
 const pin=(await c.client.query('SELECT revision FROM release_entries WHERE release_id=$1 AND entity_id=$2',[c.run.content_release_id,definitionId])).rows[0];
 await c.client.query('INSERT INTO shared_tactical_sessions(id,host_run_id,release_id,definition_id,definition_revision,spec) VALUES($1,$2,$3,$4,$5,$6)',[id,c.run.id,c.run.content_release_id,definitionId,pin.revision,spec]);
 return ready(c,id,spec);
 },key(id));
}
export function joinSharedTactical(pool:pg.Pool,accountId:string,envelope:Envelope,id:string){requireAction(envelope,'JOIN_SHARED_TACTICAL');return executeAction(pool,accountId,envelope,{id},async c=>{const s=await session(c,id,false);return ready(c,id,s.spec as TacticalSpec);},key(id));}
export function startSharedTactical(pool:pg.Pool,accountId:string,envelope:Envelope,id:string){requireAction(envelope,'START_SHARED_TACTICAL');return executeAction(pool,accountId,envelope,{id},async c=>{
 const s=await session(c,id);if(s.host_run_id!==c.run.id)throw new DomainError(403,'SHARED_TACTICAL_HOST_REQUIRED');if(s.lifecycle!=='LOBBY')throw new DomainError(409,'SHARED_TACTICAL_ALREADY_STARTED');
 const members=(await c.client.query('SELECT * FROM shared_tactical_members WHERE session_id=$1 ORDER BY seat',[id])).rows;if(members.length<2)throw new DomainError(409,'SHARED_TACTICAL_PLAYERS_REQUIRED');
 const spec=s.spec as TacticalSpec,units=members.map(m=>structuredClone(m.initial_checkpoint.state.units[0]) as TacticalUnit),npcs=await spawned(c,spec);
 const checkpoint:TacticalCheckpoint={engine:'TACTICAL_TRANSITION_V1',rules:spec.rules,state:startTactical(spec.rules,[...units,...npcs]),controlledIds:[...members.map(m=>m.unit_id),...spec.allies.filter(a=>!a.owned||a.manual).map(a=>a.id)],serverControlledIds:spec.allies.filter(a=>a.owned&&!a.manual).map(a=>a.id)};
 bounded(checkpoint);
 await c.client.query('INSERT INTO shared_tactical_origins(session_id,checkpoint,action_id) VALUES($1,$2,$3)',[id,checkpoint,c.actionId]);
 await c.client.query("UPDATE shared_tactical_sessions SET lifecycle='ACTIVE',checkpoint=$2 WHERE id=$1",[id,checkpoint]);
 return {sessionId:id,...tacticalPublic(checkpoint.state,0,spec),revision:await advanceRevision(c)} as unknown as Record<string,Json>;
 },key(id));}
/** Cooperative consent permits ordinary support, never cross-account harm or
 * removing another caster's beneficial effects. PvP requires its own opt-in. */
export function assertSharedPartyConsent(before:TacticalState,after:TacticalState,actorId:string,owners:Map<string,string>,intent:TacticalCommand){
 const actor=before.units.find(u=>u.id===actorId)!;if(actor.side!=='PARTY')return;
 if(intent.kind==='TECHNIQUE'){const a=actor.techniques?.abilities.find(a=>a.id===intent.abilityId),anchor=before.units.find(u=>u.id===intent.targetId);
  if(a?.targetSide==='ALLY'&&(a.effect.kind==='DAMAGE'||a.effect.kind==='EFFECT'&&a.grants.some(g=>g.effect.polarity!=='BENEFICIAL'))&&before.units.some(u=>u.side==='PARTY'&&u.state==='ACTIVE'&&(a.area==='SINGLE'?u.id===anchor?.id:u.zone===anchor?.zone)&&owners.get(u.id)!==owners.get(actorId)))throw new DomainError(403,'SHARED_HARMFUL_PARTY_ACTION');
 }
 for(const prior of before.units){if(prior.side!=='PARTY'||owners.get(prior.id)===owners.get(actorId))continue;const next=after.units.find(u=>u.id===prior.id)!;
 const harmful=(next.effects??[]).some(e=>e.sourceUnitId===actorId&&e.effect.polarity!=='BENEFICIAL'&&(e.appliedRevision===after.revision||e.remaining>((prior.effects??[]).find(p=>p.effectId===e.effectId&&p.sourceUnitId===actorId)?.remaining??-1)));
 const stripped=(prior.effects??[]).some(e=>e.effect.polarity==='BENEFICIAL'&&e.sourceUnitId!==actorId&&!(next.effects??[]).some(n=>n.effectId===e.effectId&&n.sourceUnitId===e.sourceUnitId&&n.effectRevision===e.effectRevision));
 if(next.health<prior.health||harmful||stripped)throw new DomainError(403,'SHARED_HARMFUL_PARTY_ACTION');
 }
}
async function transition(c:ActionContext,s:any,command:TacticalCommand,control:'PLAYER'|'SERVER'){
 const checkpoint=s.checkpoint as TacticalCheckpoint;
 const members=(await c.client.query('SELECT m.*,i.seed FROM shared_tactical_members m JOIN instances i ON i.id=m.instance_id WHERE m.session_id=$1 ORDER BY m.seat',[s.id])).rows;
 const seed=members[0]!.seed,owners=new Map(checkpoint.state.units.filter(u=>u.side==='PARTY').map(u=>[u.id,members.find(m=>m.unit_id===u.id)?.account_id??members[0]!.account_id]));
 const draw=async(drawKey:string,bound:number)=>{
 const counter=BigInt((await c.client.query('SELECT coalesce(max(counter)+1,0)::text n FROM shared_tactical_draws WHERE session_id=$1',[s.id])).rows[0].n),value=randomInteger(seed,'shared-tactical',counter,bound);
 await c.client.query('INSERT INTO shared_tactical_draws(session_id,counter,draw_key,bound,value,action_id) VALUES($1,$2,$3,$4,$5,$6)',[s.id,counter.toString(),drawKey,bound,value,c.actionId]);return value;
 };
 const intent=await resolveTacticalIntent(checkpoint,command,draw),result=stepTactical(checkpoint.rules,checkpoint.state,checkpoint.state.revision,intent);assertSharedPartyConsent(checkpoint.state,result.state,command.actorId,owners,command);bounded({...checkpoint,state:result.state});
 await c.client.query('INSERT INTO shared_tactical_steps(session_id,revision,action_id,control,intent,evidence,state) VALUES($1,$2,$3,$4,$5,$6,$7)',[s.id,result.state.revision,c.actionId,control,result.evidence.intent,result.evidence,result.state]);
 s.checkpoint={...checkpoint,state:result.state};s.revision=result.state.revision;s.lifecycle=result.state.outcome?'TERMINAL':'ACTIVE';
 await c.client.query('UPDATE shared_tactical_sessions SET checkpoint=$2,revision=$3,lifecycle=$4 WHERE id=$1',[s.id,s.checkpoint,s.revision,s.lifecycle]);
}
export function takeSharedTacticalAction(pool:pg.Pool,accountId:string,envelope:Envelope,id:string,expectedRevision:number,command:TacticalCommand|{actorId:string;kind:'CONTINUE'}){requireAction(envelope,'SHARED_TACTICAL_ACTION');return executeAction(pool,accountId,envelope,{id,expectedRevision,command},async c=>{
 const s=await session(c,id);if(s.lifecycle!=='ACTIVE')throw new DomainError(409,'SHARED_TACTICAL_NOT_ACTIVE');if(s.revision!==expectedRevision)throw new DomainError(409,'STALE_SHARED_TACTICAL_REVISION');
 const m=(await c.client.query('SELECT * FROM shared_tactical_members WHERE session_id=$1 AND run_id=$2',[id,c.run.id])).rows[0],checkpoint=s.checkpoint as TacticalCheckpoint,spec=s.spec as TacticalSpec;
 const owns=command.actorId===m.unit_id||(c.run.id===s.host_run_id&&spec.allies.some(a=>a.id===command.actorId&&(!a.owned||a.manual)));
 if(!owns)throw new DomainError(403,'TACTICAL_ACTOR_NOT_CONTROLLED');
 const serverTurn=()=>{const cp=s.checkpoint as TacticalCheckpoint,actor=cp.state.units.find(u=>u.id===cp.state.order[cp.state.cursor])!;return actor.side==='ENEMY'||cp.serverControlledIds?.includes(actor.id);};
 if(command.kind==='CONTINUE'){if(!serverTurn())throw new DomainError(409,'NOT_ENEMY_TURN');}else await transition(c,s,command,'PLAYER');
 for(let n=0;s.lifecycle==='ACTIVE'&&serverTurn();n++){if(n>=64)throw new DomainError(409,'TACTICAL_AI_LIMIT');await transition(c,s,enemyCommand(s.checkpoint),'SERVER');}
 return {sessionId:id,...tacticalPublic(s.checkpoint.state,s.revision,spec),revision:await advanceRevision(c)} as unknown as Record<string,Json>;
 },key(id));}
/** Personal claims are durable and independent of presence at the last hit.
 * Each owner executes their own settlement Action, including loot/XP and costs. */
export function projectSharedState(state:TacticalState,unitId:string):TacticalState{
 const result=structuredClone(state),rename=(id:string)=>id===unitId?'hero':id==='hero'?'player.0':id;
 result.units=result.units.map(u=>({...u,id:rename(u.id),...(u.effects?{effects:u.effects.map(e=>({...e,sourceUnitId:rename(e.sourceUnitId)}))}:{})}));
 result.units.sort((a,b)=>a.id==='hero'?-1:b.id==='hero'?1:0);result.order=result.order.map(rename);result.budgets=Object.fromEntries(Object.entries(result.budgets).map(([id,b])=>[rename(id),b]));return result;
}
export function claimSharedTactical(pool:pg.Pool,accountId:string,envelope:Envelope,id:string){requireAction(envelope,'CLAIM_SHARED_TACTICAL');return executeAction(pool,accountId,envelope,{id},async c=>{
 const s=await session(c,id);if(s.lifecycle!=='TERMINAL'&&s.lifecycle!=='CANCELLED')throw new DomainError(409,'SHARED_TACTICAL_NOT_TERMINAL');
 const m=(await c.client.query('SELECT * FROM shared_tactical_members WHERE session_id=$1 AND run_id=$2',[id,c.run.id])).rows[0];
 if((await c.client.query('SELECT 1 FROM shared_tactical_claims WHERE instance_id=$1',[m.instance_id])).rows.length)throw new DomainError(409,'SHARED_TACTICAL_ALREADY_CLAIMED');
 const spec=structuredClone(s.spec) as TacticalSpec;if(c.run.id!==s.host_run_id)spec.allies=[];
 const state=projectSharedState(s.checkpoint.state,m.unit_id);
 await saveEncounterCheckpoint(c,m.instance_id,0,json({engine:'SHARED_TACTICAL_V1',rules:spec.rules,state}));
 await c.client.query('INSERT INTO shared_tactical_claims(instance_id,action_id) VALUES($1,$2)',[m.instance_id,c.actionId]);
 const revision=await settle(c,m.instance_id,spec,state,1);
 return {sessionId:id,instanceId:m.instance_id,...tacticalPublic(state,revision,spec),recovery:await recoveryView(c,m.instance_id),revision:await advanceRevision(c)} as unknown as Record<string,Json>;
 },key(id));}
export function cancelSharedTactical(pool:pg.Pool,accountId:string,envelope:Envelope,id:string){requireAction(envelope,'CANCEL_SHARED_TACTICAL');return executeAction(pool,accountId,envelope,{id},async c=>{
 const s=await session(c,id);if(s.host_run_id!==c.run.id)throw new DomainError(403,'SHARED_TACTICAL_HOST_REQUIRED');if(s.lifecycle!=='LOBBY')throw new DomainError(409,'SHARED_TACTICAL_ALREADY_STARTED');
 const members=(await c.client.query('SELECT * FROM shared_tactical_members WHERE session_id=$1 ORDER BY seat',[id])).rows,spec=s.spec as TacticalSpec;
 const checkpoint:TacticalCheckpoint={engine:'TACTICAL_TRANSITION_V1',rules:spec.rules,state:{...startTactical(spec.rules,[...members.map(m=>m.initial_checkpoint.state.units[0]),...await spawned(c,spec)]),outcome:'RETREAT'},controlledIds:[...members.map(m=>m.unit_id),...spec.allies.filter(a=>!a.owned||a.manual).map(a=>a.id)],serverControlledIds:spec.allies.filter(a=>a.owned&&!a.manual).map(a=>a.id)};
 bounded(checkpoint);
 await c.client.query('INSERT INTO shared_tactical_origins(session_id,checkpoint,action_id) VALUES($1,$2,$3)',[id,checkpoint,c.actionId]);
 await c.client.query("UPDATE shared_tactical_sessions SET lifecycle='CANCELLED',checkpoint=$2 WHERE id=$1",[id,checkpoint]);return {sessionId:id,outcome:'RETREAT',entryTurnRefund:0,revision:await advanceRevision(c)};
 },key(id));}
export async function sharedTacticalView(pool:pg.Pool,accountId:string,id:string){
 const s=(await pool.query('SELECT s.*,m.unit_id,m.instance_id,r.revision AS run_revision FROM shared_tactical_sessions s JOIN shared_tactical_members m ON m.session_id=s.id JOIN runs r ON r.id=m.run_id WHERE s.id=$1 AND m.account_id=$2',[id,accountId])).rows[0];if(!s)throw new DomainError(404,'SHARED_TACTICAL_NOT_FOUND');
 const members=(await pool.query('SELECT m.unit_id,m.seat,claims.instance_id IS NOT NULL AS claimed FROM shared_tactical_members m LEFT JOIN shared_tactical_claims claims ON claims.instance_id=m.instance_id WHERE m.session_id=$1 ORDER BY seat',[id])).rows;
 const recovery=(await pool.query('SELECT health,mana,turn_cost,destination FROM tactical_recoveries WHERE instance_id=$1',[s.instance_id])).rows[0];
 return {recovery:recovery?{health:recovery.health,mana:recovery.mana,turnCost:recovery.turn_cost,destination:recovery.destination,...await failureCostsView(pool,s.instance_id)}:null,sessionId:id,instanceId:s.instance_id,unitId:s.unit_id,lifecycle:s.lifecycle,members,revision:s.run_revision,...(s.checkpoint?tacticalPublic(s.checkpoint.state,s.revision,s.spec):{entryTurnCost:1,loot:'PERSONAL',failureContract:s.spec.failure})};
}
/** A discovered invitation exposes its commitment before the player spends a
 * Turn or locks a build. It exposes no other player's account or hidden stats. */
export async function sharedInvitationView(pool:pg.Pool,accountId:string,id:string){
 const s=(await pool.query(`SELECT s.*,r.revision AS run_revision FROM shared_tactical_sessions s JOIN runs r ON r.content_release_id=s.release_id AND r.status IN('ACTIVE','AFTERCORE') JOIN characters c ON c.id=r.character_id AND c.account_id=$2 JOIN discoveries d ON d.account_id=c.account_id AND d.entity_id=s.definition_id WHERE s.id=$1`,[id,accountId])).rows[0];if(!s)throw new DomainError(404,'SHARED_TACTICAL_NOT_FOUND');
 const count=(await pool.query('SELECT count(*)::integer n FROM shared_tactical_members WHERE session_id=$1',[id])).rows[0].n;
 return {sessionId:id,definitionId:s.definition_id,lifecycle:s.lifecycle,playersReady:count,maximumPlayers:s.spec.sharedCombat.maximumPlayers,entryTurnCost:1,cancellationTurnRefund:0,loot:'PERSONAL',failureContract:s.spec.failure,partyWithdrawal:'CURRENT_ACTOR',harmfulAllyActions:'DISALLOWED',revision:s.run_revision};
}
