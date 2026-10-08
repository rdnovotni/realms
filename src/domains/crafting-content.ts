import { Ajv } from 'ajv';
import { DomainError } from '../foundation/errors.js';
import type { ContentEntity } from './content.js';
import { validateInventorySpec } from './item-accounting.js';
export type RoutineRecipe={version:1;ruleset:'TRIVIAL_PROCESSING_V1';access:'DISCOVERED_CURRENT_RUN';turnCost:0;maxBatch:number;inputs:{itemId:string;quantity:number}[];output:{itemId:string;quantity:number}};
const id={type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'},count={type:'integer',minimum:1,maximum:10000};
const line={type:'object',additionalProperties:false,required:['itemId','quantity'],properties:{itemId:id,quantity:count}};
const validate=new Ajv({strict:true,allErrors:true}).compile({type:'object',additionalProperties:false,required:['version','ruleset','access','turnCost','maxBatch','inputs','output'],properties:{version:{const:1,type:'integer'},ruleset:{const:'TRIVIAL_PROCESSING_V1',type:'string'},access:{const:'DISCOVERED_CURRENT_RUN',type:'string'},turnCost:{const:0,type:'integer'},maxBatch:{type:'integer',minimum:1,maximum:100},inputs:{type:'array',minItems:1,maxItems:16,items:line},output:line}});
export function recipeSpec(value:unknown):RoutineRecipe{
  if(!validate(value))throw new DomainError(400,'INVALID_ROUTINE_RECIPE');
  const spec=value as RoutineRecipe;
  if(new Set(spec.inputs.map(x=>x.itemId)).size!==spec.inputs.length || spec.inputs.some(x=>x.itemId===spec.output.itemId))throw new DomainError(400,'INVALID_ROUTINE_RECIPE');
  return spec;
}
export function validateRecipeReferences(entity:ContentEntity,entities:Map<string,ContentEntity>){
  const value=entity.definition.mechanics?.routineRecipe;if(value===undefined)return;
  if(entity.kind!=='RECIPE')throw new DomainError(400,'INVALID_ROUTINE_RECIPE');
  const spec=recipeSpec(value);
  for(const entry of [...spec.inputs,spec.output]){
    const item=entities.get(entry.itemId),inventory=item?.definition.mechanics?.inventory;
    if(!item || item.kind!=='ITEM' || !entity.definition.dependencies.includes(item.id))throw new DomainError(400,'INVALID_RECIPE_REFERENCE');
    validateInventorySpec(inventory);
    if(inventory.category!=='MATERIAL' || inventory.storageMode!=='STACK')throw new DomainError(400,'INVALID_RECIPE_MATERIAL');
  }
}
