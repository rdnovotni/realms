import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient,ApiError,type Fetcher } from '../client/api.js';
import type { Snapshot } from '../client/types.js';
import { GameSession } from '../client/session.js';
import { zoneDistance,failureSummary } from '../client/views.js';
import { equipmentProblems,bindingConsequences } from '../client/equipment.js';
import type { EquipmentPlan,Gear } from '../client/types.js';
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function harness(authMode:'development'|'sessions'='development'){
 let revision=0,canWrite=true,post:(path:string,init:RequestInit)=>Promise<Response>=async(path)=>json(path.endsWith('/login')?{token:'private-token'}:{}),readsFail=false;
 const calls:{path:string;init:RequestInit}[]=[];
 const fetcher:Fetcher=async(path,init={})=>{calls.push({path,init});if(init.method==='POST')return post(path,init);
  if(path.endsWith('/config'))return json({protocolVersion:1,authMode});
  if(readsFail)return json({error:'TECHNICAL_FAILURE'},503);
  if(path.endsWith('/state'))return json({protocolVersion:1,run:{runId:'run',turns:20,revision,status:'ACTIVE',mode:'STANDARD'},canWrite,activeEncounter:null,latestEncounter:null,adventures:[],inventory:[],hasMoreItems:false,hasMoreAdventures:false});
  if(path.endsWith('/options'))return json({classes:[],rules:[]});
  if(path==='/api/v1/progression')return json({revision,level:1,xp:'0',build:{mode:'CONFIGURED'},readiness:null});
  throw Error(`Unexpected request ${path}`);
 };
 const session=new GameSession(new ApiClient(fetcher),()=> '11111111-1111-4111-8111-111111111111');
 return {session,calls,setRevision:(n:number)=>{revision=n;},setWrite:(value:boolean)=>{canWrite=value;},setPost:(fn:typeof post)=>{post=fn;},setReadFailure:(value:boolean)=>{readsFail=value;}};
}
async function connect(h:ReturnType<typeof harness>){await h.session.initialize();await h.session.connect({token:'private-token'});assert.ok(h.session.snapshot);}
test('transport confines credentials to same-origin headers and normalizes malformed and unreachable responses',async()=>{
 const calls:RequestInit[]=[];const api=new ApiClient(async(_path,init)=>{calls.push(init!);return json({ok:true});});api.setToken('secret');await api.request('/api/v1/state');assert.equal((calls[0]!.headers as Record<string,string>).Authorization,'Bearer secret');assert.equal(calls[0]!.credentials,'omit');assert.equal(calls[0]!.cache,'no-store');assert.equal(calls[0]!.redirect,'error');await assert.rejects(api.request('https://other.example/api/v1/state'));
 const broken=new ApiClient(async()=>new Response('<html>not json</html>'));await assert.rejects(broken.request('/api/v1/state'),error=>error instanceof ApiError&&error.ambiguous);
});
test('a lost response retains the exact action envelope and blocks a second spend until confirmed retry',async()=>{
 const h=harness();await connect(h);let count=0;h.setPost(async()=>{count++;h.setRevision(1);if(count===1)throw Error('response lost after commit');return json({replayed:true});});const params={definitionId:'encounter.road'};await h.session.action('/api/v1/tactical/start','START_TACTICAL',params);params.definitionId='changed';assert.ok(h.session.pending);await h.session.action('/api/v1/tactical/start','START_TACTICAL',params);assert.equal(count,1);await h.session.refresh();assert.ok(h.session.pending);await h.session.retry();assert.equal(h.session.pending,null);assert.equal(h.session.snapshot?.game.run.revision,1);const posts=h.calls.filter(c=>c.init.method==='POST');assert.equal(posts.length,2);assert.equal(posts[0]!.init.body,posts[1]!.init.body);assert.equal(JSON.parse(posts[1]!.init.body as string).definitionId,'encounter.road');assert.equal(JSON.parse(posts[1]!.init.body as string).expectedRevision,0);
});
test('a confirmed action followed by a failed read cannot be resent or followed by a stale action',async()=>{
 const h=harness();await connect(h);h.setPost(async()=>{h.setRevision(1);h.setReadFailure(true);return json({revision:1});});await h.session.action('/api/v1/tactical/start','START_TACTICAL',{});assert.equal(h.session.pending,null);assert.equal(h.session.needsRefresh,true);await h.session.action('/api/v1/tactical/start','START_TACTICAL',{});assert.equal(h.calls.filter(c=>c.init.method==='POST').length,1);h.setReadFailure(false);await h.session.refresh();assert.equal(h.session.needsRefresh,false);assert.equal(h.session.snapshot?.game.run.revision,1);
});
test('stale writes resync without retrying and view-only sessions cannot submit actions',async()=>{
 const h=harness();await connect(h);h.setPost(async()=>{h.setRevision(2);return json({error:'STALE_REVISION'},409);});await h.session.action('/api/v1/tactical/start','START_TACTICAL',{});assert.equal(h.session.pending,null);assert.equal(h.session.snapshot?.game.run.revision,2);assert.equal(h.calls.filter(c=>c.init.method==='POST').length,1);h.setWrite(false);await h.session.refresh();await h.session.action('/api/v1/tactical/start','START_TACTICAL',{});assert.equal(h.calls.filter(c=>c.init.method==='POST').length,1);
});
test('sign out forgets the session and disconnect/reconnect obtains current saved state',async()=>{
 const h=harness();await connect(h);await h.session.logout();assert.equal(h.session.snapshot,null);assert.equal(h.session.pending,null);h.setRevision(3);await h.session.connect({token:'new-token'});assert.equal((h.session.snapshot as Snapshot|null)?.game.run.revision,3);assert.equal((h.calls.at(-1)!.init.headers as Record<string,string>).Authorization,'Bearer new-token');
});
test('battlefield paths handle cycles and disconnected zones; commitment preview discloses bounded failure costs',()=>{
 assert.equal(zoneDistance([['a','b'],['b','c'],['c','a']],'a','c'),1);assert.equal(zoneDistance([['a','b']],'a','elsewhere'),Infinity);assert.equal(zoneDistance([],'a','a'),0);const text=failureSummary({destination:'CAPTURED',turnCost:2,recoveryHealth:5,allowSurrender:true,goldLossBps:100,goldLossCap:9,durabilityWearBps:1000,injuryEffectId:'effect.injury'});for(const value of ['Captured','2 recovery Turns','5 health','1%','capped at 9','10%','Injury','Surrender'])assert.ok(text.includes(value),value);
});


test('default transport calls native fetch with its required global receiver',async()=>{
 const previous=globalThis.fetch;try{globalThis.fetch=async function(this:typeof globalThis){assert.equal(this,globalThis);return json({connected:true});};assert.deepEqual(await new ApiClient().request('/api/v1/client/config',undefined,false),{connected:true});}finally{globalThis.fetch=previous;}
});

test('sign out forgets credentials and account data after an expired session or lost revocation response',async()=>{
 for(const fail of [async()=>json({error:'UNAUTHORIZED'},401),async()=>{throw Error('response lost after revocation');}]){const h=harness('sessions');await connect(h);h.setPost(fail);await h.session.logout();assert.equal(h.session.snapshot,null);assert.equal(h.session.pending,null);assert.equal(h.session.busy,false);assert.match(h.session.notice.text,/Signed out on this device/);h.setReadFailure(true);await h.session.refresh();assert.equal((h.calls.at(-1)!.init.headers as Record<string,string>).Authorization,'Bearer ');assert.equal(h.session.snapshot,null);}
});

const equipmentGear:Gear[]=[{id:'sword',name:'Sword',binding:'TRADEABLE',slots:['MAIN_HAND'],hands:1,minimumLevel:1,bindingPolicy:'ACCOUNT_ON_ACTIVE_EQUIP',eligible:true,proficiencyMet:true,manualLocked:false,protectedLoadouts:[],condition:null,maximumCondition:null},{id:'shield',name:'Shield',binding:'TRADEABLE',slots:['OFF_HAND'],hands:1,minimumLevel:1,bindingPolicy:'PRESERVE',eligible:true,proficiencyMet:true,manualLocked:false,protectedLoadouts:[],condition:null,maximumCondition:null},{id:'greatblade',name:'Greatblade',binding:'TRADEABLE',slots:['MAIN_HAND'],hands:2,minimumLevel:1,bindingPolicy:'PRESERVE',eligible:true,proficiencyMet:true,manualLocked:false,protectedLoadouts:[],condition:null,maximumCondition:null}];
test('preparation accepts shared weapon identities across sets and catches conflicts without changing the draft',()=>{
 const plan:EquipmentPlan={activeSet:'A',slots:[{set:'A',slot:'MAIN_HAND',itemId:'sword'},{set:'B',slot:'MAIN_HAND',itemId:'sword'}]},before=structuredClone(plan);assert.deepEqual(equipmentProblems(plan,equipmentGear,1),[]);assert.deepEqual(plan,before);
 const conflict:EquipmentPlan={activeSet:'B',slots:[{set:'B',slot:'MAIN_HAND',itemId:'greatblade'},{set:'B',slot:'OFF_HAND',itemId:'shield'}]};assert.match(equipmentProblems(conflict,equipmentGear,1).join(' '),/clear the off hand/);
 assert.match(equipmentProblems({activeSet:'A',slots:[{set:'A',slot:'MAIN_HAND',itemId:'missing'}]},equipmentGear,1).join(' '),/not in the available carried gear/);
 assert.match(equipmentProblems(plan,equipmentGear.map(g=>({...g,proficiencyMet:false})),1).join(' '),/requirements/);
});
test('binding preview distinguishes inactive prepared gear from active or already bound gear',()=>{
 const plan:EquipmentPlan={activeSet:'A',slots:[{set:'B',slot:'MAIN_HAND',itemId:'sword'}]};assert.deepEqual(bindingConsequences(plan,equipmentGear),[]);assert.deepEqual(bindingConsequences({...plan,activeSet:'B'},equipmentGear),['Sword']);assert.deepEqual(bindingConsequences({...plan,activeSet:'B'},equipmentGear.map(g=>({...g,binding:'ACCOUNT_BOUND'}))),[]);
});
