export class ApiError extends Error {
 constructor(readonly status:number,readonly code:string,readonly traceId?:string){super(code);}
 get ambiguous(){return this.status===0||this.status>=500;}
}
export type Fetcher=(input:string,init?:RequestInit)=>Promise<Response>;
/** Tokens stay in memory; all requests are same-origin and never enter a URL. */
export class ApiClient {
 private token='';
 constructor(private readonly fetcher:Fetcher=(path,init)=>globalThis.fetch(path,init)){ }
 setToken(token:string){this.token=token;}
 async request<T>(path:string,body?:unknown,authenticated=true):Promise<T>{
  if(!path.startsWith('/api/v1/')||path.split('?')[0]!.includes('..'))throw new Error('Unsupported API path');
  let response:Response;
  try{response=await this.fetcher(path,{method:body===undefined?'GET':'POST',cache:'no-store',credentials:'omit',redirect:'error',headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'}),...(authenticated?{Authorization:`Bearer ${this.token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});}
  catch{throw new ApiError(0,'CONNECTION_LOST');}
  let value:unknown;try{value=await response.json();}catch{throw new ApiError(response.ok?503:response.status,'INVALID_RESPONSE');}
  if(!response.ok){const error=value as {error?:string;traceId?:string};throw new ApiError(response.status,error?.error??'REQUEST_FAILED',error?.traceId);}
  return value as T;
 }
}
export function errorMessage(error:unknown){
 if(!(error instanceof ApiError))return 'Something went wrong. Refresh to reconnect.';
 const messages:Record<string,string>={NO_REST_NEEDED:'Your retained health and mana are already full. No Turn or charge was spent.',REST_HEALTH_UNAVAILABLE:'Finish your first encounter before using recovery rests.',INVALID_TURN_REST:'This rest is not configured correctly.',TURN_RESERVE_CONFIRMATION_REQUIRED:'This action would use protected Turns. Review the reserve confirmation before continuing.',TURN_AUTOMATION_BUDGET_REQUIRED:'Repeated actions need an explicit Turn budget.',DAILY_CHARGES_EMPTY:'This daily source has no charges left. Check its next refresh in the Turns planner.',ROLLOVER_PENDING:'Your rollover is waiting. Apply it in the Turns planner before using a daily allowance.',DAILY_MANUAL_USE_REQUIRED:'Use this daily source yourself once before enabling automatic collection.',ATTRIBUTE_CAPACITY_RESERVED:'Nothing was allocated. This distribution would leave too little capacity for future authored milestones. Try another allowed attribute.',ATTRIBUTE_CAP_REACHED:'Nothing was allocated. An attribute would exceed its authored maximum.',INVALID_ATTRIBUTE_BUDGET:'Allocate exactly the full authored point budget using allowed attributes.',ATTRIBUTE_MILESTONE_USED:'This attribute milestone has already been spent. Review the refreshed choices.',SKILL_RANK_CAP_REACHED:'This skill has reached its authored maximum rank.',PROFICIENCY_MILESTONE_USED:'This proficiency milestone has already been spent. Review the refreshed choices.',BULK_ITEM_PROTECTED:'Nothing moved. The selection includes equipped, locked or saved-loadout protected items. Remove those items from the selection and try again.',INVALID_INVENTORY_SELECTION:'Choose up to 48 individual items on this page. Expand grouped copies first.',INVALID_INSPECTION_TOKEN:'This item changed. Refresh its details before marking it inspected.',INVALID_TILE_PREFERENCES:'Use whole percentages with worn below healthy, up to 100%.',BINDING_RESTRICTED:'Nothing moved. An item’s binding prevents that destination.',MATERIAL_VAULT_ONLY:'Nothing moved. The Material Vault accepts materials only.',ASCENSION_PREVIEW_CHANGED:'Your retained state changed. Review a fresh preview before Ascending.',EXPLICIT_ASCENSION_REQUIRED:'Ascension needs your explicit confirmation.',ASCENSION_NOT_READY:'Complete this campaign before choosing a new life.',CONNECTION_LOST:'Connection unavailable. Reconnect to load your saved game.',TECHNICAL_FAILURE:'The server could not confirm this action. Retry to confirm its saved result.',INVALID_CREDENTIALS:'The account name or password was not accepted.',UNAUTHORIZED:'Your session has ended. Sign in again to resume.',SESSION_NOT_AUTHORIZED:'This session does not allow that action. Sign in with play access.',STALE_REVISION:'Your game changed in another window. The latest state has been loaded.',INSUFFICIENT_TURNS:'You do not have enough Turns.',NO_ACTIVE_RUN:'This account does not have an active character yet.',BUILD_NOT_CONFIGURED:'Choose your starting class before beginning this adventure.',INSTANCE_STILL_ACTIVE:'Finish your current encounter before changing your build.',AUTH_RATE_LIMITED:'Too many sign-in attempts. Please wait before trying again.'};
 return (messages[error.code]??'That action is unavailable in the current game state. Refresh and try again.')+(error.traceId?` Reference: ${error.traceId}`:'');
}
