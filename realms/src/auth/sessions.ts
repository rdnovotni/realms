import { createHash,createHmac,randomBytes,randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from '../foundation/transaction.js';
import { DomainError } from '../foundation/errors.js';
import { hashPassword,verifyPassword } from './passwords.js';
export type Permission='GAME_READ'|'GAME_WRITE'|'ACCOUNT_MANAGE';
export type Principal={accountId:string;sessionId:string};
const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
const secret=(prefix:string)=>prefix+randomBytes(32).toString('base64url');
const normalize=(handle:string)=>handle.toLowerCase();
const validHandle=(handle:string)=>/^[a-z][a-z0-9_]{2,39}$/.test(handle);
async function event(client:pg.PoolClient,accountId:string|null,type:string,sessionId:string|null=null){await client.query('INSERT INTO auth_events(account_id,event_type,session_id) VALUES($1,$2,$3)',[accountId,type,sessionId]);}
async function lockAccount(client:pg.PoolClient,id:string){
  const row=(await client.query('SELECT * FROM accounts WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!row || row.access_status!=='ACTIVE') throw new DomainError(401,'UNAUTHORIZED');return row;
}
export async function authorizeSession(client:pg.PoolClient,principal:Principal,permission?:Permission){
  const row=(await client.query(`SELECT s.id FROM auth_sessions s JOIN accounts a ON a.id=s.account_id
    WHERE s.id=$1 AND s.account_id=$2 AND a.access_status='ACTIVE' AND s.security_epoch=a.security_epoch
    AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.last_seen_at>clock_timestamp()-interval '30 minutes'
    AND ($3::text IS NULL OR $3=ANY(s.scopes)) FOR SHARE OF s`,[principal.sessionId,principal.accountId,permission??null])).rows[0];
  if(!row) throw new DomainError(permission?403:401,permission?'SESSION_NOT_AUTHORIZED':'UNAUTHORIZED');
}
export async function resolveSession(pool:pg.Pool,token:string):Promise<Principal>{
  if(!/^rs1_[A-Za-z0-9_-]{43}$/.test(token)) throw new DomainError(401,'UNAUTHORIZED');
  const row=(await pool.query(`UPDATE auth_sessions s SET last_seen_at=least(s.expires_at,greatest(s.last_seen_at,clock_timestamp())) FROM accounts a
    WHERE s.token_digest=$1 AND s.account_id=a.id AND a.access_status='ACTIVE' AND s.security_epoch=a.security_epoch
    AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.last_seen_at>clock_timestamp()-interval '30 minutes'
    RETURNING s.id,s.account_id`,[digest(token)])).rows[0];
  if(!row) throw new DomainError(401,'UNAUTHORIZED');return {accountId:row.account_id,sessionId:row.id};
}
async function recoverySet(client:pg.PoolClient,accountId:string){
  const revision=(await client.query('SELECT revision FROM auth_credentials WHERE account_id=$1',[accountId])).rows[0].revision;
  const codes=Array.from({length:8},()=>secret('rc1_'));
  for(const code of codes) await client.query(`INSERT INTO auth_recovery_codes(token_digest,account_id,credential_revision,expires_at)
    VALUES($1,$2,$3,clock_timestamp()+interval '365 days')`,[digest(code),accountId,revision]);
  return codes;
}
// Enrollment is an administration-only operation. The HTTP role cannot insert
// credentials, and no public signup endpoint is enabled by this foundation.
export async function enrollPassword(pool:pg.Pool,accountId:string,handle:string,password:string){
  handle=normalize(handle);if(!validHandle(handle)) throw new DomainError(400,'INVALID_LOGIN_HANDLE');
  const hashed=await hashPassword(password);
  return transaction(pool,async client=>{
    await lockAccount(client,accountId);
    await client.query('INSERT INTO auth_credentials(account_id,handle,salt,verifier) VALUES($1,$2,$3,$4)',[accountId,handle,hashed.salt,hashed.verifier]);
    const recoveryCodes=await recoverySet(client,accountId);await event(client,accountId,'PASSWORD_ENROLLED');return {recoveryCodes};
  });
}
export async function throttleAuth(pool:pg.Pool,key:string,peer:string,handle:string){
  if(!/^[0-9a-f]{64}$/.test(key)) throw new Error('Invalid authentication throttle key');
  const buckets=[{name:'peer:'+peer,limit:30,seconds:60},{name:'handle:'+normalize(handle),limit:10,seconds:600}]
    .map(b=>({...b,key:createHmac('sha256',key).update(b.name).digest('hex')})).sort((a,b)=>a.key.localeCompare(b.key));
  const allowed=await transaction(pool,async client=>{
    let allowed=true;
    for(const b of buckets){
      const rows=(await client.query(`INSERT INTO auth_throttle(bucket_key,attempts,expires_at) VALUES($1,1,clock_timestamp()+$2*interval '1 second')
        ON CONFLICT(bucket_key) DO UPDATE SET attempts=CASE WHEN auth_throttle.expires_at<=clock_timestamp() THEN 1 ELSE auth_throttle.attempts+1 END,
        expires_at=CASE WHEN auth_throttle.expires_at<=clock_timestamp() THEN EXCLUDED.expires_at ELSE auth_throttle.expires_at END
        WHERE auth_throttle.expires_at<=clock_timestamp() OR auth_throttle.attempts<$3 RETURNING bucket_key`,[b.key,b.seconds,b.limit])).rows;
      if(!rows.length) allowed=false;
    }
    return allowed;
  });
  if(!allowed) throw new DomainError(429,'AUTH_RATE_LIMITED');
}
export async function pruneAuthThrottle(pool:pg.Pool){
  return (await pool.query(`WITH expired AS(SELECT bucket_key FROM auth_throttle WHERE expires_at<=clock_timestamp()
    ORDER BY expires_at,bucket_key LIMIT 1000 FOR UPDATE SKIP LOCKED) DELETE FROM auth_throttle t USING expired e WHERE t.bucket_key=e.bucket_key`)).rowCount;
}
export async function login(pool:pg.Pool,handle:string,password:string,deviceLabel:string,readOnly=false){
  handle=normalize(handle);
  if(!validHandle(handle) || !deviceLabel.trim() || [...deviceLabel].length>80) throw new DomainError(400,'INVALID_LOGIN');
  const credential=(await pool.query('SELECT * FROM auth_credentials WHERE handle=$1',[handle])).rows[0];
  const matches=await verifyPassword(password,credential);
  return transaction(pool,async client=>{
    const account=credential?(await client.query('SELECT * FROM accounts WHERE id=$1 FOR UPDATE',[credential.account_id])).rows[0]:null;
    const current=credential?(await client.query('SELECT revision FROM auth_credentials WHERE account_id=$1',[credential.account_id])).rows[0]:null;
    if(!matches || !account || account.access_status!=='ACTIVE' || current?.revision!==credential.revision){
      await event(client,account?.id??null,'LOGIN_FAILED');return null;
    }
    // Account locking serializes simultaneous login/revocation and bounds devices.
    await client.query(`UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE id IN(
      SELECT id FROM auth_sessions WHERE account_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()
      AND security_epoch=$2 ORDER BY created_at DESC,id OFFSET 9)`,[account.id,account.security_epoch]);
    const token=secret('rs1_'),id=randomUUID(),scopes:Permission[]=readOnly?['GAME_READ']:['GAME_READ','GAME_WRITE','ACCOUNT_MANAGE'];
    const row=(await client.query(`INSERT INTO auth_sessions(id,account_id,token_digest,security_epoch,scopes,device_label,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,now()+interval '12 hours') RETURNING expires_at`,[id,account.id,digest(token),account.security_epoch,scopes,deviceLabel])).rows[0];
    await event(client,account.id,'LOGIN_SUCCEEDED',id);
    return {token,sessionId:id,accountId:account.id,expiresAt:(row.expires_at as Date).toISOString()};
  });
}
export async function requireLogin(pool:pg.Pool,handle:string,password:string,label:string,readOnly=false){
  const result=await login(pool,handle,password,label,readOnly);if(!result) throw new DomainError(401,'INVALID_CREDENTIALS');return result;
}
export async function listSessions(pool:pg.Pool,principal:Principal){
  return transaction(pool,async client=>{
    await lockAccount(client,principal.accountId);await authorizeSession(client,principal,'ACCOUNT_MANAGE');
    return (await client.query(`SELECT id,device_label AS "deviceLabel",scopes,created_at AS "createdAt",last_seen_at AS "lastSeenAt",
      expires_at AS "expiresAt",revoked_at AS "revokedAt",security_epoch=(SELECT security_epoch FROM accounts WHERE id=$1) AND revoked_at IS NULL
      AND expires_at>clock_timestamp() AND last_seen_at>clock_timestamp()-interval '30 minutes' AS active
      FROM auth_sessions WHERE account_id=$1 ORDER BY created_at DESC,id LIMIT 100`,[principal.accountId])).rows;
  });
}
export async function revokeSession(pool:pg.Pool,principal:Principal,targetId:string){
  targetId=targetId.toLowerCase();
  return transaction(pool,async client=>{
    await lockAccount(client,principal.accountId);await authorizeSession(client,principal,targetId===principal.sessionId?undefined:'ACCOUNT_MANAGE');
    const row=(await client.query('SELECT id,revoked_at FROM auth_sessions WHERE id=$1 AND account_id=$2 FOR UPDATE',[targetId,principal.accountId])).rows[0];
    if(!row) throw new DomainError(404,'SESSION_NOT_FOUND');
    if(!row.revoked_at) await client.query('UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE id=$1',[targetId]);
    return {revoked:true};
  });
}
export async function revokeAllSessions(pool:pg.Pool,principal:Principal){
  return transaction(pool,async client=>{
    await lockAccount(client,principal.accountId);await authorizeSession(client,principal,'ACCOUNT_MANAGE');
    await client.query('UPDATE accounts SET security_epoch=security_epoch+1 WHERE id=$1',[principal.accountId]);
    await event(client,principal.accountId,'SESSIONS_REVOKED');return {revoked:true};
  });
}
export async function changePassword(pool:pg.Pool,principal:Principal,currentPassword:string,newPassword:string){
  const credential=(await pool.query('SELECT * FROM auth_credentials WHERE account_id=$1',[principal.accountId])).rows[0];
  if(!await verifyPassword(currentPassword,credential)) throw new DomainError(401,'INVALID_CREDENTIALS');
  const hashed=await hashPassword(newPassword);
  return transaction(pool,async client=>{
    await lockAccount(client,principal.accountId);await authorizeSession(client,principal,'ACCOUNT_MANAGE');
    const current=(await client.query('SELECT revision FROM auth_credentials WHERE account_id=$1',[principal.accountId])).rows[0];
    if(!credential || current?.revision!==credential.revision) throw new DomainError(401,'INVALID_CREDENTIALS');
    await client.query('UPDATE auth_credentials SET salt=$1,verifier=$2 WHERE account_id=$3',[hashed.salt,hashed.verifier,principal.accountId]);
    const recoveryCodes=await recoverySet(client,principal.accountId);await event(client,principal.accountId,'PASSWORD_CHANGED');return {recoveryCodes};
  });
}
export async function recoverPassword(pool:pg.Pool,handle:string,code:string,newPassword:string){
  // Derive even when a handle/code is unknown; lookup failures share one response.
  const hashed=await hashPassword(newPassword),normalized=normalize(handle);
  const candidate=(await pool.query('SELECT account_id FROM auth_credentials WHERE handle=$1',[normalized])).rows[0];
  const result=await transaction(pool,async client=>{
    const account=candidate?(await client.query('SELECT * FROM accounts WHERE id=$1 FOR UPDATE',[candidate.account_id])).rows[0]:null;
    const credential=account?(await client.query('SELECT revision FROM auth_credentials WHERE account_id=$1',[account.id])).rows[0]:null;
    const recovery=(await client.query('SELECT * FROM auth_recovery_codes WHERE token_digest=$1 FOR UPDATE',[digest(code)])).rows[0];
    if(!/^rc1_[A-Za-z0-9_-]{43}$/.test(code) || !account || account.access_status!=='ACTIVE' || !recovery || recovery.account_id!==account.id ||
      recovery.credential_revision!==credential?.revision || recovery.used_at || (recovery.expires_at as Date).getTime()<=Date.now()){
      await event(client,account?.id??null,'LOGIN_FAILED');return null;
    }
    await client.query('UPDATE auth_recovery_codes SET used_at=clock_timestamp() WHERE token_digest=$1',[digest(code)]);
    await client.query('UPDATE auth_credentials SET salt=$1,verifier=$2 WHERE account_id=$3',[hashed.salt,hashed.verifier,account.id]);
    const recoveryCodes=await recoverySet(client,account.id);await event(client,account.id,'RECOVERY_USED');return {recoveryCodes};
  });
  if(!result) throw new DomainError(401,'INVALID_RECOVERY');return result;
}
