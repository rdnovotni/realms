import type pg from 'pg';
import { executeAction,advanceRevision,type ActionContext,type Envelope } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';
import { beginAuthoredEncounter,settleAuthoredVictory } from './loot.js';
import { drawEncounter,saveEncounterCheckpoint,finishEncounter } from './encounters.js';
import { postTransfers } from './ledger.js';
import { validateCombatSpec,validateFighter,validateCampaign,type CombatSpec,type Profile,type Fighter,type Chance,type Campaign } from './combat-content.js';
async function content(c:ActionContext,id:string,kind:string,field:string){
  const row=(await c.client.query(`SELECT e.revision,v.definition->'mechanics'->$4 AS spec FROM release_entries e
    JOIN content_entities identity ON identity.id=e.entity_id AND identity.kind=$3
    JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=$1 AND e.entity_id=$2`,[c.run.content_release_id,id,kind,field])).rows[0];
  if(!row) throw new DomainError(409,'COMBAT_CONTENT_MISSING');return row;
}
async function specFor(c:ActionContext,id:string){const row=await content(c,id,'ENCOUNTER','combat');validateCombatSpec(row.spec);return row.spec as CombatSpec;}
async function campaignFor(c:ActionContext,id:string){const row=await content(c,id,'TUNING','campaign');validateCampaign(row.spec);return {revision:row.revision as number,spec:row.spec as Campaign};}
async function checkPrerequisites(c:ActionContext,definitionId:string,spec:CombatSpec){
  if(!spec.campaignId)return;
  const campaign=await campaignFor(c,spec.campaignId);
  if(campaign.spec.finalEncounterId!==definitionId) throw new DomainError(409,'CAMPAIGN_FINAL_MISMATCH');
  if(c.run.status!=='ACTIVE') throw new DomainError(409,'CAMPAIGN_ALREADY_COMPLETE');
  const won=(await c.client.query(`SELECT DISTINCT e.definition_id FROM combat_states combat JOIN encounter_records e ON e.instance_id=combat.instance_id
    WHERE combat.run_id=$1 AND combat.outcome='VICTORY' AND e.release_id=$2`,[c.run.id,c.run.content_release_id])).rows.map(r=>r.definition_id);
  if(campaign.spec.requiresEncounterIds.some(id=>!won.includes(id))) throw new DomainError(409,'CAMPAIGN_PREREQUISITES_MISSING');
}
export function startCombat(pool:pg.Pool,accountId:string,envelope:Envelope,definitionId:string){
  return executeAction(pool,accountId,envelope,{definitionId},async c=>{
    if(!(await c.client.query('SELECT 1 FROM discoveries WHERE account_id=$1 AND entity_id=$2',[c.accountId,definitionId])).rows.length) throw new DomainError(404,'COMBAT_NOT_DISCOVERED');
    const spec=await specFor(c,definitionId);await checkPrerequisites(c,definitionId,spec);
    const profile=await content(c,spec.profileId,'TUNING','combatProfile'),monster=await content(c,spec.monsterId,'MONSTER','combatMonster');
    validateFighter(profile.spec,true);validateFighter(monster.spec);
    await c.client.query(`INSERT INTO combat_run_state(run_id,release_id,profile_id,profile_revision,health,max_health,location)
      VALUES($1,$2,$3,$4,$5,$5,'HOME') ON CONFLICT(run_id) DO NOTHING`,[c.run.id,c.run.content_release_id,spec.profileId,profile.revision,profile.spec.maxHealth]);
    const actor=(await c.client.query('SELECT * FROM combat_run_state WHERE run_id=$1 FOR UPDATE',[c.run.id])).rows[0];
    if(actor.profile_id!==spec.profileId) throw new DomainError(409,'COMBAT_PROFILE_MISMATCH');
    const started=await beginAuthoredEncounter(c,definitionId,{});
    await c.client.query(`INSERT INTO combat_states(instance_id,run_id,release_id,profile_id,profile_revision,monster_id,monster_revision,player_health,player_max_health,enemy_health,enemy_max_health)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,[started.instanceId,c.run.id,c.run.content_release_id,spec.profileId,profile.revision,spec.monsterId,monster.revision,actor.health,actor.max_health,monster.spec.maxHealth]);
    await c.client.query("UPDATE combat_run_state SET location='FIELD',last_instance_id=$2 WHERE run_id=$1",[c.run.id,started.instanceId]);
    if(c.run.status==='ACTIVE') await c.client.query("UPDATE runs SET completion_policy='CAMPAIGN' WHERE id=$1",[c.run.id]);
    if(spec.gold){
      const source=(await c.client.query(`SELECT w.id FROM wallets w JOIN state_scopes s ON s.id=w.scope_id JOIN worlds world ON world.id=s.world_id
        WHERE world.name=$1 AND s.lifecycle='ACTIVE' AND w.currency_id='GOLD' AND w.purpose='FAUCET_SINK'`,[spec.gold.worldName])).rows[0];
      if(!source)throw new DomainError(409,'COMBAT_GOLD_SOURCE_MISSING');
      const target=(await c.client.query(`INSERT INTO wallets(scope_id,currency_id,purpose) SELECT id,'GOLD','PLAYER' FROM state_scopes WHERE run_id=$1
        ON CONFLICT(scope_id,currency_id,purpose) DO UPDATE SET balance=wallets.balance RETURNING id`,[c.run.id])).rows[0];
      await c.client.query('INSERT INTO combat_gold_plans(instance_id,amount,from_wallet_id,to_wallet_id) VALUES($1,$2,$3,$4)',[started.instanceId,spec.gold.amount,source.id,target.id]);
    }
    return {...started,failureContract:spec.failure,roundLimit:spec.roundLimit,round:0,playerHealth:actor.health as number,enemyHealth:monster.spec.maxHealth,revision:await advanceRevision(c)};
  });
}
export type CombatIntent='ATTACK'|'GUARD'|'RETREAT';
async function hit(c:ActionContext,id:string,key:string,chance:Chance){return await drawEncounter(c,id,'combat',key,chance.denominator)<chance.numerator;}
async function damage(c:ActionContext,id:string,key:string,attacker:Fighter,target:Fighter,guard=false){
  if(!await hit(c,id,`${key}.hit`,attacker.attack.hit))return 0;
  const raw=attacker.attack.min+await drawEncounter(c,id,'combat',`${key}.damage`,attacker.attack.max-attacker.attack.min+1);
  const mitigated=Math.max(1,Math.floor(Math.max(1,raw-target.armor)*(10000-target.resistanceBps)/10000));
  return guard?Math.max(1,Math.floor(mitigated/2)):mitigated;
}
async function completeCampaign(c:ActionContext,id:string,definitionId:string,spec:CombatSpec){
  if(!spec.campaignId)return;
  await checkPrerequisites(c,definitionId,spec);const campaign=await campaignFor(c,spec.campaignId);
  await c.client.query(`INSERT INTO run_completions(run_id,release_id,campaign_id,definition_revision,final_instance_id,action_id) VALUES($1,$2,$3,$4,$5,$6)`,[c.run.id,c.run.content_release_id,spec.campaignId,campaign.revision,id,c.actionId]);
  await c.client.query("UPDATE runs SET status='AFTERCORE',completed_at=now() WHERE id=$1",[c.run.id]);
}
export function takeCombatAction(pool:pg.Pool,accountId:string,envelope:Envelope,instanceId:string,expectedRound:number,intent:CombatIntent){
  if(!['ATTACK','GUARD','RETREAT'].includes(intent) || !Number.isInteger(expectedRound) || expectedRound<0) throw new DomainError(400,'INVALID_COMBAT_INTENT');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(instanceId))throw new DomainError(400,'INVALID_COMBAT_ID');
  const id=instanceId.toLowerCase();
  return executeAction(pool,accountId,envelope,{instanceId:id,expectedRound,intent},async c=>{
    const state=(await c.client.query(`SELECT combat.*,e.definition_id FROM combat_states combat JOIN encounter_records e ON e.instance_id=combat.instance_id
      WHERE combat.instance_id=$1 AND combat.run_id=$2 FOR UPDATE OF combat`,[id,c.run.id])).rows[0];
    if(!state)throw new DomainError(404,'COMBAT_NOT_FOUND');if(state.outcome!==null)throw new DomainError(409,'COMBAT_RESOLVED');
    if(state.round!==expectedRound)throw new DomainError(409,'STALE_COMBAT_ROUND');
    const spec=await specFor(c,state.definition_id),profileRow=await content(c,state.profile_id,'TUNING','combatProfile'),monsterRow=await content(c,state.monster_id,'MONSTER','combatMonster');
    validateFighter(profileRow.spec,true);validateFighter(monsterRow.spec);const profile:Profile=profileRow.spec,monster:Fighter=monsterRow.spec;
    const round=state.round+1;let player=state.player_health as number,enemy=state.enemy_health as number;
    let outcome:'VICTORY'|'DEFEAT'|'RETREAT'|'FAILED_FORWARD'|null=null;
    if(intent==='RETREAT'){
      if(spec.retreat.numerator===0)throw new DomainError(409,'RETREAT_UNAVAILABLE');
      if(await hit(c,id,`round.${round}.retreat`,spec.retreat))outcome='RETREAT';
    }else if(intent==='ATTACK')enemy=Math.max(0,enemy-await damage(c,id,`round.${round}.player`,profile,monster));
    if(enemy===0)outcome='VICTORY';
    if(outcome===null){player=Math.max(0,player-await damage(c,id,`round.${round}.enemy`,monster,profile,intent==='GUARD'));if(player===0)outcome='DEFEAT';}
    if(outcome===null && round>=spec.roundLimit)outcome='FAILED_FORWARD';
    await saveEncounterCheckpoint(c,id,state.revision,{round});
    const revision=state.revision+(outcome===null?1:2);
    await c.client.query('INSERT INTO combat_steps(instance_id,round,action_id,intent,revision,player_health,enemy_health,outcome) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,round,c.actionId,intent,revision,player,enemy,outcome]);
    await c.client.query('UPDATE combat_states SET player_health=$2,enemy_health=$3,round=$4,revision=$5,outcome=$6 WHERE instance_id=$1',[id,player,enemy,round,revision,outcome]);
    let location='FIELD',health=player,extraCost=0;
    if(outcome==='VICTORY'){
      await settleAuthoredVictory(c,id,state.revision+1,async c=>{
        const gold=(await c.client.query('SELECT * FROM combat_gold_plans WHERE instance_id=$1',[id])).rows[0];
        if(gold){const [transfer]=await postTransfers(c,[{key:'combat.gold',currencyId:'GOLD',from:gold.from_wallet_id,to:gold.to_wallet_id,amount:gold.amount,reason:'COMBAT_REWARD'}]);await c.client.query('INSERT INTO combat_gold_claims(instance_id,transfer_id) VALUES($1,$2)',[id,transfer!.transferId]);}
        await completeCampaign(c,id,state.definition_id,spec);return {gold:gold?.amount??'0',campaignCompleted:Boolean(spec.campaignId)};
      });
    }else if(outcome!==null){
      if(outcome==='DEFEAT' || outcome==='FAILED_FORWARD'){
        health=profile.recoveryHealth;location='HOME';extraCost=Math.min(c.run.turns,spec.failure.turnCost);
        await finishEncounter(c,id,state.revision+1,outcome,async c=>{
          await c.client.query('INSERT INTO combat_recoveries(instance_id,action_id,restored_health,turn_cost) VALUES($1,$2,$3,$4)',[id,c.actionId,health,extraCost]);
          await c.client.query('UPDATE runs SET turns=turns-$2 WHERE id=$1',[c.run.id,extraCost]);
          await c.client.query("INSERT INTO turn_ledger(run_id,request_id,delta,reason) VALUES($1,$2,$3,'COMBAT_RECOVERY')",[c.run.id,c.requestId,-extraCost]);
          return {destination:'HOME',health,turnCost:extraCost};
        });
      }else await finishEncounter(c,id,state.revision+1,outcome,async()=>({}));
    }
    await c.client.query('UPDATE combat_run_state SET health=$2,location=$3 WHERE run_id=$1',[c.run.id,health,location]);
    return {instanceId:id,round,playerHealth:player,enemyHealth:enemy,outcome,health,location,recoveryTurnCost:extraCost,revision:await advanceRevision(c)};
  });
}
export async function combatView(pool:pg.Pool,accountId:string,id:string){
  const row=(await pool.query(`SELECT combat.instance_id AS "instanceId",combat.round,combat.player_health AS "playerHealth",combat.player_max_health AS "playerMaxHealth",combat.enemy_health AS "enemyHealth",combat.enemy_max_health AS "enemyMaxHealth",combat.outcome,recovery.restored_health AS "recoveryHealth",recovery.turn_cost AS "recoveryTurnCost",CASE WHEN recovery.instance_id IS NULL THEN 'FIELD' ELSE 'HOME' END AS location,
    v.definition->>'name' AS "enemyName",rules.definition->'mechanics'->'combat'->'failure' AS "failureContract",rules.definition->'mechanics'->'combat'->'roundLimit' AS "roundLimit"
    FROM combat_states combat LEFT JOIN combat_recoveries recovery ON recovery.instance_id=combat.instance_id JOIN runs r ON r.id=combat.run_id JOIN characters character ON character.id=r.character_id
    JOIN content_versions v ON v.entity_id=combat.monster_id AND v.revision=combat.monster_revision
    JOIN encounter_records e ON e.instance_id=combat.instance_id JOIN content_versions rules ON rules.entity_id=e.definition_id AND rules.revision=e.definition_revision
    WHERE combat.instance_id=$1 AND character.account_id=$2`,[id,accountId])).rows[0];
  if(!row)throw new DomainError(404,'COMBAT_NOT_FOUND');return row;
}
