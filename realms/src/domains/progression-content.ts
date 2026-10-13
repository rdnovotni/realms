import type { ContentEntity } from './content.js';
import { DomainError } from '../foundation/errors.js';
import { addXP,validateProgressionCurve } from './progression-rules.js';
export type ResolutionXP={version:1;amount:string;curveId:string};
export function validateResolutionXP(value:unknown):asserts value is ResolutionXP {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new DomainError(400,'INVALID_RESOLUTION_XP');
  const spec=value as Record<string,unknown>;
  if(Object.keys(spec).length!==3 || spec.version!==1 || typeof spec.curveId!=='string' || !/^[a-z][a-z0-9_.-]{2,119}$/.test(spec.curveId)) throw new DomainError(400,'INVALID_RESOLUTION_XP');
  addXP('0',spec.amount as string);
}
export function validateProgressionReferences(entity:ContentEntity,entities:Map<string,ContentEntity>) {
  const mechanics=entity.definition.mechanics;
  if(mechanics?.xpCurve!==undefined) {
    if(entity.kind!=='TUNING') throw new DomainError(400,'INVALID_XP_CURVE_KIND');
    validateProgressionCurve(mechanics.xpCurve);
  }
  if(mechanics?.resolutionXP!==undefined) {
    if(entity.kind!=='ENCOUNTER' || mechanics.encounter===undefined) throw new DomainError(400,'INVALID_XP_SOURCE_KIND');
    validateResolutionXP(mechanics.resolutionXP);
    const curve=entities.get(mechanics.resolutionXP.curveId);
    if(curve?.kind!=='TUNING' || !entity.definition.dependencies.includes(curve.id)) throw new DomainError(400,'INVALID_XP_CURVE_REFERENCE');
    validateProgressionCurve(curve.definition.mechanics?.xpCurve);
  }
}
