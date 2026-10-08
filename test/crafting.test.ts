import { test } from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { actor,testDatabase } from './helpers.js';
import { publishContent,validateContent,type ContentPackage } from '../src/domains/content.js';
import { craftRoutine,routineRecipeView } from '../src/domains/crafting.js';
import { executeAction,advanceRevision } from '../src/foundation/action.js';
import { grantItem,consumeItem } from '../src/domains/item-accounting.js';
import { integrityReport,unindexedForeignKeys } from '../src/foundation/integrity.js';
import { buildApp } from '../src/app.js';
import { ascend } from '../src/domains/lifecycle.js';
const pkg:ContentPackage={version:'craft-fixture',engineVersion:'foundation-1',entities:[
 ...['ore','coal','bar'].map(name=>({id:`item.${name}`,kind:'ITEM' as const,revision:1,schemaVersion:1,definition:{name,dependencies:[],public:{},mechanics:{inventory:{version:1,storageMode:'STACK',category:'MATERIAL'}}}})),
 {id:'recipe.bar',kind:'RECIPE',revision:1,schemaVersion:1,definition:{name:'Basic bar processing',dependencies:['item.ore','item.coal','item.bar'],public:{},secrets:{hidden:'unexposed'},mechanics:{routineRecipe:{version:1,ruleset:'TRIVIAL_PROCESSING_V1',access:'DISCOVERED_CURRENT_RUN',turnCost:0,maxBatch:10,inputs:[{itemId:'item.ore',quantity:2},{itemId:'item.coal',quantity:1}],output:{itemId:'item.bar',quantity:1}}}}}
]};
const env=(revision:number,actionType='CRAFT_ROUTINE')=>({requestId:randomUUID(),expectedRevision:revision,actionType});
async function fixture(pool:Awaited<ReturnType<typeof testDatabase>>['pool'],binding:'TRADEABLE'|'ACCOUNT_BOUND'|'RUN_BOUND'='TRADEABLE'){
 const release=await publishContent(pool,pkg),f=await actor(pool,release,8);
 const container=(await pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'CARRIED' FROM state_scopes WHERE run_id=$1 RETURNING id",[f.run])).rows[0].id;
 await pool.query("INSERT INTO discoveries(account_id,entity_id,knowledge_level) VALUES($1,'recipe.bar','LEARNED')",[f.account]);
 const grant=await executeAction(pool,f.account,env(0,'MATERIAL_FIXTURE'),{},async c=>{const ore=await grantItem(c,'ore',{containerId:container,definitionId:'item.ore',quantity:'20',binding,sourceCode:'FIXTURE'},'FIXTURE'),coal=await grantItem(c,'coal',{containerId:container,definitionId:'item.coal',quantity:'10',sourceCode:'FIXTURE'},'FIXTURE');return {ore:ore.itemId,coal:coal.itemId,revision:await advanceRevision(c)};});
 return {...f,release,container,ids:[grant.ore as string,grant.coal as string]};
}
test('routine batch consumes exact materials, records provenance and replays once without spending Turns',async()=>{
 const db=await testDatabase();try{const f=await fixture(db.pool),request=env(1),run=()=>craftRoutine(db.pool,f.account,request,'recipe.bar',3,f.ids);
 const results=await Promise.all(Array.from({length:4},run));assert.equal(results.filter(x=>!x.replayed).length,1);
 const result=results[0]!;assert.equal(result.quantity,'3');assert.equal(result.revision,2);assert.equal(result.binding,'TRADEABLE');
 assert.deepEqual((await db.pool.query('SELECT quantity::text FROM inventory_items WHERE id=ANY($1::uuid[]) ORDER BY definition_id',[f.ids])).rows.map(x=>x.quantity),['7','14']);
 const output=(await db.pool.query('SELECT * FROM inventory_items WHERE id=$1',[result.itemId])).rows[0];assert.equal(output.metadata.makerCharacterId,f.character);assert.equal(output.release_id,f.release);
 assert.equal((await db.pool.query('SELECT turns FROM runs WHERE id=$1',[f.run])).rows[0].turns,8);
 assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM craft_records')).rows[0].n,1);
 assert.equal((await integrityReport(db.pool)).craftMismatches,0);assert.deepEqual(await unindexedForeignKeys(db.pool),[]);
 await assert.rejects(craftRoutine(db.pool,f.account,request,'recipe.bar',2,f.ids),/REQUEST_ID_REUSED/);
 }finally{await db.close();}
});
test('binding survives crafting and Ascension stores ordinary outputs without reusing archived materials',async()=>{
 const db=await testDatabase();try{
 for(const binding of ['ACCOUNT_BOUND','RUN_BOUND'] as const){const f=await fixture(db.pool,binding),r=await craftRoutine(db.pool,f.account,env(1),'recipe.bar',1,f.ids);assert.equal(r.binding,binding);
 await db.pool.query("UPDATE runs SET status='AFTERCORE' WHERE id=$1",[f.run]);const next=await ascend(db.pool,f.account,env(2,'ASCEND'));
 const item=(await db.pool.query('SELECT s.run_id,s.account_id FROM inventory_items i JOIN inventory_containers c ON c.id=i.container_id JOIN state_scopes s ON s.id=c.scope_id WHERE i.id=$1',[r.itemId])).rows[0];
 assert.equal(binding==='RUN_BOUND'?item.run_id:item.account_id,binding==='RUN_BOUND'?f.run:f.account);
 await assert.rejects(craftRoutine(db.pool,f.account,env(0),'recipe.bar',1,f.ids),/CRAFT_MATERIAL_NOT_OWNED/);assert.ok(next.runId);
 assert.equal((await routineRecipeView(db.pool,f.account,'recipe.bar')).name,'Basic bar processing');}
 }finally{await db.close();}
});
test('foreign, undiscovered, mismatched, insufficient and duplicate materials fail with no partial consumption',async()=>{
 const db=await testDatabase();try{const f=await fixture(db.pool),other=await fixture(db.pool),before=(await db.pool.query('SELECT id,quantity FROM inventory_items ORDER BY id')).rows;
 await assert.rejects(craftRoutine(db.pool,f.account,env(1),'recipe.bar',1,other.ids),/CRAFT_MATERIAL_NOT_OWNED/);
 await assert.rejects(craftRoutine(db.pool,f.account,env(1),'recipe.bar',1,[...f.ids].reverse()),/CRAFT_MATERIAL_INELIGIBLE/);
 await assert.rejects(craftRoutine(db.pool,f.account,env(1),'recipe.bar',11,f.ids),/INVALID_CRAFT_BATCH/);
 assert.throws(()=>craftRoutine(db.pool,f.account,env(1),'recipe.bar',1,[f.ids[0]!,f.ids[0]!]),/INVALID_CRAFT_BATCH/);
 await craftRoutine(db.pool,f.account,env(1),'recipe.bar',10,f.ids);
 await assert.rejects(craftRoutine(db.pool,f.account,env(2),'recipe.bar',1,f.ids),/INSUFFICIENT_ITEM_QUANTITY/);
 assert.equal(before.length,4);assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM craft_records')).rows[0].n,1);
 await db.pool.query("DELETE FROM discoveries WHERE account_id=$1 AND entity_id='recipe.bar'",[other.account]);
 await assert.rejects(craftRoutine(db.pool,other.account,env(1),'recipe.bar',1,other.ids),/RECIPE_NOT_KNOWN/);
 }finally{await db.close();}
});
test('late database failure rolls back inputs, output, craft history and Action receipt',async()=>{
 const db=await testDatabase();try{const f=await fixture(db.pool),before=(await db.pool.query('SELECT id,quantity FROM inventory_items ORDER BY id')).rows;
 await db.pool.query("CREATE FUNCTION force_craft_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Forced craft failure'; END $$; CREATE TRIGGER fail_craft BEFORE INSERT ON craft_inputs FOR EACH ROW EXECUTE FUNCTION force_craft_failure()");
 const request=env(1);await assert.rejects(craftRoutine(db.pool,f.account,request,'recipe.bar',1,f.ids),/Forced craft failure/);
 assert.deepEqual((await db.pool.query('SELECT id,quantity FROM inventory_items ORDER BY id')).rows,before);
 assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM craft_records')).rows[0].n,0);
 assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM action_receipts WHERE request_id=$1',[request.requestId])).rows[0].n,0);
 await db.pool.query('DROP TRIGGER fail_craft ON craft_inputs');await craftRoutine(db.pool,f.account,request,'recipe.bar',1,f.ids);
 }finally{await db.close();}
});
test('publication and newer releases cannot bypass trivial recipe limits or change existing run costs',async()=>{
 validateContent(pkg);
 for(const patch of [{turnCost:1},{ruleset:'GENERAL_CRAFT'},{maxBatch:101},{output:{itemId:'item.ore',quantity:1}},{inputs:[]},{quality:100}]){const bad=structuredClone(pkg);Object.assign(bad.entities[3]!.definition.mechanics!.routineRecipe as object,patch);assert.throws(()=>validateContent(bad));}
 const db=await testDatabase();try{const f=await fixture(db.pool),next=structuredClone(pkg);next.version='craft-fixture-2';next.entities[3]!.revision=2;
 (next.entities[3]!.definition.mechanics!.routineRecipe as {output:{quantity:number}}).output.quantity=9;await publishContent(db.pool,next);
 const r=await craftRoutine(db.pool,f.account,env(1),'recipe.bar',1,f.ids);assert.equal(r.quantity,'1');assert.equal((await db.pool.query('SELECT release_id FROM craft_records')).rows[0].release_id,f.release);
 }finally{await db.close();}
});
test('SQL rejects orphan crafting operations and craft history is immutable',async()=>{
 const db=await testDatabase();try{const f=await fixture(db.pool);
 await assert.rejects(executeAction(db.pool,f.account,env(1),{},async c=>{await db.pool.query('SELECT 1');return {...await grantItem(c,'craft.output',{containerId:f.container,definitionId:'item.bar',quantity:'1',sourceCode:'ROUTINE_CRAFT'},'ROUTINE_CRAFT_OUTPUT')};}),/Routine craft/);
 await craftRoutine(db.pool,f.account,env(1),'recipe.bar',1,f.ids);
 for(const sql of ['UPDATE craft_records SET batches=2','DELETE FROM craft_records','DELETE FROM craft_inputs'])await assert.rejects(db.pool.query(sql),/Immutable record/);
 await db.pool.query('ALTER TABLE craft_inputs DISABLE TRIGGER immutable_craft_input');await db.pool.query('DELETE FROM craft_inputs WHERE line_index=0');await db.pool.query('ALTER TABLE craft_inputs ENABLE TRIGGER immutable_craft_input');assert.ok((await integrityReport(db.pool)).craftMismatches>0);
 }finally{await db.close();}
});
test('HTTP derives ownership and returns an explicit safe preview; forged output fields are rejected',async()=>{
 const db=await testDatabase();try{const f=await fixture(db.pool),app=buildApp(db.pool,{mode:'development',accountId:f.account,token:'test-token'}),headers={authorization:'Bearer test-token'};
 try{const view=await app.inject({method:'GET',url:'/api/v1/crafting/recipes/recipe.bar',headers});assert.equal(view.statusCode,200);assert.equal(view.json().turnCost,0);assert.equal(view.json().secrets,undefined);
 const payload={...env(1),recipeId:'recipe.bar',batches:1,itemIds:f.ids};assert.equal((await app.inject({method:'POST',url:'/api/v1/crafting/routine',headers,payload:{...payload,quality:99}})).statusCode,400);
 assert.equal((await app.inject({method:'POST',url:'/api/v1/crafting/routine',payload})).statusCode,401);
 assert.equal((await app.inject({method:'POST',url:'/api/v1/crafting/routine',headers,payload})).statusCode,200);
 }finally{await app.close();}
 }finally{await db.close();}
});

test('restricted SQL runtime crafts while history stays append-only; read-only sessions cannot craft',async()=>{
 const db=await testDatabase(),pool=db.pool,role=`probe_${randomUUID().replaceAll('-','')}`;let created=false;
 try{const f=await fixture(pool);await pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);created=true;
 await pool.query(`GRANT USAGE ON SCHEMA ${db.schema} TO ${role};GRANT SELECT ON ALL TABLES IN SCHEMA ${db.schema} TO ${role};
 GRANT INSERT,UPDATE ON accounts,runs,inventory_items,inventory_containers,state_scopes TO ${role};GRANT INSERT ON craft_records,craft_inputs,inventory_quantity_operations,action_receipts,audit_events,outbox_events TO ${role};GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ${db.schema} TO ${role}`);
 const client=await pool.connect();try{await client.query(`SET ROLE ${role}`);const asRole={connect:async()=>({query:client.query.bind(client),release:()=>{}})} as unknown as pg.Pool;
 await craftRoutine(asRole,f.account,env(1),'recipe.bar',1,f.ids);
 for(const sql of ['UPDATE craft_records SET batches=batches','DELETE FROM craft_inputs'])await assert.rejects(client.query(sql),(e:{code?:string})=>e.code==='42501');
 }finally{await client.query('RESET ROLE');client.release();}
 const token='rs1_'+randomBytes(32).toString('base64url');await pool.query(`INSERT INTO auth_sessions(account_id,token_digest,security_epoch,scopes,device_label,expires_at) SELECT id,$2,security_epoch,ARRAY['GAME_READ'],'Read only',now()+interval '1 hour' FROM accounts WHERE id=$1`,[f.account,createHash('sha256').update(token).digest('hex')]);
 const app=buildApp(pool,{mode:'sessions',throttleKey:'craft-test-throttle-key-long-enough'}),headers={authorization:`Bearer ${token}`};try{
 assert.equal((await app.inject({method:'GET',url:'/api/v1/crafting/recipes/recipe.bar',headers})).statusCode,200);
 assert.equal((await app.inject({method:'POST',url:'/api/v1/crafting/routine',headers,payload:{...env(2),recipeId:'recipe.bar',batches:1,itemIds:f.ids}})).statusCode,403);
 }finally{await app.close();}assert.equal((await integrityReport(pool)).craftMismatches,0);
 }finally{if(created){await pool.query(`DROP OWNED BY ${role}`);await pool.query(`DROP ROLE ${role}`);}await db.close();}
});

test('SQL rejects binding laundering; high-quality and protected materials cannot be silently processed',async()=>{
 const db=await testDatabase(),pool=db.pool;
 try{const f=await fixture(pool,'RUN_BOUND');
 await assert.rejects(executeAction(pool,f.account,env(1),{},async c=>{
 const inputs=[await consumeItem(c,'craft.input.0',f.ids[0]!,'2','ROUTINE_CRAFT_INPUT'),await consumeItem(c,'craft.input.1',f.ids[1]!,'1','ROUTINE_CRAFT_INPUT')];
 const output=await grantItem(c,'craft.output',{containerId:f.container,definitionId:'item.bar',quantity:'1',binding:'TRADEABLE',sourceCode:'ROUTINE_CRAFT',metadata:{craftActionId:c.actionId,recipeId:'recipe.bar',makerCharacterId:f.character,batches:1}},'ROUTINE_CRAFT_OUTPUT');
 await c.client.query("INSERT INTO craft_records(action_id,run_id,release_id,recipe_id,definition_revision,batches,output_operation_id) VALUES($1,$2,$3,'recipe.bar',1,1,$4)",[c.actionId,f.run,f.release,output.operationId]);
 for(let n=0;n<2;n++)await c.client.query('INSERT INTO craft_inputs(action_id,line_index,operation_id) VALUES($1,$2,$3)',[c.actionId,n,inputs[n]!.operationId]);return {ok:true};
 }),/Routine craft/);
 for(const spec of [{quality:'2',metadata:{} as Record<string,boolean>},{quality:'1',metadata:{locked:true}}]){
 const revision=(await pool.query('SELECT revision FROM runs WHERE id=$1',[f.run])).rows[0].revision;
 const grant=await executeAction(pool,f.account,env(revision,'MATERIAL_FIXTURE'),{},async c=>({...await grantItem(c,'special',{containerId:f.container,definitionId:'item.ore',quantity:'2',sourceCode:'FIXTURE',...spec},'FIXTURE'),revision:await advanceRevision(c)}));
 await assert.rejects(craftRoutine(pool,f.account,env(revision+1),'recipe.bar',1,[grant.itemId as string,f.ids[1]!]),/CRAFT_MATERIAL_INELIGIBLE/);

 }
 }finally{await db.close();}
});

test('crafting cannot run during an active instance or consume materials moved to account storage',async()=>{
 const db=await testDatabase(),pool=db.pool;try{const f=await fixture(pool),instance=randomUUID();
 await pool.query("INSERT INTO instances(id,kind,content_release_id,seed) VALUES($1,'COMBAT',$2,$3)",[instance,f.release,randomBytes(32)]);
 await pool.query('INSERT INTO instance_participants(instance_id,run_id) VALUES($1,$2)',[instance,f.run]);
 await assert.rejects(craftRoutine(pool,f.account,env(1),'recipe.bar',1,f.ids),/INSTANCE_STILL_ACTIVE/);
 const second=await fixture(pool),storage=(await pool.query("INSERT INTO inventory_containers(scope_id,kind) SELECT id,'HOME' FROM state_scopes WHERE account_id=$1 RETURNING id",[second.account])).rows[0].id;
 await pool.query('UPDATE inventory_items SET container_id=$1 WHERE id=$2',[storage,second.ids[0]]);
 await assert.rejects(craftRoutine(pool,second.account,env(1),'recipe.bar',1,second.ids),/CRAFT_MATERIAL_NOT_OWNED/);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM craft_records')).rows[0].n,0);
 }finally{await db.close();}
});
