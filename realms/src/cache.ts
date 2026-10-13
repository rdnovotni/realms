import { createClient } from '@redis/client';
import { createHash } from 'node:crypto';
// Disposable data only. No durable jobs, sessions, balances or distributed game locks.
export class DisposableCache {
  private client: ReturnType<typeof createClient> | undefined;
  private connecting: Promise<void> | undefined;
  private retryAt=0;
  private closed=false;
  constructor(readonly namespace:string, private password:string, private host='cache', private port=6379) {
    if(!/^kol-(production|staging)$/.test(namespace))throw new Error('Invalid cache namespace');
  }
  private async command<T>(fn:(client:ReturnType<typeof createClient>)=>Promise<T>):Promise<T|null>{
    if(this.closed || Date.now()<this.retryAt)return null;
    let timer:ReturnType<typeof setTimeout>|undefined;
    let used:ReturnType<typeof createClient>|undefined;
    try {
      if(!this.client){
        this.client=createClient({maintNotifications:'disabled',socket:{host:this.host,port:this.port,connectTimeout:400,reconnectStrategy:false},username:'cache',password:this.password,disableOfflineQueue:true});
        this.client.on('error',()=>{}); // Errors are handled by the bounded command path, without logging secrets.
        this.connecting=this.client.connect().then(()=>{});
      }
      const client=this.client;used=client;
      return await Promise.race([(async()=>{await this.connecting;return fn(client);})(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('CACHE_TIMEOUT')),600);})]);
    } catch {
      if(this.client===used){if(this.client?.isOpen)this.client.destroy();this.client=undefined;this.connecting=undefined;this.retryAt=Date.now()+2000;}return null;
    } finally {if(timer)clearTimeout(timer);}
  }
  key(key:string){if(key.length>240 || !/^[A-Za-z0-9:_.-]+$/.test(key))throw new Error('Invalid cache key');return `${this.namespace}:${key}`;}
  async probe(){return await this.command(c=>c.ping())==='PONG';}
  async get(key:string){return this.command(c=>c.get(this.key(key)));}
  async set(key:string,value:string,seconds=60){
    if(!Number.isInteger(seconds)||seconds<1||seconds>3600||Buffer.byteLength(value)>65536)throw new Error('Invalid cache entry');
    return this.command(c=>c.set(this.key(key),value,{EX:seconds}));
  }
  async invalidate(key:string){return this.command(c=>c.del(this.key(key)));}
  // Supplemental traffic shaping only; authoritative authentication limits remain PostgreSQL-backed.
  async allow(subject:string,limit=120,seconds=60):Promise<boolean|null>{
    const bucket=createHash('sha256').update(subject).digest('hex');
    const script="local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n";
    const n=await this.command(c=>c.eval(script,{keys:[this.key(`rate:${bucket}`)],arguments:[String(seconds)]}));
    return n===null?null:Number(n)<=limit;
  }
  close(){this.closed=true;if(this.client?.isOpen)this.client.destroy();this.client=undefined;}
}
