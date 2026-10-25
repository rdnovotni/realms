import { DomainError } from '../foundation/errors.js';
import { validateStats } from './character-mechanics.js';
import type { TacticalState,TacticalUnit,TacticalRules } from './tactical-engine.js';
import type { TechniqueProfile } from './tactical-techniques.js';
export const loadoutFields=['stats','canHeal','canGuard','damageProfile','onHitEffects','onHealEffects','techniques','healingAbilities','attackAbilities','statusProfile','cleansingAbilities','carryResources'] as const;
export type CombatLoadout=Pick<TacticalUnit,typeof loadoutFields[number]>;
export type PreparedState={activeSet:'A'|'B';sets:Record<'A'|'B',CombatLoadout>;quickslots:{slot:number;itemId:string}[];resourceMaximums:Record<string,number>;resourceClocks:NonNullable<TechniqueProfile['clocks']>};
export function validatePrepared(r:TacticalRules,u:TacticalUnit){const p=u.prepared;if(!p)return;if(!r.preparation||!['A','B'].includes(p.activeSet)||Object.keys(p.sets).sort().join()!=='A,B'||p.quickslots.length>4||new Set(p.quickslots.map(x=>x.slot)).size!==p.quickslots.length||p.quickslots.some(x=>!Number.isInteger(x.slot)||x.slot<1||x.slot>4||!/^[-a-f0-9]{36}$/.test(x.itemId)))throw new DomainError(409,'INVALID_COMBAT_PREPARATION');for(const s of ['A','B']as const)validateStats(p.sets[s].stats);}
export function swapPrepared(s:TacticalState,actor:TacticalUnit,set:'A'|'B'){
 const p=actor.prepared;if(!p||!['A','B'].includes(set)||p.activeSet===set||s.budgets[actor.id]!.quick!==1)throw new DomainError(409,'ILLEGAL_PREPARED_SWAP');
 const next=p.sets[set];for(const key of loadoutFields)delete (actor as unknown as Record<string,unknown>)[key];Object.assign(actor,structuredClone(next));
 actor.health=Math.min(actor.health,actor.stats.maxHealth);actor.mana=Math.min(actor.mana??0,actor.stats.maxMana);actor.guardReady=false;p.activeSet=set;s.budgets[actor.id]!.quick=0;
 return {actorId:actor.id,set,source:'prepared-gear',health:actor.health,mana:actor.mana};
}
