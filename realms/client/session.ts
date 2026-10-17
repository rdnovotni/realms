import { inventorySuccess } from './inventory-usability.js';
import { defaultTileSettings,validTileSettings,type TileSettings } from './item-tiles.js';
import { ApiClient,ApiError,errorMessage } from './api.js';
import type { Config,GameView,Progression,BuildOptions,Tactical,Snapshot,Notice,AscensionPreview,InventoryPage,InventoryQuery,InventoryItem,InventoryHistory,EquipmentPlan,Gear,EquipmentPreview } from './types.js';
const equipmentKey=(p:EquipmentPlan)=>JSON.stringify({activeSet:p.activeSet,slots:[...p.slots].sort((a,b)=>(a.set+a.slot).localeCompare(b.set+b.slot))});
export class GameSession {
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
  this.equipmentDraft.plan=structuredClone(plan);for(const item of gear)if(!this.equipmentDraft.gear.some(g=>g.id===item.id))this.equipmentDraft.gear.push(structuredClone(item));else if(item.inspection)this.equipmentDraft.gear.find(g=>g.id===item.id)!.inspection=structuredClone(item.inspection);
  this.equipmentPreview=null;this.notify();void this.previewEquipment();
 }
 revertEquipment(){this.equipmentDraft=null;this.equipmentPreview=null;this.notify();void this.previewEquipment();}
 async applyEquipment(){const d=this.equipmentDraft;if(!d||d.runId!==this.snapshot?.game.run.runId||d.revision!==this.snapshot.game.run.revision)return;await this.action('/api/v1/equipment','SET_EQUIPMENT',d.plan);}
 async previewEquipment(contextId=this.equipmentContext){
  const s=this.snapshot;if(!s)return;const epoch=this.epoch,generation=++this.previewGeneration,plan=structuredClone(this.equipmentState());this.equipmentContext=contextId;
  this.equipmentPreviewBusy=true;this.equipmentPreviewError=null;this.notify();
  const q=new URLSearchParams({expectedRevision:String(s.game.run.revision)});if(plan)q.set('plan',JSON.stringify(plan));if(contextId)q.set('contextId',contextId);
  try{const result=await this.api.request<EquipmentPreview>('/api/v1/equipment/preview?'+q);if(epoch!==this.epoch||generation!==this.previewGeneration)return;if(result.revision!==this.snapshot?.game.run.revision||result.runId!==this.snapshot.game.run.runId)throw new ApiError(409,'STALE_REVISION');this.equipmentPreview=result;}
  catch(error){if(epoch===this.epoch&&generation===this.previewGeneration){this.equipmentPreview=null;this.equipmentPreviewError=errorMessage(error);}}
  finally{if(epoch===this.epoch&&generation===this.previewGeneration){this.equipmentPreviewBusy=false;this.notify();}}
 }
 characterSection:'overview'|'progression'='overview';
 setCharacterSection(section:'overview'|'progression'){this.characterSection=section;this.notify();}
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
 private notify(){for(const listener of this.listeners)listener();}
 async initialize(){try{this.config=await this.api.request<Config>('/api/v1/client/config',undefined,false);}catch(error){this.notice={text:errorMessage(error),kind:'error'};}this.notify();}
 async connect(credentials:{handle?:string;password?:string;token?:string}){
  if(this.busy)return;this.inventorySelection.clear();this.inventorySelectionAnchor=null;this.inventoryLayout='STANDARD';this.inventoryEquipmentOpen=false;this.inventoryLoadoutsOpen=false;this.inventoryStatsOpen=false;this.tileSettings={...defaultTileSettings};this.equipmentDraft=null;this.equipmentPreview=null;this.equipmentContext=undefined;this.previewGeneration++;this.inventory=null;this.inventoryBusy=false;this.inventoryError=null;this.inventoryHistory=null;this.historyGeneration++;this.inventoryHistoryBusy=false;this.selectedInventoryItem=null;this.selectedInventoryGrouped=false;this.inventoryWanted=false;this.inventoryQuery={sort:'NAME',direction:'ASC',grouped:true,offset:0};this.inventoryGeneration++;this.busy=true;const epoch=++this.epoch;this.notify();
  try{let token=credentials.token;if(this.config?.authMode==='sessions'){const result=await this.api.request<{token:string}>('/api/v1/auth/login',{handle:credentials.handle,password:credentials.password,deviceLabel:'Follybound browser'},false);token=result.token;}
   if(epoch!==this.epoch)return;if(!token)throw new ApiError(401,'UNAUTHORIZED');this.api.setToken(token);await this.load(epoch);this.notice={text:'Connected. Your progress is saved by the server.',kind:'success'};
  }catch(error){if(epoch===this.epoch){this.api.setToken('');this.snapshot=null;this.notice={text:errorMessage(error),kind:'error'};}}
  finally{if(epoch===this.epoch){this.busy=false;this.notify();}}
 }
 private async load(epoch:number){
  this.ascension=null;this.inventory=null;this.inventoryError=null;
  const game=await this.api.request<GameView>('/api/v1/client/state');if(game.protocolVersion!==1)throw new ApiError(503,'UNSUPPORTED_CLIENT');
  const [progression,options]=await Promise.all([this.api.request<Progression>('/api/v1/progression'),this.api.request<BuildOptions>('/api/v1/progression/options')]);
  const id=game.activeEncounter?.kind==='TACTICAL'?game.activeEncounter.id:!game.activeEncounter?game.latestEncounter?.id:null;
  const battle=id?await this.api.request<Tactical>(`/api/v1/tactical/${id}`):null;
  // These independent projections may cross another window's action. Refuse a
  // mixed revision and let the player explicitly refresh, never write from it.
  if(progression.revision!==game.run.revision||(battle&&battle.revision!==game.run.revision))throw new ApiError(409,'STALE_REVISION');
  if(epoch===this.epoch){if(this.snapshot?.game.run.runId!==game.run.runId){this.equipmentContext=undefined;this.inventorySearchDraft=null;this.characterSection='overview';}this.equipmentPreviewError=null;this.snapshot={game,progression,options,battle};this.needsRefresh=false;
   if(this.equipmentDraft&&(this.equipmentDraft.runId!==game.run.runId||game.equipment&&equipmentKey(this.equipmentDraft.plan)===equipmentKey(game.equipment)))this.equipmentDraft=null;
   this.equipmentPreview=null;this.previewGeneration++;this.equipmentPreviewBusy=false;if(this.inventoryWanted)await this.browseInventory(this.inventoryQuery);}
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
  this.pending={path,body:{...structuredClone(parameters),requestId:this.uuid(),actionType,expectedRevision:this.snapshot.game.run.revision}};await this.submit();
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
  try{const owned=[...(this.inventory?.items??[]),...(this.selectedInventoryItem?[this.selectedInventoryItem]:[])];const result=await this.api.request<Record<string,unknown>>(pending.path,pending.body);if(epoch!==this.epoch)return;this.pending=null;this.notice={text:inventorySuccess(String(pending.body.actionType),pending.body,result??{},owned),kind:'success'};await this.load(epoch);}
  catch(error){if(epoch!==this.epoch)return;if(!this.pending){this.needsRefresh=true;this.notice={text:'Your action was saved, but the latest view could not be loaded. Refresh to reconnect.',kind:'error'};return;}if(!(error instanceof ApiError)||!error.ambiguous)this.pending=null;this.handleError(error);if(error instanceof ApiError&&error.ambiguous&&this.pending)this.notice.text+=' The action may have completed. Retry the same action to confirm.';if(error instanceof ApiError&&error.status===409){try{await this.load(epoch);}catch{/* Keep the stale snapshot disabled until an explicit refresh succeeds. */this.snapshot=null;}}}
  finally{if(epoch===this.epoch){this.busy=false;this.notify();}}
 }
 private handleError(error:unknown){this.notice={text:errorMessage(error),kind:'error'};if(error instanceof ApiError&&error.status===401){this.inventorySelection.clear();this.inventorySelectionAnchor=null;this.inventoryLayout='STANDARD';this.inventoryEquipmentOpen=false;this.inventoryLoadoutsOpen=false;this.inventoryStatsOpen=false;this.tileSettings={...defaultTileSettings};this.equipmentDraft=null;this.equipmentPreview=null;this.equipmentContext=undefined;this.previewGeneration++;this.equipmentPreviewBusy=false;this.api.setToken('');this.snapshot=null;this.pending=null;this.inventory=null;this.inventoryHistory=null;this.historyGeneration++;this.inventoryHistoryBusy=false;this.selectedInventoryItem=null;this.selectedInventoryGrouped=false;this.inventoryWanted=false;this.inventoryBusy=false;this.inventoryGeneration++;}}
 async logout(){
  if(this.busy||this.pending)return;this.busy=true;this.notify();
  let confirmed=true;
  try{if(this.config?.authMode==='sessions')await this.api.request('/api/v1/auth/logout',{});}
  catch{confirmed=false;}
  // Forget local account data even if revocation succeeded but its reply was lost.
  ++this.epoch;this.inventorySelection.clear();this.inventorySelectionAnchor=null;this.inventoryLayout='STANDARD';this.inventoryEquipmentOpen=false;this.inventoryLoadoutsOpen=false;this.inventoryStatsOpen=false;this.tileSettings={...defaultTileSettings};this.equipmentDraft=null;this.equipmentPreview=null;this.equipmentContext=undefined;this.previewGeneration++;this.equipmentPreviewBusy=false;this.api.setToken('');this.snapshot=null;this.ascension=null;this.pending=null;this.inventory=null;this.selectedInventoryItem=null;this.selectedInventoryGrouped=false;this.inventoryHistory=null;this.inventoryWanted=false;this.inventoryBusy=false;this.inventoryHistoryBusy=false;this.inventoryError=null;this.inventoryGeneration++;this.historyGeneration++;this.inventoryQuery={sort:'NAME',direction:'ASC',grouped:true,offset:0};this.inventorySearchDraft=null;this.characterSection='overview';this.needsRefresh=false;this.busy=false;this.notice={text:confirmed?'Signed out. Your game is saved; sign in to resume.':'Signed out on this device. Server session revocation could not be confirmed.',kind:'info'};this.notify();
 }
}
