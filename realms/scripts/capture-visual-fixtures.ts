import { writeFile } from 'node:fs/promises';
import { ApiClient } from '../client/api.js';
import { GameSession } from '../client/session.js';
// Explicit refresh only: never capture arbitrary hosts, accounts or production data.
for(const [name,port,handle]of [['character',3008,'wayfarer'],['pack',3001,'wayfarer'],['combat',3011,'dense'],['setup',3011,'newcomer'],['adventure',3011,'road']]as const){
 const base='http://127.0.0.1:'+port;
 const transport=async(path:string,init?:RequestInit)=>{
  const response=await fetch(base+path,init);
  if(response.headers.get('x-follybound-fixture')!=='disposable-visual')throw Error('Refusing a server without the disposable fixture marker');return response;
 };
 const session=new GameSession(new ApiClient(transport));await session.initialize();
 if(!session.config)throw Error('Start all three documented disposable preview processes first.');
 await session.connect({handle,password:'A road worth wandering 47!'});if(!session.snapshot)throw Error('Fixture login failed: '+name);
 await session.browseInventory({sort:'NAME',direction:'ASC',grouped:false,offset:0});
 await session.loadAdvancement();await session.previewEquipment();await session.loadCharacterStats();await session.loadAbilityBook();await session.loadCharacterHistory();
 const fixture={schemaVersion:1,source:'Public projections from disposable '+name+' fixture; frozen for repeatable presentation checks.',snapshot:session.snapshot,inventory:session.inventory,advancement:session.advancement,equipmentPreview:session.equipmentPreview,characterStats:session.characterStats,abilityBook:session.abilityBook,characterHistory:session.characterHistory};
 // Signed inspection acknowledgements are not presentation facts.
 const json=JSON.stringify(fixture,(key,value)=>key==='inspectionToken'?'':value,2)+'\n';
 if(/"(?:password|token|authorization|throttleKey)"\s*:/i.test(json))throw Error('Unexpected credential-shaped field in public fixture');
 await writeFile(new URL('../test/visual-fixtures/'+name+'.json',import.meta.url),json);await session.logout();console.log('Captured public '+name+' fixture.');
}
