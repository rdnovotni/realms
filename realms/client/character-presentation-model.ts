import type { Advancement,Snapshot,AbilityEntry } from './types.js';
/** Never reuse a specialization name from another run or an old state revision. */
export function knownSpecializations(snapshot:Snapshot,view:Advancement|null){
 if(!view||view.runId!==snapshot.game.run.runId||view.revision!==snapshot.game.run.revision)return null;
 const owned=new Set(snapshot.progression.build.classes?.map(c=>c.classId));
 return view.subclasses.selected.filter(c=>owned.has(c.classId)).map(c=>({classId:c.classId,name:c.name}));
}
export function abilityCostText(costs:AbilityEntry['costs']){
 return costs===null?'Cost unavailable':costs.length?costs.map(c=>`${c.amount} ${c.name}`).join(' · '):'No authored resource cost';
}
