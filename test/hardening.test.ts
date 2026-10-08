import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { actor,testDatabase } from './helpers.js';
import { executeAction,advanceRevision,type Envelope } from '../src/foundation/action.js';
import { postTransfers,type TransferLeg } from '../src/domains/ledger.js';
import { dispatchOutbox,enqueue,claimJob,renewJobLease,finishJob } from '../src/domains/jobs.js';
import { integrityReport,unindexedForeignKeys } from '../src/foundation/integrity.js';
import { migrate } from '../src/database.js';
const envelope=(type:string,revision=0):Envelope=>({requestId:randomUUID(),actionType:type,expectedRevision:revision});

async function economyFixture(pool:Awaited<ReturnType<typeof testDatabase>>['pool']){
  const user=await actor(pool,null,3,'CASUAL'),world=randomUUID();
  await pool.query('INSERT INTO worlds(id,name) VALUES($1,$2)',[world,world]);
  const scope=(await pool.query('SELECT id FROM state_scopes WHERE account_id=$1',[user.account])).rows[0].id;
  const shared=(await pool.query('SELECT id FROM state_scopes WHERE world_id=$1',[world])).rows[0].id;
  const buyer=randomUUID(),escrow=randomUUID(),seller=randomUUID(),fees=randomUUID(),faucet=randomUUID();
  await pool.query(`INSERT INTO wallets(id,scope_id,currency_id,purpose) VALUES
    ($1,$6,'GOLD','PLAYER'),($2,$7,'GOLD','ESCROW'),($3,$7,'GOLD','PLAYER'),($4,$7,'GOLD','TREASURY'),($5,$7,'GOLD','FAUCET_SINK')`,[buyer,escrow,seller,fees,faucet,scope,shared]);
  await executeAction(pool,user.account,envelope('FIXTURE_GRANT'),{},async context=>{
    await postTransfers(context,[{key:'fund',currencyId:'GOLD',from:faucet,to:buyer,amount:'20',reason:'FIXTURE'}]);return {fixture:true};
  });
  return {...user,buyer,escrow,seller,fees,faucet};
}

test('three-leg settlement is atomic, duplicate-safe and conserved',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const f=await economyFixture(pool),request=envelope('SETTLE_FIXTURE');
    const legs:TransferLeg[]=[
      {key:'payment',currencyId:'GOLD',from:f.buyer.toUpperCase(),to:f.escrow,amount:'10',reason:'PAYMENT'},
      {key:'proceeds',currencyId:'GOLD',from:f.escrow,to:f.seller,amount:'9',reason:'PROCEEDS'},
      {key:'fee',currencyId:'GOLD',from:f.escrow,to:f.fees,amount:'1',reason:'FEE'}];
    const settle=()=>executeAction(pool,f.account,request,{legs},async context=>({transfers:await postTransfers(context,legs),revision:await advanceRevision(context)}));
    const results=await Promise.all(Array.from({length:8},settle));
    assert.equal(results.filter(r=>!r.replayed).length,1);
    assert.ok(results.every(r=>JSON.stringify(r.transfers)===JSON.stringify(results[0]!.transfers)));
    const balances=(await pool.query('SELECT id,balance::text FROM wallets')).rows;
    const balance=(id:string)=>balances.find(w=>w.id===id)!.balance;
    assert.equal(balance(f.buyer),'10');assert.equal(balance(f.escrow),'0');assert.equal(balance(f.seller),'9');assert.equal(balance(f.fees),'1');assert.equal(balance(f.faucet),'-20');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM currency_transfers WHERE action_id=$1',[results[0]!.actionId])).rows[0].n,3);
    assert.deepEqual(await integrityReport(pool),{equipmentMismatches:0,itemLockMismatches:0,craftMismatches:0,combatMismatches:0,completionMismatches:0,rewardMismatches:0,encounterMismatches:0,walletBalanceMismatches:0,itemQuantityMismatches:0,runScopeMismatches:0,malformedJobLeases:0,itemBindingMismatches:0,outboxJobCollisions:0,unvalidatedConstraints:0});
    assert.deepEqual(await unindexedForeignKeys(pool),[]);
  }finally{await db.close();}
});

test('failed or invalid settlement leaves no balances, revisions, receipts or partial legs',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const f=await economyFixture(pool),before=(await pool.query('SELECT id,balance::text FROM wallets ORDER BY id')).rows;
    const legs:TransferLeg[]=[{key:'payment',currencyId:'GOLD',from:f.buyer,to:f.escrow,amount:'10',reason:'PAYMENT'},
      {key:'payout',currencyId:'GOLD',from:f.escrow,to:f.seller,amount:'11',reason:'PAYOUT'}];
    await assert.rejects(executeAction(pool,f.account,envelope('INVALID_SETTLEMENT'),{legs},async context=>({transfers:await postTransfers(context,legs)})),/INSUFFICIENT_BALANCE/);
    legs[1]!.amount='10';
    await assert.rejects(executeAction(pool,f.account,envelope('ROLLBACK_SETTLEMENT'),{legs},async context=>{
      await postTransfers(context,legs);await advanceRevision(context);throw new Error('Failure after all legs');
    }),/Failure after all legs/);
    await assert.rejects(executeAction(pool,f.account,envelope('DUPLICATE_LEGS'),{legs},async context=>({transfers:await postTransfers(context,[legs[0]!,legs[0]!])})),/INVALID_TRANSFER_PLAN/);
    const mismatch=structuredClone(legs);mismatch[0]!.currencyId='SUPPORTER_UNITS';
    await assert.rejects(executeAction(pool,f.account,envelope('WRONG_CURRENCY'),{mismatch},async context=>({transfers:await postTransfers(context,mismatch)})),/CURRENCY_MISMATCH/);
    assert.deepEqual((await pool.query('SELECT id,balance::text FROM wallets ORDER BY id')).rows,before);
    assert.equal((await pool.query('SELECT revision FROM runs WHERE id=$1',[f.run])).rows[0].revision,0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM action_receipts')).rows[0].n,1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM currency_transfers')).rows[0].n,1);
  }finally{await db.close();}
});

test('overlapping multi-leg spending cannot overdraw or duplicate fees',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const f=await economyFixture(pool),secondActor=await actor(pool);
    const legs:TransferLeg[]=[{key:'payment',currencyId:'GOLD',from:f.buyer,to:f.escrow,amount:'15',reason:'PAYMENT'},
      {key:'proceeds',currencyId:'GOLD',from:f.escrow,to:f.seller,amount:'14',reason:'PROCEEDS'},
      {key:'fee',currencyId:'GOLD',from:f.escrow,to:f.fees,amount:'1',reason:'FEE'}];
    // Two independently authorized server fixtures use different account locks so
    // only the shared-wallet lock protects the overlapping plan.
    const spend=(account:string,actorRequest:Envelope)=>executeAction(pool,account,actorRequest,{legs},async context=>({transfers:await postTransfers(context,legs),revision:await advanceRevision(context)}));
    const results=await Promise.allSettled([spend(f.account,envelope('SETTLEMENT')),spend(secondActor.account,envelope('SETTLEMENT'))]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    const revision=(await pool.query('SELECT revision FROM runs WHERE id=$1',[f.run])).rows[0].revision;
    await assert.rejects(spend(f.account,envelope('SETTLEMENT',revision)),/INSUFFICIENT_BALANCE/);
    assert.equal((await pool.query('SELECT balance::text FROM wallets WHERE id=$1',[f.buyer])).rows[0].balance,'5');
    assert.equal((await pool.query('SELECT balance::text FROM wallets WHERE id=$1',[f.fees])).rows[0].balance,'1');
  }finally{await db.close();}
});

test('custody cannot change indirectly and terminal run scopes remain consistent',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const a=await actor(pool),b=await actor(pool);
    const scope=(await pool.query('SELECT id FROM state_scopes WHERE run_id=$1',[a.run])).rows[0].id;
    const other=(await pool.query('SELECT id FROM state_scopes WHERE run_id=$1',[b.run])).rows[0].id;
    const container=(await pool.query("INSERT INTO inventory_containers(scope_id,kind) VALUES($1,'CARRIED') RETURNING id",[scope])).rows[0].id;
    await assert.rejects(pool.query('UPDATE characters SET account_id=$1 WHERE id=$2',[b.account,a.character]),/ownership are immutable/);
    await assert.rejects(pool.query('UPDATE inventory_containers SET scope_id=$1 WHERE id=$2',[other,container]),/ownership are immutable/);
    await assert.rejects(pool.query("UPDATE state_scopes SET lifecycle='ARCHIVED' WHERE run_id=$1",[a.run]),/lifetimes must agree/);
    await pool.query("UPDATE runs SET status='ABANDONED' WHERE id=$1",[a.run]);
    assert.equal((await pool.query('SELECT lifecycle FROM state_scopes WHERE run_id=$1',[a.run])).rows[0].lifecycle,'ARCHIVED');
    await assert.rejects(pool.query("UPDATE runs SET status='ACTIVE' WHERE id=$1",[a.run]),/cannot be reopened/);
    await pool.query("UPDATE runs SET status='AFTERCORE' WHERE id=$1",[b.run]);
    await assert.rejects(pool.query("UPDATE runs SET status='ACTIVE' WHERE id=$1",[b.run]),/Victory cannot be reversed/);
  }finally{await db.close();}
});

test('job envelopes, immutable work and renewed leases retain fencing',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    await assert.rejects(enqueue(pool,'','MAIL',{}),/Invalid job envelope/);
    const id=await enqueue(pool,'lease-fixture','MAIL',{});
    await assert.rejects(pool.query('UPDATE durable_jobs SET lease_token=$1 WHERE id=$2',[randomUUID(),id]),/complete_job_lease/);
    await assert.rejects(pool.query('UPDATE durable_jobs SET payload=$1 WHERE id=$2',[{changed:true},id]),/work and retry budget are immutable/);
    const first=await claimJob(pool);assert.equal(await renewJobLease(pool,id,first.lease_token,60),true);
    await pool.query("UPDATE durable_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[id]);
    assert.equal(await renewJobLease(pool,id,first.lease_token),false);
    const second=await claimJob(pool);
    assert.equal(await renewJobLease(pool,id,first.lease_token),false);
    assert.equal(await finishJob(pool,id,second.lease_token,true),true);
    await assert.rejects(pool.query("UPDATE durable_jobs SET status='PENDING' WHERE id=$1",[id]),/cannot be reopened/);
  }finally{await db.close();}
});

test('outbox collision cannot silently mark different work as delivered',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const user=await actor(pool);
    await executeAction(pool,user.account,envelope('OUTBOX_FIXTURE'),{},async()=>({fixture:true}));
    const event=(await pool.query('SELECT * FROM outbox_events')).rows[0];
    await enqueue(pool,`outbox:${event.id}`,'WRONG_WORK',{});
    await assert.rejects(dispatchOutbox(pool),/conflicts with different work/);
    assert.equal((await pool.query('SELECT delivered_at FROM outbox_events')).rows[0].delivered_at,null);
    assert.equal((await integrityReport(pool)).outboxJobCollisions,1);
  }finally{await db.close();}
});

test('ledger rejects integer overflow and reconciliation detects balanced corruption',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const f=await economyFixture(pool),scope=(await pool.query('SELECT id FROM state_scopes WHERE account_id=$1',[f.account])).rows[0].id;
    const faucet=randomUUID();
    await pool.query("INSERT INTO wallets(id,scope_id,currency_id,purpose) VALUES($1,$2,'GOLD','FAUCET_SINK')",[faucet,scope]);
    await executeAction(pool,f.account,envelope('BOUNDARY_GRANT'),{},async context=>({transfers:await postTransfers(context,[{key:'maximum',currencyId:'GOLD',from:faucet,to:f.fees,amount:'9223372036854775807',reason:'BOUNDARY'}])}));
    const before=(await pool.query('SELECT id,balance::text FROM wallets ORDER BY id')).rows;
    await assert.rejects(executeAction(pool,f.account,envelope('OVERFLOW_PLAN'),{},async context=>({transfers:await postTransfers(context,[{key:'overflow',currencyId:'GOLD',from:faucet,to:f.fees,amount:'1',reason:'BOUNDARY'}])})),/BALANCE_OVERFLOW/);
    assert.deepEqual((await pool.query('SELECT id,balance::text FROM wallets ORDER BY id')).rows,before);
    // Simulate damaged projection data as the isolated test administrator. Total
    // currency remains conserved, so only per-wallet reconciliation can catch it.
    await pool.query('ALTER TABLE wallets DISABLE TRIGGER wallet_guard');
    await pool.query('UPDATE wallets SET balance=balance-1 WHERE id=$1',[f.fees]);
    await pool.query('UPDATE wallets SET balance=balance+1 WHERE id=$1',[faucet]);
    await pool.query('ALTER TABLE wallets ENABLE TRIGGER wallet_guard');
    assert.equal((await pool.query('SELECT sum(balance)::text AS total FROM wallets')).rows[0].total,'0');
    assert.equal((await integrityReport(pool)).walletBalanceMismatches,2);
  }finally{await db.close();}
});

test('upgrade preserves historical transfers and assigns their primary leg',async()=>{
  const db=await testDatabase(false),pool=db.pool;
  try{
    await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    for(const name of ['001_foundation.sql','002_domain_foundation.sql']){
      const sql=await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8');
      await pool.query(sql);await pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
    }
    const f=await actor(pool,null,3,'CASUAL'),scope=(await pool.query('SELECT id FROM state_scopes WHERE account_id=$1',[f.account])).rows[0].id;
    const source=randomUUID(),target=randomUUID();
    await pool.query("INSERT INTO wallets(id,scope_id,currency_id,purpose) VALUES($1,$3,'GOLD','FAUCET_SINK'),($2,$3,'GOLD','PLAYER')",[source,target,scope]);
    const id=randomUUID();
    await executeAction(pool,f.account,envelope('OLD_GRANT'),{},async context=>{
      await context.client.query("INSERT INTO currency_transfers(id,action_id,currency_id,from_wallet_id,to_wallet_id,amount,reason) VALUES($1,$2,'GOLD',$3,$4,7,'LEGACY')",[id,context.actionId,source,target]);return {fixture:true};
    });
    await migrate(pool);
    const row=(await pool.query('SELECT id,amount::text,leg_key FROM currency_transfers')).rows[0];
    assert.deepEqual(row,{id,amount:'7',leg_key:'primary'});
    assert.equal((await pool.query('SELECT balance::text FROM wallets WHERE id=$1',[target])).rows[0].balance,'7');
    await assert.rejects(pool.query('UPDATE currency_transfers SET amount=8 WHERE id=$1',[id]),/Immutable record/);
  }finally{await db.close();}
});
