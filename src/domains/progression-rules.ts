import { DomainError } from '../foundation/errors.js';

// Cumulative authored thresholds; numeric JSON XP would lose bigint precision.
export type ProgressionCurve = { version:1; thresholds:string[] };
const maximumXP=9223372036854775807n;
function xpAmount(value:unknown):bigint {
  if(typeof value!=='string' || !/^(0|[1-9][0-9]{0,18})$/.test(value)) throw new DomainError(400,'INVALID_XP_AMOUNT');
  const amount=BigInt(value);
  if(amount>maximumXP) throw new DomainError(400,'INVALID_XP_AMOUNT');
  return amount;
}

export function validateProgressionCurve(value:unknown):asserts value is ProgressionCurve {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new DomainError(400,'INVALID_PROGRESSION_CURVE');
  const curve=value as Record<string,unknown>;
  if(Object.keys(curve).length!==2 || curve.version!==1 || !Array.isArray(curve.thresholds) || curve.thresholds.length<25 || curve.thresholds.length>999) throw new DomainError(400,'INVALID_PROGRESSION_CURVE');
  let prior=-1n;
  for(const [index,threshold] of curve.thresholds.entries()) {
    const amount=xpAmount(threshold);
    if((index===0 && amount!==0n) || amount<=prior) throw new DomainError(400,'INVALID_PROGRESSION_CURVE');
    prior=amount;
  }
}

// Threshold index zero is level 1. Readiness is separate from committed level:
// crossing a threshold never selects classes/feats or completes the campaign.
export function progressionReadiness(curve:ProgressionCurve,xp:string,committedLevel:number) {
  validateProgressionCurve(curve);
  const total=xpAmount(xp);
  if(!Number.isInteger(committedLevel) || committedLevel<1 || committedLevel>curve.thresholds.length || total<BigInt(curve.thresholds[committedLevel-1]!)) throw new DomainError(409,'INVALID_PROGRESSION_STATE');
  let low=0,high=curve.thresholds.length;
  while(low<high) {
    const middle=Math.floor((low+high)/2);
    if(BigInt(curve.thresholds[middle]!)<=total) low=middle+1;
    else high=middle;
  }
  return {xp,level:committedLevel,readyThroughLevel:low,pendingLevels:low-committedLevel,nextThreshold:curve.thresholds[low]??null};
}

export function addXP(current:string,award:string):string {
  const amount=xpAmount(award),total=xpAmount(current)+amount;
  if(amount===0n) throw new DomainError(400,'EMPTY_XP_AWARD');
  if(total>maximumXP) throw new DomainError(409,'XP_OVERFLOW');
  return total.toString();
}
