import {timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
// Fastify continues to distrust Forwarded/X-Forwarded-* from every socket.
// Only the credentialed local proxy may supply a canonical client IP for budgets.
export function ingressPeer(socket:string,headers:Record<string,string|string[]|undefined>,key?:string):string {
 const supplied=headers['x-kol-proxy-key'],peer=headers['x-kol-client-ip'];
 if(!key || typeof supplied!=='string' || Buffer.byteLength(supplied)!==Buffer.byteLength(key) ||
    !timingSafeEqual(Buffer.from(supplied),Buffer.from(key)) || typeof peer!=='string' || !isIP(peer))return socket;
 return peer;
}
export class RequestBudget {
 private lastPrune=-Infinity;
 private readonly entries=new Map<string,{until:number;count:number}>();
 constructor(private readonly limit=120,private readonly capacity=10000){
  if(!Number.isInteger(limit)||limit<10||limit>10000)throw new Error('Invalid API request budget');
 }
 take(key:string,now=Date.now()):boolean {
  let bucket=this.entries.get(key);
  if(bucket && bucket.until<=now){this.entries.delete(key);bucket=undefined;}
  if(!bucket){
   if(this.entries.size>=this.capacity && now-this.lastPrune>=1000){this.lastPrune=now;for(const [id,b] of this.entries)if(b.until<=now)this.entries.delete(id);}
   if(this.entries.size>=this.capacity)return false;
   bucket={until:now+60000,count:0};this.entries.set(key,bucket);
  }
  if(bucket.count>=this.limit)return false;
  bucket.count++;return true;
 }
}
