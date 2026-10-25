import type { Json } from '../foundation/json.js';
/** Shared whitelist for actual content queries and synthetic Studio client previews. */
export function projectKnownContent(row:{id:string;revision:number;name:string;public:Record<string,Json>;advanced?:Record<string,Json>|null},advanced:boolean){
 return {id:row.id,revision:row.revision,name:row.name,public:structuredClone(row.public),advanced:advanced?structuredClone(row.advanced??null):null};
}
