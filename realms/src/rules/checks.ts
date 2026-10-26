import { effectiveRule } from './modifiers.js';
import { DomainError } from '../foundation/errors.js';
export type Degree='CRITICAL_FAILURE'|'FAILURE'|'PARTIAL'|'SUCCESS'|'EXCEPTIONAL';
const degrees:Degree[]=['CRITICAL_FAILURE','FAILURE','PARTIAL','SUCCESS','EXCEPTIONAL'];
export type SharedCheck={version:2;attribute:string;skill:string|null;difficulty:number;minimumRank:number;attributeBaseline:number;attributeDivisor:number;rankBonuses:number[];partialMargin:number;exceptionalMargin:number;criticalFailureMargin:number;naturalShift:boolean;possibility:'ROLL'|'IMPOSSIBLE'|'AUTOMATIC';advantage:boolean;disadvantage:boolean;mode:'ACTIVE'|'PASSIVE';visibility:'KNOWN'|'HIDDEN'};
export function validateSharedCheck(v:unknown):asserts v is SharedCheck{
 const c=v as SharedCheck;
 if(!c||Object.keys(c).sort().join(',')!==['version','attribute','skill','difficulty','minimumRank','attributeBaseline','attributeDivisor','rankBonuses','partialMargin','exceptionalMargin','criticalFailureMargin','naturalShift','possibility','advantage','disadvantage','mode','visibility'].sort().join(',')||c.version!==2||!/^attribute\.(strength|dexterity|constitution|intelligence|wisdom|charisma|luck)$/.test(c.attribute)||(c.skill!==null&&!/^skill\.[a-z][a-z0-9_.-]{2,119}$/.test(c.skill))||![c.difficulty,c.attributeBaseline,c.attributeDivisor,c.minimumRank,c.partialMargin,c.exceptionalMargin,c.criticalFailureMargin].every(Number.isSafeInteger)||Math.abs(c.difficulty)>1000000||c.attributeBaseline<0||c.attributeBaseline>9999||c.attributeDivisor<1||c.attributeDivisor>9999||c.minimumRank<0||c.minimumRank>5||!Array.isArray(c.rankBonuses)||c.rankBonuses.length!==6||c.rankBonuses.some((n,i)=>!Number.isInteger(n)||n<0||n>1000||(i>0&&n<c.rankBonuses[i-1]!))||c.partialMargin>0||c.partialMargin< -1000000||c.exceptionalMargin<1||c.exceptionalMargin>1000000||c.criticalFailureMargin>=c.partialMargin||c.criticalFailureMargin< -1000000||![c.naturalShift,c.advantage,c.disadvantage].every(x=>typeof x==='boolean')||!['ROLL','IMPOSSIBLE','AUTOMATIC'].includes(c.possibility)||!['ACTIVE','PASSIVE'].includes(c.mode)||!['KNOWN','HIDDEN'].includes(c.visibility))throw new DomainError(400,'INVALID_SHARED_CHECK');
}
export type CheckActor={attributeScore:number;rank:number;modifiers:{source:string;amount:number}[];canAttempt:boolean};
export function resolveSharedCheck(c:SharedCheck,a:CheckActor,rolls:number[]){
 validateSharedCheck(c);
 if(!Number.isInteger(a.attributeScore)||a.attributeScore<1||a.attributeScore>9999||!Number.isInteger(a.rank)||a.rank<0||a.rank>5||a.modifiers.length>64||a.modifiers.some(m=>!m.source||!Number.isSafeInteger(m.amount)||Math.abs(m.amount)>1000000))throw new DomainError(409,'INVALID_CHECK_ACTOR');
 const eligible=a.canAttempt&&a.rank>=c.minimumRank;
 const deterministic=!eligible||c.possibility!=='ROLL'||c.mode==='PASSIVE';
 const needed=deterministic?0:c.advantage!==c.disadvantage?2:1;
 if(rolls.length!==needed||rolls.some(n=>!Number.isInteger(n)||n<1||n>20))throw new DomainError(409,'INVALID_SHARED_ROLLS');
 const roll=needed===2?(c.advantage?Math.max(...rolls):Math.min(...rolls)):needed===1?rolls[0]!:10;
 const attribute=Math.floor((a.attributeScore-c.attributeBaseline)/c.attributeDivisor),proficiency=c.rankBonuses[a.rank]!,modifier=(effectiveRule('check.modifier',0,a.modifiers.map(m=>({key:'check.modifier',source:m.source,layer:'EXPLICIT',operation:'ADD',value:m.amount}))).value as number),total=roll+attribute+proficiency+modifier,margin=total-c.difficulty;
 let index=!eligible||c.possibility==='IMPOSSIBLE'?1:c.possibility==='AUTOMATIC'?3:margin>=c.exceptionalMargin?4:margin>=0?3:margin>=c.partialMargin?2:margin<=c.criticalFailureMargin?0:1;
 if(needed&&c.naturalShift)index=Math.max(0,Math.min(4,index+(roll===20?1:roll===1?-1:0)));
 return {eligible,roll:needed||c.mode==='PASSIVE'?roll:null,rolls:[...rolls],attribute,proficiency,modifiers:structuredClone(a.modifiers),total,margin,degree:degrees[index]!,success:index>=3,partial:index===2};
}
export function sharedCheckChance(c:SharedCheck,a:CheckActor){
 const deterministic=!a.canAttempt||a.rank<c.minimumRank||c.possibility!=='ROLL'||c.mode==='PASSIVE';
 if(deterministic)return {numerator:resolveSharedCheck(c,a,[]).success?1:0,denominator:1};
 let numerator=0;const two=c.advantage!==c.disadvantage;
 for(let r=1;r<=20;r++)for(let s=1;s<=(two?20:1);s++)if(resolveSharedCheck(c,a,two?[r,s]:[r]).success)numerator++;
 return {numerator,denominator:two?400:20};
}
export function contest(attacker:number,defender:number,tie:'DEFENDER'|'ATTACKER'='DEFENDER'){if(![attacker,defender].every(Number.isSafeInteger))throw new DomainError(400,'INVALID_CONTEST');return attacker>defender||(attacker===defender&&tie==='ATTACKER');}
export function groupCheck(mode:'BEST'|'LEADER_ASSIST'|'MAJORITY'|'CUMULATIVE'|'WEAKEST',totals:number[],difficulty:number,leader=0,assist=0){
 if(totals.length<1||totals.length>8||!totals.every(Number.isSafeInteger)||!Number.isSafeInteger(difficulty)||!Number.isInteger(leader)||leader<0||leader>=totals.length||!Number.isInteger(assist)||assist<0||assist>5)throw new DomainError(400,'INVALID_GROUP_CHECK');
 const total=mode==='BEST'?Math.max(...totals):mode==='WEAKEST'?Math.min(...totals):mode==='LEADER_ASSIST'?totals[leader]!+assist:mode==='CUMULATIVE'?totals.reduce((s,n)=>s+n,0):totals.filter(n=>n>=difficulty).length;
 return {total,success:mode==='MAJORITY'?total>totals.length/2:total>=difficulty};
}

/** Uses the same v2 resolver for both actors. Defender wins ties. No second dice engine. */
export function contestedChance(check:SharedCheck,actor:CheckActor,defender:SharedCheck,target:CheckActor){
 const outcomes=(c:SharedCheck,a:CheckActor)=>{const deterministic=!a.canAttempt||a.rank<c.minimumRank||c.mode==='PASSIVE'||c.possibility!=='ROLL';const values:{total:number;count:number}[]=[];const counts=new Map<number,number>();if(deterministic)counts.set(resolveSharedCheck(c,a,[]).total,1);else for(let x=1;x<=20;x++)for(let y=1;y<=(c.advantage!==c.disadvantage?20:1);y++){const total=resolveSharedCheck(c,a,c.advantage!==c.disadvantage?[x,y]:[x]).total;counts.set(total,(counts.get(total)??0)+1);}for(const [total,count] of counts)values.push({total,count});return values;};
 let numerator=0,denominator=0;
 for(const d of outcomes(defender,target)){const chance=sharedCheckChance({...check,difficulty:d.total+1},actor);numerator+=d.count*chance.numerator;denominator+=d.count*chance.denominator;}
 return {numerator,denominator};
}
