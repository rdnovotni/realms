import type pg from 'pg';
import { tacticalFixture,tacticalPackage,envelope } from './tactical-fixture.js';
import { startTacticalCombat,takeTacticalAction } from '../src/domains/tactical-combat.js';
import type { TacticalSpec } from '../src/domains/tactical-content.js';
import assert from 'node:assert/strict';
const json=(value:unknown)=>value as any;
export function campaignPackage(required=true){
 const p=tacticalPackage();p.version='tactical-campaign-fixture';
 const first=p.entities.find(e=>e.id==='encounter.tactical')!;
 (first.definition.mechanics!.tacticalCombat as unknown as TacticalSpec).allies=[];
 (p.entities.find(e=>e.id==='monster.tactical')!.definition.mechanics!.tacticalUnit as any).stats.maxHealth=6;
 const final=structuredClone(first);final.id='encounter.finale';final.definition.name='Finale';
 (final.definition.mechanics!.tacticalCombat as unknown as TacticalSpec).campaignId='campaign.tactical';final.definition.dependencies.push('campaign.tactical');
 p.entities.push(final,{id:'campaign.tactical',kind:'TUNING',revision:1,schemaVersion:1,definition:{name:'Campaign',dependencies:required?['encounter.tactical']:[],public:{},mechanics:{tacticalCampaign:{version:1,ruleset:'TACTICAL_CAMPAIGN_V1',finalEncounterId:'encounter.finale',requiresEncounterIds:required?['encounter.tactical']:[]}}}});
 return p;
}
export async function fixture(pool:pg.Pool,p=campaignPackage()){
 const f=await tacticalFixture(pool,p);
 await pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,'encounter.finale','DISCOVERED')",[f.account]);return f;
}
export async function win(pool:pg.Pool,account:string,revision:number,definitionId='encounter.tactical'){
 const started=json(await startTacticalCombat(pool,account,envelope(revision,'START_TACTICAL'),definitionId));
 const request=envelope(started.revision),intent={actorId:'hero',kind:'ATTACK' as const,targetId:'enemy'};
 const result=json(await takeTacticalAction(pool,account,request,started.instanceId,started.encounterRevision,started.tacticalRevision,intent));assert.equal(result.outcome,'VICTORY');
 return {started,request,intent,result};
}
