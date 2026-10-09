import { validateAbilityContent } from './tactical-abilities.js';
import { validateStatusContent } from './tactical-status.js';
import { validateCleansingContent } from './tactical-cleansing.js';
import { validateEffectContent,validateEffectFamilies } from './tactical-effects.js';
import { validateTacticalCampaignContent } from './tactical-campaign.js';
import { validateTacticalContent } from './tactical-content.js';
import { randomUUID } from 'node:crypto';
import { Ajv } from 'ajv';
import type pg from 'pg';
import { checksum, type Json } from '../foundation/json.js';
import { transaction } from '../foundation/transaction.js';
import { DomainError } from '../foundation/errors.js';
import { validateEquipmentContent } from './equipment-content.js';
import { validateRecipeReferences } from './crafting-content.js';
import { validateCombatReferences } from './combat-content.js';
import { validateLootReferences } from './loot.js';
import { validateEncounterSpec } from './encounters.js';
import { validateInventorySpec } from './item-accounting.js';
import { validateProgressionReferences } from './progression-content.js';
import { validateAttributeReferences } from './attribute-content.js';
import { validateFeatContent } from './feat-content.js';
import { validateSubclassReferences } from './subclasses.js';
import { validateBuildReferences } from './build-content.js';
import { validateProficiencyRequirements } from './proficiency-requirements.js';
import { validateProficiencyContent } from './proficiency-content.js';
import { validateCharacterMechanics,validateCheckRules,validateDamageRules,validateCharacterProfileReferences } from './character-mechanics.js';

export const kinds = ['ITEM','EFFECT','ABILITY','CLASS','SPECIES','MONSTER','NPC','ENCOUNTER','QUEST','RECIPE','LOCATION','ROUTE','FACTION','PATH','EVENT','ACTIVITY','CARD','FAMILIAR','BOSS','LOOT_TABLE','LORE','TUNING','SKILL'] as const;
export type ContentEntity = { id:string; kind:typeof kinds[number]; revision:number; schemaVersion:number; definition:{ name:string; dependencies:string[]; public:Record<string,Json>; advanced?:Record<string,Json>; mechanics?:Record<string,Json>; secrets?:Record<string,Json> } };
export type ContentPackage = { version:string; engineVersion:string; entities:ContentEntity[] };
const ajv = new Ajv({ strict:true, allErrors:true });
const validate = ajv.compile({ type:'object',additionalProperties:false,required:['version','engineVersion','entities'],properties:{
  version:{type:'string',minLength:1,maxLength:100},engineVersion:{type:'string',minLength:1,maxLength:100},
  entities:{type:'array',maxItems:10000,items:{type:'object',additionalProperties:false,required:['id','kind','revision','schemaVersion','definition'],properties:{
    id:{type:'string',pattern:'^[a-z][a-z0-9_.-]{2,119}$'},kind:{type:'string',enum:kinds},revision:{type:'integer',minimum:1,maximum:2147483647},schemaVersion:{type:'integer',const:1},
    definition:{type:'object',additionalProperties:false,required:['name','dependencies','public'],properties:{
      name:{type:'string',minLength:1,maxLength:200},dependencies:{type:'array',uniqueItems:true,items:{type:'string'}},
      public:{type:'object'},advanced:{type:'object'},mechanics:{type:'object'},secrets:{type:'object'}
    }}
  }}}
}});

// This validates the shared envelope. Each gameplay module must additionally validate its mechanics.
export function validateContent(input:unknown): asserts input is ContentPackage {
  if (!validate(input)) throw new DomainError(400,'INVALID_CONTENT_PACKAGE');
  const pkg=input as ContentPackage, entities=new Map(pkg.entities.map(e=>[e.id,e]));
  validateFeatContent(entities);
  validateEffectFamilies(entities);
  validateProficiencyContent(entities);
  for(const entity of pkg.entities) {
    validateAttributeReferences(entity,entities);
    validateSubclassReferences(entity,entities);
    validateBuildReferences(entity,entities);
    validateProgressionReferences(entity,entities);
    validateLootReferences(entity,entities);
    validateCombatReferences(entity,entities);
    validateRecipeReferences(entity,entities);
    validateEquipmentContent(entity);
    validateCharacterMechanics(entity);
    validateCharacterProfileReferences(entity,entities);
    validateTacticalContent(entity,entities);
    validateEffectContent(entity,entities);
    validateCleansingContent(entity);
    validateStatusContent(entity);
    validateAbilityContent(entity);
    validateTacticalCampaignContent(entity,entities);
    if(entity.definition.mechanics?.checkRules!==undefined) {
      if(entity.kind!=='TUNING')throw new DomainError(400,'INVALID_CHECK_RULES_KIND');
      validateCheckRules(entity.definition.mechanics.checkRules);
    }
    if(entity.definition.mechanics?.damageRules!==undefined) {
      if(entity.kind!=='TUNING')throw new DomainError(400,'INVALID_DAMAGE_RULES_KIND');
      validateDamageRules(entity.definition.mechanics.damageRules);
    }
    const encounter=entity.definition.mechanics?.encounter;
    if(entity.kind==='ENCOUNTER' && encounter!==undefined) validateEncounterSpec(encounter);
    const inventory=entity.definition.mechanics?.inventory;
    if(entity.kind==='ITEM' && inventory!==undefined) validateInventorySpec(inventory);
  }
  validateProficiencyRequirements(entities);
  if (entities.size!==pkg.entities.length) throw new DomainError(400,'DUPLICATE_CONTENT_ID');
  const visiting=new Set<string>(),done=new Set<string>();
  const visit=(id:string) => {
    if (visiting.has(id)) throw new DomainError(400,'CYCLIC_CONTENT_DEPENDENCY');
    if (done.has(id)) return;
    const entity=entities.get(id);
    if (!entity) throw new DomainError(400,'MISSING_CONTENT_DEPENDENCY');
    visiting.add(id);
    for (const dependency of entity.definition.dependencies) visit(dependency);
    visiting.delete(id);done.add(id);
  };
  for (const id of entities.keys()) visit(id);
  checksum(pkg as unknown as Json); // Also rejects non-finite JSON numbers.
}
export async function publishContent(pool:pg.Pool,input:unknown) {
  validateContent(input);
  // Clone before the first await, so callers cannot mutate an in-flight package.
  const pkg=structuredClone(input), entities=[...pkg.entities].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const manifest={version:pkg.version,engineVersion:pkg.engineVersion,entities:entities.map(e=>({id:e.id,revision:e.revision,checksum:checksum(e as unknown as Json)}))};
  const digest=checksum(manifest),id=randomUUID();
  return transaction(pool,async client=>{
    await client.query('SELECT pg_advisory_xact_lock(73180422)');
    const prior=(await client.query('SELECT id,checksum,sealed FROM content_releases WHERE version=$1',[pkg.version])).rows[0];
    if(prior){if(prior.checksum!==digest || !prior.sealed) throw new DomainError(409,'CONTENT_VERSION_REUSED');return prior.id as string;}
    for(const entity of entities){
      const identity=(await client.query('SELECT kind,retired_at FROM content_entities WHERE id=$1',[entity.id])).rows[0];
      if(identity && (identity.kind!==entity.kind || identity.retired_at)) throw new DomainError(409,'CONTENT_ID_REUSED');
      if(!identity) await client.query('INSERT INTO content_entities(id,kind) VALUES($1,$2)',[entity.id,entity.kind]);
      const hash=checksum(entity as unknown as Json);
      const version=(await client.query('SELECT checksum FROM content_versions WHERE entity_id=$1 AND revision=$2',[entity.id,entity.revision])).rows[0];
      if(version && version.checksum!==hash) throw new DomainError(409,'CONTENT_REVISION_REUSED');
      if(!version) await client.query('INSERT INTO content_versions(entity_id,revision,schema_version,definition,checksum) VALUES($1,$2,$3,$4,$5)',[entity.id,entity.revision,entity.schemaVersion,entity.definition,hash]);
    }
    await client.query('INSERT INTO content_releases(id,version,engine_version,checksum,manifest) VALUES($1,$2,$3,$4,$5)',[id,pkg.version,pkg.engineVersion,digest,manifest]);
    for(const entity of entities) await client.query('INSERT INTO release_entries(release_id,entity_id,revision) VALUES($1,$2,$3)',[id,entity.id,entity.revision]);
    await client.query('UPDATE content_releases SET sealed=true WHERE id=$1',[id]);
    return id;
  });
}
export async function contentView(pool:pg.Pool,accountId:string,releaseId:string,entityId:string){
  // Filter in SQL. Hidden definitions and mechanics never enter a client response object.
  const result=await pool.query(`SELECT e.entity_id AS id,e.revision,v.definition->>'name' AS name,
    v.definition->'public' AS public,CASE WHEN d.knowledge_level='ADVANCED' THEN v.definition->'advanced' ELSE NULL END AS advanced
    FROM release_entries e JOIN content_releases r ON r.id=e.release_id AND r.sealed
    JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision
    JOIN discoveries d ON d.entity_id=e.entity_id AND d.account_id=$1
    WHERE e.release_id=$2 AND e.entity_id=$3 AND EXISTS(
      SELECT 1 FROM runs x JOIN characters c ON c.id=x.character_id WHERE c.account_id=$1 AND x.content_release_id=e.release_id)`,[accountId,releaseId,entityId]);
  if(!result.rows.length) throw new DomainError(404,'CONTENT_NOT_KNOWN');
  return result.rows[0];
}
