import type {SceneView} from './scenes.js';
import type { NpcView,NpcInterpretation } from './npcs.js';
import { DmTranscript,dmReceipt,routineTemplates } from './dm-model.js';
import type { JournalView } from './journal.js';
import type { NoncombatView } from './noncombat.js';
import type { ConsumptionView,MealLine,TurnPlanner } from './types.js';
import { readCharacterView,saveCharacterView,clearCharacterView } from './character-preferences.js';
import { canChooseAdvancement,advancementSuccess } from './advancement-model.js';
import type { Advancement,AdvancementChoice,AdvancementClass,AdvancementScope,SubclassCatalog,FeatCatalog,FeatFilter,AttributeCatalog,ProficiencyCatalog,MilestoneCatalog,AttributeDraft } from './types.js';
import { inventorySuccess } from './inventory-usability.js';
import { defaultTileSettings,validTileSettings,type TileSettings } from './item-tiles.js';
import { ApiClient,ApiError,errorMessage } from './api.js';
import type { Config,GameView,Progression,BuildOptions,Tactical,Snapshot,Notice,AscensionPreview,InventoryPage,InventoryQuery,InventoryItem,InventoryHistory,EquipmentPlan,Gear,EquipmentPreview,AbilityBook,CharacterSection,AdvancementHistory } from './types.js';
const equipmentKey=(p:EquipmentPlan)=>JSON.stringify({activeSet:p.activeSet,slots:[...p.slots].sort((a,b)=>(a.set+a.slot).localeCompare(b.set+b.slot))});
export class GameSession {
 readonly dm=new DmTranscript();
 private dmNotice="";
 combatFocus:{instanceId:string;unitId:string}|null=null;
 runningCombatPlan:string|null=null;
 stopRepeatingCombat(){this.runningCombatPlan=null;this.notify();}
 async runCombatPlan(id:string){if(this.runningCombatPlan||this.busy||this.pending)return;const epoch=this.epoch;this.runningCombatPlan=id;this.notify();try{for(let n=0;n<101&&this.runningCombatPlan===id&&epoch===this.epoch;n++){const p=this.snapshot?.battle?.plans?.find(p=>p.id===id);if(!p||p.status!=='ACTIVE'||this.needsRefresh||this.pending||!this.snapshot?.game.canWrite)break;await this.action('/api/v1/tactical/plans/step','STEP_COMBAT_PLAN',{planId:id});if(this.notice.kind==='error'||this.pending)break;}}finally{if(this.runningCombatPlan===id)this.runningCombatPlan=null;this.notify();}}

 consumption:ConsumptionView|null=null;
 consumptionBusy=false;
 consumptionError:string|null=null;
 private consumptionGeneration=0;
 private consumptionWanted=false;
 mealDraft:{runId:string;name:string;lines:MealLine[]}|null=null;
 editMealDraft(value:GameSession['mealDraft']){this.mealDraft=value?.runId===this.snapshot?.game.run.runId?value:null;this.notify();}
 runningMeal:string|null=null;
 stopRepeatingMeal(){this.runningMeal=null;this.runningCombatPlan=null;this.notify();}
 private clearConsumption(){this.consumption=null;this.consumptionBusy=false;this.consumptionError=null;this.consumptionGeneration++;}
 async loadConsumption(){const s=this.snapshot;if(!s||this.consumptionBusy)return;const epoch=this.epoch,generation=++this.consumptionGeneration,runId=s.game.run.runId,revision=s.game.run.revision;this.consumptionWanted=true;this.consumptionBusy=true;this.consumptionError=null;this.notify();
  try{const view=await this.api.request<ConsumptionView>('/api/v1/consumption?expectedRevision='+revision);if(epoch!==this.epoch||generation!==this.consumptionGeneration)return;if(view.runId!==runId||view.revision!==revision||this.snapshot?.game.run.runId!==runId||this.snapshot.game.run.revision!==revision)throw new ApiError(409,'STALE_REVISION');this.consumption=view;}
  catch(error){if(epoch===this.epoch&&generation===this.consumptionGeneration){this.consumption=null;this.consumptionError=errorMessage(error);if(error instanceof ApiError&&error.status===401)this.handleError(error);}}
  finally{if(epoch===this.epoch&&generation===this.consumptionGeneration){this.consumptionBusy=false;this.notify();}}
 }
 async runMeal(id:string){if(this.runningMeal||this.busy||this.pending)return;const epoch=this.epoch;this.runningMeal=id;this.notify();try{for(let n=0;n<101&&this.runningMeal===id&&this.epoch===epoch;n++){const e=this.consumption?.executions.find(e=>e.id===id);if(!e||e.status!=='ACTIVE'||this.needsRefresh||this.pending||!this.snapshot?.game.canWrite)break;await this.action('/api/v1/consumption/meals/step','STEP_MEAL_PLAN',{executionId:id});if(this.notice.kind==='error'||this.pending)break;}}finally{if(this.runningMeal===id)this.runningMeal=null;this.runningCombatPlan=null;this.notify();}}
 turnActivity:{entityId:string;revision:number;eligible:boolean;restReason?:string|null;rest?:{health:number;mana:number;afterHealth:number;afterMana:number;maxHealth:number;maxMana:number}|null;costs:{turns:number}}|null=null;
 async reviewTurnActivity(id:string){const epoch=this.epoch,generation=++this.turnActivityGeneration,revision=this.snapshot?.game.run.revision;this.turnActivity=null;
  try{const preview=await this.api.request<NonNullable<GameSession['turnActivity']>>('/api/v1/rules/'+encodeURIComponent(id));if(epoch!==this.epoch||generation!==this.turnActivityGeneration||revision!==this.snapshot?.game.run.revision)return;this.turnActivity=preview;}
  catch(error){if(epoch===this.epoch)this.handleError(error);}this.notify();
 }
 runningTurnPlan:string|null=null;
 stopRepeatingTurns(){this.runningTurnPlan=null;this.notify();}
 async runTurnPlan(id:string){if(this.runningTurnPlan||this.busy||this.pending)return;const epoch=this.epoch;this.runningTurnPlan=id;this.notify();
  try{for(let n=0;n<1000&&this.runningTurnPlan===id&&this.epoch===epoch;n++){
   const plan=this.turns?.plans.find(p=>p.id===id);if(!plan||plan.status!=='ACTIVE'||this.needsRefresh||this.pending||!this.snapshot?.game.canWrite)break;
   await this.action('/api/v1/turns/plans/step','STEP_TURN_PLAN',{planId:id});if(this.notice.kind==='error'||this.pending)break;
  }}finally{if(this.runningTurnPlan===id)this.runningTurnPlan=null;this.notify();}
 }
 turnPlanDraft:{runId:string;entityId:string;maxTurns:number;maxActions:number;minHealth:number;targetItemId:string;targetQuantity:number}|null=null;
 scenes:SceneView|null=null;
 sceneBusy=false;
 sceneError:string|null=null;
 sceneSelected:string|undefined;
 sceneItems:Record<string,string>={};
 private sceneWanted=false;
 private sceneGeneration=0;
 private clearScenes(){this.scenes=null;this.sceneBusy=false;this.sceneError=null;this.sceneSelected=undefined;this.sceneItems={};this.sceneWanted=false;this.sceneGeneration++;}
 async loadScenes(sceneId=this.sceneSelected){const snapshot=this.snapshot;if(!snapshot)return;const epoch=this.epoch,generation=++this.sceneGeneration,runId=snapshot.game.run.runId,revision=snapshot.game.run.revision;if(sceneId!==this.sceneSelected)this.sceneItems={};this.sceneSelected=sceneId;this.sceneWanted=true;this.sceneBusy=true;this.sceneError=null;this.notify();
  try{const v=await this.api.request<SceneView>('/api/v1/scenes'+(sceneId?'?sceneId='+encodeURIComponent(sceneId):''));if(epoch!==this.epoch||generation!==this.sceneGeneration)return;if(v.runId!==runId||v.revision!==revision||this.snapshot?.game.run.runId!==runId||this.snapshot.game.run.revision!==revision)throw new ApiError(409,'STALE_REVISION');this.scenes=v;this.dm.selection.sceneId=v.selected?.id;this.dm.save();if(v.selected)this.dm.focus(v.selected.name);}
  catch(error){if(epoch===this.epoch&&generation===this.sceneGeneration){this.scenes=null;this.sceneError=errorMessage(error);if(error instanceof ApiError&&error.status===401)this.handleError(error);}}
  finally{if(epoch===this.epoch&&generation===this.sceneGeneration){this.sceneBusy=false;this.notify();}}
 }
 async chooseScene(objectId:string,actionId:string,itemInstanceId?:string,confirmItem?:boolean){const v=this.scenes,n=v?.selected,a=n?.objects.find(o=>o.id===objectId)?.actions.find(a=>a.id===actionId);if(!v||!n||!a?.eligible||this.sceneBusy||v.revision!==this.snapshot?.game.run.revision||v.runId!==this.snapshot.game.run.runId)return;await this.action('/api/v1/scenes/actions','SCENE_ACTION',{sceneId:n.id,objectId,actionId,confirm:true,...(itemInstanceId?{itemInstanceId}:{}),...(confirmItem!==undefined?{confirmItem}:{})});}
 npcs:NpcView|null=null;
 npcBusy=false;
 npcError:string|null=null;
 npcSelected:string|undefined;
 npcDraft='';
 npcInterpretation:NpcInterpretation|null=null;
 private npcGeneration=0;
 private npcWanted=false;
 private clearNpcs(){this.npcs=null;this.npcBusy=false;this.npcError=null;this.npcSelected=undefined;this.npcDraft='';this.npcInterpretation=null;this.npcWanted=false;this.npcGeneration++;}
 async loadNpcs(npcId=this.npcSelected){
  const snapshot=this.snapshot;if(!snapshot)return;const epoch=this.epoch,generation=++this.npcGeneration,runId=snapshot.game.run.runId,revision=snapshot.game.run.revision;
  if(npcId!==this.npcSelected){this.npcDraft='';this.npcInterpretation=null;}this.npcSelected=npcId;this.npcWanted=true;this.npcBusy=true;this.npcError=null;this.notify();
  try{const view=await this.api.request<NpcView>('/api/v1/npcs'+(npcId?'?npcId='+encodeURIComponent(npcId):''));if(epoch!==this.epoch||generation!==this.npcGeneration)return;if(view.runId!==runId||view.revision!==revision||this.snapshot?.game.run.runId!==runId||this.snapshot.game.run.revision!==revision)throw new ApiError(409,'STALE_REVISION');this.npcs=view;this.dm.selection.npcId=view.selected?.id;this.dm.save();if(view.selected){this.dm.focus(view.selected.name,view.selected.name);}}
  catch(error){if(epoch===this.epoch&&generation===this.npcGeneration){this.npcs=null;this.npcError=errorMessage(error);if(error instanceof ApiError&&error.status===401)this.handleError(error);}}
  finally{if(epoch===this.epoch&&generation===this.npcGeneration){this.npcBusy=false;this.notify();}}
 }
 async interpretNpc(text:string){
  const n=this.npcs?.selected,run=this.snapshot?.game.run;if(!n||!run||this.npcBusy||this.busy||this.pending)return;const epoch=this.epoch,generation=++this.npcGeneration;this.npcBusy=true;this.npcInterpretation=null;this.npcError=null;this.notify();
  try{const result=await this.api.request<NpcInterpretation>('/api/v1/npcs/interpret',{npcId:n.id,text});if(epoch!==this.epoch||generation!==this.npcGeneration)return;if(result.runId!==this.snapshot?.game.run.runId||result.revision!==this.snapshot.game.run.revision||n.id!==this.npcSelected)throw new ApiError(409,'STALE_REVISION');this.npcInterpretation=result;this.dm.add({surface:'command',channel:'choices',lines:[result.message,...result.choices.map(c=>c.label+' — '+c.consequence)]});}
  catch(error){if(epoch===this.epoch&&generation===this.npcGeneration){this.npcError=errorMessage(error);this.npcInterpretation=null;}}
  finally{if(epoch===this.epoch&&generation===this.npcGeneration){this.npcBusy=false;this.notify();}}
 }
 reviewNpcChoice(choiceId:string){const v=this.npcs,n=v?.selected,c=n?.choices.find(c=>c.id===choiceId);if(!v||!n||!c?.eligible)return;this.npcInterpretation={runId:v.runId,revision:v.revision,npcId:n.id,nodeId:n.node.id,kind:'PROPOSED',message:'Review the consequence, then confirm this authored approach.',choices:[c]};this.notify();}
 async chooseNpc(choiceId:string){const n=this.npcs?.selected,p=this.npcInterpretation;if(!n||!p||p.npcId!==n.id||p.revision!==this.snapshot?.game.run.revision||!p.choices.some(c=>c.id===choiceId&&c.eligible))return;await this.action('/api/v1/npcs/choice','NPC_CHOICE',{npcId:n.id,nodeId:p.nodeId,choiceId,confirm:true});if(!this.pending&&this.notice.kind==='success'){this.npcDraft='';this.npcInterpretation=null;this.notify();}}
 journalNoteDraft="";
 async saveJournalNote(text:string){if(this.busy||this.pending||this.needsRefresh||!this.snapshot?.game.canWrite)return;await this.action('/api/v1/journal/notes','JOURNAL_NOTE',{text});if(!this.pending&&this.notice?.kind==='success'){this.journalNoteDraft="";this.notify();}}
 journal:JournalView|null=null;
 journalBusy=false;
 journalError:string|null=null;
 private journalGeneration=0;
 private journalWanted=false;
 async loadJournal(){
  const s=this.snapshot;if(!s)return;const epoch=this.epoch,generation=++this.journalGeneration,runId=s.game.run.runId,revision=s.game.run.revision;this.journalWanted=true;this.journalBusy=true;this.journalError=null;this.notify();
  try{const view=await this.api.request<JournalView>('/api/v1/journal');if(epoch!==this.epoch||generation!==this.journalGeneration)return;if(view.runId!==runId||view.revision!==revision||this.snapshot?.game.run.runId!==runId||this.snapshot.game.run.revision!==revision)throw new ApiError(409,'STALE_REVISION');this.journal=view;}
  catch(error){if(epoch===this.epoch&&generation===this.journalGeneration){this.journal=null;this.journalError=errorMessage(error);}}
  finally{if(epoch===this.epoch&&generation===this.journalGeneration){this.journalBusy=false;this.notify();}}
 }
 noncombat:NoncombatView|null=null;
 noncombatBusy=false;
 noncombatError:string|null=null;
 noncombatSelected:string|undefined;
 noncombatCompanion:string|undefined;
 private noncombatGeneration=0;
 private noncombatWanted=false;
 async loadNoncombat(obstacleId=this.noncombatSelected,...selection:[companionId?:string]){
  const companionId=selection.length?selection[0]:obstacleId===this.noncombatSelected?this.noncombatCompanion:undefined;
  const s=this.snapshot;if(!s)return;const epoch=this.epoch,generation=++this.noncombatGeneration,runId=s.game.run.runId,revision=s.game.run.revision;this.noncombatWanted=true;this.noncombatBusy=true;this.noncombatError=null;this.noncombatSelected=obstacleId;this.noncombatCompanion=companionId;this.notify();
  const q=new URLSearchParams();if(obstacleId)q.set('obstacleId',obstacleId);if(companionId)q.set('companionId',companionId);
  try{const view=await this.api.request<NoncombatView>('/api/v1/noncombat?'+q);if(epoch!==this.epoch||generation!==this.noncombatGeneration)return;if(view.runId!==runId||view.revision!==revision||this.snapshot?.game.run.runId!==runId||this.snapshot.game.run.revision!==revision)throw new ApiError(409,'STALE_REVISION');this.noncombat=view;}
  catch(error){if(epoch===this.epoch&&generation===this.noncombatGeneration){this.noncombat=null;this.noncombatError=errorMessage(error);}}
  finally{if(epoch===this.epoch&&generation===this.noncombatGeneration){this.noncombatBusy=false;this.notify();}}
 }
 turns:TurnPlanner|null=null;
 turnsBusy=false;
 turnsError:string|null=null;
 private turnsGeneration=0;
 private turnActivityGeneration=0;
 private turnsWanted=false;
 reserveAction:{path:string;type:string;parameters:Record<string,unknown>}|null=null;
 cancelReserveAction(){this.reserveAction=null;this.notify();}
 async confirmReserveAction(){const a=this.reserveAction;if(!a)return;this.reserveAction=null;await this.action(a.path,a.type,{...a.parameters,confirmReserve:true});}
 async loadTurns(historyBefore?:string){
  const s=this.snapshot;if(!s||this.turnsBusy)return;const epoch=this.epoch,generation=++this.turnsGeneration,runId=s.game.run.runId,revision=s.game.run.revision;
  this.turnsWanted=true;this.turnsBusy=true;this.turnsError=null;this.notify();
  try{const view=await this.api.request<TurnPlanner>('/api/v1/turns?expectedRevision='+revision+(historyBefore?'&historyBefore='+encodeURIComponent(historyBefore):''));
   if(epoch!==this.epoch||generation!==this.turnsGeneration)return;
   if(view.runId!==runId||view.revision!==revision||this.snapshot?.game.run.runId!==runId||this.snapshot.game.run.revision!==revision)throw new ApiError(409,'STALE_REVISION');this.turns=view;
  }catch(error){if(epoch===this.epoch&&generation===this.turnsGeneration){this.turns=null;this.turnsError=errorMessage(error);if(error instanceof ApiError&&error.status===401)this.handleError(error);}}
  finally{if(epoch===this.epoch&&generation===this.turnsGeneration){this.turnsBusy=false;this.notify();}}
 }
 private clearTurns(){this.journal=null;this.journalBusy=false;this.journalError=null;this.journalGeneration++;this.noncombat=null;this.noncombatBusy=false;this.noncombatError=null;this.noncombatGeneration++;this.clearConsumption();this.turnActivityGeneration++;this.turnActivity=null;this.turns=null;this.turnsBusy=false;this.turnsError=null;this.turnsGeneration++;}

 private selectionPage='';
 inventorySelection=new Set<string>();
 inventorySelectionAnchor:string|null=null;
 selectInventoryRange(item:InventoryItem,options:{toggle?:boolean;range?:boolean}={}){
  const items=this.inventory?.items??[],physical=items.filter(i=>i.accessible&&(!this.inventoryQuery.grouped||i.copies===1)),index=items.findIndex(i=>i.id===item.id),anchor=items.findIndex(i=>i.id===this.inventorySelectionAnchor);
  if(!item.accessible||this.inventoryQuery.grouped&&item.copies>1)return;
  if(options.range&&anchor>=0){if(!options.toggle)this.inventorySelection.clear();for(const row of items.slice(Math.min(anchor,index),Math.max(anchor,index)+1))if(physical.some(i=>i.id===row.id))this.inventorySelection.add(row.id);}
  else if(options.toggle){if(this.inventorySelection.has(item.id))this.inventorySelection.delete(item.id);else this.inventorySelection.add(item.id);}
  else {this.inventorySelection.clear();this.inventorySelection.add(item.id);}
  if(!options.range)this.inventorySelectionAnchor=item.id;this.notify();
 }
 clearInventorySelection(){this.inventorySelection.clear();this.inventorySelectionAnchor=null;this.notify();}
 async bulkInventory(operation:string,items:InventoryItem[]){if(!items.length||this.busy||this.pending||this.needsRefresh||!this.snapshot?.game.canWrite)return;const runId=this.snapshot.game.run.runId;await this.action('/api/v1/inventory/bulk','BULK_INVENTORY',{operation,selections:items.map(i=>({itemId:i.id,...(operation==='MARK_INSPECTED'?{inspectionToken:i.inspectionToken}:{})}))});if(this.snapshot?.game.run.runId===runId&&!this.pending&&this.notice.kind==='success'&&this.selectedInventoryItem&&items.some(i=>i.id===this.selectedInventoryItem?.id)){if(operation==='MARK_INSPECTED')this.selectedInventoryItem.isNew=false;if(operation==='FAVORITE'||operation==='UNFAVORITE')this.selectedInventoryItem.favorite=operation==='FAVORITE';this.notify();}}
 equipmentDraft:{runId:string;revision:number;plan:EquipmentPlan;gear:Gear[]}|null=null;
 equipmentContext:string|undefined;
 equipmentPreview:EquipmentPreview|null=null;
 equipmentPreviewError:string|null=null;
 equipmentPreviewBusy=false;
 private previewGeneration=0;
 equipmentState(){
  const s=this.snapshot;if(!s?.game.equipment)return null;
  if(this.equipmentDraft?.runId!==s.game.run.runId)this.equipmentDraft=null;
  return this.equipmentDraft?.plan??s.game.equipment;
 }
 equipmentGear(){return [...(this.snapshot?.game.gear??[]),...(this.equipmentDraft?.gear??[])].filter((g,i,all)=>all.findIndex(a=>a.id===g.id)===i);}
 stageEquipment(plan:EquipmentPlan,gear:Gear[]=[]){
  const s=this.snapshot;if(!s||this.busy||this.needsRefresh)return;
  if(!this.equipmentDraft)this.equipmentDraft={runId:s.game.run.runId,revision:s.game.run.revision,plan:structuredClone(plan),gear:[]};
  this.clearCharacterStats();this.equipmentDraft.plan=structuredClone(plan);for(const item of gear)if(!this.equipmentDraft.gear.some(g=>g.id===item.id))this.equipmentDraft.gear.push(structuredClone(item));else if(item.inspection)this.equipmentDraft.gear.find(g=>g.id===item.id)!.inspection=structuredClone(item.inspection);
  this.equipmentPreview=null;this.notify();void this.previewEquipment();
 }
 revertEquipment(){this.clearCharacterStats();this.equipmentDraft=null;this.equipmentPreview=null;this.notify();void this.previewEquipment();}
 async applyEquipment(){const d=this.equipmentDraft;if(!d||d.runId!==this.snapshot?.game.run.runId||d.revision!==this.snapshot.game.run.revision)return;await this.action('/api/v1/equipment','SET_EQUIPMENT',d.plan);}
 async previewEquipment(contextId=this.equipmentContext){
  const s=this.snapshot;if(!s)return;const epoch=this.epoch,generation=++this.previewGeneration,plan=structuredClone(this.equipmentState());this.equipmentContext=contextId;
  this.equipmentPreviewBusy=true;this.equipmentPreviewError=null;this.notify();
  const q=new URLSearchParams({expectedRevision:String(s.game.run.revision)});if(plan)q.set('plan',JSON.stringify(plan));if(contextId)q.set('contextId',contextId);
  try{const result=await this.api.request<EquipmentPreview>('/api/v1/equipment/preview?'+q);if(epoch!==this.epoch||generation!==this.previewGeneration)return;if(result.revision!==this.snapshot?.game.run.revision||result.runId!==this.snapshot.game.run.runId)throw new ApiError(409,'STALE_REVISION');this.equipmentPreview=result;}
  catch(error){if(epoch===this.epoch&&generation===this.previewGeneration){this.equipmentPreview=null;this.equipmentPreviewError=errorMessage(error);}}
  finally{if(epoch===this.epoch&&generation===this.previewGeneration){this.equipmentPreviewBusy=false;this.notify();}}
 }
 advancement:Advancement|null=null;
 advancementBusy=false;
 advancementError:string|null=null;
 advancementNeedsRefresh=false;
 advancementSearch='';
 advancementFilter:FeatFilter='ALL';
 advancementFeatId:string|null=null;
 advancementMilestone:number|null=null;
 attributeDraft:AttributeDraft|null=null;
 proficiencySearch='';
 proficiencyFamily='';
 proficiencyRank='';
 proficiencyEligible=false;
 setAttributeDraft(draft:AttributeDraft|null){this.attributeDraft=draft;this.notify();}
 setProficiencyBrowser(patch:Partial<Pick<GameSession,'proficiencySearch'|'proficiencyFamily'|'proficiencyRank'|'proficiencyEligible'>>){Object.assign(this,patch);this.notify();}
 private advancementWanted=false;
 private advancementGeneration=0;
 setAdvancementBrowser(patch:Partial<Pick<GameSession,'advancementSearch'|'advancementFilter'|'advancementFeatId'|'advancementMilestone'>>){Object.assign(this,patch);this.notify();}
 async loadAdvancement(){
  const snapshot=this.snapshot;if(!snapshot||this.advancementBusy)return;
  this.advancementWanted=true;this.advancementBusy=true;this.advancementError=null;this.advancementNeedsRefresh=false;const generation=++this.advancementGeneration,epoch=this.epoch,runId=snapshot.game.run.runId,revision=snapshot.game.run.revision;this.notify();
  try {
   const [options,subclasses,feats,attributes,proficiencies,milestones]=await Promise.all([this.api.request<BuildOptions&AdvancementScope&{classes:AdvancementClass[]}>('/api/v1/progression/options?advancement=true'),this.api.request<SubclassCatalog>('/api/v1/progression/subclasses'),this.api.request<FeatCatalog>('/api/v1/progression/feats'),this.api.request<AttributeCatalog>('/api/v1/progression/attributes'),this.api.request<ProficiencyCatalog>('/api/v1/progression/proficiencies'),this.api.request<MilestoneCatalog>('/api/v1/progression/milestones')]);
   if(epoch!==this.epoch||generation!==this.advancementGeneration||this.snapshot?.game.run.runId!==runId||this.snapshot.game.run.revision!==revision)return;
   if([options,subclasses,feats,attributes,proficiencies,milestones].some(v=>v.runId!==runId||v.revision!==revision||v.activeInstance!==options.activeInstance))throw new ApiError(409,'STALE_REVISION');
   this.advancement={runId,revision,activeInstance:options.activeInstance,classes:options.classes,subclasses,feats,attributes,proficiencies,milestones};
   if(this.attributeDraft&&(this.attributeDraft.runId!==runId||this.attributeDraft.revision!==revision))this.attributeDraft=null;
  }catch(error){if(epoch===this.epoch&&generation===this.advancementGeneration){this.advancement=null;this.advancementError=errorMessage(error);this.advancementNeedsRefresh=error instanceof ApiError&&error.status===409;if(error instanceof ApiError&&error.status===401)this.handleError(error);}}
  finally{if(epoch===this.epoch&&generation===this.advancementGeneration){this.advancementBusy=false;this.notify();}}
 }
 async chooseAdvancement(choice:AdvancementChoice){
  if(this.busy||this.pending||this.needsRefresh||!this.snapshot?.game.canWrite||this.advancementBusy||choice.runId!==this.snapshot.game.run.runId||choice.revision!==this.snapshot.game.run.revision||!canChooseAdvancement(this.advancement,choice))return;
  if(choice.kind==='ATTRIBUTE'){await this.action('/api/v1/progression/attributes','ALLOCATE_ATTRIBUTES',{rulesId:choice.id,milestone:choice.milestone,allocation:choice.allocation});return;}
  if(choice.kind==='PROFICIENCY'){await this.action('/api/v1/progression/proficiencies','ADVANCE_PROFICIENCY',{rulesId:choice.rulesId,skillId:choice.id,milestone:choice.milestone});return;}
  const path=choice.kind==='CLASS'?'level':choice.kind==='SUBCLASS'?'subclasses':'feats',type=choice.kind==='CLASS'?'LEVEL_UP':choice.kind==='SUBCLASS'?'CHOOSE_SUBCLASS':'CHOOSE_FEAT',body=choice.kind==='CLASS'?{classId:choice.id}:choice.kind==='SUBCLASS'?{subclassId:choice.id}:{featId:choice.id,milestone:choice.milestone};
  await this.action('/api/v1/progression/'+path,type,body);
 }
 private clearAdvancement(newRun=false){this.clearCharacterReads(newRun);this.advancement=null;this.advancementBusy=false;this.advancementError=null;this.advancementNeedsRefresh=false;this.advancementGeneration++;if(newRun){this.attributeDraft=null;this.proficiencySearch='';this.proficiencyFamily='';this.proficiencyRank='';this.proficiencyEligible=false;this.advancementSearch='';this.advancementFilter='ALL';this.advancementFeatId=null;this.advancementMilestone=null;}}
 characterStats:EquipmentPreview|null=null;
 characterStatsBusy=false;
 characterStatsError:string|null=null;
 characterStatsContext:string|undefined;
 characterStatsDraft=false;
 characterStatsNeedsRefresh=false;
 private characterStatsGeneration=0;
 abilityBook:AbilityBook|null=null;
 abilityBookBusy=false;
 abilityBookError:string|null=null;
 abilityBookNeedsRefresh=false;
 abilitySearch='';
 abilityCategory='ALL';
 abilitySource='ALL';
 abilitySelection:string|null=null;
 private abilityGeneration=0;
 setAbilityBrowser(patch:Partial<Pick<GameSession,'abilitySearch'|'abilityCategory'|'abilitySource'|'abilitySelection'>>){Object.assign(this,patch);this.notify();}
 private clearCharacterStats(){this.characterStats=null;this.characterStatsBusy=false;this.characterStatsError=null;this.characterStatsNeedsRefresh=false;this.characterStatsGeneration++;}
 private clearCharacterReads(newRun=false){this.characterHistory=null;this.characterHistoryBusy=false;this.characterHistoryError=null;this.characterHistoryNeedsRefresh=false;this.characterHistoryGeneration++;if(newRun)this.characterHistoryOffset=0;this.clearCharacterStats();this.abilityBook=null;this.abilityBookBusy=false;this.abilityBookError=null;this.abilityBookNeedsRefresh=false;this.abilityGeneration++;if(newRun){this.characterStatsContext=undefined;this.characterStatsDraft=false;this.abilitySearch='';this.abilityCategory='ALL';this.abilitySource='ALL';this.abilitySelection=null;}}
 async loadCharacterStats(context=this.characterStatsContext,includeDraft=this.characterStatsDraft){
  const s=this.snapshot;if(!s)return;const epoch=this.epoch,generation=++this.characterStatsGeneration,runId=s.game.run.runId,revision=s.game.run.revision;
  const draft=includeDraft?this.equipmentDraft:null,plan=draft&&draft.runId===runId&&draft.revision===revision?structuredClone(draft.plan):null,key=plan?equipmentKey(plan):null;
  this.characterStatsContext=context;this.characterStatsDraft=includeDraft;this.characterStats=null;this.characterStatsBusy=true;this.characterStatsError=null;this.characterStatsNeedsRefresh=false;this.notify();
  const q=new URLSearchParams({expectedRevision:String(revision)});if(context)q.set('contextId',context);if(plan)q.set('plan',JSON.stringify(plan));
  try{const result=await this.api.request<EquipmentPreview>('/api/v1/equipment/preview?'+q);if(epoch!==this.epoch||generation!==this.characterStatsGeneration)return;
   if(result.runId!==this.snapshot?.game.run.runId||result.revision!==this.snapshot.game.run.revision||result.runId!==runId||result.revision!==revision)throw new ApiError(409,'STALE_REVISION');
   if(key&&(!this.equipmentDraft||equipmentKey(this.equipmentDraft.plan)!==key))return;
   this.characterStats=result;
  }catch(error){if(epoch===this.epoch&&generation===this.characterStatsGeneration){this.characterStatsError=errorMessage(error);if(error instanceof ApiError&&error.code==='STAT_CONTEXT_NOT_FOUND'){this.characterStatsContext=undefined;this.characterStatsError='This rules context is unavailable. Retry statistics to discover current contexts.';}this.characterStatsNeedsRefresh=error instanceof ApiError&&error.status===409;if(error instanceof ApiError&&error.status===401)this.handleError(error);}}
  finally{if(epoch===this.epoch&&generation===this.characterStatsGeneration){this.characterStatsBusy=false;this.notify();}}
 }
 async loadAbilityBook(){
  const s=this.snapshot;if(!s||this.abilityBookBusy)return;const epoch=this.epoch,generation=++this.abilityGeneration,runId=s.game.run.runId,revision=s.game.run.revision;this.abilityBookBusy=true;this.abilityBookError=null;this.abilityBookNeedsRefresh=false;this.notify();
  try{const result=await this.api.request<AbilityBook>('/api/v1/character/abilities');if(epoch!==this.epoch||generation!==this.abilityGeneration)return;
   if(result.runId!==runId||result.revision!==revision||this.snapshot?.game.run.runId!==runId||this.snapshot.game.run.revision!==revision)throw new ApiError(409,'STALE_REVISION');this.abilityBook=result;
  }catch(error){if(epoch===this.epoch&&generation===this.abilityGeneration){this.abilityBook=null;this.abilityBookError=errorMessage(error);this.abilityBookNeedsRefresh=error instanceof ApiError&&error.status===409;if(error instanceof ApiError&&error.status===401)this.handleError(error);}}
  finally{if(epoch===this.epoch&&generation===this.abilityGeneration){this.abilityBookBusy=false;this.notify();}}
 }
 characterHistory:AdvancementHistory|null=null;
 characterHistoryBusy=false;
 characterHistoryError:string|null=null;
 characterHistoryNeedsRefresh=false;
 characterHistoryOffset=0;
 private characterHistoryGeneration=0;
 async loadCharacterHistory(offset=this.characterHistoryOffset){
  const s=this.snapshot;if(!s||this.characterHistoryBusy||!Number.isInteger(offset)||offset<0||offset>10000)return;
  const epoch=this.epoch,generation=++this.characterHistoryGeneration,runId=s.game.run.runId,revision=s.game.run.revision;
  this.characterHistory=null;this.characterHistoryBusy=true;this.characterHistoryError=null;this.characterHistoryNeedsRefresh=false;this.characterHistoryOffset=offset;saveCharacterView(runId,this.characterSection,offset);this.notify();
  try{const result=await this.api.request<AdvancementHistory>('/api/v1/character/history?'+new URLSearchParams({expectedRevision:String(revision),offset:String(offset)}));
   if(epoch!==this.epoch||generation!==this.characterHistoryGeneration)return;
   if(result.runId!==runId||result.revision!==revision||this.snapshot?.game.run.runId!==runId||this.snapshot.game.run.revision!==revision)throw new ApiError(409,'STALE_REVISION');
   this.characterHistory=result;
  }catch(error){if(epoch===this.epoch&&generation===this.characterHistoryGeneration){this.characterHistoryError=errorMessage(error);this.characterHistoryNeedsRefresh=error instanceof ApiError&&error.status===409;if(error instanceof ApiError&&error.status===401)this.handleError(error);}}
  finally{if(epoch===this.epoch&&generation===this.characterHistoryGeneration){this.characterHistoryBusy=false;this.notify();}}
 }
 characterSection:CharacterSection='overview';
 setCharacterSection(section:CharacterSection){this.characterSection=section;if(this.snapshot)saveCharacterView(this.snapshot.game.run.runId,section,this.characterHistoryOffset);this.notify();}
 inventoryFiltersOpen=false;
 inventorySearchDraft:string|null=null;
 inventoryAutomationOpen=false;
 inventoryLayout:'COMPACT'|'STANDARD'|'DETAILED'='STANDARD';
 inventoryEquipmentOpen=false;
 inventoryLoadoutsOpen=false;
 inventoryStatsOpen=false;
 setInventoryEquipmentOpen(open:boolean){this.inventoryEquipmentOpen=open;this.notify();}
 setInventoryLayout(layout:'COMPACT'|'STANDARD'|'DETAILED'){if(this.busy||this.pending||this.needsRefresh||!this.snapshot?.game.canWrite)return;void this.action('/api/v1/inventory/workspace','SET_INVENTORY_WORKSPACE',{layout});}
 tileSettingsOpen=false;
 tileSettings:TileSettings={...defaultTileSettings};
 updateTileSettings(patch:Partial<TileSettings>){if(this.snapshot&&(this.busy||this.pending||!this.snapshot.game.canWrite||this.needsRefresh))return false;const next={...this.tileSettings,...patch};if(!validTileSettings(next))return false;this.tileSettings=next;this.notify();if(this.snapshot)void this.action('/api/v1/inventory/display-preferences','SET_TILE_PREFERENCES',{preferences:next});return true;}
 snapshot:Snapshot|null=null;
 inventory:InventoryPage|null=null;
 selectedInventoryItem:InventoryItem|null=null;
 selectedInventoryGrouped=false;
 private selectedInventoryQuery='';
 private selectedInventoryRevision=-1;
 inventoryQuery:InventoryQuery={sort:'NAME',direction:'ASC',grouped:true,offset:0};
 inventoryBusy=false;
 inventoryError:string|null=null;
 inventoryHistory:InventoryHistory|null=null;
 inventoryHistoryBusy=false;
 private historyGeneration=0;
 private inventoryWanted=false;
 private inventoryGeneration=0;
 ascension:AscensionPreview|null=null;
 busy=false;
 needsRefresh=false;
 pending:{path:string;body:Record<string,unknown>}|null=null;
 notice:Notice={text:'Your journey begins with a character.',kind:'info'};
 config:Config|null=null;
 private epoch=0;
 private listeners=new Set<()=>void>();
 constructor(private readonly api=new ApiClient(),private readonly uuid:()=>string=()=>crypto.randomUUID()){}
 query<T>(path:string){return this.api.request<T>(path);}
 subscribe(listener:()=>void){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
 private notify(){if(this.snapshot){this.dm.scope(this.snapshot.game.run.runId);if(!this.busy&&this.notice.text!==this.dmNotice){this.dmNotice=this.notice.text;this.dm.add({surface:'system',channel:this.notice.kind==='error'?'error':'dm',lines:[this.notice.text]});}}for(const listener of this.listeners)listener();}
 async initialize(){try{this.config=await this.api.request<Config>('/api/v1/client/config',undefined,false);}catch(error){this.notice={text:errorMessage(error),kind:'error'};}this.notify();}
 async connect(credentials:{handle?:string;password?:string;token?:string}){
  if(this.busy)return;this.dm.reset();this.dmNotice="";this.clearNpcs();this.clearScenes();this.inventorySelection.clear();this.inventorySelectionAnchor=null;this.inventoryLayout='STANDARD';this.inventoryEquipmentOpen=false;this.inventoryLoadoutsOpen=false;this.inventoryStatsOpen=false;this.tileSettings={...defaultTileSettings};this.equipmentDraft=null;this.equipmentPreview=null;this.equipmentContext=undefined;this.previewGeneration++;this.inventory=null;this.inventoryBusy=false;this.inventoryError=null;this.inventoryHistory=null;this.historyGeneration++;this.inventoryHistoryBusy=false;this.selectedInventoryItem=null;this.selectedInventoryGrouped=false;this.inventoryWanted=false;this.inventoryQuery={sort:'NAME',direction:'ASC',grouped:true,offset:0};this.inventoryGeneration++;this.busy=true;const epoch=++this.epoch;this.notify();
  try{let token=credentials.token;if(this.config?.authMode==='sessions'){const result=await this.api.request<{token:string}>('/api/v1/auth/login',{handle:credentials.handle,password:credentials.password,deviceLabel:'Follybound browser'},false);token=result.token;}
   if(epoch!==this.epoch)return;if(!token)throw new ApiError(401,'UNAUTHORIZED');this.api.setToken(token);await this.load(epoch);this.notice={text:'Connected. Your progress is saved by the server.',kind:'success'};
  }catch(error){if(epoch===this.epoch){this.clearAdvancement(true);this.advancementWanted=false;this.clearTurns();this.turnPlanDraft=null;this.mealDraft=null;this.consumptionWanted=false;this.runningMeal=null;this.runningCombatPlan=null;this.turnsWanted=false;this.journalWanted=false;this.journalNoteDraft="";this.noncombatWanted=false;this.noncombatSelected=undefined;this.noncombatCompanion=undefined;this.runningTurnPlan=null;this.reserveAction=null;this.api.setToken('');this.snapshot=null;this.notice={text:errorMessage(error),kind:'error'};}}
  finally{if(epoch===this.epoch){this.busy=false;this.notify();}}
 }
 private async load(epoch:number,refreshAdvancement=this.advancementWanted){
  this.clearTurns();this.ascension=null;this.inventory=null;this.inventoryError=null;this.clearAdvancement();
  const game=await this.api.request<GameView>('/api/v1/client/state');if(game.protocolVersion!==1)throw new ApiError(503,'UNSUPPORTED_CLIENT');
  const [progression,options]=await Promise.all([this.api.request<Progression>('/api/v1/progression'),this.api.request<BuildOptions>('/api/v1/progression/options')]);
  const id=game.activeEncounter?.kind==='TACTICAL'?game.activeEncounter.id:!game.activeEncounter?game.latestEncounter?.id:null;
  const shared=game.activeEncounter?.kind==='SHARED_TACTICAL'?game.activeEncounter.sessionId:!game.activeEncounter&&game.latestEncounter?.kind==='SHARED_TACTICAL'?game.latestEncounter.sessionId:null;
  const battle=shared?await this.api.request<Tactical>('/api/v1/tactical/shared/'+shared):id?await this.api.request<Tactical>(`/api/v1/tactical/${id}`):null;
  // These independent projections may cross another window's action. Refuse a
  // mixed revision and let the player explicitly refresh, never write from it.
  if(progression.revision!==game.run.revision||(options.revision!==undefined&&options.revision!==game.run.revision)||(options.runId!==undefined&&options.runId!==game.run.runId)||(battle&&battle.revision!==game.run.revision))throw new ApiError(409,'STALE_REVISION');
  if(epoch===this.epoch){if(this.snapshot?.game.run.runId!==game.run.runId){this.clearNpcs();this.clearScenes();this.noncombatSelected=undefined;this.noncombatCompanion=undefined;this.turnPlanDraft=null;this.mealDraft=null;this.runningMeal=null;this.runningCombatPlan=null;const remembered=!this.snapshot?readCharacterView(game.run.runId):null;this.equipmentContext=undefined;this.inventorySearchDraft=null;this.clearAdvancement(true);this.characterSection=remembered?.section??'overview';this.characterHistoryOffset=remembered?.offset??0;}this.equipmentPreviewError=null;this.snapshot={game,progression,options,battle};this.dm.scope(game.run.runId);const resume=this.dm.selection;if(!this.sceneWanted&&resume.sceneId&&this.dm.scene==='scenes'){this.sceneWanted=true;this.sceneSelected=resume.sceneId;}if(!this.npcWanted&&resume.npcId&&this.dm.scene==='npcs'){this.npcWanted=true;this.npcSelected=resume.npcId;}saveCharacterView(game.run.runId,this.characterSection,this.characterHistoryOffset);this.needsRefresh=false;
   if(this.equipmentDraft&&(this.equipmentDraft.runId!==game.run.runId||game.equipment&&equipmentKey(this.equipmentDraft.plan)===equipmentKey(game.equipment)))this.equipmentDraft=null;
   this.equipmentPreview=null;this.previewGeneration++;this.equipmentPreviewBusy=false;if(this.inventoryWanted)await this.browseInventory(this.inventoryQuery);if(this.npcWanted)await this.loadNpcs();if(this.sceneWanted)await this.loadScenes();if(this.journalWanted)await this.loadJournal();if(this.noncombatWanted)await this.loadNoncombat();if(this.turnsWanted)await this.loadTurns();if(this.consumptionWanted)await this.loadConsumption();if(refreshAdvancement&&this.advancementWanted&&this.snapshot?.progression.build.mode==='CONFIGURED')await this.loadAdvancement();}
  if(epoch===this.epoch&&!this.snapshot)throw new ApiError(401,'UNAUTHORIZED');
 }
 selectInventory(item:InventoryItem|null){if(item?.id!==this.selectedInventoryItem?.id)this.inventoryAutomationOpen=false;this.equippedInspectionGeneration++;this.inventoryHistory=null;this.inventoryHistoryBusy=false;this.historyGeneration++;this.selectedInventoryItem=item?structuredClone(item):null;this.selectedInventoryGrouped=!!item&&!!this.inventoryQuery.grouped&&item.copies>1;this.selectedInventoryQuery=JSON.stringify(this.inventoryQuery);this.selectedInventoryRevision=this.snapshot?.game.run.revision??-1;this.notify();}
 private equippedInspectionGeneration=0;
 async inspectEquippedItem(itemId:string){
  const snapshot=this.snapshot,epoch=this.epoch,generation=++this.equippedInspectionGeneration;if(!snapshot)return false;
  const visible=this.inventory?.items.find(i=>i.id===itemId&&i.accessible);if(visible&&(!this.inventoryQuery.grouped||visible.copies===1)){this.selectInventory({...visible,copies:1});return true;}
  const draft=this.equipmentDraft,cached=draft?.runId===snapshot.game.run.runId&&draft.revision===snapshot.game.run.revision?draft.gear.find(g=>g.id===itemId)?.inspection:undefined;
  if(cached){this.selectInventory({...cached,copies:1});return true;}
  try{const page=await this.api.request<InventoryPage>('/api/v1/inventory?equipmentState=EQUIPPED&grouped=false&expectedRevision='+snapshot.game.run.revision);
   if(epoch!==this.epoch||generation!==this.equippedInspectionGeneration||this.snapshot?.game.run.runId!==page.runId||this.snapshot.game.run.revision!==page.revision)return false;
   const item=page.items.find(i=>i.id===itemId);if(!item)return false;
   this.selectInventory({...item,copies:1});return true;
  }catch(error){if(epoch===this.epoch){this.handleError(error);this.notify();}return false;}
 }
 async loadInventoryHistory(itemId:string,offset=0){
  const snapshot=this.snapshot;if(!snapshot||this.selectedInventoryItem?.id!==itemId)return;
  const generation=++this.historyGeneration,epoch=this.epoch,revision=snapshot.game.run.revision;
  this.inventoryHistoryBusy=true;this.notify();
  try{const page=await this.api.request<InventoryHistory>(`/api/v1/inventory/${itemId}/history?offset=${offset}&expectedRevision=${revision}`);
   if(epoch!==this.epoch||generation!==this.historyGeneration||this.selectedInventoryItem?.id!==itemId)return;
   if(page.revision!==this.snapshot?.game.run.revision||page.runId!==this.snapshot.game.run.runId)throw new ApiError(409,'STALE_REVISION');
   this.inventoryHistory=page;
  }catch(error){if(epoch===this.epoch&&generation===this.historyGeneration){this.inventoryHistory=null;this.handleError(error);if(error instanceof ApiError&&error.status===409)this.needsRefresh=true;}}
  finally{if(epoch===this.epoch&&generation===this.historyGeneration){this.inventoryHistoryBusy=false;this.notify();}}
 }
 async findEquipment(slot:string,search='',offset=0){
  const snapshot=this.snapshot,epoch=this.epoch;if(!snapshot)throw new ApiError(401,'UNAUTHORIZED');
  const query=new URLSearchParams({equipmentSlot:slot,search,offset:String(offset),grouped:'false',expectedRevision:String(snapshot.game.run.revision)});
  const page=await this.api.request<InventoryPage>('/api/v1/inventory?'+query);
  if(epoch!==this.epoch||!this.snapshot||page.runId!==this.snapshot.game.run.runId||page.revision!==this.snapshot.game.run.revision)throw new ApiError(409,'STALE_REVISION');
  return page;
 }
 async browseInventory(query:InventoryQuery=this.inventoryQuery){
  const snapshot=this.snapshot;if(!snapshot)return;
  if(this.selectedInventoryGrouped&&this.selectedInventoryQuery!==JSON.stringify(query)){this.selectedInventoryItem=null;this.selectedInventoryGrouped=false;this.inventoryHistory=null;this.inventoryHistoryBusy=false;this.historyGeneration++;}
  if(JSON.stringify(query)!==JSON.stringify(this.inventoryQuery)){this.inventorySelection.clear();this.inventorySelectionAnchor=null;}
  this.inventoryWanted=true;this.inventoryQuery=structuredClone(query);
  const generation=++this.inventoryGeneration,epoch=this.epoch,runId=snapshot.game.run.runId,revision=snapshot.game.run.revision;
  this.inventoryBusy=true;this.inventoryError=null;this.notify();
  const parameters=new URLSearchParams();for(const [key,value] of Object.entries(query))if(value!==undefined&&value!=='')parameters.set(key,String(value));parameters.set('expectedRevision',String(revision));
  try{const page=await this.api.request<InventoryPage>('/api/v1/inventory?'+parameters.toString());
   if(epoch!==this.epoch||generation!==this.inventoryGeneration||this.snapshot?.game.run.runId!==runId)return;
   if(page.runId!==runId||page.revision!==this.snapshot.game.run.revision)throw new ApiError(409,'STALE_REVISION');
   if(this.selectedInventoryRevision!==page.revision){this.selectedInventoryItem=null;this.selectedInventoryGrouped=false;this.inventoryHistory=null;this.historyGeneration++;this.inventoryHistoryBusy=false;}
   const selectionPage=JSON.stringify([page.runId,page.revision,query]);if(this.selectionPage!==selectionPage){this.inventorySelection.clear();this.inventorySelectionAnchor=null;}this.selectionPage=selectionPage;
   for(const id of this.inventorySelection)if(!page.items.some(i=>i.id===id&&i.accessible&&(!this.inventoryQuery.grouped||i.copies===1)))this.inventorySelection.delete(id);
   this.inventory=page;if(page.workspacePreferences)this.inventoryLayout=page.workspacePreferences.layout;if(page.displayPreferences&&validTileSettings(page.displayPreferences))this.tileSettings={...page.displayPreferences};
   if(this.selectedInventoryItem&&!this.selectedInventoryGrouped){const fresh=page.items.find(i=>i.id===this.selectedInventoryItem?.id);if(fresh&&(!this.inventoryQuery.grouped||fresh.copies===1))this.selectedInventoryItem=structuredClone(fresh);}
  }catch(error){if(epoch===this.epoch&&generation===this.inventoryGeneration){this.inventory=null;this.inventoryError=errorMessage(error);this.handleError(error);if(error instanceof ApiError&&error.status===409)this.needsRefresh=true;}}
  finally{if(epoch===this.epoch&&generation===this.inventoryGeneration){this.inventoryBusy=false;this.notify();}}
 }
 async refresh(){if(this.busy)return;this.busy=true;const epoch=this.epoch;this.notify();try{await this.load(epoch);if(!this.pending)this.notice={text:'Your saved game is up to date.',kind:'info'};}catch(error){this.needsRefresh=true;this.handleError(error);}finally{if(epoch===this.epoch){this.busy=false;this.notify();}}}
 async action(path:string,actionType:string,parameters:Record<string,unknown>){
  if(this.busy||this.pending||this.needsRefresh||!this.snapshot?.game.canWrite)return;
  this.reserveAction=null;this.pending={path,body:{...structuredClone(parameters),requestId:this.uuid(),actionType,expectedRevision:this.snapshot.game.run.revision}};await this.submit();
 }
 async previewAscension(){
  if(this.busy||this.pending||this.needsRefresh||!this.snapshot?.game.canWrite)return;
  this.busy=true;const epoch=this.epoch;this.notify();
  try{const preview=await this.api.request<AscensionPreview>('/api/v1/ascend/preview');
   if(epoch!==this.epoch)return;
   if(preview.runId!==this.snapshot?.game.run.runId||preview.revision!==this.snapshot.game.run.revision)throw new ApiError(409,'STALE_REVISION');
   this.ascension=preview;this.notice={text:'Review what is retained and reset before choosing a new life.',kind:'info'};
  }catch(error){this.ascension=null;this.handleError(error);}finally{if(epoch===this.epoch){this.busy=false;this.notify();}}
 }
 async confirmAscension(){
  const preview=this.ascension;if(!preview?.ready||preview.runId!==this.snapshot?.game.run.runId||preview.revision!==this.snapshot.game.run.revision)return;
  await this.action('/api/v1/ascend','ASCEND',{previewToken:preview.previewToken});
 }
 async retry(){if(!this.busy&&this.pending)await this.submit();}
 private async submit(){
  const pending=this.pending;if(!pending)return;const epoch=this.epoch;this.busy=true;this.notify();
  try{const owned=[...(this.inventory?.items??[]),...(this.selectedInventoryItem?[this.selectedInventoryItem]:[])];const result=await this.api.request<Record<string,unknown>>(pending.path,pending.body);if(epoch!==this.epoch)return;this.pending=null;if(pending.body.actionType==='NPC_CHOICE'&&typeof result.response==='string'&&typeof result.speaker==='string'){this.dm.add({id:'npc-'+String(result.conversationEventId),surface:'command',channel:'npc',speaker:result.speaker,lines:[result.response]});this.npcInterpretation=null;}this.notice={text:pending.body.actionType==='SCENE_ACTION'?String((result.scene as {consequence?:string})?.consequence??'Scene decision saved.'):pending.body.actionType==='NPC_CHOICE'?'Conversation saved.':advancementSuccess(String(pending.body.actionType),pending.body,result??{},this.advancement)??inventorySuccess(String(pending.body.actionType),pending.body,result??{},owned),kind:'success'};this.dm.scope(this.snapshot!.game.run.runId);const receipt=dmReceipt(String(pending.body.requestId),String(pending.body.actionType),result??{},this.notice.text);const receiptEntry:Parameters<DmTranscript['add']>[0]={id:'receipt-'+String(pending.body.requestId),surface:String(pending.body.actionType).includes('TACTICAL')?'battle':String(pending.body.actionType).includes('QUEST')?'quest':'command',channel:'facts',lines:[this.notice.text],receipt,prose:[routineTemplates.saved]};this.dm.add(receiptEntry);this.dmNotice=this.notice.text;await this.load(epoch,['LEVEL_UP','CHOOSE_SUBCLASS','CHOOSE_FEAT','ALLOCATE_ATTRIBUTES','ADVANCE_PROFICIENCY'].includes(String(pending.body.actionType)));if(this.snapshot){this.dm.scope(this.snapshot.game.run.runId);this.dm.add(receiptEntry);}}
  catch(error){if(epoch!==this.epoch)return;if(!this.pending){this.needsRefresh=true;this.notice={text:'Your action was saved, but the latest view could not be loaded. Refresh to reconnect.',kind:'error'};return;}if(error instanceof ApiError&&error.code==='TURN_RESERVE_CONFIRMATION_REQUIRED'){const {requestId,actionType,expectedRevision,...parameters}=pending.body;this.reserveAction={path:pending.path,type:String(actionType),parameters};}if(!(error instanceof ApiError)||!error.ambiguous)this.pending=null;this.handleError(error);if(error instanceof ApiError&&error.ambiguous&&this.pending){this.notice.text+=' The action may have completed. Retry the same action to confirm.';this.dm.add({surface:'system',channel:'warning',lines:[this.notice.text],receipt:{requestId:String(pending.body.requestId),action:String(pending.body.actionType),phase:'UNCONFIRMED',costs:[],checks:[],result:[],journal:[]}});}if(error instanceof ApiError&&error.status===409){try{await this.load(epoch);}catch{/* Keep the stale snapshot disabled until an explicit refresh succeeds. */this.snapshot=null;}}}
  finally{if(epoch===this.epoch){this.busy=false;this.notify();}}
 }
 private handleError(error:unknown){this.notice={text:errorMessage(error),kind:'error'};if(error instanceof ApiError&&error.status===401){this.dm.reset();this.dmNotice="";this.clearNpcs();this.clearScenes();clearCharacterView();this.inventorySelection.clear();this.inventorySelectionAnchor=null;this.inventoryLayout='STANDARD';this.inventoryEquipmentOpen=false;this.inventoryLoadoutsOpen=false;this.inventoryStatsOpen=false;this.tileSettings={...defaultTileSettings};this.equipmentDraft=null;this.equipmentPreview=null;this.equipmentContext=undefined;this.previewGeneration++;this.equipmentPreviewBusy=false;this.clearAdvancement(true);this.advancementWanted=false;this.clearTurns();this.turnPlanDraft=null;this.mealDraft=null;this.consumptionWanted=false;this.runningMeal=null;this.runningCombatPlan=null;this.turnsWanted=false;this.journalWanted=false;this.journalNoteDraft="";this.noncombatWanted=false;this.noncombatSelected=undefined;this.noncombatCompanion=undefined;this.runningTurnPlan=null;this.reserveAction=null;this.api.setToken('');this.snapshot=null;this.pending=null;this.inventory=null;this.inventoryHistory=null;this.historyGeneration++;this.inventoryHistoryBusy=false;this.selectedInventoryItem=null;this.selectedInventoryGrouped=false;this.inventoryWanted=false;this.inventoryBusy=false;this.inventoryGeneration++;}}
 async logout(){clearCharacterView();
  if(this.busy||this.pending)return;this.busy=true;this.notify();
  let confirmed=true;
  try{if(this.config?.authMode==='sessions')await this.api.request('/api/v1/auth/logout',{});}
  catch{confirmed=false;}
  // Forget local account data even if revocation succeeded but its reply was lost.
  ++this.epoch;this.dm.reset();this.dmNotice="";this.clearNpcs();this.clearScenes();this.inventorySelection.clear();this.inventorySelectionAnchor=null;this.inventoryLayout='STANDARD';this.inventoryEquipmentOpen=false;this.inventoryLoadoutsOpen=false;this.inventoryStatsOpen=false;this.tileSettings={...defaultTileSettings};this.equipmentDraft=null;this.equipmentPreview=null;this.equipmentContext=undefined;this.previewGeneration++;this.equipmentPreviewBusy=false;this.clearAdvancement(true);this.advancementWanted=false;this.clearTurns();this.turnPlanDraft=null;this.mealDraft=null;this.consumptionWanted=false;this.runningMeal=null;this.runningCombatPlan=null;this.turnsWanted=false;this.journalWanted=false;this.journalNoteDraft="";this.noncombatWanted=false;this.noncombatSelected=undefined;this.noncombatCompanion=undefined;this.runningTurnPlan=null;this.reserveAction=null;this.api.setToken('');this.snapshot=null;this.ascension=null;this.pending=null;this.inventory=null;this.selectedInventoryItem=null;this.selectedInventoryGrouped=false;this.inventoryHistory=null;this.inventoryWanted=false;this.inventoryBusy=false;this.inventoryHistoryBusy=false;this.inventoryError=null;this.inventoryGeneration++;this.historyGeneration++;this.inventoryQuery={sort:'NAME',direction:'ASC',grouped:true,offset:0};this.inventorySearchDraft=null;this.characterSection='overview';this.needsRefresh=false;this.busy=false;this.notice={text:confirmed?'Signed out. Your game is saved; sign in to resume.':'Signed out on this device. Server session revocation could not be confirmed.',kind:'info'};this.notify();
 }
}
