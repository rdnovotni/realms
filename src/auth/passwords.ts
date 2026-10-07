import { randomBytes,scrypt,timingSafeEqual } from 'node:crypto';
import { DomainError } from '../foundation/errors.js';
let active=0;
function validText(password:string){return typeof password==='string' && [...password].length<=128 && Buffer.from(password,'utf8').toString('utf8')===password;}
export function validateNewPassword(password:string){
  if(!validText(password) || [...password].length<15) throw new DomainError(400,'PASSWORD_POLICY');
}
async function derive(password:string,salt:Buffer){
  if(!validText(password)) throw new DomainError(400,'PASSWORD_POLICY');
  // Bound concurrent 128 MiB derivations without an unbounded request queue.
  if(active>=2) throw new DomainError(503,'AUTH_BUSY');
  active++;
  try{return await new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,32,{N:131072,r:8,p:1,maxmem:192*1024*1024},(error,key)=>error?reject(error):resolve(key)));}
  finally{active--;}
}
export async function hashPassword(password:string){validateNewPassword(password);const salt=randomBytes(16);return {salt,verifier:await derive(password,salt)};}
export async function verifyPassword(password:string,credential?:{salt:Buffer;verifier:Buffer}){
  const result=await derive(password,credential?.salt??Buffer.alloc(16));
  const matches=timingSafeEqual(result,credential?.verifier??Buffer.alloc(32));
  return Boolean(credential && matches);
}
