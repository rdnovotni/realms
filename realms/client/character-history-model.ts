import type { Advancement,Snapshot } from './types.js';
export const historyCategories:Record<string,string>={START_BUILD:'Starting build',LEVEL_UP:'Class advancement',SUBCLASS:'Subclass selection',FEAT:'Feat selection',ATTRIBUTE:'Attribute allocation',PROFICIENCY:'Proficiency advancement'};
/** Count decisions, not alternative catalog entries. Earned milestones are not future rewards. */
export function pendingCharacterChoices(snapshot:Snapshot,view:Advancement|null){
 const levels=snapshot.progression.readiness?.pendingLevels??0;
 if(!view||view.runId!==snapshot.game.run.runId||view.revision!==snapshot.game.run.revision)return levels?`${levels} pending level${levels===1?'':'s'}`:undefined;
 const earned=new Set([...view.attributes.rules.flatMap(r=>r.availableMilestones.map(m=>'ATTRIBUTE:'+m.level)),...view.feats.options.flatMap(f=>f.availableMilestones.map(m=>'FEAT:'+m)),...view.proficiencies.options.flatMap(p=>p.availableMilestones.map(m=>'PROFICIENCY:'+m))]);
 const subclasses=new Set(view.subclasses.options.filter(s=>['AVAILABLE','ACTIVE_INSTANCE'].includes(s.eligibility)).map(s=>s.classId));
 const count=levels+earned.size+subclasses.size;return count?`${count} known pending`:undefined;
}
export function historyTime(value:string|null){if(value===null)return null;const time=new Date(value);return Number.isNaN(time.getTime())?null:{iso:time.toISOString(),label:time.toLocaleString()+' (local time)'};}
