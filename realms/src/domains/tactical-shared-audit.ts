import type pg from 'pg';
import type { ActionContext } from '../foundation/action.js';
import { checksum,type Json } from '../foundation/json.js';
import { randomInteger } from '../foundation/rng.js';
import { loadTacticalPlayer,resolveTacticalIntent,type TacticalCheckpoint,type TacticalCommand } from './tactical-encounters.js';
import { spawned,enemyCommand } from './tactical-combat.js';
import { projectSharedState,assertSharedPartyConsent } from './tactical-shared.js';
import { startTactical,stepTactical,type TacticalUnit } from './tactical-engine.js';
import { deriveCarryEffects,loadInjuryGrant } from './tactical-persistence.js';
import { failureCostMismatch } from './tactical-failure.js';
import { companionRecovery } from './tactical-companions.js';
import { validateTacticalSpec,type TacticalSpec } from './tactical-content.js';
const equal=(a:unknown,b:unknown)=>checksum(a as Json)===checksum(b as Json);
/** Rebuild every consenting character from immutable inputs, verify seeded
 * draws and authorization, replay transitions, then reconcile personal claims. */
export async function sharedTacticalMismatchCount(client:pg.PoolClient){
 let mismatches=0;
 await client.query('DECLARE shared_session_audit NO SCROLL CURSOR FOR '+'SELECT s.*,v.definition->\'mechanics\'->\'tacticalCombat\' AS authored FROM shared_tactical_sessions s JOIN content_versions v ON v.entity_id=s.definition_id AND v.revision=s.definition_revision');
 try{for(;;){const sessions=(await client.query('FETCH FORWARD 32 FROM shared_session_audit')).rows;if(!sessions.length)break;
 for(const s of sessions)try{
  const spec=s.spec as TacticalSpec;validateTacticalSpec(spec);if(!spec.sharedCombat||!equal(spec,s.authored))throw Error('shared source');
  const members=(await client.query('SELECT m.*,r.*,m.run_id AS member_run_id,m.instance_id AS personal_instance,c.account_id AS run_account,e.start_action_id,e.outcome,e.revision AS personal_revision,e.checkpoint AS personal_checkpoint,e.finish_action_id,i.seed,i.created_at,receipt.account_id AS receipt_owner,receipt.action_type FROM shared_tactical_members m JOIN runs r ON r.id=m.run_id JOIN characters c ON c.id=r.character_id JOIN encounter_records e ON e.instance_id=m.instance_id JOIN instances i ON i.id=m.instance_id LEFT JOIN action_receipts receipt ON receipt.action_id=m.action_id WHERE m.session_id=$1 ORDER BY m.seat',[s.id])).rows;
  if(!members.length||members.length>spec.sharedCombat.maximumPlayers||members[0]!.member_run_id!==s.host_run_id)throw Error('roster');
  const ready:TacticalUnit[]=[];
  for(const [index,m] of members.entries()){

   if(m.seat!==index||m.unit_id!==(index===0?'hero':`player.${index}`)||m.account_id!==m.run_account||m.receipt_owner!==m.account_id||m.start_action_id!==m.action_id||m.content_release_id!==s.release_id||m.action_type!==(index===0?'CREATE_SHARED_TACTICAL':'JOIN_SHARED_TACTICAL'))throw Error('consent');
   const prior=m.previous_instance_id?(await client.query('SELECT health,mana FROM tactical_recoveries WHERE instance_id=$1',[m.previous_instance_id])).rows[0]:null;if(m.previous_instance_id&&!prior)throw Error('previous recovery');
   const c={client,accountId:m.account_id,run:{...m,id:m.member_run_id}} as ActionContext;
   const unit=await loadTacticalPlayer(c,m.personal_instance,spec.rules,{id:m.unit_id,zone:spec.playerZone,loadKit:true,...(prior?{health:prior.health,mana:prior.mana}:{})},m.previous_instance_id);
   if(!equal(m.initial_checkpoint,{engine:'SHARED_READY_V1',rules:spec.rules,state:{units:[unit]}}))throw Error('ready snapshot');ready.push(unit);
  }
  const origin=(await client.query('SELECT o.*,a.account_id,a.action_type FROM shared_tactical_origins o LEFT JOIN action_receipts a ON a.action_id=o.action_id WHERE o.session_id=$1',[s.id])).rows[0];
  if(s.lifecycle==='LOBBY'){if(origin||s.checkpoint||s.revision!==0||members.some(m=>m.outcome!==null||m.personal_revision!==0||!equal(m.personal_checkpoint,{})))throw Error('lobby');continue;}
  if(!origin||origin.account_id!==members[0]!.account_id||origin.action_type!==(s.lifecycle==='CANCELLED'?'CANCEL_SHARED_TACTICAL':'START_SHARED_TACTICAL'))throw Error('host origin');
  const host=members[0]!,c={client,accountId:host.account_id,run:{...host,id:host.member_run_id}} as ActionContext;
  const pins=Object.fromEntries(spec.allies.filter(a=>a.owned).map(a=>[a.id,origin.checkpoint.state.units.find((u:TacticalUnit)=>u.id===a.id)?.companionRecoveryId??null]));
  const npcs=await spawned(c,spec,pins);let state=startTactical(spec.rules,[...ready,...npcs]);if(s.lifecycle==='CANCELLED')state.outcome='RETREAT';
  const initial:TacticalCheckpoint={engine:'TACTICAL_TRANSITION_V1',rules:spec.rules,state,controlledIds:[...members.map(m=>m.unit_id),...spec.allies.filter(a=>!a.owned||a.manual).map(a=>a.id)],serverControlledIds:spec.allies.filter(a=>a.owned&&!a.manual).map(a=>a.id)};
  if(!equal(initial,origin.checkpoint))throw Error('initial state');
  const draws=(await client.query('SELECT * FROM shared_tactical_draws WHERE session_id=$1 ORDER BY counter',[s.id])).rows;if(draws.some((d,i)=>BigInt(d.counter)!==BigInt(i)))throw Error('draw sequence');
  const byKey=new Map(draws.map(d=>[d.draw_key,d])),used=new Set<string>();
  await client.query('DECLARE shared_steps_audit NO SCROLL CURSOR FOR '+'SELECT st.*,a.account_id FROM shared_tactical_steps st LEFT JOIN action_receipts a ON a.action_id=st.action_id WHERE st.session_id=$1 ORDER BY revision',[s.id]);
  try{for(;;){const steps=(await client.query('FETCH FORWARD 32 FROM shared_steps_audit')).rows;if(!steps.length)break;
  for(const step of steps){
   const member=members.find(m=>m.account_id===step.account_id);if(!member||step.revision!==state.revision+1)throw Error('step owner');
   const intent=step.intent,command={...intent} as Record<string,unknown>;delete command.roll;delete command.rawDamage;if(intent.kind==='USE_HEALING_ABILITY')delete command.amount;if(intent.kind==='TECHNIQUE')delete command.draws;if(intent.kind==='MOVE')delete command.opportunities;
   const checkpoint={...initial,state};
   if(step.control==='SERVER'){if(!equal(command,enemyCommand(checkpoint)))throw Error('AI');}
   else if(intent.actorId!==member.unit_id&&!(member.member_run_id===s.host_run_id&&spec.allies.some(a=>a.id===intent.actorId&&(!a.owned||a.manual))))throw Error('foreign control');
   const expected=await resolveTacticalIntent(checkpoint,command as TacticalCommand,async(key,bound)=>{const d=byKey.get(key);if(!d||d.action_id!==step.action_id||Number(d.bound)!==bound||used.has(key)||Number(d.value)!==randomInteger(host.seed,'shared-tactical',BigInt(d.counter),bound))throw Error('draw');used.add(key);return Number(d.value);});
   if(!equal(expected,intent))throw Error('intent');const result=stepTactical(spec.rules,state,state.revision,intent);assertSharedPartyConsent(state,result.state,intent.actorId,new Map(state.units.filter(u=>u.side==='PARTY').map(u=>[u.id,members.find(m=>m.unit_id===u.id)?.account_id??host.account_id])),command as TacticalCommand);if(!equal(result.evidence,step.evidence)||!equal(result.state,step.state))throw Error('transition');state=result.state;
  }
  }}finally{await client.query('CLOSE shared_steps_audit');}
  if(used.size!==draws.length||state.revision!==s.revision||!equal(s.checkpoint,{...initial,state})||(s.lifecycle==='ACTIVE')!==(state.outcome===null)||s.lifecycle==='CANCELLED'&&state.revision!==0)throw Error('head');
  for(const m of members){
   const claim=(await client.query('SELECT cl.*,a.account_id FROM shared_tactical_claims cl LEFT JOIN action_receipts a ON a.action_id=cl.action_id WHERE cl.instance_id=$1',[m.personal_instance])).rows[0];
   if(!claim){if(m.outcome!==null||m.personal_revision!==0||!equal(m.personal_checkpoint,{}))throw Error('unclaimed settlement');continue;}
   if(m.personal_revision!==2||claim.account_id!==m.account_id||m.finish_action_id!==claim.action_id||m.outcome!==state.outcome)throw Error('claim ownership');
   const personal=projectSharedState(state,m.unit_id),personalSpec=structuredClone(spec);if(m.member_run_id!==s.host_run_id)personalSpec.allies=[];
   if(!equal(m.personal_checkpoint,{engine:'SHARED_TACTICAL_V1',rules:spec.rules,state:personal}))throw Error('claim state');
   const recovery=(await client.query('SELECT * FROM tactical_recoveries WHERE instance_id=$1',[m.personal_instance])).rows[0],hero=personal.units[0]!,failed=['DEFEAT','FAILED_FORWARD','SURRENDER'].includes(state.outcome??'');
   if(!recovery||recovery.action_id!==claim.action_id||recovery.health!==(hero.health>0?hero.health:Math.min(hero.stats.maxHealth,spec.failure.recoveryHealth))||recovery.mana!==hero.mana||recovery.destination!==(failed?spec.failure.destination:'FIELD')||recovery.turn_cost>spec.failure.turnCost||!failed&&recovery.turn_cost!==0)throw Error('recovery');
   if(spec.rules.roundEffects?.version===4){const carry=(await client.query('SELECT effects FROM tactical_effect_carryovers WHERE instance_id=$1',[m.personal_instance])).rows[0];const injury=await loadInjuryGrant(client,s.release_id,s.definition_id,spec);if(!carry||!equal(carry.effects,deriveCarryEffects(personalSpec,personal,recovery.turn_cost,injury)))throw Error('carry');}
   if(await failureCostMismatch(client,m.personal_instance,personalSpec,failed))throw Error('costs');
   const companionInjury=await loadInjuryGrant(client,s.release_id,s.definition_id,spec);const companions=(await client.query('SELECT companion_id,health,mana,terminal_state,rescued,effects FROM companion_tactical_recoveries WHERE instance_id=$1 ORDER BY companion_id',[m.personal_instance])).rows,expectedCompanions=personalSpec.allies.filter(a=>a.owned).map(a=>{const r=companionRecovery(personalSpec,personal,a.id,recovery.turn_cost,companionInjury);return {companion_id:a.definitionId,health:r.health,mana:r.mana,terminal_state:r.terminalState,rescued:r.rescued,effects:r.effects};}).sort((a,b)=>a.companion_id<b.companion_id?-1:1);if(!equal(companions,expectedCompanions))throw Error('companions');
  }
 }catch{mismatches++;}
 }}finally{await client.query('CLOSE shared_session_audit');}
 return mismatches;
}
