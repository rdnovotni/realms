import type { Advancement,AdvancementChoice,FeatCatalog,FeatFilter,FeatOption,AttributeRule,AttributeMilestone,AttributeName,ProficiencyOption } from './types.js';
const reasons:Record<string,string>={AVAILABLE:'Available now',ELIGIBLE:'Prerequisites met',ACTIVE_INSTANCE:'Earned, but blocked by an active instance',LEVEL_NOT_READY:'Next character level has not been earned',NATIVE_LEVEL_REQUIRED:'Required native class level has not been reached',ALREADY_CHOSEN:'Already selected',PREREQUISITES_NOT_MET:'Prerequisites not met',PROFICIENCY_NOT_MET:'Proficiency requirements not met',CLASS_LIMIT:'Maximum number of native classes reached',NATIVE_CLASS_LEVEL_LIMIT:'Maximum native class level reached',BUILD_NOT_CONFIGURED:'Choose a starting build first',BUILD_CURVE_MISMATCH:'Build and encounter XP rules differ',BUILD_RULES_MISMATCH:'Build rules do not match the current release'};
export function advancementReason(code:string){return Object.hasOwn(reasons,code)?reasons[code]!:'Availability could not be verified';}
export function subclassStatus(option:{subclassId:string;eligibility:string},selectedId?:string){return option.eligibility==='ALREADY_CHOSEN'&&option.subclassId!==selectedId?'This class already has a committed subclass':advancementReason(option.eligibility);}
export function featStatus(option:Pick<FeatOption,'eligibility'|'availableMilestones'>){if(!option.availableMilestones.length&&['ELIGIBLE','ACTIVE_INSTANCE'].includes(option.eligibility))return 'Prerequisites met; no earned milestone available'+(option.eligibility==='ACTIVE_INSTANCE'?'; advancement is also paused by an active instance':'');return option.eligibility==='ELIGIBLE'?'Available now':advancementReason(option.eligibility);}
export function canChooseAdvancement(view:Advancement|null,choice:AdvancementChoice){
 if(!view||choice.runId!==view.runId||choice.revision!==view.revision||view.activeInstance)return false;
 if(choice.kind==='CLASS')return view.classes.some(c=>c.classId===choice.id&&c.eligibility==='AVAILABLE');
 if(choice.kind==='SUBCLASS')return view.subclasses.options.some(c=>c.subclassId===choice.id&&c.eligibility==='AVAILABLE');
 if(choice.kind==='ATTRIBUTE'){const rule=view.attributes.rules.find(r=>r.rulesId===choice.id),milestone=rule?.availableMilestones.find(m=>m.level===choice.milestone);return !!rule&&!rule.blockedByInstance&&!!milestone&&validAttributeAllocation(rule,milestone,view.attributes.attributes,choice.allocation??{});}
 if(choice.kind==='PROFICIENCY')return view.proficiencies.options.some(p=>p.skillId===choice.id&&p.rulesId===choice.rulesId&&p.eligibility==='ELIGIBLE'&&nextRank(p.rank)!==null&&choice.milestone!==undefined&&p.availableMilestones.includes(choice.milestone));
 return view.feats.options.some(c=>c.featId===choice.id&&c.eligibility==='ELIGIBLE'&&choice.milestone!==undefined&&c.availableMilestones.includes(choice.milestone));
}
export function featEntries(catalog:FeatCatalog,search:string,filter:FeatFilter){
 const selected=new Set(catalog.selected.map(c=>c.featId)),entries=catalog.options.map(c=>({...c,selected:selected.has(c.featId)}));
 for(const item of catalog.selected)if(!entries.some(c=>c.featId===item.featId))entries.push({featId:item.featId,name:item.name,rulesId:'',availableMilestones:[],eligibility:'ALREADY_CHOSEN',selected:true});
 return entries.filter(c=>c.name.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim())&&(filter==='ALL'||filter==='SELECTED'&&c.selected||filter==='ELIGIBLE'&&!c.selected&&c.eligibility==='ELIGIBLE'||filter==='UNAVAILABLE'&&!c.selected&&(c.eligibility!=='ELIGIBLE'||!c.availableMilestones.length)));
}
export function publicChoiceText(value:unknown){return typeof value==='string'?value:null;}
export function advancementSuccess(type:string,body:Record<string,unknown>,result:Record<string,unknown>,view:Advancement|null){
 if(type==='LEVEL_UP'){const name=view?.classes.find(c=>c.classId===body.classId)?.name??'Class';const build=result.build as {classes?:{classId:string;nativeLevel:number}[]}|undefined;const level=build?.classes?.find(c=>c.classId===body.classId)?.nativeLevel;return `Advanced ${name}${level===undefined?'':` to native level ${level}`}.`;}
 if(type==='CHOOSE_SUBCLASS')return `Selected subclass ${view?.subclasses.options.find(c=>c.subclassId===body.subclassId)?.name??'successfully'}.`;
 if(type==='CHOOSE_FEAT')return `Selected feat ${view?.feats.options.find(c=>c.featId===body.featId)?.name??'successfully'}${typeof result.milestone==='number'?` at milestone ${result.milestone}`:''}.`;
 if(type==='ALLOCATE_ATTRIBUTES')return `Allocated attribute milestone ${body.milestone}: ${Object.entries(body.allocation as Record<string,number>).map(([a,n])=>`${titleCase(a)} +${n}`).join(', ')}.`;
 if(type==='ADVANCE_PROFICIENCY')return `Advanced ${view?.proficiencies.options.find(p=>p.skillId===body.skillId)?.name??'skill'} to ${titleCase(String(result.rank??''))} at milestone ${body.milestone}.`;
 return null;
}

export const attributeNames:AttributeName[]=['strength','dexterity','constitution','intelligence','wisdom','charisma','luck'];
export const rankLadder=['UNTRAINED','NOVICE','TRAINED','EXPERT','MASTER','LEGENDARY'] as const;
export const titleCase=(s:string)=>s.toLowerCase().replace(/(^|[ _])\w/g,c=>c.toUpperCase()).replaceAll('_',' ');
export function nextRank(rank:string){const i=rankLadder.findIndex(r=>r===rank);return i<0||i===rankLadder.length-1?null:rankLadder[i+1]!;}
export function validAttributeAllocation(rule:AttributeRule,m:AttributeMilestone,scores:Record<AttributeName,number|null>,allocation:Partial<Record<AttributeName,number>>){
 const entries=Object.entries(allocation) as [AttributeName,number][];
 return entries.length>0&&entries.every(([a,n])=>m.allowedAttributes.includes(a)&&Number.isInteger(n)&&n>0&&scores[a]!==null&&scores[a]!+n<=rule.maximumScores[a])&&entries.reduce((sum,[,n])=>sum+n,0)===m.points;
}
export function proficiencyEntries(options:ProficiencyOption[],search:string,family:string,rank:string,eligible:boolean){return options.filter(p=>p.name.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim())&&(!family||p.family===family)&&(!rank||p.rank===rank)&&(!eligible||p.eligibility==='ELIGIBLE'));}
export function proficiencyStatus(p:ProficiencyOption){const cap=p.rank===p.maximumRank||nextRank(p.rank)===null;if(cap)return 'Maximum rank reached';if(!p.availableMilestones.length)return 'No earned milestone available';return p.eligibility==='ELIGIBLE'?'Available now':advancementReason(p.eligibility);}
