import test from 'node:test';
import assert from 'node:assert/strict';
import {ingressPeer,RequestBudget} from '../src/ingress.js';
import {buildApp} from '../src/app.js';
import type pg from 'pg';
const key='a'.repeat(64);
test('forged forwarded and identity headers never change the untrusted peer',()=>{
 for(const headers of [{'x-forwarded-for':'1.2.3.4'},{'cf-connecting-ip':'1.2.3.4'},{'x-kol-client-ip':'1.2.3.4','x-kol-proxy-key':'b'.repeat(64)}])assert.equal(ingressPeer('127.0.0.1',headers,key),'127.0.0.1');
 assert.equal(ingressPeer('127.0.0.1',{'x-kol-client-ip':'1.2.3.4','x-kol-proxy-key':key},key),'1.2.3.4');
 assert.equal(ingressPeer('127.0.0.1',{'x-kol-client-ip':'1.2.3.4','x-kol-proxy-key':'é'.repeat(64)},key),'127.0.0.1');
 assert.equal(ingressPeer('127.0.0.1',{'x-kol-client-ip':'bad','x-kol-proxy-key':key},key),'127.0.0.1');
});
test('request budgets bound memory, expire, and keep peers independent',()=>{
 const b=new RequestBudget(10,2);for(let n=0;n<10;n++)assert.equal(b.take('a',0),true);
 assert.equal(b.take('a',0),false);assert.equal(b.take('b',0),true);assert.equal(b.take('c',0),false);assert.equal(b.take('c',60001),true);
});
test('HTTP budget rejects repeated calls and ignores spoofed proxy identities',async()=>{
 const app=buildApp({} as pg.Pool,{mode:'sessions',throttleKey:key},false,undefined,undefined,key);
 try{
  for(let n=0;n<120;n++)assert.equal((await app.inject({url:'/api/v1/client/config',headers:{'x-forwarded-for':`10.0.0.${n}`}})).statusCode,200);
  assert.equal((await app.inject('/api/v1/client/config')).statusCode,429);
  assert.equal((await app.inject({url:'/api/v1/client/config',headers:{'x-kol-proxy-key':key,'x-kol-client-ip':'1.2.3.4'}})).statusCode,200);
  assert.equal((await app.inject('/health/live')).statusCode,200);
 }finally{await app.close();}
});
