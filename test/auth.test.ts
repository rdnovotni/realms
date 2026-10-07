import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes } from 'node:crypto';
import { testDatabase,actor } from './helpers.js';
import { buildApp } from '../src/app.js';
import { hashPassword,verifyPassword,validateNewPassword } from '../src/auth/passwords.js';
import { enrollPassword,requireLogin,resolveSession,revokeSession,revokeAllSessions,changePassword,recoverPassword,throttleAuth,pruneAuthThrottle } from '../src/auth/sessions.js';
import { spendTurns } from '../src/actions.js';
import { integrityReport,unindexedForeignKeys } from '../src/foundation/integrity.js';
const password='fixture correct horse battery',replacement='fixture replacement horse battery';
const request=()=>({requestId:randomUUID(),actionType:'SPEND_TURNS' as const,amount:1,expectedRevision:0});
const key='a'.repeat(64);
async function identity(pool:Awaited<ReturnType<typeof testDatabase>>['pool'],handle='fixture_user'){
  const user=await actor(pool),recovery=await enrollPassword(pool,user.account,handle,password);return {...user,...recovery,handle};
}

test('passwords use independent salts, full UTF-8 input and bounded policy',async()=>{
  const results=await Promise.allSettled(Array.from({length:3},()=>hashPassword(password)));
  if(results[0]?.status!=='fulfilled' || results[1]?.status!=='fulfilled' || results[2]?.status!=='rejected') throw new Error('Password derivation concurrency budget failed');
  assert.match(String(results[2].reason),/AUTH_BUSY/);
  const a=results[0].value,b=results[1].value;
  assert.notDeepEqual(a.salt,b.salt);assert.notDeepEqual(a.verifier,b.verifier);
  assert.equal(await verifyPassword(password,a),true);assert.equal(await verifyPassword(password+'!',a),false);
  assert.equal(await verifyPassword(password),false);
  assert.throws(()=>validateNewPassword('short'),/PASSWORD_POLICY/);
  assert.throws(()=>validateNewPassword('x'.repeat(129)),/PASSWORD_POLICY/);
  assert.throws(()=>validateNewPassword('x'.repeat(20)+'\ud800'),/PASSWORD_POLICY/);
  assert.doesNotThrow(()=>validateNewPassword('🧙'.repeat(15)));
});

test('HTTP identity comes from persisted sessions; read-only and cross-account access are denied',async()=>{
  const db=await testDatabase(),pool=db.pool,app=buildApp(pool,{mode:'sessions',throttleKey:key});
  try{
    const a=await identity(pool),b=await identity(pool,'other_user');
    const login=(handle:string,secret=password,readOnly=false)=>app.inject({method:'POST',url:'/api/v1/auth/login',payload:{handle,password:secret,deviceLabel:'Native desktop',readOnly}});
    const first=await login(a.handle.toUpperCase());assert.equal(first.statusCode,200);assert.equal(first.headers['cache-control'],'no-store');
    const token=first.json().token,headers={authorization:`Bearer ${token}`};
    assert.equal((await app.inject({url:'/api/v1/state',headers})).json().runId,a.run);
    const other=await login(b.handle);assert.equal((await app.inject({url:'/api/v1/state',headers:{authorization:`Bearer ${other.json().token}`}})).json().runId,b.run);
    const reader=await login(a.handle,password,true);
    assert.equal((await app.inject({method:'POST',url:'/api/v1/actions',headers:{authorization:`Bearer ${reader.json().token}`},payload:request()})).statusCode,403);
    assert.equal((await app.inject({url:'/api/v1/auth/sessions',headers:{authorization:`Bearer ${reader.json().token}`}})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:'/api/v1/actions',headers,payload:{...request(),accountId:b.account}})).statusCode,400);
    const act=request(),committed=await app.inject({method:'POST',url:'/api/v1/actions',headers,payload:act});assert.equal(committed.statusCode,200);
    assert.equal((await app.inject({method:'POST',url:'/api/v1/actions',headers,payload:act})).json().replayed,true);
    assert.equal((await login(a.handle,'wrong')).json().error,'INVALID_CREDENTIALS');
    assert.equal((await login('unknown_user','wrong')).json().error,'INVALID_CREDENTIALS');
    assert.equal((await app.inject({url:'/api/v1/state',headers:{authorization:'Bearer '+password}})).statusCode,401);
    assert.ok(!(await app.inject({url:'/api/v1/auth/sessions',headers})).body.includes('token_digest'));
    const stored=(await pool.query('SELECT token_digest FROM auth_sessions WHERE id=$1',[first.json().sessionId])).rows[0].token_digest;
    assert.notEqual(stored,token);assert.ok(!JSON.stringify((await pool.query('SELECT * FROM auth_credentials')).rows).includes(password));
    assert.deepEqual(await unindexedForeignKeys(pool),[]);assert.ok(Object.values(await integrityReport(pool)).every(n=>n===0));
  }finally{await app.close();await db.close();}
});

test('sessions survive app restart, expire and revoke; another account cannot revoke them',async()=>{
  const db=await testDatabase(),pool=db.pool;let app=buildApp(pool,{mode:'sessions',throttleKey:key});
  try{
    const a=await identity(pool),b=await identity(pool,'other_user'),first=await requireLogin(pool,a.handle,password,'Desktop'),second=await requireLogin(pool,a.handle,password,'Browser');
    const principal=await resolveSession(pool,first.token),foreign=await requireLogin(pool,b.handle,password,'Other');
    await assert.rejects(revokeSession(pool,principal,foreign.sessionId),/SESSION_NOT_FOUND/);
    await app.close();app=buildApp(pool,{mode:'sessions',throttleKey:key});
    assert.equal((await app.inject({url:'/api/v1/state',headers:{authorization:`Bearer ${first.token}`}})).statusCode,200);
    await revokeSession(pool,principal,second.sessionId);await assert.rejects(resolveSession(pool,second.token),/UNAUTHORIZED/);
    await assert.rejects(pool.query('UPDATE auth_sessions SET revoked_at=NULL WHERE id=$1',[second.sessionId]),/cannot be rewound or reopened/);
    await assert.rejects(pool.query("UPDATE auth_sessions SET scopes=ARRAY['GAME_READ'] WHERE id=$1",[first.sessionId]),/authority and expiry are immutable/);
    // An administrator advances the isolated fixture's timestamps to represent idle expiry.
    await pool.query('ALTER TABLE auth_sessions DISABLE TRIGGER auth_session_identity');
    await pool.query("UPDATE auth_sessions SET created_at=now()-interval '1 hour',last_seen_at=now()-interval '31 minutes',expires_at=now()+interval '11 hours' WHERE id=$1",[first.sessionId]);
    await pool.query('ALTER TABLE auth_sessions ENABLE TRIGGER auth_session_identity');
    await assert.rejects(resolveSession(pool,first.token),/UNAUTHORIZED/);
    const absolute=await requireLogin(pool,a.handle,password,'Expired');
    await pool.query('ALTER TABLE auth_sessions DISABLE TRIGGER auth_session_identity');
    await pool.query("UPDATE auth_sessions SET created_at=now()-interval '13 hours',last_seen_at=now()-interval '61 minutes',expires_at=now()-interval '1 hour' WHERE id=$1",[absolute.sessionId]);
    await pool.query('ALTER TABLE auth_sessions ENABLE TRIGGER auth_session_identity');
    await assert.rejects(resolveSession(pool,absolute.token),/UNAUTHORIZED/);
  }finally{await app.close();await db.close();}
});

test('revocation between request authentication and Action locking rejects even receipt replay',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const a=await identity(pool),issued=await requireLogin(pool,a.handle,password,'Desktop'),principal=await resolveSession(pool,issued.token),act=request();
    await spendTurns(pool,a.account,{...act,principal});
    const blocker=await pool.connect();
    try{
      await blocker.query('BEGIN');await blocker.query('UPDATE accounts SET security_epoch=security_epoch+1 WHERE id=$1',[a.account]);
      const denied=assert.rejects(spendTurns(pool,a.account,{...act,principal}),/SESSION_NOT_AUTHORIZED/);
      await blocker.query('COMMIT');await denied;
    }finally{blocker.release();}
    assert.deepEqual((await pool.query('SELECT turns,revision FROM runs WHERE id=$1',[a.run])).rows[0],{turns:2,revision:1});
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM action_receipts')).rows[0].n,1);
  }finally{await db.close();}
});

test('password change and recovery invalidate sessions and prior codes; logout-all preserves recovery',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const a=await identity(pool),issued=await requireLogin(pool,a.handle,password,'Desktop'),principal=await resolveSession(pool,issued.token);
    await revokeAllSessions(pool,principal);await assert.rejects(resolveSession(pool,issued.token),/UNAUTHORIZED/);
    const recovered=await recoverPassword(pool,a.handle,a.recoveryCodes[0]!,replacement);assert.equal(recovered.recoveryCodes.length,8);
    await assert.rejects(recoverPassword(pool,a.handle,a.recoveryCodes[0]!,password),/INVALID_RECOVERY/);
    await assert.rejects(recoverPassword(pool,a.handle,a.recoveryCodes[1]!,password),/INVALID_RECOVERY/);
    await assert.rejects(requireLogin(pool,a.handle,password,'Old'),/INVALID_CREDENTIALS/);
    const fresh=await requireLogin(pool,a.handle,replacement,'Fresh'),freshPrincipal=await resolveSession(pool,fresh.token);
    await assert.rejects(changePassword(pool,freshPrincipal,'wrong',password),/INVALID_CREDENTIALS/);
    const changed=await changePassword(pool,freshPrincipal,replacement,password);assert.equal(changed.recoveryCodes.length,8);
    await assert.rejects(resolveSession(pool,fresh.token),/UNAUTHORIZED/);
    await assert.rejects(recoverPassword(pool,a.handle,recovered.recoveryCodes[0]!,replacement),/INVALID_RECOVERY/);
    const used=(await pool.query('SELECT count(*)::int AS n FROM auth_recovery_codes WHERE used_at IS NOT NULL')).rows[0].n;assert.equal(used,1);
    await assert.rejects(pool.query('DELETE FROM auth_events'),/Immutable record/);
  }finally{await db.close();}
});

test('a recovery code cannot be consumed twice by concurrent requests',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const a=await identity(pool);
    const results=await Promise.allSettled([recoverPassword(pool,a.handle,a.recoveryCodes[0]!,replacement),recoverPassword(pool,a.handle,a.recoveryCodes[0]!,replacement)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal((await pool.query('SELECT revision::text FROM auth_credentials WHERE account_id=$1',[a.account])).rows[0].revision,'2');
  }finally{await db.close();}
});

test('suspension blocks login and trusted Actions, and reactivation does not revive old tokens',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const a=await identity(pool),issued=await requireLogin(pool,a.handle,password,'Desktop');
    await pool.query("UPDATE accounts SET access_status='SUSPENDED' WHERE id=$1",[a.account]);
    const development=buildApp(pool,{mode:'development',token:'fixture-token',accountId:a.account});
    try{assert.equal((await development.inject({url:'/api/v1/state',headers:{authorization:'Bearer fixture-token'}})).statusCode,401);}finally{await development.close();}
    await assert.rejects(requireLogin(pool,a.handle,password,'Denied'),/INVALID_CREDENTIALS/);
    await assert.rejects(spendTurns(pool,a.account,request()),/ACCOUNT_SUSPENDED/);
    await pool.query("UPDATE accounts SET access_status='ACTIVE' WHERE id=$1",[a.account]);
    await assert.rejects(resolveSession(pool,issued.token),/UNAUTHORIZED/);
    await assert.rejects(pool.query('UPDATE accounts SET security_epoch=0 WHERE id=$1',[a.account]),/Invalid account security epoch/);
    assert.deepEqual((await pool.query("SELECT event_type FROM auth_events WHERE event_type IN('ACCOUNT_SUSPENDED','ACCOUNT_REACTIVATED') ORDER BY id")).rows,[{event_type:'ACCOUNT_SUSPENDED'},{event_type:'ACCOUNT_REACTIVATED'}]);
  }finally{await db.close();}
});

test('device sessions are capped and automatically evicted sessions retain an audit',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const a=await identity(pool),first=await requireLogin(pool,a.handle,password,'First');
    for(let n=0;n<10;n++) await requireLogin(pool,a.handle,password,'Device '+n);
    await assert.rejects(resolveSession(pool,first.token),/UNAUTHORIZED/);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM auth_sessions WHERE revoked_at IS NULL')).rows[0].n,10);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM auth_events WHERE event_type='SESSION_REVOKED'")).rows[0].n,1);
  }finally{await db.close();}
});

test('authentication throttles persist, serialize concurrent attempts and disclose no raw identifiers',async()=>{
  const db=await testDatabase(),pool=db.pool;
  try{
    const results=await Promise.allSettled(Array.from({length:20},()=>throttleAuth(pool,key,'127.0.0.1','fixture_user')));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,10);
    await assert.rejects(throttleAuth(pool,key,'127.0.0.2','FIXTURE_USER'),/AUTH_RATE_LIMITED/);
    const stored=(await pool.query('SELECT * FROM auth_throttle')).rows;assert.ok(!JSON.stringify(stored).includes('fixture_user'));assert.ok(!JSON.stringify(stored).includes('127.0.0.1'));
    await pool.query("UPDATE auth_throttle SET expires_at=now()-interval '1 second'");assert.equal(await pruneAuthThrottle(pool),3);
    await throttleAuth(pool,key,'127.0.0.1','fixture_user');
  }finally{await db.close();}
});

test('restricted runtime can authenticate, revoke and change passwords but cannot enroll or suspend',async()=>{
  const db=await testDatabase(),pool=db.pool,role=`probe_${randomUUID().replaceAll('-','')}`;let created=false;
  try{
    const a=await identity(pool),issued=await requireLogin(pool,a.handle,password,'Probe');
    await pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);created=true;
    await pool.query(`GRANT USAGE ON SCHEMA ${db.schema} TO ${role};GRANT SELECT ON ALL TABLES IN SCHEMA ${db.schema} TO ${role};
      GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${db.schema} TO ${role};GRANT UPDATE(security_epoch) ON accounts TO ${role};
      GRANT UPDATE(salt,verifier) ON auth_credentials TO ${role};GRANT INSERT,UPDATE ON auth_sessions,auth_recovery_codes,auth_throttle TO ${role};GRANT INSERT ON auth_events TO ${role}`);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');await client.query(`SET LOCAL ROLE ${role}`);
      await client.query('UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE id=$1',[issued.sessionId]);
      await client.query('UPDATE auth_credentials SET salt=$1 WHERE account_id=$2',[randomBytes(16),a.account]);
      assert.equal((await client.query('SELECT security_epoch::text FROM accounts WHERE id=$1',[a.account])).rows[0].security_epoch,'1');
      for(const sql of ["UPDATE accounts SET access_status='SUSPENDED'",'DELETE FROM auth_events','UPDATE auth_credentials SET handle=handle',"INSERT INTO auth_credentials(account_id,handle,salt,verifier) SELECT account_id,'forged_user',salt,verifier FROM auth_credentials"]){
        await client.query('SAVEPOINT denied');await assert.rejects(client.query(sql),(error:{code?:string})=>error.code==='42501');await client.query('ROLLBACK TO denied');
      }
    }finally{await client.query('ROLLBACK');client.release();}
  }finally{if(created){await pool.query(`DROP OWNED BY ${role}`);await pool.query(`DROP ROLE ${role}`);}await db.close();}
});
