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
  if(!path.startsWith('/api/v1/')||path.includes('..'))throw new Error('Unsupported API path');
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
 const messages:Record<string,string>={CONNECTION_LOST:'Connection unavailable. Reconnect to load your saved game.',TECHNICAL_FAILURE:'The server could not confirm this action. Retry to confirm its saved result.',INVALID_CREDENTIALS:'The account name or password was not accepted.',UNAUTHORIZED:'Your session has ended. Sign in again to resume.',SESSION_NOT_AUTHORIZED:'This session does not allow that action. Sign in with play access.',STALE_REVISION:'Your game changed in another window. The latest state has been loaded.',INSUFFICIENT_TURNS:'You do not have enough Turns.',NO_ACTIVE_RUN:'This account does not have an active character yet.',BUILD_NOT_CONFIGURED:'Choose your starting class before beginning this adventure.',INSTANCE_STILL_ACTIVE:'Finish your current encounter before changing your build.',AUTH_RATE_LIMITED:'Too many sign-in attempts. Please wait before trying again.'};
 return (messages[error.code]??'That action is unavailable in the current game state. Refresh and try again.')+(error.traceId?` Reference: ${error.traceId}`:'');
}
