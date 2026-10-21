import { turnFixture } from '../client/dev/turn-fixture.js';
import { iconCatalog } from '../client/icons.js';
import { knownSpecializations,abilityCostText } from '../client/character-presentation-model.js';
import { equipmentSlotPresentation } from '../client/equipment-presentation.js';
import { adventureAvailability,combatTurn,canOpenJourneyRecord } from '../client/campaign-model.js';
import { shellChapter,shellNavigationPage,shellNoticeLabel,shellRenderedScreen } from '../client/shell-model.js';
import { itemStatuses,groupedInspectionFacts } from '../client/item-tiles.js';
import { itemArtKey } from '../client/item-art.js';
import { equipmentDrag,removeEquipmentAssignment } from '../client/equipment-drag.js';
import { itemCondition,itemWeight,itemTileDetails,validTileSettings,defaultTileSettings } from '../client/item-tiles.js';
import { equipmentSpec } from '../src/domains/equipment-content.js';
import { paperdollPositions,paperdollCandidate } from '../client/paperdoll.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerClient } from '../src/client-assets.js';
import { ApiClient,ApiError,type Fetcher } from '../client/api.js';
import type { Snapshot } from '../client/types.js';
import { GameSession } from '../client/session.js';
import { zoneDistance,failureSummary } from '../client/views.js';
import { equipmentProblems,bindingConsequences } from '../client/equipment.js';
import type { EquipmentPlan,Gear } from '../client/types.js';
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
test('public preview marks account access unavailable and serves only approved same-origin artwork and styles',async()=>{
 const app=Fastify();registerClient(app,{mode:'sessions',throttleKey:'must-never-be-public'},{previewOnly:true});
 try{
  const config=await app.inject({url:'/api/v1/client/config'});assert.deepEqual(config.json(),{protocolVersion:1,authMode:'sessions',previewOnly:true});assert.ok(!config.body.includes('must-never-be-public'));
  const art=await app.inject({url:'/assets/realms-tavern.webp'});assert.equal(art.statusCode,200);assert.match(art.headers['content-type']!,/^image\/webp/);assert.equal(art.rawPayload.subarray(0,4).toString(),'RIFF');assert.match(art.headers['content-security-policy']!,/img-src 'self'/);assert.equal(art.headers['cache-control'],'no-store');
  const css=await app.inject({url:'/assets/welcome.css'});assert.equal(css.statusCode,200);assert.match(css.headers['content-type']!,/^text\/css/);
  for(const name of ['interactions.css']){const style=await app.inject({url:'/assets/'+name});assert.equal(style.statusCode,200);assert.match(style.body,/prefers-reduced-motion/);assert.match(style.body,/forced-colors/);}
  for(const path of ['/dev/visual','/dev/fixture/pack','/dev/manifest','/assets/visual-reference.js','/assets/dev/visual-reference.js'])assert.equal((await app.inject({url:path})).statusCode,404);
  const characterStyle=await app.inject({url:'/assets/character-folio.css'});assert.equal(characterStyle.statusCode,200);assert.match(characterStyle.body,/\.character-sheet/);
  const shellStyle=await app.inject({url:'/assets/shell.css'});assert.equal(shellStyle.statusCode,200);assert.match(shellStyle.headers['content-type']!,/^text\/css/);assert.match(shellStyle.body,/\.game-shell/);
  const ledger=await app.inject({url:'/assets/inventory-folio.css'});assert.equal(ledger.statusCode,200);assert.match(ledger.headers['content-type']!,/^text\/css/);assert.match(ledger.body,/\.paperdoll-slot/);
  const campaign=await app.inject({url:'/assets/campaign-folio.css'});assert.equal(campaign.statusCode,200);assert.match(campaign.headers['content-type']!,/^text\/css/);assert.match(campaign.body,/\.battlefield/);
  const theme=await app.inject({url:'/assets/folio.css'});assert.equal(theme.statusCode,200);assert.match(theme.headers['content-type']!,/^text\/css/);assert.match(theme.body,/--folio-parchment:/);assert.match(theme.headers['content-security-policy']!,/style-src 'self'/);
  const grain=await app.inject({url:'/assets/folio-grain.svg'});assert.equal(grain.statusCode,200);assert.match(grain.headers['content-type']!,/^image\/svg\+xml/);assert.ok(grain.rawPayload.length<1024);assert.doesNotMatch(grain.body,/<script|https?:\/\/(?!www.w3.org)/);
  const shell=await app.inject({url:'/'});assert.match(shell.body,/href="\/assets\/folio.css"/);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{handle:'preview',password:'example'}})).statusCode,404);
  assert.equal((await app.inject({url:'/assets/README.md'})).statusCode,404);
 }finally{await app.close();}
 const game=Fastify();registerClient(game,{mode:'sessions',throttleKey:'must-never-be-public'});
 try{assert.deepEqual((await game.inject({url:'/api/v1/client/config'})).json(),{protocolVersion:1,authMode:'sessions'});}finally{await game.close();}
});
test('public page links support direct loads while unknown routes stay unavailable',async()=>{
 const app=Fastify();registerClient(app,{mode:'sessions',throttleKey:'private'},{previewOnly:true});
 try{
  const home=await app.inject({url:'/'});
  for(const route of ['/about','/announcements','/changelog','/guide','/community','/newsletter','/privacy','/monetization','/contact']){
   const page=await app.inject({url:route});assert.equal(page.statusCode,200,route);assert.equal(page.body,home.body);assert.match(page.headers['content-type']!,/^text\/html/);assert.equal(page.headers['content-security-policy'],home.headers['content-security-policy']);
  }
  assert.equal((await app.inject({url:'/not-a-page'})).statusCode,404);
  assert.equal((await app.inject({url:'/dev/folio'})).statusCode,404,'design reference must never be a game route');
 }finally{await app.close();}
});
function harness(authMode:'development'|'sessions'='development'){
 let turnsRead:((path:string)=>Promise<Response>)|null=null;
 let bookRead:((path:string)=>Promise<Response>)|null=null;
 let advancementRead:((path:string)=>Promise<Response>)|null=null;
 let inventoryRead:(path:string)=>Promise<Response>=async()=>json({revision,runId,items:[],total:0,offset:0,pageSize:48,containers:[],hasMoreContainers:false,preferences:{autoStoreMaterials:false,autoOverflow:false}});
 let revision=0,canWrite=true,runId='run',status='ACTIVE',post:(path:string,init:RequestInit)=>Promise<Response>=async(path)=>json(path.endsWith('/login')?{token:'private-token'}:{}),readsFail=false;
 const calls:{path:string;init:RequestInit}[]=[];
 const fetcher:Fetcher=async(path,init={})=>{calls.push({path,init});if(init.method==='POST')return post(path,init);
  if(turnsRead&&path.startsWith('/api/v1/turns?'))return turnsRead(path);
  if(bookRead&&(path.startsWith('/api/v1/character/')||path.startsWith('/api/v1/equipment/preview')))return bookRead(path);
  if(advancementRead&&path.startsWith('/api/v1/progression/'))return advancementRead(path);
  if(path.startsWith('/api/v1/inventory?'))return inventoryRead(path);
  if(path.endsWith('/config'))return json({protocolVersion:1,authMode});
  if(readsFail)return json({error:'TECHNICAL_FAILURE'},503);
  if(path.endsWith('/state'))return json({protocolVersion:1,run:{runId,turns:20,revision,status,mode:'STANDARD'},canWrite,activeEncounter:null,latestEncounter:null,adventures:[],inventory:[],hasMoreItems:false,hasMoreAdventures:false});
  if(path==='/api/v1/ascend/preview')return json({runId,revision,ready:status==='AFTERCORE',activeInstances:0,previewToken:'a'.repeat(64),contract:{version:1,preserve:[],reset:[],archive:[],blockers:[]},retained:{turns:20,consumption:{fullness:6,drunkenness:4,tolerance:2},knowledge:1,storedItems:1,archivedItems:0,gold:'0',carriedFields:1},next:{mode:'STANDARD',startingLevel:1,startingXP:'0',build:'UNCONFIGURED'}});
  if(path.endsWith('/options'))return json({classes:[],rules:[]});
  if(path==='/api/v1/progression')return json({revision,level:1,xp:'0',build:{mode:'CONFIGURED'},readiness:null});
  throw Error(`Unexpected request ${path}`);
 };
 const session=new GameSession(new ApiClient(fetcher),()=> '11111111-1111-4111-8111-111111111111');
 return {session,calls,setTurnsRead:(read:(path:string)=>Promise<Response>)=>{turnsRead=read;},setBookRead:(read:(path:string)=>Promise<Response>)=>{bookRead=read;},setAdvancementRead:(read:(path:string)=>Promise<Response>)=>{advancementRead=read;},setInventoryRead:(read:(path:string)=>Promise<Response>)=>{inventoryRead=read;},setStatus:(s:string)=>{status=s;},setRun:(r:string)=>{runId=r;},setRevision:(n:number)=>{revision=n;},setWrite:(value:boolean)=>{canWrite=value;},setPost:(fn:typeof post)=>{post=fn;},setReadFailure:(value:boolean)=>{readsFail=value;}};
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

test('Ascension requires a current explicit preview and retries the same token after a lost transition response',async()=>{
 const h=harness();h.setStatus('AFTERCORE');await connect(h);
 await h.session.confirmAscension();assert.equal(h.calls.filter(c=>c.init.method==='POST').length,0);
 await h.session.previewAscension();assert.equal(h.session.ascension?.retained.consumption.fullness,6);
 let count=0;h.setPost(async()=>{count++;h.setRun('next-run');h.setStatus('ACTIVE');h.setRevision(0);if(count===1)throw Error('Transition response lost');return json({replayed:true});});
 await h.session.confirmAscension();assert.ok(h.session.pending);await h.session.refresh();assert.equal(h.session.ascension,null);await h.session.retry();
 assert.equal(h.session.snapshot?.game.run.runId,'next-run');assert.equal(h.session.pending,null);
 const posts=h.calls.filter(c=>c.init.method==='POST');assert.equal(posts.length,2);assert.equal(posts[0]!.init.body,posts[1]!.init.body);assert.equal(JSON.parse(posts[0]!.init.body as string).previewToken,'a'.repeat(64));
});
test('Ascension preview clears on refresh and read-only sessions cannot confirm or request a transition preview',async()=>{
 const h=harness();h.setStatus('AFTERCORE');await connect(h);await h.session.previewAscension();assert.ok(h.session.ascension);await h.session.refresh();assert.equal(h.session.ascension,null);
 h.setWrite(false);await h.session.refresh();const before=h.calls.length;await h.session.previewAscension();await h.session.confirmAscension();assert.equal(h.calls.length,before);
});

test('inventory paging ignores out-of-order reads and clears account data on sign out',async()=>{
 const h=harness();await connect(h);
 let release!:(response:Response)=>void;const delayed=new Promise<Response>(resolve=>{release=resolve;});
 const page=(name:string)=>({revision:0,runId:'run',items:[{id:name,name}],total:1,offset:0,pageSize:48,containers:[],hasMoreContainers:false,preferences:{autoStoreMaterials:false,autoOverflow:false}});
 h.setInventoryRead(async path=>path.includes('search=first')?delayed:json(page('second')));
 const first=h.session.browseInventory({search:'first'});await h.session.browseInventory({search:'second'});release(json(page('first')));await first;
 assert.equal(h.session.inventory?.items[0]?.name,'second');
 await h.session.logout();assert.equal(h.session.inventory,null);assert.equal(h.session.selectedInventoryItem,null);assert.equal(h.session.inventoryHistory,null);
});
test('inventory reads refuse crossed revisions and search dots stay inside the query',async()=>{
 const h=harness();await connect(h);h.setInventoryRead(async()=>json({revision:1,runId:'run',items:[]}));await h.session.browseInventory({search:'..'});assert.equal(h.session.inventory,null);assert.equal(h.session.needsRefresh,true);
 const last=h.calls.find(c=>c.path.startsWith('/api/v1/inventory?'));assert.ok(last?.path.includes('search=..'));
});


test('paperdoll includes every worn position and both weapon sets independent of inventory filters',()=>{
 const plan:EquipmentPlan={activeSet:'B',slots:[{set:'WORN',slot:'RING_2',itemId:'ring'},{set:'A',slot:'MAIN_HAND',itemId:'sword'},{set:'B',slot:'MAIN_HAND',itemId:'sword'}]};
 const before=structuredClone(plan),positions=paperdollPositions(plan);
 assert.equal(positions.length,16);assert.equal(new Set(positions.map(p=>p.set+':'+p.slot)).size,16);
 assert.equal(positions.find(p=>p.slot==='RING_1')?.itemId,null);assert.equal(positions.find(p=>p.slot==='RING_2')?.itemId,'ring');
 assert.equal(positions.filter(p=>p.itemId==='sword').length,2);assert.deepEqual(plan,before);
 assert.equal(positions.filter(p=>p.set==='WORN').length,12);
});


test('expanded equipment copies are candidates and off-page gear still warns before permanent binding',()=>{
 const item={id:'off-page',name:'Off-page ring',binding:'TRADEABLE',kind:'CARRIED',accessible:true,copies:3,eligible:true,proficiencyMet:true,equipment:{slots:['RING_1','RING_2'],hands:0,minimumLevel:1,bindingPolicy:'ACCOUNT_ON_ACTIVE_EQUIP'}} as import('../client/types.js').InventoryItem;
 assert.equal(paperdollCandidate(item,true,1),null);
 assert.equal(paperdollCandidate(item,false,1),item);
 assert.equal(paperdollCandidate({...item,accessible:false},false,1),null);
 const plan:EquipmentPlan={activeSet:'A',slots:[{set:'WORN',slot:'RING_1',itemId:item.id}]};
 assert.deepEqual(bindingConsequences(plan,equipmentGear,item),['Off-page ring']);
 assert.deepEqual(bindingConsequences({...plan,slots:[{set:'B',slot:'MAIN_HAND',itemId:item.id}]},equipmentGear,item),[]);
 assert.deepEqual(bindingConsequences(plan,[...equipmentGear,{...equipmentGear[0]!,id:item.id,name:item.name}],item),['Off-page ring']);
});


test('condition presentation preserves true maxima and uses configurable inclusive percentage thresholds',()=>{
 for(const [value,max,state]of [[87,100,'healthy'],[46,100,'worn'],[12,100,'critical'],[180,200,'healthy'],[180,250,'healthy'],[70,100,'healthy'],[25,100,'worn'],[0,100,'critical']] as const){const result=itemCondition({condition:value,maximumCondition:max});assert.equal(result?.state,state);assert.equal(result?.text,`${value}/${max}`);}
 assert.equal(itemCondition({condition:null,maximumCondition:null}),null);
 assert.equal(itemCondition({condition:180,maximumCondition:250},{healthyPercent:80,wornPercent:40,showSingleQuantity:true})?.state,'worn');
 assert.equal(validTileSettings({...defaultTileSettings,wornPercent:70}),false);assert.equal(validTileSettings({...defaultTileSettings,healthyPercent:101}),false);
});
test('tile weights distinguish units, stack totals, authored zero and unmeasured values without losing integer precision',()=>{
 const stack={unitWeight:'2',totalWeight:'40',groupWeight:'60',quantity:'20',groupQuantity:'30',storageMode:'STACK'};
 assert.deepEqual(itemWeight(stack,false),{text:'40',description:'2 each × 20 = 40 total'});
 assert.deepEqual(itemWeight({...stack,storageMode:'INSTANCE'},false),{text:'2',description:'2 unit weight'});
 assert.equal(itemWeight({...stack,unitWeight:null,totalWeight:null},false).text,'—');assert.equal(itemWeight({...stack,unitWeight:'0',totalWeight:'0'},false).text,'0');
 assert.equal(itemWeight({...stack,totalWeight:'18446744073709551614'},false).text,BigInt('18446744073709551614').toLocaleString());
 assert.equal(itemWeight(stack,true).text,'60');
});
test('all accessory definitions include three interchangeable positions without mutating authored content',()=>{
 for(const slots of [['RING_1','RING_2'],['TRINKET'],['RING_2']]){const spec={version:1,slots,hands:0,minimumLevel:1,bindingPolicy:'PRESERVE'},before=structuredClone(spec);assert.deepEqual(equipmentSpec(spec).slots,['RING_1','RING_2','TRINKET']);assert.deepEqual(spec,before);}
});


test('tile facts never invent levels or expose a grouped representative quality as a shared fact',()=>{
 const item={copies:3,equipment:null,numericQuality:null,qualityLabel:'Unassessed',family:'Crafting material',category:'MATERIAL'} as import('../client/types.js').InventoryItem;
 assert.deepEqual(itemTileDetails(item,false),[['property','Crafting material']]);
 assert.deepEqual(itemTileDetails({...item,numericQuality:'1.2345'},false),[['quality','Quality 1.2345']]);
 assert.deepEqual(itemTileDetails({...item,numericQuality:'1.2345'},true),[['copies','3 copies · inspect individually']]);
 const session=new GameSession();assert.equal(session.updateTileSettings({healthyPercent:20}),false);assert.equal(session.tileSettings.healthyPercent,70);assert.equal(session.updateTileSettings({showSingleQuantity:false}),true);assert.equal(session.tileSettings.showSingleQuantity,false);
});


test('artwork hierarchy uses only curated assets and distinct public item identities',()=>{
 assert.equal(itemArtKey({name:'Sword',category:'EQUIPMENT',artwork:'compass',icon:'ring'}),'compass');
 assert.equal(itemArtKey({name:'Sword',category:'EQUIPMENT',artwork:'https://untrusted.invalid/x',icon:'ring'}),'ring');
 assert.equal(itemArtKey({name:'Knotted charm',equipment:{slots:['TRINKET']}}),'charm');assert.equal(itemArtKey({name:'Road medallion',equipment:{slots:['TRINKET']}}),'medallion');assert.equal(itemArtKey({name:'Copper ring'}),'ring');
 assert.equal(itemArtKey({name:'Unrecognized thing',artwork:'../../private'}),null);
});
test('equipment drag payloads must reference a current assignment and unequip preserves other prepared references',()=>{
 const plan:EquipmentPlan={activeSet:'A',slots:[{set:'A',slot:'MAIN_HAND',itemId:'sword'},{set:'B',slot:'MAIN_HAND',itemId:'sword'}]};
 const payload={set:'A',slot:'MAIN_HAND',itemId:'sword'};const parsed=equipmentDrag(JSON.stringify(payload),plan);assert.ok(parsed);assert.equal(removeEquipmentAssignment(plan,parsed).slots.length,1);assert.equal(plan.slots.length,2);
 for(const value of ['bad','null',JSON.stringify({...payload,itemId:'foreign'}),JSON.stringify({...payload,set:'WORN'})])assert.equal(equipmentDrag(value,plan),null);
});
test('equipment search does not alter pack state and rejects responses from signed-out sessions',async()=>{
 const h=harness();await connect(h);h.session.inventoryQuery={search:'ore',grouped:true};
 h.setInventoryRead(async path=>{assert.ok(path.includes('equipmentSlot=HEAD'));assert.ok(path.includes('grouped=false'));return json({runId:'run',revision:0,items:[],total:0,offset:0,pageSize:48});});
 await h.session.findEquipment('HEAD','helm');assert.deepEqual(h.session.inventoryQuery,{search:'ore',grouped:true});assert.equal(h.session.inventory,null);
 let resolve!:(value:Response)=>void;h.setInventoryRead(()=>new Promise(r=>{resolve=r;}));const pending=h.session.findEquipment('HEAD');await h.session.logout();resolve(json({runId:'run',revision:0,items:[]}));await assert.rejects(pending,/STALE_REVISION/);
});


test('group inspector exposes aggregate facts without representative binding, quality, condition or protection',()=>{
 const facts=groupedInspectionFacts({copies:2,groupQuantity:'20',groupWeight:null,groupBulk:'5',multipleLocations:true,binding:'ACCOUNT_BOUND',numericQuality:'9.999',condition:87,maximumCondition:100,locked:true} as import('../client/types.js').InventoryItem);
 assert.deepEqual(facts,[['Copies','2'],['Total quantity','20'],['Total weight','—'],['Total bulk','5'],['Locations','Multiple locations']]);
});
test('curated item illustrations use same-origin whitelisted routes',async()=>{
 const app=Fastify();registerClient(app,{mode:'sessions',throttleKey:'not-public'});
 try{const image=await app.inject({url:'/assets/items/sword.svg'});assert.equal(image.statusCode,200);assert.match(image.headers['content-type']!,/image\/svg\+xml/);assert.match(image.body,/<svg/);assert.equal((await app.inject({url:'/assets/items/not-approved.svg'})).statusCode,404);}finally{await app.close();}
});


test('selected groups never become representative individuals when browse mode or filters change',async()=>{
 const h=harness();await connect(h);const item={id:'copy',name:'Group',copies:3} as import('../client/types.js').InventoryItem;
 h.session.selectInventory(item);assert.equal(h.session.selectedInventoryGrouped,true);
 await h.session.browseInventory({grouped:false});assert.equal(h.session.selectedInventoryItem,null);assert.equal(h.session.selectedInventoryGrouped,false);
 h.session.selectInventory(item);assert.equal(h.session.selectedInventoryGrouped,false);
 await h.session.browseInventory({grouped:true});assert.equal(h.session.selectedInventoryGrouped,false);assert.deepEqual(h.session.selectedInventoryItem,item);
 h.session.selectInventory(item);assert.equal(h.session.selectedInventoryGrouped,true);h.session.inventoryQuery={grouped:true,search:'changed'};
 await h.session.browseInventory(h.session.inventoryQuery);assert.equal(h.session.selectedInventoryItem,null);
});

test('authored images accept bounded local raster filenames and reject remote or traversing paths',async()=>{
 const { authoredItemImage }=await import('../client/item-art.js');assert.equal(authoredItemImage('authored/wardens-blade.webp'),'/assets/items/authored/wardens-blade.webp');
 for(const value of ['https://example.com/a.png','authored/../a.png','authored/x.svg','authored/x.png?x','authored/a/b.png','Authored/a.png'])assert.equal(authoredItemImage(value),null,value);
});
test('equipment drafts survive refresh, refuse stale Apply and are forgotten on logout',async()=>{
 const h=harness();await connect(h);h.session.snapshot!.game.equipment={activeSet:'A',slots:[]};
 const plan:EquipmentPlan={activeSet:'B',slots:[{set:'B',slot:'MAIN_HAND',itemId:'sword'}]};h.session.stageEquipment(plan,equipmentGear);assert.deepEqual(h.session.equipmentState(),plan);plan.activeSet='A';assert.equal(h.session.equipmentState()?.activeSet,'B');
 await h.session.refresh();h.session.snapshot!.game.equipment={activeSet:'A',slots:[]};assert.equal(h.session.equipmentState()?.activeSet,'B');
 h.setRevision(1);await h.session.refresh();await h.session.applyEquipment();assert.equal(h.calls.filter(c=>c.init.method==='POST').length,0);assert.ok(h.session.equipmentDraft);
 h.session.equipmentContext='encounter.old';h.setRun('next-run');await h.session.refresh();assert.equal(h.session.equipmentContext,undefined);assert.equal(h.session.equipmentDraft,null);
 await h.session.logout();assert.equal(h.session.equipmentDraft,null);assert.equal(h.session.equipmentPreview,null);
});

test('page selection supports toggles and ranges without selecting grouped representatives',()=>{
 const session=new GameSession();const rows=[{id:'a',copies:1,accessible:true},{id:'b',copies:2,accessible:true},{id:'c',copies:1,accessible:true},{id:'d',copies:1,accessible:true}] as any;session.inventory={items:rows} as any;session.inventoryQuery={grouped:true};session.selectInventoryRange(rows[0]);session.selectInventoryRange(rows[3],{range:true});assert.deepEqual([...session.inventorySelection],['a','c','d']);session.selectInventoryRange(rows[2],{toggle:true});assert.deepEqual([...session.inventorySelection],['a','d']);session.clearInventorySelection();assert.equal(session.inventorySelection.size,0);rows[2].accessible=false;session.selectInventoryRange(rows[0]);session.selectInventoryRange(rows[3],{range:true});assert.deepEqual([...session.inventorySelection],['a','d']);session.selectInventoryRange(rows[2],{toggle:true});assert.deepEqual([...session.inventorySelection],['a','d']);
});
test('favorite and new badges are distinct and grouped counts never use a representative status',()=>{
 const item={favorite:true,isNew:true,locked:false,equipped:false,loadouts:[],accessible:true,groupFavoriteCount:2,groupNewCount:1} as any;assert.deepEqual(itemStatuses(item,false).map(s=>s.kind),['favorite','new']);assert.deepEqual(itemStatuses(item,true).map(s=>s.label),['Grouped copies — expand to inspect individual statuses','2 favorite copies','1 uninspected copies']);
});

test('selection survives cosmetic page reloads but clears on query or gameplay revision changes',async()=>{
 const h=harness();await connect(h);let revision=0;h.setInventoryRead(async()=>json({revision,runId:'run',items:[{id:'a',copies:1,accessible:true},{id:'b',copies:1,accessible:true}],total:2,offset:0,pageSize:48,containers:[],preferences:{}}));
 await h.session.browseInventory({grouped:false});h.session.selectInventoryRange(h.session.inventory!.items[0]!);h.session.inventory=null;await h.session.browseInventory({grouped:false});assert.deepEqual([...h.session.inventorySelection],['a']);assert.equal(h.session.inventorySelectionAnchor,'a');
 await h.session.browseInventory({grouped:false,search:'other'});assert.equal(h.session.inventorySelection.size,0);h.session.selectInventoryRange(h.session.inventory!.items[1]!);revision=1;h.setRevision(1);await h.session.refresh();assert.equal(h.session.inventorySelection.size,0);
});
test('double activation cancels a pending inspection and modifier clicks never activate items',async t=>{
 const { attachInventoryActivation }=await import('../client/inventory-activation.js');t.mock.timers.enable({apis:['setTimeout']});const tile=new EventTarget() as EventTarget & {isConnected:boolean};tile.isConnected=true;let inspect=0,activate=0,select=0;attachInventoryActivation(tile as unknown as HTMLButtonElement,()=>inspect++,()=>activate++,()=>select++);
 function fire(type:string,properties:Record<string,unknown>={}){const e=new Event(type);Object.assign(e,{detail:1,ctrlKey:false,metaKey:false,shiftKey:false,...properties});tile.dispatchEvent(e);}
 fire('click');fire('click',{detail:2});fire('dblclick');t.mock.timers.tick(400);assert.equal(inspect,0);assert.equal(activate,1);fire('click',{ctrlKey:true});t.mock.timers.tick(400);assert.equal(select,1);assert.equal(activate,1);fire('click');t.mock.timers.tick(350);assert.equal(inspect,1);
});

test('side-by-side item comparison distinguishes unknown properties, empty slots and true durability',async()=>{const {comparisonRows}=await import('../client/item-comparison.js');const candidate={id:'candidate',name:'Candidate',binding:'TRADEABLE',slots:['HEAD'],hands:0,minimumLevel:3,bindingPolicy:'PRESERVE',eligible:true,proficiencyMet:true,manualLocked:false,protectedLoadouts:[],condition:180,maximumCondition:250,unitWeight:null,knownStats:{armor:4}};const current={...candidate,id:'current',name:'Current',knownStats:null,condition:null,maximumCondition:null};const rows=comparisonRows(current,candidate);assert.deepEqual(rows.find(r=>r[0]==='armor'),['armor','Unknown','4']);assert.deepEqual(rows.find(r=>r[0]==='Condition'),['Condition','—','180/250']);assert.deepEqual(rows.find(r=>r[0]==='Weight'),['Weight','—','—']);assert.equal(comparisonRows(null,candidate).find(r=>r[0]==='Required level')![1],'—');});

test('item-service authoring rejects client-like rewards, hidden dependencies and missing repair policy bounds',async()=>{const {validateContent}=await import('../src/domains/content.js');const {servicePackage}=await import('./inventory-services-fixture.js');for(const change of [(p:any)=>p.entities.find((e:any)=>e.id==='item.box').definition.mechanics.itemUse.rewards[0].quantity=0,(p:any)=>p.entities.find((e:any)=>e.id==='item.vial').definition.dependencies=[],(p:any)=>p.entities.find((e:any)=>e.id==='item.sword').definition.mechanics.repair.goldPerPoint=0,(p:any)=>p.entities.find((e:any)=>e.id==='item.vial').definition.mechanics.itemUse.effects.push('missing.effect')]){const p=servicePackage();change(p);assert.throws(()=>validateContent(p));}assert.doesNotThrow(()=>validateContent(servicePackage()));});

test('mobile equipment disclosure preserves item selection, filters and shared draft without an action',async()=>{const h=harness();await connect(h);const plan:EquipmentPlan={activeSet:'A',slots:[]};h.session.equipmentDraft={runId:'run',revision:0,plan,gear:[]};h.session.inventoryQuery={search:'sword',grouped:false};h.session.inventorySelection.add('chosen');const before=h.calls.length;h.session.setInventoryEquipmentOpen(true);assert.equal(h.session.inventoryEquipmentOpen,true);h.session.setInventoryEquipmentOpen(false);assert.equal(h.session.equipmentDraft.plan,plan);assert.equal(h.session.inventoryQuery.search,'sword');assert.deepEqual([...h.session.inventorySelection],['chosen']);assert.equal(h.calls.length,before);});

test('equipped-item inspection resolves a physical identity without replacing the current pack query',async()=>{const h=harness();await connect(h);h.session.inventoryQuery={search:'materials',grouped:true};h.setInventoryRead(async path=>{assert.match(path,/equipmentState=EQUIPPED/);assert.match(path,/grouped=false/);return json({revision:0,runId:'run',items:[{id:'equipped',name:'Sword',copies:2,accessible:true}],total:1});});assert.equal(await h.session.inspectEquippedItem('equipped'),true);assert.equal(h.session.selectedInventoryItem!.id,'equipped');assert.equal(h.session.selectedInventoryGrouped,false);assert.equal(h.session.inventoryQuery.search,'materials');});

test('a late equipped-item lookup cannot reopen inspection after the player closes it',async()=>{const h=harness();await connect(h);let respond!:(r:Response)=>void;h.setInventoryRead(async()=>new Promise<Response>(resolve=>respond=resolve));const pending=h.session.inspectEquippedItem('equipped');h.session.selectInventory(null);respond(json({revision:0,runId:'run',items:[{id:'equipped',name:'Sword',copies:1,accessible:true}]}));assert.equal(await pending,false);assert.equal(h.session.selectedInventoryItem,null);});

test('off-page picker gear retains physical inspection facts only for its current draft revision',async()=>{const {inventoryGear,gearCandidate}=await import('../client/equipment-picker.js');const h=harness();await connect(h);const item={id:'staged',definitionId:'item.test',name:'Picker gear',multipleLocations:false,knownStats:null,groupWeight:'4',groupBulk:'2',groupQuantity:'2',category:'EQUIPMENT',rarity:'COMMON',description:'Picker item',family:'Equipment',qualityLabel:'Standard',numericQuality:null,unitWeight:'2',unitBulk:'1',totalWeight:'2',totalBulk:'1',locked:false,equipped:false,protected:false,containerId:'carried',storageMode:'INSTANCE',binding:'TRADEABLE',accessible:true,kind:'CARRIED',copies:2,quantity:'1',condition:180,maximumCondition:250,equipment:{version:2,slots:['HEAD'],hands:0,minimumLevel:1,bindingPolicy:'PRESERVE'},loadouts:[],eligible:true,proficiencyMet:true} as import('../client/types.js').InventoryItem;const gear=inventoryGear(item);assert.equal(gearCandidate(gear).definitionId,item.definitionId);h.session.inventoryQuery={search:'materials',grouped:true};h.session.equipmentDraft={runId:'run',revision:0,plan:{activeSet:'A',slots:[{set:'WORN',slot:'HEAD',itemId:item.id}]},gear:[gear]};const before=h.calls.length;assert.equal(await h.session.inspectEquippedItem(item.id),true);assert.equal(h.calls.length,before);assert.equal(h.session.selectedInventoryGrouped,false);assert.equal(h.session.selectedInventoryItem!.condition,180);assert.equal(h.session.inventoryQuery.search,'materials');h.setRevision(1);await h.session.refresh();h.session.selectInventory(null);assert.equal(await h.session.inspectEquippedItem(item.id),false);assert.equal(h.session.selectedInventoryItem,null);});

test('carrying percentages preserve overload and bigint precision',async()=>{const {carryPercent}=await import('../client/inventory.js');assert.equal(carryPercent('175','100'),175);assert.equal(carryPercent('9223372036854775807','9223372036854775807'),100);assert.equal(carryPercent('0',null),0);});
test('Keep-N allocation and saved views validate safe intent',async()=>{const {keepAllocation,validateInventoryViews}=await import('../src/domains/inventory-intelligence.js');assert.equal(keepAllocation(2n,12n,5),3n);assert.equal(keepAllocation(9n,12n,5),0n);assert.equal(keepAllocation(0n,9223372036854775807n,5),5n);assert.throws(()=>validateInventoryViews([{name:'Bad',query:{expectedRevision:1}}]),/INVALID_INVENTORY_VIEWS/);validateInventoryViews([{name:'Materials',query:{category:'MATERIAL',sort:'WEIGHT',direction:'DESC'}}]);});

test('saved views reject inherited keys and non-string filters',async()=>{const {validateInventoryViews}=await import('../src/domains/inventory-intelligence.js');for(const query of [JSON.parse('{"__proto__":{}}'),{constructor:'anything'},{category:['EQUIPMENT']}])assert.throws(()=>validateInventoryViews([{name:'Bad',query}]),/INVALID_INVENTORY_VIEWS/);});

test('inventory rarity terms match the design bible without rewriting persisted codes',async()=>{const {rarityTitle}=await import('../client/inventory-usability.js');assert.equal(rarityTitle('VERY_RARE'),'Exceptional');assert.equal(rarityTitle('MYTHIC'),'Mythic');assert.equal(rarityTitle('ULTRA_ULTRA_RARE'),'Ultra-ultra rare');assert.equal(rarityTitle('PRIVATE_MARKER'),'Unknown');assert.equal(rarityTitle('constructor'),'Unknown');});
test('inventory success feedback describes confirmed changes, costs and no-ops',async()=>{const {inventorySuccess}=await import('../client/inventory-usability.js');const items=[{id:'vial',name:'Road tonic'}];assert.equal(inventorySuccess('SPLIT_STACK',{quantity:'9223372036854775806'},{},items),'Split 9223372036854775806 units into a separate stack.');assert.equal(inventorySuccess('USE_ITEM',{itemId:'vial'},{kind:'USE',remaining:'4'},items),'Used Road tonic; 4 remaining.');assert.equal(inventorySuccess('REPAIR_ITEMS',{}, {items:[{},{}],total:'70'},items),'Repaired 2 items for 70 Gold.');assert.match(inventorySuccess('BULK_INVENTORY',{operation:'COLLECT'},{changed:0},items),/^No items changed/);assert.equal(inventorySuccess('MOVE_INVENTORY',{itemId:'vial',kind:'HOME'},{},items),'Moved Road tonic to home storage.');assert.match(inventorySuccess('SET_INVENTORY_WORKSPACE',{layout:'COMPACT'},{},items),/Compact.*saved to your account/);});
test('compact comparison preserves unknown facts and never compares a grouped representative',async()=>{const {quickComparison}=await import('../client/inventory-usability.js');const item={id:'candidate',name:'Very long candidate name',definitionId:'item.candidate',multipleLocations:false,groupWeight:'2',groupBulk:'1',groupQuantity:'1',category:'EQUIPMENT',rarity:'COMMON',description:'',family:'Equipment',qualityLabel:'Known',numericQuality:'1',totalWeight:'2',totalBulk:'1',equipped:false,protected:false,containerId:'carried',storageMode:'INSTANCE',accessible:true,kind:'CARRIED',quantity:'1',binding:'TRADEABLE',equipment:{version:2,slots:['HEAD'],hands:0,minimumLevel:1,bindingPolicy:'PRESERVE'},eligible:true,proficiencyMet:true,locked:false,loadouts:[],knownStats:{armor:4},unitWeight:'2',unitBulk:'1',condition:87,maximumCondition:100,copies:1} as import('../client/types.js').InventoryItem;const current={id:'current',name:'Current helm',binding:'TRADEABLE',slots:['HEAD'],hands:0,minimumLevel:1,bindingPolicy:'PRESERVE',eligible:true,proficiencyMet:true,manualLocked:false,protectedLoadouts:[],knownStats:null,condition:180,maximumCondition:250,unitWeight:null};const plan={activeSet:'A' as const,slots:[{set:'WORN' as const,slot:'HEAD',itemId:'current'}]};const comparison=quickComparison(item,plan,[current],false)!;assert.match(comparison.title,/Current helm/);assert.equal(quickComparison({...item,equipment:null},plan,[current],true),null);assert.ok(comparison.lines.includes('armor: Unknown → 4'));assert.ok(comparison.lines.includes('Condition %: 72 → 87'));assert.deepEqual(quickComparison({...item,copies:2},plan,[current],true)!.lines,['Expand matching copies to compare individual equipment.']);});

test('detached inventory tiles cannot reopen a stale context menu',async()=>{
 const {attachItemContextMenu}=await import('../client/item-context-menu.js');
 const tile=Object.assign(new EventTarget(),{isConnected:false});let opened=0;
 attachItemContextMenu(tile as unknown as HTMLButtonElement,()=>opened++);
 const event=new Event('contextmenu',{cancelable:true});tile.dispatchEvent(event);
 assert.equal(opened,0);assert.equal(event.defaultPrevented,true);
});

test('automation disclosure survives same-item refreshes and closes for a different item',()=>{
 const session=new GameSession(),first={id:'first',copies:1} as any,second={id:'second',copies:1} as any;
 session.selectInventory(first);session.inventoryAutomationOpen=true;
 session.selectInventory({...first});assert.equal(session.inventoryAutomationOpen,true);
 session.selectInventory(second);assert.equal(session.inventoryAutomationOpen,false);
 session.inventoryAutomationOpen=true;session.selectInventory(null);assert.equal(session.inventoryAutomationOpen,false);
});

test('pending search text survives background browse notifications without changing applied filters and clears on logout',async()=>{
 const h=harness();await connect(h);h.setInventoryRead(async()=>json({revision:0,runId:'run',items:[]}));
 await h.session.browseInventory({search:'applied'});h.session.inventorySearchDraft='pending';
 await h.session.browseInventory(h.session.inventoryQuery);
 assert.equal(h.session.inventorySearchDraft,'pending');assert.equal(h.session.inventoryQuery.search,'applied');
 await h.session.logout();assert.equal(h.session.inventorySearchDraft,null);
});

// CHAR-01: presentation consumes exact authoritative projections, never XP thresholds invented in the browser.
test('Character XP separates the next earned threshold from pending class allocation',async()=>{
 const {characterXP}=await import('../client/character-model.js');
 const p={level:1,xp:'250',build:{mode:'CONFIGURED'},readiness:{readyThroughLevel:3,pendingLevels:2,nextThreshold:'300'},xpProgress:{earnedThreshold:'200',maximumLevel:25}} as import('../client/types.js').Progression;
 assert.deepEqual(characterXP(p),{earnedLevel:3,nextEarnableLevel:4,nextAllocationLevel:2,capped:false,remaining:'50',percent:50,maximumLevel:25});
 assert.equal(characterXP({...p,xpProgress:null}).percent,null);
});
test('Character XP retains exact large decimal values and bounded fractional progress',async()=>{
 const {characterXP,exactXP}=await import('../client/character-model.js');
 const p={level:2,xp:'9007199254740993',build:{mode:'CONFIGURED'},readiness:{readyThroughLevel:2,pendingLevels:0,nextThreshold:'9007199254740995'},xpProgress:{earnedThreshold:'9007199254740991',maximumLevel:25}} as import('../client/types.js').Progression;
 assert.equal(characterXP(p).percent,50);assert.equal(characterXP(p).remaining,'2');assert.equal(exactXP(p.xp),9007199254740993n.toLocaleString());
 assert.equal(characterXP({...p,xp:'9223372036854775807',readiness:{readyThroughLevel:25,pendingLevels:23,nextThreshold:null}}).capped,true);
});
test('Character XP explicitly handles capped, pending-at-cap and unconfigured states',async()=>{
 const {characterXP}=await import('../client/character-model.js');
 const p={level:25,xp:'2400',build:{mode:'CONFIGURED'},readiness:{readyThroughLevel:25,pendingLevels:0,nextThreshold:null},xpProgress:{earnedThreshold:'2400',maximumLevel:25}} as import('../client/types.js').Progression;
 assert.equal(characterXP(p).nextEarnableLevel,null);assert.equal(characterXP(p).nextAllocationLevel,null);assert.equal(characterXP(p).percent,null);
 assert.equal(characterXP({...p,level:3,readiness:{...p.readiness!,pendingLevels:22}}).nextAllocationLevel,4);
 assert.equal(characterXP({...p,readiness:null,xpProgress:null}).capped,false);
});
test('Character class summary shows both native levels and only discovered names and limits',async()=>{
 const {characterClasses}=await import('../client/character-model.js');
 const s={progression:{build:{classes:[{classId:'class.one',nativeLevel:4},{classId:'class.two',nativeLevel:2}]}},options:{classes:[{classId:'class.one',name:'Warden',maximumNativeLevel:20},{classId:'class.two',name:'Wayfarer',maximumNativeLevel:15}]}} as unknown as Snapshot;
 assert.deepEqual(characterClasses(s).map(c=>[c.name,c.nativeLevel,c.maximumNativeLevel]),[['Warden',4,20],['Wayfarer',2,15]]);
 s.options.classes=[];assert.equal(characterClasses(s)[0]!.name,'Class name unavailable');assert.equal(characterClasses(s)[0]!.maximumNativeLevel,null);
});
test('Character equipment summary follows the shared active draft without altering assignments',async()=>{
 const {characterEquipment}=await import('../client/character-model.js');const s={game:{equipment:{activeSet:'A',slots:[]}}} as unknown as Snapshot;
 const plan={activeSet:'B' as const,slots:[{set:'A' as const,slot:'MAIN_HAND',itemId:'old'},{set:'B' as const,slot:'MAIN_HAND',itemId:'new'},{set:'WORN' as const,slot:'HEAD',itemId:'helm'}]};const before=JSON.stringify(plan);
 const result=characterEquipment(s,{equipmentState:()=>plan,equipmentGear:()=>[{id:'new',name:'Known blade'} as Gear]});
 assert.equal(result.plan!.activeSet,'B');assert.deepEqual(result.items.map(i=>i.itemId),['new','helm']);assert.equal(result.items[0]!.gear!.name,'Known blade');assert.equal(result.items[1]!.gear,undefined);assert.equal(JSON.stringify(plan),before);
});
test('Character section choice survives ordinary redraws and resets on sign out',async()=>{
 const h=harness();await connect(h);h.session.setCharacterSection('progression');assert.equal(h.session.characterSection,'progression');await h.session.logout();assert.equal(h.session.characterSection,'overview');
});

function advancementData(revision=0,runId='run'):import('../client/types.js').Advancement{
 const scope={revision,runId,activeInstance:false};return {...scope,attributes:{...scope,attributes:{strength:12,dexterity:11,constitution:10,intelligence:10,wisdom:10,charisma:10,luck:10},explanation:"Committed scores",choices:[],rules:[]},proficiencies:{...scope,selected:[],choices:[],options:[]},milestones:{...scope,milestones:[],truncated:false},classes:[{classId:'class.known',name:'Known class',rulesId:'rules.known',nativeLevel:4,nextNativeLevel:5,maximumNativeLevel:20,eligibility:'AVAILABLE'}],subclasses:{...scope,selected:[],options:[{subclassId:'sub.known',classId:'class.known',name:'Known subclass',nativeLevel:5,unlockNativeLevel:5,eligibility:'AVAILABLE'}]},feats:{...scope,selected:[],options:[{featId:'feat.known',name:'Known feat',rulesId:'rules.feats',availableMilestones:[2,4],eligibility:'ELIGIBLE'}]}};
}
const advancementRead=(view:import('../client/types.js').Advancement,path:string)=>json(path.includes('/options')?{runId:view.runId,revision:view.revision,activeInstance:view.activeInstance,classes:view.classes,rules:[]}:path.endsWith('/subclasses')?view.subclasses:path.endsWith('/attributes')?view.attributes:path.endsWith('/proficiencies')?view.proficiencies:path.endsWith('/milestones')?view.milestones:view.feats);
test('advancement eligibility requires an exact earned feat milestone and current run, not eligibility alone',async()=>{
 const {canChooseAdvancement,featStatus,advancementReason}=await import('../client/advancement-model.js');const v=advancementData(),choice={kind:'FEAT' as const,id:'feat.known',runId:'run',revision:0,milestone:2};
 assert.equal(canChooseAdvancement(v,choice),true);for(const patch of [{milestone:3},{milestone:undefined},{runId:'other'},{revision:1},{id:'feat.unknown'}])assert.equal(canChooseAdvancement(v,{...choice,...patch}),false);
 v.feats.options[0]!.availableMilestones=[];assert.equal(canChooseAdvancement(v,choice),false);assert.match(featStatus(v.feats.options[0]!),/no earned milestone/);assert.match(featStatus({...v.feats.options[0]!,eligibility:'ACTIVE_INSTANCE'}),/no earned milestone/);assert.match(advancementReason('PROFICIENCY_NOT_MET'),/Proficiency requirements/);
 v.activeInstance=true;assert.equal(canChooseAdvancement(v,{...choice,kind:'SUBCLASS',id:'sub.known'}),false);
});
test('feat filters retain committed selections and distinguish eligible from actionable milestones',async()=>{
 const {featEntries}=await import('../client/advancement-model.js');const v=advancementData();v.feats.selected=[{featId:'feat.old',name:'Committed feat',milestone:1}];v.feats.options.push({featId:'feat.locked',name:'Restricted feat',rulesId:'rules.feats',availableMilestones:[2],eligibility:'PREREQUISITES_NOT_MET'});v.feats.options[0]!.availableMilestones=[];
 assert.deepEqual(featEntries(v.feats,'','SELECTED').map(f=>f.featId),['feat.old']);assert.deepEqual(featEntries(v.feats,'','ELIGIBLE').map(f=>f.featId),['feat.known']);assert.equal(featEntries(v.feats,'','UNAVAILABLE').length,2);assert.equal(featEntries(v.feats,'restricted','ALL').length,1);assert.deepEqual(featEntries({...v.feats,selected:[],options:[]},'','ALL'),[]);
});
test('advancement decisions refresh after commit, retain Progression and respect read-only sessions',async()=>{
 const h=harness();await connect(h);let view=advancementData();h.setAdvancementRead(async path=>advancementRead(view,path));await h.session.loadAdvancement();h.session.setCharacterSection('progression');
 const choice={kind:'FEAT' as const,id:'feat.known',runId:'run',revision:0,milestone:2};h.session.snapshot!.game.canWrite=false;await h.session.chooseAdvancement(choice);assert.equal(h.calls.filter(c=>c.init.method==='POST').length,0);h.session.snapshot!.game.canWrite=true;
 h.setPost(async()=>{view=advancementData(1);view.feats.selected=[{featId:'feat.known',name:'Known feat',milestone:2}];view.feats.options[0]!.eligibility='ALREADY_CHOSEN';h.setRevision(1);return json({milestone:2});});
 await h.session.chooseAdvancement(choice);assert.equal(h.session.characterSection,'progression');assert.equal(h.session.advancement!.revision,1);assert.equal(h.session.advancement!.feats.selected.length,1);assert.equal(h.session.notice.text,'Selected feat Known feat at milestone 2.');await h.session.chooseAdvancement(choice);assert.equal(h.calls.filter(c=>c.init.method==='POST').length,1);
});
test('advancement rejects crossed read revisions and forgets late catalog data after logout',async()=>{
 const h=harness();await connect(h);h.setAdvancementRead(async path=>advancementRead(advancementData(path.endsWith('/feats')?1:0),path));await h.session.loadAdvancement();assert.equal(h.session.advancement,null);assert.equal(h.session.needsRefresh,false);assert.equal(h.session.advancementNeedsRefresh,true);
 const next=harness();await connect(next);let finish!:(r:Response)=>void;next.setAdvancementRead(async path=>path.endsWith('/feats')?new Promise<Response>(resolve=>finish=resolve):advancementRead(advancementData(),path));const read=next.session.loadAdvancement();await next.session.logout();finish(json(advancementData().feats));await read;assert.equal(next.session.advancement,null);assert.equal(next.session.advancementBusy,false);
});
test('ambiguous advancement submissions retry the identical action rather than submitting twice',async()=>{
 const h=harness();await connect(h);let v=advancementData(),posts=0;h.setAdvancementRead(async path=>advancementRead(v,path));await h.session.loadAdvancement();h.setPost(async()=>{posts++;h.setRevision(1);v=advancementData(1);if(posts===1)throw Error('response lost');return json({milestone:2,replayed:true});});
 const choice={kind:'FEAT' as const,id:'feat.known',runId:'run',revision:0,milestone:2};await h.session.chooseAdvancement(choice);assert.ok(h.session.pending);await h.session.chooseAdvancement(choice);assert.equal(posts,1);await h.session.retry();const actions=h.calls.filter(c=>c.init.method==='POST');assert.equal(posts,2);assert.equal(actions[0]!.init.body,actions[1]!.init.body);assert.equal(h.session.pending,null);assert.equal(h.session.advancement!.revision,1);
});

test('new runs discard advancement browser state and old catalogs while preserving owned scope',async()=>{
 const h=harness();await connect(h);let current=advancementData();h.setAdvancementRead(async path=>advancementRead(current,path));await h.session.loadAdvancement();h.session.setCharacterSection('progression');h.session.setAdvancementBrowser({advancementSearch:'old feat',advancementFeatId:'feat.known',advancementMilestone:2});h.setRun('next-run');current=advancementData(0,'next-run');await h.session.refresh();
 assert.equal(h.session.characterSection,'overview');assert.equal(h.session.advancementSearch,'');assert.equal(h.session.advancementFeatId,null);assert.equal(h.session.advancementMilestone,null);assert.equal(h.session.advancement!.runId,'next-run');
});

test('subclass alternatives explain a committed class decision without claiming the alternative was selected',async()=>{
 const {subclassStatus}=await import('../client/advancement-model.js');assert.equal(subclassStatus({subclassId:'sub.chosen',eligibility:'ALREADY_CHOSEN'},'sub.chosen'),'Already selected');assert.equal(subclassStatus({subclassId:'sub.other',eligibility:'ALREADY_CHOSEN'},'sub.chosen'),'This class already has a committed subclass');
});

test('optional advancement catalog failures preserve committed action feedback and unrelated core state',async()=>{
 const h=harness();await connect(h);let v=advancementData(),fail=false;h.setAdvancementRead(async path=>fail&&path.endsWith('/feats')?json({error:'TECHNICAL_FAILURE'},503):advancementRead(v,path));await h.session.loadAdvancement();
 assert.ok(h.calls.some(c=>c.path==='/api/v1/progression/options?advancement=true'));
 h.setPost(async()=>{h.setRevision(1);v=advancementData(1);fail=true;return json({build:{classes:[{classId:'class.known',nativeLevel:5}]}});});
 await h.session.chooseAdvancement({kind:'CLASS',id:'class.known',runId:'run',revision:0});assert.equal(h.session.notice.kind,'success');assert.equal(h.session.notice.text,'Advanced Known class to native level 5.');assert.equal(h.session.snapshot!.game.run.revision,1);assert.equal(h.session.needsRefresh,false);assert.equal(h.session.pending,null);assert.equal(h.session.advancement,null);assert.ok(h.session.advancementError);
});

test('ordinary actions invalidate catalogs without eagerly running advanced class previews',async()=>{
 const h=harness();await connect(h);let v=advancementData();h.setAdvancementRead(async path=>advancementRead(v,path));await h.session.loadAdvancement();h.setPost(async()=>{h.setRevision(1);v=advancementData(1);return json({});});await h.session.action('/api/v1/inventory/lock','SET_ITEM_LOCK',{itemId:'known-item',locked:true});
 assert.equal(h.calls.filter(c=>c.path.includes('advancement=true')).length,1);assert.equal(h.session.advancement,null);assert.equal(h.session.snapshot!.game.run.revision,1);await h.session.loadAdvancement();assert.equal(h.session.advancement!.revision,1);
});

test('attribute editor guards exact budget, allowed names, caps and Luck without silently distributing points',async()=>{
 const {validAttributeAllocation,canChooseAdvancement}=await import('../client/advancement-model.js');const v=advancementData(),rule={rulesId:'rules.attributes',rulesRevision:1,maximumScores:{strength:13,dexterity:14,constitution:14,intelligence:14,wisdom:14,charisma:14,luck:12},blockedByInstance:false,availableMilestones:[{level:2,points:2,allowedAttributes:['strength','dexterity','luck'] as import('../client/types.js').AttributeName[]}]};v.attributes.rules=[rule];const m=rule.availableMilestones[0]!;
 for(const allocation of [{},{strength:1},{strength:2},{constitution:2},{dexterity:3},{dexterity:1.5,luck:.5},{dexterity:2,luck:-1}])assert.equal(validAttributeAllocation(rule,m,v.attributes.attributes,allocation),false);
 const choice={kind:'ATTRIBUTE' as const,id:rule.rulesId,milestone:2,allocation:{luck:2},runId:'run',revision:0};assert.equal(canChooseAdvancement(v,choice),true);assert.equal(canChooseAdvancement(v,{...choice,milestone:4}),false);v.activeInstance=true;assert.equal(canChooseAdvancement(v,choice),false);
});
test('proficiency browsing and guards preserve the established ladder and exact earned milestone',async()=>{
 const {nextRank,proficiencyNextRank,rankLadder,proficiencyEntries,canChooseAdvancement,proficiencyStatus}=await import('../client/advancement-model.js');for(let i=0;i<rankLadder.length;i++)assert.equal(nextRank(rankLadder[i]!),rankLadder[i+1]??null);assert.equal(nextRank('UNKNOWN'),null);assert.equal(proficiencyNextRank({rank:'NOVICE',maximumRank:'NOVICE'}),null);assert.equal(proficiencyNextRank({rank:'NOVICE',maximumRank:'EXPERT'}),'TRAINED');
 const v=advancementData(),p={rulesId:'rules.skills',skillId:'skill.luck',name:'Lucky guess',family:'FORTUNE',defaultAttribute:'luck' as const,rank:'NOVICE' as const,maximumRank:'MASTER' as const,availableMilestones:[1,3],blockedByInstance:false,eligibility:'ELIGIBLE'};v.proficiencies.options=[p];assert.equal(proficiencyEntries([p],'guess','FORTUNE','NOVICE',true).length,1);assert.equal(proficiencyEntries([p],'guess','PHYSICAL','',false).length,0);
 const choice={kind:'PROFICIENCY' as const,id:p.skillId,rulesId:p.rulesId,milestone:1,runId:'run',revision:0};assert.equal(canChooseAdvancement(v,choice),true);for(const patch of [{milestone:2},{rulesId:'other'},{revision:1},{runId:'old'}])assert.equal(canChooseAdvancement(v,{...choice,...patch}),false);p.eligibility='RANK_CAP_REACHED';assert.equal(canChooseAdvancement(v,choice),false);assert.equal(proficiencyStatus({...p,rank:'MASTER'}),'Maximum rank reached');
});
test('attribute and proficiency session actions keep exact envelopes, refresh choices and block repeat/read-only submissions',async()=>{
 for(const kind of ['ATTRIBUTE','PROFICIENCY'] as const){const h=harness();await connect(h);let v=advancementData();v.attributes.rules=[{rulesId:'rules.attributes',rulesRevision:1,maximumScores:{strength:20,dexterity:20,constitution:20,intelligence:20,wisdom:20,charisma:20,luck:20},availableMilestones:[{level:2,points:2,allowedAttributes:['luck']}],blockedByInstance:false}];v.proficiencies.options=[{rulesId:'rules.skills',skillId:'skill.known',name:'Known skill',family:'FORTUNE',defaultAttribute:'luck',rank:'UNTRAINED',maximumRank:'MASTER',availableMilestones:[2],blockedByInstance:false,eligibility:'ELIGIBLE'}];h.setAdvancementRead(async path=>advancementRead(v,path));await h.session.loadAdvancement();h.session.setCharacterSection('progression');const choice={kind,id:kind==='ATTRIBUTE'?'rules.attributes':'skill.known',rulesId:'rules.skills',milestone:2,allocation:{luck:2},runId:'run',revision:0};h.session.snapshot!.game.canWrite=false;await h.session.chooseAdvancement(choice);assert.equal(h.calls.filter(c=>c.init.method==='POST').length,0);h.session.snapshot!.game.canWrite=true;h.setPost(async()=>{h.setRevision(1);v=advancementData(1);return json(kind==='ATTRIBUTE'?{attributes:{luck:12}}:{rank:'NOVICE'});});await h.session.chooseAdvancement(choice);const post=h.calls.filter(c=>c.init.method==='POST');assert.equal(post.length,1);const body=JSON.parse(post[0]!.init.body as string);assert.equal(body.milestone,2);assert.equal(body.expectedRevision,0);if(kind==='ATTRIBUTE')assert.deepEqual(body.allocation,{luck:2});else{assert.equal(body.rank,undefined);assert.equal(body.skillId,'skill.known');}assert.equal(h.session.characterSection,'progression');assert.equal(h.session.advancement!.revision,1);assert.match(h.session.notice.text,kind==='ATTRIBUTE'?/Luck \+2/:/Known skill to Novice/);await h.session.chooseAdvancement(choice);assert.equal(h.calls.filter(c=>c.init.method==='POST').length,1);}
});
test('growth drafts survive rerenders but clear on run transitions; capacity failures explain reserved future points',async()=>{
 const {errorMessage}=await import('../client/api.js');assert.match(errorMessage(new ApiError(409,'ATTRIBUTE_CAPACITY_RESERVED')),/future authored milestones/);const h=harness();await connect(h);let v=advancementData();h.setAdvancementRead(async path=>advancementRead(v,path));await h.session.loadAdvancement();h.session.setAttributeDraft({runId:'run',revision:0,rulesId:'rules.attributes',milestone:2,allocation:{luck:1}});h.session.setProficiencyBrowser({proficiencySearch:'Lucky',proficiencyFamily:'FORTUNE'});h.session.setCharacterSection('progression');assert.deepEqual(h.session.attributeDraft?.allocation,{luck:1});await h.session.refresh();assert.deepEqual(h.session.attributeDraft?.allocation,{luck:1});h.setRun('new-run');v=advancementData(0,'new-run');await h.session.refresh();assert.equal(h.session.attributeDraft,null);assert.equal(h.session.proficiencySearch,'');assert.equal(h.session.proficiencyFamily,'');
});

test('Character display distinguishes unavailable from authored zero and filters only authorized Ability Book entries',async()=>{
 const {knownNumber,knownPercent,carryingValue,abilityEntries}=await import('../client/character-book-model.js');assert.equal(knownNumber(undefined),'Unavailable');assert.equal(knownNumber(null),'Unavailable');assert.equal(knownNumber(0),'0');assert.equal(knownPercent(undefined),'Unavailable');assert.equal(knownPercent(0),'0%');assert.match(carryingValue(undefined,'weight'),/Unavailable/);assert.match(carryingValue({enabled:true,unmeasuredItems:1,weight:'0'} as import('../client/types.js').CarryView,'weight'),/unmeasured/);assert.equal(carryingValue({enabled:true,unmeasuredItems:0,weight:'0'} as import('../client/types.js').CarryView,'weight'),'0');
 const entry:import('../client/types.js').AbilityEntry={id:'known',name:'Warden · Riposte',category:'REACTION',source:{name:'Warden',kind:'CLASS',nativeLevel:1},action:'REACTION',costs:[{name:'Mana',amount:1,clock:null}],cooldownRounds:2,effects:['Physical damage'],restrictions:['Encounter rules apply'],duration:'OWNED'};assert.equal(abilityEntries([entry],'riposte','REACTION','CLASS').length,1);assert.equal(abilityEntries([entry],'physical','ALL','ALL').length,1);assert.equal(abilityEntries([entry],'','UTILITY','ALL').length,0);assert.equal(abilityEntries([entry],'','ALL','EQUIPMENT').length,0);
});
test('Character statistics default to committed gear and share drafts only when explicitly requested',async()=>{
 const h=harness();await connect(h);h.session.snapshot!.game.canWrite=false;h.session.equipmentDraft={runId:'run',revision:0,plan:{activeSet:'B',slots:[]},gear:[]};h.setBookRead(async()=>json({runId:'run',revision:0,contexts:[],current:null,preview:null,reason:'No context'}));await h.session.loadCharacterStats();assert.equal(new URL(h.calls.at(-1)!.path,'http://test').searchParams.has('plan'),false);await h.session.loadCharacterStats('encounter.known',true);assert.deepEqual(JSON.parse(new URL(h.calls.at(-1)!.path,'http://test').searchParams.get('plan')!),{activeSet:'B',slots:[]});assert.equal(h.calls.filter(c=>c.init.method==='POST').length,0);assert.equal(h.session.equipmentDraft.plan.activeSet,'B');assert.equal(h.session.characterStats?.reason,'No context');await h.session.loadCharacterStats(undefined,false);assert.equal(new URL(h.calls.at(-1)!.path,'http://test').searchParams.get('contextId'),'encounter.known');assert.equal(new URL(h.calls.at(-1)!.path,'http://test').searchParams.has('plan'),false);
});
test('Character read models reject crossed scope, forget late logout responses, and remain optional to core game reads',async()=>{
 const h=harness();await connect(h);h.setBookRead(async()=>json({runId:'other',revision:0,entries:[]}));await h.session.loadAbilityBook();assert.equal(h.session.abilityBook,null);assert.equal(h.session.abilityBookNeedsRefresh,true);assert.equal(h.session.needsRefresh,false);assert.ok(h.session.snapshot);let finish!:(r:Response)=>void;h.setBookRead(async()=>new Promise<Response>(resolve=>finish=resolve));const pending=h.session.loadAbilityBook();await h.session.logout();finish(json({runId:'run',revision:0,entries:[]}));await pending;assert.equal(h.session.abilityBook,null);assert.equal(h.session.abilityBookBusy,false);
 const next=harness();await connect(next);next.setBookRead(async()=>json({error:'TECHNICAL_FAILURE'},503));await next.session.loadCharacterStats();assert.ok(next.session.characterStatsError);assert.equal(next.session.needsRefresh,false);assert.ok(next.session.snapshot);
});
test('Character sections and committed reads refresh on reconnect; new runs clear filters and context',async()=>{
 const h=harness();await connect(h);h.setBookRead(async path=>json(path.includes('/abilities')?{runId:'run',revision:0,activeInstance:false,activeSet:'A',entries:[],truncated:false,notes:[]}:{runId:'run',revision:0,contexts:[],current:null,preview:null}));h.session.setCharacterSection('abilities');await h.session.loadAbilityBook();assert.ok(h.session.abilityBook);h.session.setAbilityBrowser({abilitySearch:'Riposte',abilityCategory:'REACTION',abilitySelection:'known'});await h.session.refresh();assert.equal(h.session.characterSection,'abilities');assert.equal(h.session.abilityBook,null);await h.session.loadAbilityBook();assert.ok(h.session.abilityBook);h.session.characterStatsContext='encounter.old';h.setRun('new-run');await h.session.refresh();assert.equal(h.session.characterSection,'overview');assert.equal(h.session.abilityBook,null);assert.equal(h.session.abilitySearch,'');assert.equal(h.session.abilitySelection,null);assert.equal(h.session.characterStatsContext,undefined);
});

test('a vanished Character statistics context can be retried against the available catalog',async()=>{
 const h=harness();await connect(h);let fail=true;h.setBookRead(async()=>fail?json({error:'STAT_CONTEXT_NOT_FOUND'},404):json({runId:'run',revision:0,contexts:[],current:null,preview:null,reason:'No context'}));await h.session.loadCharacterStats('encounter.old');assert.equal(h.session.characterStatsContext,undefined);assert.match(h.session.characterStatsError!,/Retry statistics/);fail=false;await h.session.loadCharacterStats();assert.equal(new URL(h.calls.at(-1)!.path,'http://test').searchParams.has('contextId'),false);assert.equal(h.session.characterStats!.reason,'No context');
});

test('Character navigation indicators count known earned decisions once, not alternatives or upcoming rewards',async()=>{
 const {pendingCharacterChoices,historyTime}=await import('../client/character-history-model.js');const h=harness();await connect(h);h.session.snapshot!.progression.readiness={pendingLevels:3,nextThreshold:'500'};const v=advancementData();v.feats.options.push({...v.feats.options[0]!,featId:'feat.alternative'});v.subclasses.options.push({...v.subclasses.options[0]!,subclassId:'sub.alternative'});assert.equal(pendingCharacterChoices(h.session.snapshot!,v),'6 known pending');assert.equal(pendingCharacterChoices(h.session.snapshot!,null),'3 pending levels');assert.equal(pendingCharacterChoices(h.session.snapshot!,advancementData(1)),'3 pending levels');v.activeInstance=true;assert.equal(pendingCharacterChoices(h.session.snapshot!,v),'6 known pending');assert.equal(historyTime(null),null);assert.equal(historyTime('invalid'),null);assert.equal(historyTime('2026-10-17T12:34:56.000Z')!.iso,'2026-10-17T12:34:56.000Z');
});
test('Character history pages retain section and offset on navigation/refresh, then reset across new runs',async()=>{
 const h=harness();await connect(h);let currentRun='run';h.setBookRead(async path=>{const q=new URL(path,'http://test').searchParams;return json({runId:currentRun,revision:0,activeInstance:false,entries:[],total:30,offset:Number(q.get('offset')),pageSize:25,hasMore:false});});h.session.setCharacterSection('history');await h.session.loadCharacterHistory(25);assert.equal(h.session.characterHistory!.offset,25);h.session.setCharacterSection('statistics');h.session.setCharacterSection('history');assert.equal(h.session.characterHistory!.offset,25);await h.session.refresh();assert.equal(h.session.characterSection,'history');assert.equal(h.session.characterHistory,null);await h.session.loadCharacterHistory();assert.equal(h.session.characterHistory!.offset,25);h.setRun('next-life');currentRun='next-life';await h.session.refresh();assert.equal(h.session.characterSection,'overview');assert.equal(h.session.characterHistoryOffset,0);assert.equal(h.session.characterHistory,null);
});
test('Character history rejects crossed revisions and late logout responses without disabling unrelated reads',async()=>{
 const h=harness();await connect(h);h.setBookRead(async()=>json({runId:'run',revision:1,entries:[]}));await h.session.loadCharacterHistory();assert.equal(h.session.characterHistory,null);assert.equal(h.session.characterHistoryNeedsRefresh,true);assert.equal(h.session.needsRefresh,false);let finish!:(r:Response)=>void;h.setBookRead(async()=>new Promise<Response>(resolve=>finish=resolve));const read=h.session.loadCharacterHistory();await h.session.logout();finish(json({runId:'run',revision:0,entries:[]}));await read;assert.equal(h.session.characterHistory,null);assert.equal(h.session.characterHistoryBusy,false);
});
test('a committed advancement invalidates Statistics, Ability Book and History while preserving the current Character section',async()=>{
 const h=harness();await connect(h);let v=advancementData(),revision=0;h.setAdvancementRead(async path=>advancementRead(v,path));h.setBookRead(async path=>json(path.includes('/history')?{runId:'run',revision,activeInstance:false,entries:[],total:revision?2:1,offset:0,pageSize:25,hasMore:false}:path.includes('/abilities')?{runId:'run',revision,activeInstance:false,entries:[],activeSet:'A',notes:[],truncated:false}:{runId:'run',revision,contexts:[],current:null,preview:null}));await h.session.loadAdvancement();await h.session.loadCharacterStats();await h.session.loadAbilityBook();await h.session.loadCharacterHistory();h.session.setCharacterSection('history');h.setPost(async()=>{revision=1;h.setRevision(1);v=advancementData(1);return json({build:{classes:[{classId:'class.known',nativeLevel:5}]}});});await h.session.chooseAdvancement({kind:'CLASS',id:'class.known',runId:'run',revision:0});assert.equal(h.session.characterSection,'history');assert.equal(h.session.characterStats,null);assert.equal(h.session.abilityBook,null);assert.equal(h.session.characterHistory,null);assert.equal(h.session.advancement!.revision,1);await h.session.loadCharacterHistory();assert.equal(h.session.characterHistory!.total,2);assert.equal(h.session.characterHistory!.revision,1);assert.equal(h.calls.filter(c=>c.init.method==='POST').length,1);
});

test('Character presentation preferences survive a tab session without storing game evidence or crossing runs',async()=>{
 const {readCharacterView,saveCharacterView,clearCharacterView}=await import('../client/character-preferences.js');const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};saveCharacterView('current-run','history',25,storage);assert.deepEqual(readCharacterView('current-run',storage),{section:'history',offset:25});assert.equal(readCharacterView('other-run',storage),null);assert.deepEqual(Object.keys(JSON.parse([...values.values()][0]!)).sort(),['offset','runId','section']);clearCharacterView(storage);assert.equal(readCharacterView('current-run',storage),null);storage.setItem('follybound.character.view.v1','{"runId":"current-run","section":"unsafe","offset":25}');assert.equal(readCharacterView('current-run',storage),null);const denied={getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('quota');},removeItem:()=>{throw Error('denied');}};assert.equal(readCharacterView('current-run',denied),null);assert.doesNotThrow(()=>saveCharacterView('current-run','history',25,denied));assert.doesNotThrow(()=>clearCharacterView(denied));
});

test('shell navigation keeps all public page names and places Combat under Adventure',()=>{for(const screen of ['adventure','character','pack','combat']as const)assert.equal(shellChapter(screen),({adventure:'Adventure',character:'Character',pack:'Pack',combat:'Combat'})[screen]);assert.equal(shellNavigationPage('combat'),'adventure');assert.equal(shellNavigationPage('character'),'character');assert.equal(shellNavigationPage('pack'),'pack');for(const screen of ['adventure','character','pack']as const)for(const hasBattle of [true,false])assert.equal(shellRenderedScreen(screen,hasBattle),screen);assert.equal(shellChapter(shellRenderedScreen('combat',false)),'Adventure');assert.equal(shellChapter(shellRenderedScreen('combat',true)),'Combat');});
test('shell feedback identifies states without changing action messages',()=>{assert.equal(shellNoticeLabel('error',false),'Error');assert.equal(shellNoticeLabel('success',false),'Success');assert.equal(shellNoticeLabel('warning',false),'Warning');assert.equal(shellNoticeLabel('info',false),'Information');assert.equal(shellNoticeLabel('info',true),'Connecting');});


test('Character folio specialization labels require the current owned build and revision',async()=>{
 const h=harness();await connect(h);const s=h.session.snapshot!,view=advancementData();s.progression.build.classes=[{classId:'class.known',nativeLevel:5}];
 view.subclasses.selected=[{classId:'class.known',subclassId:'sub.known',name:'Known specialization'},{classId:'class.other',subclassId:'sub.foreign',name:'Other build'}];
 assert.deepEqual(knownSpecializations(s,view),[{classId:'class.known',name:'Known specialization'}]);assert.equal(knownSpecializations(s,null),null);assert.equal(knownSpecializations(s,{...view,runId:'another-run'}),null);assert.equal(knownSpecializations(s,{...view,revision:1}),null);
 s.progression.build.classes=[];assert.deepEqual(knownSpecializations(s,view),[]);
});
test('Ability Book compact costs distinguish unknown, absent authored cost and explicit zero',()=>{
 assert.equal(abilityCostText(null),'Cost unavailable');assert.equal(abilityCostText([]),'No authored resource cost');assert.equal(abilityCostText([{name:'Mana',amount:0,clock:null}]),'0 Mana');assert.equal(abilityCostText([{name:'Mana',amount:2,clock:null},{name:'Focus',amount:1,clock:'COMBAT_ROUND'}]),'2 Mana · 1 Focus');
});
 test('equipment ledger states preserve unknown condition, percentage thresholds and inspection during locks',()=>{
 const state=(item:{condition:number|null;maximumCondition:number|null}|null,selected=false,compatible=false,blocked=false,twoHand=false)=>equipmentSlotPresentation(item,selected,compatible,blocked,twoHand,defaultTileSettings);
 assert.equal(state(null).hint,'Search equipment');assert.equal(state(null).condition,null);
 assert.match(state(null,false,false,false,true).className,/two-handed/);
 assert.equal(state({condition:null,maximumCondition:null}).condition,null);
 assert.equal(state({condition:180,maximumCondition:250}).condition?.state,'healthy');
 assert.match(state({condition:46,maximumCondition:100}).className,/damaged/);
 assert.equal(state({condition:0,maximumCondition:250}).broken,true);
 assert.match(state(null,true,true).className,/compatible/);assert.equal(state(null,true,false).hint,'Does not fit selected item');
 assert.equal(state(null,true,true,true).hint,'Changes locked');
 assert.equal(state({condition:0,maximumCondition:250},false,false,true).broken,true);
 });
test('campaign entry presentation preserves entry gates and explicit unavailable explanations',()=>{
 const s={game:{canWrite:true,run:{turns:2},carry:{state:'COMFORTABLE'}},progression:{build:{mode:'CONFIGURED'}}} as Snapshot;
 assert.equal(adventureAvailability(s,2,false).unavailable,false);
 assert.equal(adventureAvailability(s,3,false).label,'Insufficient Turns');
 assert.equal(adventureAvailability(s,1,true).label,'Temporarily unavailable');
 const unchanged=structuredClone(s);assert.equal(adventureAvailability({...s,game:{...s.game,canWrite:false}},1,true).label,'View only');
 assert.equal(adventureAvailability({...s,progression:{...s.progression,build:{mode:'UNCONFIGURED'}}},1,false).label,'Starting build required');
 for(const state of ['OVERLOADED','UNMEASURED'])assert.equal(adventureAvailability({...s,game:{...s.game,carry:{...s.game.carry!,state}}},1,false).label,'Carrying restriction');
 assert.deepEqual(s,unchanged);
});
test('combat turn presentation distinguishes manual companions, server turns, read-only and completed encounters',()=>{
 const b={currentActor:'companion',outcome:null,units:[{id:'companion',side:'PARTY'}],partyCapabilities:[{id:'companion',control:'PLAYER'}]} as import('../client/types.js').Tactical;
 assert.equal(combatTurn(b,false).label,'Party turn');
 assert.equal(combatTurn({...b,partyCapabilities:[{...b.partyCapabilities[0]!,control:'SERVER'}]},false).server,true);
 assert.equal(combatTurn({...b,units:[{...b.units[0]!,side:'ENEMY'}]},false).label,'World turn');
 assert.match(combatTurn(b,true).description,/View-only/);
 assert.equal(combatTurn({...b,currentActor:null,units:[]},false).label,'Saved encounter');
 assert.equal(combatTurn({...b,outcome:'VICTORY',currentActor:null},false).label,'Victory');
});

test('journey links never open an active fight on behalf of an older recorded outcome',()=>{
 const s={battle:{instanceId:'active-fight'}} as Snapshot;
 assert.equal(canOpenJourneyRecord(s,'older-record'),false);assert.equal(canOpenJourneyRecord(s,'active-fight'),true);assert.equal(canOpenJourneyRecord({...s,battle:null},'older-record'),false);
});

test('shared ink motifs remain bounded local vector paths across all feature families',()=>{
 for(const [family,icons]of Object.entries(iconCatalog)){
  assert.ok(Object.keys(icons).length>=9,family);
  for(const [name,path]of Object.entries(icons)){assert.ok(path.length>5&&path.length<700,family+':'+name);assert.match(path,/^[Mm]/);assert.doesNotMatch(path,/[<>]|url|https|data:/i);}
 }
 for(const attr of ['strength','dexterity','constitution','intelligence','wisdom','charisma','luck'])assert.ok(Object.hasOwn(iconCatalog.character,attr));
 for(const status of ['favorite','new','locked','equipped','durability','collection'])assert.ok(Object.hasOwn(iconCatalog.status,status));
 for(const name of ['health','mana','warning','success','error','weight','journal'])assert.ok(Object.hasOwn(iconCatalog.common,name));
});

test('Turns planner rejects mixed revisions and forgets delayed account data after sign out',async()=>{
 const h=harness();await connect(h);const view=turnFixture(h.session.snapshot!);h.setTurnsRead(async()=>json({...view,revision:1}));await h.session.loadTurns();assert.equal(h.session.turns,null);assert.match(h.session.turnsError!,/game changed/i);
 let finish!:(r:Response)=>void;h.setTurnsRead(()=>new Promise(r=>finish=r));const pending=h.session.loadTurns();await h.session.logout();finish(json(view));await pending;assert.equal(h.session.turns,null);assert.equal(h.session.turnsBusy,false);assert.equal(h.session.snapshot,null);
});
test('reserve warning preserves the original intent and only explicit confirmation adds permission',async()=>{
 const h=harness();await connect(h);h.setPost(async()=>json({error:'TURN_RESERVE_CONFIRMATION_REQUIRED'},409));await h.session.action('/api/v1/rules/interaction','RESOLVE_RULE_INTERACTION',{entityId:'activity.work'});assert.equal(h.session.pending,null);assert.equal(h.session.reserveAction?.parameters.entityId,'activity.work');assert.equal(h.calls.filter(c=>c.init.method==='POST').length,1);
 h.setPost(async()=>{h.setRevision(1);return json({revision:1});});await h.session.confirmReserveAction();const body=JSON.parse(String(h.calls.filter(c=>c.init.method==='POST').at(-1)!.init.body));assert.equal(body.confirmReserve,true);assert.equal(body.entityId,'activity.work');assert.equal(body.expectedRevision,0);assert.equal(h.session.reserveAction,null);
});
test('repeat plans stop on an uncertain response and retain one exact retry intent',async()=>{
 const h=harness();await connect(h);const view=turnFixture(h.session.snapshot!);view.plans[0]!.status='ACTIVE';h.setTurnsRead(async()=>json(view));await h.session.loadTurns();h.setPost(async()=>{throw Error('reply lost');});await h.session.runTurnPlan(view.plans[0]!.id);assert.equal(h.calls.filter(c=>c.init.method==='POST').length,1);assert.equal(h.session.runningTurnPlan,null);assert.equal(h.session.pending?.body.actionType,'STEP_TURN_PLAN');assert.equal(h.session.pending?.body.planId,view.plans[0]!.id);assert.match(h.session.notice.text,/may have completed/);
});
test('Turns navigation is stable and saved repeat drafts clear between accounts',async()=>{
 const h=harness();await connect(h);assert.equal(shellChapter('daily'),'Turns & daily planner');assert.equal(shellNavigationPage('daily'),'adventure');h.session.turnPlanDraft={runId:'run',entityId:'activity.work',maxTurns:10,maxActions:5,minHealth:0,targetItemId:'',targetQuantity:1};await h.session.logout();assert.equal(h.session.turnPlanDraft,null);assert.equal(h.session.reserveAction,null);assert.equal(h.session.runningTurnPlan,null);
});
