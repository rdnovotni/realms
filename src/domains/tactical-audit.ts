import { loadEffectGrants } from './tactical-effects.js';
import { loadDamageProfile,deriveDamageProfile } from './tactical-damage.js';
import type pg from 'pg';
import { checksum,type Json } from '../foundation/json.js';
import { randomInteger } from '../foundation/rng.js';
import { readCharacterSnapshot } from './character-snapshots.js';
import { validateTacticalSpec,validateTacticalTemplate,type TacticalSpec,type TacticalTemplate,type TacticalKit } from './tactical-content.js';
import { startTactical,stepTactical,type TacticalUnit,type TacticalIntent } from './tactical-engine.js';
import type { TacticalCheckpoint } from './tactical-encounters.js';
import { enemyCommand } from './tactical-combat.js';
const equal=(a:unknown,b:unknown)=>checksum(a as Json)===checksum(b as Json);
/** Independent reconciliation from immutable origin, source pins, seed and intents.
 * Streaming origins bounds memory; individual fights are bounded by authored rounds.
 */
export async function tacticalMismatchCount(client:pg.PoolClient) {
 let mismatches=0;
 await client.query(`DECLARE tactical_audit NO SCROLL CURSOR FOR SELECT o.*,e.checkpoint,e.outcome,e.settlement,e.release_id,e.created_at,i.seed,i.rng_version,v.definition->'mechanics'->'tacticalCombat' AS authored FROM tactical_encounter_origins o JOIN encounter_records e ON e.instance_id=o.instance_id JOIN instances i ON i.id=o.instance_id JOIN content_versions v ON v.entity_id=e.definition_id AND v.revision=e.definition_revision`);
 try{for(;;){const rows=(await client.query('FETCH FORWARD 32 FROM tactical_audit')).rows;if(!rows.length)break;
  for(const row of rows)try{
   validateTacticalSpec(row.spec);const spec=row.spec as TacticalSpec,origin=row.initial_checkpoint as TacticalCheckpoint;
   if(!equal(spec,row.authored)||!equal(origin.rules,spec.rules))throw Error('rules');
   const snapshot=await readCharacterSnapshot(client,row.instance_id as string,row.run_id as string),stats=snapshot.derived.stats;
   let canHeal=false,canGuard=false;
   for(const source of snapshot.inputs.sources){const kit=(await client.query("SELECT definition->'mechanics'->'tacticalKit' AS kit FROM content_versions WHERE entity_id=$1 AND revision=$2",[source.entityId,source.revision])).rows[0]?.kit as TacticalKit|undefined;
    if(kit&&source.nativeLevel>=kit.minimumNativeLevel){canHeal ||=kit.heal;canGuard ||=kit.guard;}}
   const prior=row.previous_instance_id?(await client.query('SELECT health,mana FROM tactical_recoveries WHERE instance_id=$1',[row.previous_instance_id])).rows[0]:null;
   if(row.previous_instance_id&&!prior)throw Error('unsettled predecessor');
   const units:TacticalUnit[]=[{id:'hero',side:'PARTY',zone:spec.playerZone,stats,health:Math.min(prior?.health??stats.maxHealth,stats.maxHealth),mana:Math.min(prior?.mana??stats.maxMana,stats.maxMana),canHeal,canGuard,strikes:0,state:'ACTIVE',...(spec.rules.roundEffects?{onHitEffects:await loadEffectGrants(client,row.release_id as string,snapshot.inputs.sources)}:{}),...(spec.rules.typedDamage?{damageProfile:await loadDamageProfile(client,spec.rules.typedDamage,snapshot.inputs.sources)}:{})}];
   for(const u of [...spec.allies.map(u=>({...u,side:'PARTY' as const})),...spec.enemies.map(u=>({...u,side:'ENEMY' as const}))]){
    const templateRow=(await client.query(`SELECT e.revision,v.definition->'mechanics'->'tacticalUnit' AS spec FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=$1 AND e.entity_id=$2`,[row.release_id,u.definitionId])).rows[0];const template=templateRow?.spec;
    validateTacticalTemplate(template);const t=template as TacticalTemplate;
    units.push({id:u.id,side:u.side,zone:u.zone,stats:t.stats,health:t.stats.maxHealth,canHeal:t.canHeal,canGuard:t.canGuard,strikes:0,state:'ACTIVE',...(spec.rules.roundEffects?{onHitEffects:await loadEffectGrants(client,row.release_id as string,[{entityId:u.definitionId,revision:templateRow!.revision as number,nativeLevel:0}])}:{}),...(spec.rules.typedDamage?{damageProfile:deriveDamageProfile(spec.rules.typedDamage,t.damageTraits?[{traits:t.damageTraits,nativeLevel:0}]:[])}:{})});
   }
   let state=startTactical(spec.rules,units);
   const controlled=['hero',...spec.allies.map(u=>u.id)];if(!equal(origin.controlledIds,controlled)||!equal(origin.state,state))throw Error('origin');
   const draws=(await client.query("SELECT * FROM encounter_draws WHERE instance_id=$1 AND stream='tactical' ORDER BY counter",[row.instance_id])).rows;
   if(row.rng_version!=='hmac-sha256-v1')throw Error('rng version');
   if(draws.some((d,i)=>BigInt(d.counter)!==BigInt(i)))throw Error('draw sequence');
   const drawByKey=new Map(draws.map(d=>[d.draw_key as string,d]));
   const used=new Set<string>();
   const draw=(key:string,bound:number,action:string)=>{
    const d=drawByKey.get(key);
    if(!d||Number(d.bound)!==bound||d.action_id!==action||Number(d.value)!==randomInteger(row.seed,'tactical',BigInt(d.counter),bound))throw Error('draw');
    used.add(key);return Number(d.value);
   };
   await client.query('DECLARE tactical_step_audit NO SCROLL CURSOR FOR SELECT * FROM tactical_steps WHERE instance_id=$1 ORDER BY revision',[row.instance_id]);
   try{for(;;){const steps=(await client.query('FETCH FORWARD 32 FROM tactical_step_audit')).rows;if(!steps.length)break;for(const step of steps){
    const intent=step.intent as TacticalIntent,actor=state.units.find(u=>u.id===intent.actorId)!;
    if(!actor||(step.control==='PLAYER'?!controlled.includes(actor.id):actor.side!=='ENEMY'))throw Error('control');
    if(step.control==='SERVER'){
     const expected=enemyCommand({...origin,state});
     const command={...intent} as Record<string,unknown>;delete command.roll;delete command.rawDamage;
     if(!equal(command,expected))throw Error('AI intent');
    }
    const prefix=`action.${state.revision}`;
    if(intent.kind==='ATTACK'&&(intent.roll!==1+draw(`${prefix}.hit`,20,step.action_id)||intent.rawDamage!==actor.stats.attackMin+draw(`${prefix}.damage`,actor.stats.attackMax-actor.stats.attackMin+1,step.action_id)))throw Error('attack rolls');
    if(intent.kind==='RETREAT'&&intent.roll!==1+draw(`${prefix}.retreat`,20,step.action_id))throw Error('retreat roll');
    const result=stepTactical(spec.rules,state,state.revision,intent);
    if(step.revision!==result.state.revision||!equal(result.evidence,step.evidence)||!equal(result.state,step.state))throw Error('transition');state=result.state;
   }}}finally{await client.query('CLOSE tactical_step_audit');}
   if(used.size!==draws.length||!equal({...origin,state},row.checkpoint)||state.outcome!==row.outcome)throw Error('projection');
   if(state.outcome!==null){
    const recovery=(await client.query(`SELECT recovery.*,ledger.delta,ledger.reason FROM tactical_recoveries recovery LEFT JOIN action_receipts receipt ON receipt.action_id=recovery.action_id LEFT JOIN turn_ledger ledger ON ledger.run_id=$2 AND ledger.request_id=receipt.request_id AND ledger.reason='TACTICAL_RECOVERY' WHERE recovery.instance_id=$1`,[row.instance_id,row.run_id])).rows[0];
    const hero=state.units[0]!,failure=['DEFEAT','FAILED_FORWARD'].includes(state.outcome);
    if(!recovery||recovery.health!==(hero.health>0?hero.health:Math.min(hero.stats.maxHealth,spec.failure.recoveryHealth))||recovery.mana!==hero.mana||recovery.destination!==(failure?'HOME':'FIELD')||recovery.turn_cost>spec.failure.turnCost||(!failure&&recovery.turn_cost!==0)||(failure&&(recovery.reason!=='TACTICAL_RECOVERY'||recovery.delta!==-recovery.turn_cost)))throw Error('recovery');
    const expected={destination:recovery.destination,health:recovery.health,mana:recovery.mana,turnCost:recovery.turn_cost};
    if(!equal(state.outcome==='VICTORY'?row.settlement.additional:row.settlement,state.outcome==='VICTORY'&&spec.campaignId?{...expected,campaignCompleted:true}:expected))throw Error('settlement');
   }
  }catch{mismatches++;}
 }}finally{await client.query('CLOSE tactical_audit');}
 // Check the current persistent pool against its last encounter or recovery.
 mismatches+=(await client.query(`SELECT count(*)::int AS n FROM tactical_run_state s JOIN tactical_encounter_origins o ON o.instance_id=s.last_instance_id JOIN encounter_records e ON e.instance_id=o.instance_id LEFT JOIN tactical_recoveries r ON r.instance_id=o.instance_id WHERE s.health IS DISTINCT FROM coalesce(r.health,(o.initial_checkpoint->'state'->'units'->0->>'health')::integer) OR s.mana IS DISTINCT FROM coalesce(r.mana,(o.initial_checkpoint->'state'->'units'->0->>'mana')::integer)`)).rows[0].n;
 return mismatches;
}
