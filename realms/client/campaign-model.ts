import type { Failure,Snapshot,Tactical } from './types.js';
export const campaignLabel=(value:string)=>value==='hero'?'You':value.split(/[._-]/).filter(Boolean).map(w=>w[0]!.toUpperCase()+w.slice(1).toLowerCase()).join(' ');
const label=campaignLabel;
export function zoneDistance(edges:[string,string][],from:string,to:string){if(from===to)return 0;const queue:[string,number][]=[[from,0]],seen=new Set([from]);for(const [zone,distance] of queue)for(const [a,b] of edges){const next=a===zone?b:b===zone?a:null;if(next&&!seen.has(next)){if(next===to)return distance+1;seen.add(next);queue.push([next,distance+1]);}}return Infinity;}

export function failureSummary(f:Failure){return `Defeat: ${label(f.destination)}, up to ${f.turnCost} recovery Turns; ${f.recoveryHealth} health.`+(f.goldLossBps!==undefined?` Eligible Gold loss: ${f.goldLossBps/100}%, capped at ${f.goldLossCap??0}. Active equipment wear: ${(f.durabilityWearBps??0)/100}%.`:'')+(f.injuryEffectId?` Injury: ${label(f.injuryEffectId)}.`:'')+(f.allowSurrender?' Surrender applies the same failure costs.':'');}

/** Existing entry gates, projected into explicit text; server still validates entry. */
export function adventureAvailability(s:Snapshot,cost:number,disabled:boolean){
 const carrying=['OVERLOADED','UNMEASURED'].includes(s.game.carry?.state??'');
 const intoxicated=s.game.overdrunk===true&&cost>0;
 const unavailable=intoxicated||carrying||disabled||s.game.run.turns<cost||s.progression.build.mode!=='CONFIGURED';
 return {unavailable,label:!unavailable?'Available':!s.game.canWrite?'View only':carrying?'Carrying restriction':s.progression.build.mode!=='CONFIGURED'?'Starting build required':intoxicated?'Overdrunk':s.game.run.turns<cost?'Insufficient Turns':'Temporarily unavailable',reason:!unavailable?'Ready to enter.':!s.game.canWrite?'This session is view only.':carrying?'Manage your carrying load in Pack before entering.':s.progression.build.mode!=='CONFIGURED'?'Choose your starting build first.':intoxicated?'Wait for Drunkenness to clear before starting a Turn-consuming adventure. Free management remains available.':s.game.run.turns<cost?'You need more Turns.':'Wait for the current action or refresh to reconnect.'};
}
export function combatTurn(b:Tactical,readOnly:boolean){
 const actor=b.units.find(u=>u.id===b.currentActor),waiting=!!b.shared&&actor?.side==='PARTY'&&!b.shared.controlledIds.includes(actor.id)&&b.partyCapabilities.find(c=>c.id===actor.id)?.control!=='SERVER',server=actor?.side==='ENEMY'||b.partyCapabilities.find(c=>c.id===b.currentActor)?.control==='SERVER';
 return {actor,server,waiting,label:b.outcome?label(b.outcome):!actor?'Saved encounter':waiting?'Waiting for your party':server?'World turn':b.currentActor==='hero'?'Your turn':'Party turn',description:b.outcome?'The outcome is saved.':readOnly?'View-only session · actions are unavailable.':waiting?'Another player controls this actor. Refresh to see their next saved move.':server?'Continue the saved segment when ready. Nothing advances while disconnected.':actor?actor.id==='hero'?'Choose your next action.':'Choose an action for '+label(actor.id)+'.':'Refresh to load the saved actor.'};
}

export const canOpenJourneyRecord=(s:Snapshot,id:string)=>s.battle?.instanceId===id;

/** Cosmetic explanations use only the discovery-filtered public battle view. */
export const combatZoneName=(b:Tactical,id:string)=>b.battlefield.details?.find(z=>z.id===id)?.name??label(id);
export function combatOptionText(b:Tactical,o:NonNullable<Tactical['actionOptions']>[number]){
 const actor=b.units.find(u=>u.id===o.command.actorId),costs=[o.action==='FREE'?'No action cost':label(o.action)+' action'];
 if(o.mana)costs.push(o.mana+' Mana');
 for(const [key,value]of Object.entries(o.resourceCost??{}))costs.push(`${value} ${label(key)}`);
 if(o.range!==null)costs.push(o.range===0?'Same zone':`Range ${o.range} zone${o.range===1?'':'s'}`);
 if(o.area==='ZONE')costs.push('All eligible targets in the chosen zone');
 if((o.cooldownUntil??0)>b.round)costs.push('Ready in round '+o.cooldownUntil);
 let reason=o.reason?combatReasons[o.reason]??'Requires an eligible target, the shown action and sufficient resources.':null;
 if(!o.available&&actor){
  if(actor.mana<o.mana)reason=`Needs ${o.mana} Mana; ${actor.mana} available.`;
  const lacking=Object.entries(o.resourceCost??{}).filter(([k,n])=>(actor.resources?.[k]??0)<n);
  if(lacking.length)reason=lacking.map(([k,n])=>`${label(k)}: needs ${n}, ${actor.resources?.[k]??0} available.`).join(' ');
  if((o.cooldownUntil??0)>b.round)reason='Recharging until round '+o.cooldownUntil+'.';
 }
 return {costs:costs.join(' · '),reason};
}
const combatReasons:Record<string,string>={TACTICAL_MAIN_SPENT:'Your Main action is spent.',TACTICAL_ACTOR_STUNNED:'Stunned: end your turn to advance recovery.',TACTICAL_ACTOR_ROOTED:'Rooted: movement is unavailable.',TACTICAL_ACTOR_DISARMED:'Disarmed: weapon attacks are unavailable.',TACTICAL_ACTOR_DAZED:'Dazed: you have already used your action.',TACTICAL_REACTION_SUPPRESSED:'Your reactions are suppressed.',TACTICAL_TECHNIQUE_SUPPRESSED:'Silenced or disarmed: this technique is suppressed.',ILLEGAL_TACTICAL_GUARD:'Guard requires its capability and an available Quick action.',ILLEGAL_TACTICAL_MOVE:'Movement requires a Quick action and an adjacent zone.',ILLEGAL_TACTICAL_ATTACK:'The target is out of range or cannot be attacked.',ILLEGAL_TACTICAL_HEAL:'Healing requires an eligible ally in range, a Main action and enough Mana.',ILLEGAL_TACTICAL_TECHNIQUE:'Requires its action, resources, cooldown and an eligible target.',ILLEGAL_TACTICAL_TECHNIQUE_TARGET:'Choose an eligible target within this technique’s range.',ILLEGAL_TACTICAL_INTERACTION:'This interaction is used up, out of range, or needs its action.',FORMATION_LOCKED:'Formation is locked after the opening choice.'};

export function combatActionName(o:NonNullable<Tactical['actionOptions']>[number]){
 const c=o.command;if(c.kind==='SWAP_SET')return 'Switch to weapon set '+c.set;
 if(c.kind==='ATTACK'||c.kind==='HEAL')return (c.kind==='ATTACK'?'Attack ':'Heal ')+label(c.targetId!);
 if(c.abilityId&&c.targetId)return label(c.abilityId)+' → '+label(c.targetId);
 return o.label;
}
