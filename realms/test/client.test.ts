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
 }finally{await app.close();}
});
function harness(authMode:'development'|'sessions'='development'){
 let inventoryRead:(path:string)=>Promise<Response>=async()=>json({revision,runId,items:[],total:0,offset:0,pageSize:48,containers:[],hasMoreContainers:false,preferences:{autoStoreMaterials:false,autoOverflow:false}});
 let revision=0,canWrite=true,runId='run',status='ACTIVE',post:(path:string,init:RequestInit)=>Promise<Response>=async(path)=>json(path.endsWith('/login')?{token:'private-token'}:{}),readsFail=false;
 const calls:{path:string;init:RequestInit}[]=[];
 const fetcher:Fetcher=async(path,init={})=>{calls.push({path,init});if(init.method==='POST')return post(path,init);
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
 return {session,calls,setInventoryRead:(read:(path:string)=>Promise<Response>)=>{inventoryRead=read;},setStatus:(s:string)=>{status=s;},setRun:(r:string)=>{runId=r;},setRevision:(n:number)=>{revision=n;},setWrite:(value:boolean)=>{canWrite=value;},setPost:(fn:typeof post)=>{post=fn;},setReadFailure:(value:boolean)=>{readsFail=value;}};
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
test('inventory success feedback describes confirmed changes, costs and no-ops',async()=>{const {inventorySuccess}=await import('../client/inventory-usability.js');const items=[{id:'vial',name:'Road tonic'}];assert.equal(inventorySuccess('USE_ITEM',{itemId:'vial'},{kind:'USE',remaining:'4'},items),'Used Road tonic; 4 remaining.');assert.equal(inventorySuccess('REPAIR_ITEMS',{}, {items:[{},{}],total:'70'},items),'Repaired 2 items for 70 Gold.');assert.match(inventorySuccess('BULK_INVENTORY',{operation:'COLLECT'},{changed:0},items),/^No items changed/);assert.equal(inventorySuccess('MOVE_INVENTORY',{itemId:'vial',kind:'HOME'},{},items),'Moved Road tonic to home storage.');assert.match(inventorySuccess('SET_INVENTORY_WORKSPACE',{layout:'COMPACT'},{},items),/Compact.*saved to your account/);});
test('compact comparison preserves unknown facts and never compares a grouped representative',async()=>{const {quickComparison}=await import('../client/inventory-usability.js');const item={id:'candidate',name:'Very long candidate name',definitionId:'item.candidate',multipleLocations:false,groupWeight:'2',groupBulk:'1',groupQuantity:'1',category:'EQUIPMENT',rarity:'COMMON',description:'',family:'Equipment',qualityLabel:'Known',numericQuality:'1',totalWeight:'2',totalBulk:'1',equipped:false,protected:false,containerId:'carried',storageMode:'INSTANCE',accessible:true,kind:'CARRIED',quantity:'1',binding:'TRADEABLE',equipment:{version:2,slots:['HEAD'],hands:0,minimumLevel:1,bindingPolicy:'PRESERVE'},eligible:true,proficiencyMet:true,locked:false,loadouts:[],knownStats:{armor:4},unitWeight:'2',unitBulk:'1',condition:87,maximumCondition:100,copies:1} as import('../client/types.js').InventoryItem;const current={id:'current',name:'Current helm',binding:'TRADEABLE',slots:['HEAD'],hands:0,minimumLevel:1,bindingPolicy:'PRESERVE',eligible:true,proficiencyMet:true,manualLocked:false,protectedLoadouts:[],knownStats:null,condition:180,maximumCondition:250,unitWeight:null};const plan={activeSet:'A' as const,slots:[{set:'WORN' as const,slot:'HEAD',itemId:'current'}]};const comparison=quickComparison(item,plan,[current],false)!;assert.match(comparison.title,/Current helm/);assert.equal(quickComparison({...item,equipment:null},plan,[current],true),null);assert.ok(comparison.lines.includes('armor: Unknown → 4'));assert.ok(comparison.lines.includes('Condition %: 72 → 87'));assert.deepEqual(quickComparison({...item,copies:2},plan,[current],true)!.lines,['Expand matching copies to compare individual equipment.']);});
