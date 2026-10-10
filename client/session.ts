import { ApiClient,ApiError,errorMessage } from './api.js';
import type { Config,GameView,Progression,BuildOptions,Tactical,Snapshot,Notice } from './types.js';
export class GameSession {
 snapshot:Snapshot|null=null;
 busy=false;
 needsRefresh=false;
 pending:{path:string;body:Record<string,unknown>}|null=null;
 notice:Notice={text:'Your journey begins with a character.',kind:'info'};
 config:Config|null=null;
 private epoch=0;
 private listeners=new Set<()=>void>();
 constructor(private readonly api=new ApiClient(),private readonly uuid:()=>string=()=>crypto.randomUUID()){}
 subscribe(listener:()=>void){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
 private notify(){for(const listener of this.listeners)listener();}
 async initialize(){try{this.config=await this.api.request<Config>('/api/v1/client/config',undefined,false);}catch(error){this.notice={text:errorMessage(error),kind:'error'};}this.notify();}
 async connect(credentials:{handle?:string;password?:string;token?:string}){
  if(this.busy)return;this.busy=true;const epoch=++this.epoch;this.notify();
  try{let token=credentials.token;if(this.config?.authMode==='sessions'){const result=await this.api.request<{token:string}>('/api/v1/auth/login',{handle:credentials.handle,password:credentials.password,deviceLabel:'Realms browser'},false);token=result.token;}
   if(epoch!==this.epoch)return;if(!token)throw new ApiError(401,'UNAUTHORIZED');this.api.setToken(token);await this.load(epoch);this.notice={text:'Connected. Your progress is saved by the server.',kind:'success'};
  }catch(error){if(epoch===this.epoch){this.api.setToken('');this.snapshot=null;this.notice={text:errorMessage(error),kind:'error'};}}
  finally{if(epoch===this.epoch){this.busy=false;this.notify();}}
 }
 private async load(epoch:number){
  const game=await this.api.request<GameView>('/api/v1/client/state');if(game.protocolVersion!==1)throw new ApiError(503,'UNSUPPORTED_CLIENT');
  const [progression,options]=await Promise.all([this.api.request<Progression>('/api/v1/progression'),this.api.request<BuildOptions>('/api/v1/progression/options')]);
  const id=game.activeEncounter?.kind==='TACTICAL'?game.activeEncounter.id:!game.activeEncounter?game.latestEncounter?.id:null;
  const battle=id?await this.api.request<Tactical>(`/api/v1/tactical/${id}`):null;
  // These independent projections may cross another window's action. Refuse a
  // mixed revision and let the player explicitly refresh, never write from it.
  if(progression.revision!==game.run.revision||(battle&&battle.revision!==game.run.revision))throw new ApiError(409,'STALE_REVISION');
  if(epoch===this.epoch){this.snapshot={game,progression,options,battle};this.needsRefresh=false;}
 }
 async refresh(){if(this.busy)return;this.busy=true;const epoch=this.epoch;this.notify();try{await this.load(epoch);if(!this.pending)this.notice={text:'Your saved game is up to date.',kind:'info'};}catch(error){this.needsRefresh=true;this.handleError(error);}finally{if(epoch===this.epoch){this.busy=false;this.notify();}}}
 async action(path:string,actionType:string,parameters:Record<string,unknown>){
  if(this.busy||this.pending||this.needsRefresh||!this.snapshot?.game.canWrite)return;
  this.pending={path,body:{...structuredClone(parameters),requestId:this.uuid(),actionType,expectedRevision:this.snapshot.game.run.revision}};await this.submit();
 }
 async retry(){if(!this.busy&&this.pending)await this.submit();}
 private async submit(){
  const pending=this.pending;if(!pending)return;const epoch=this.epoch;this.busy=true;this.notify();
  try{await this.api.request(pending.path,pending.body);if(epoch!==this.epoch)return;this.pending=null;this.notice={text:'Action saved.',kind:'success'};await this.load(epoch);}
  catch(error){if(epoch!==this.epoch)return;if(!this.pending){this.needsRefresh=true;this.notice={text:'Your action was saved, but the latest view could not be loaded. Refresh to reconnect.',kind:'error'};return;}if(!(error instanceof ApiError)||!error.ambiguous)this.pending=null;this.handleError(error);if(error instanceof ApiError&&error.ambiguous&&this.pending)this.notice.text+=' The action may have completed. Retry the same action to confirm.';if(error instanceof ApiError&&error.status===409){try{await this.load(epoch);}catch{/* Keep the stale snapshot disabled until an explicit refresh succeeds. */this.snapshot=null;}}}
  finally{if(epoch===this.epoch){this.busy=false;this.notify();}}
 }
 private handleError(error:unknown){this.notice={text:errorMessage(error),kind:'error'};if(error instanceof ApiError&&error.status===401){this.api.setToken('');this.snapshot=null;this.pending=null;}}
 async logout(){
  if(this.busy||this.pending)return;this.busy=true;this.notify();
  let confirmed=true;
  try{if(this.config?.authMode==='sessions')await this.api.request('/api/v1/auth/logout',{});}
  catch{confirmed=false;}
  // Forget local account data even if revocation succeeded but its reply was lost.
  ++this.epoch;this.api.setToken('');this.snapshot=null;this.pending=null;this.needsRefresh=false;this.busy=false;this.notice={text:confirmed?'Signed out. Your game is saved; sign in to resume.':'Signed out on this device. Server session revocation could not be confirmed.',kind:'info'};this.notify();
 }
}
