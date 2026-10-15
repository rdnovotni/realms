export const itemArtKeys=['sword','greatsword','shield','ring','charm','medallion','compass','ore','vial','satchel','helmet','boots','armor'] as const;
type ArtItem={name:string;category?:string;family?:string;equipment?:{slots:string[]}|null;artwork?:string|null;icon?:string|null};
const known=(key:string|null|undefined)=>typeof key==='string'&&(itemArtKeys as readonly string[]).includes(key)?key:null;
/** Authored illustration, authored icon, specific public item/slot identity, category fallback. */
export function itemArtKey(item:ArtItem){
 const authored=known(item.artwork)??known(item.icon);if(authored)return authored;
 const name=(item.family+' '+item.name).toLowerCase(),slots=item.equipment?.slots??[];
 for(const [pattern,key]of [[/compass/,'compass'],[/medallion|amulet/,'medallion'],[/charm|talisman/,'charm'],[/\bring\b/,'ring'],[/satchel|backpack|\bbag\b/,'satchel']] as const)if(pattern.test(name))return key;
 if(item.category==='MATERIAL')return 'ore';if(item.category==='CONSUMABLE')return 'vial';
 if(slots.includes('HEAD'))return 'helmet';if(slots.includes('FEET'))return 'boots';if(slots.includes('CHEST'))return 'armor';if(slots.includes('TOOL'))return 'satchel';
 if(slots.some(s=>['RING_1','RING_2','TRINKET'].includes(s)))return 'charm';if(slots.includes('OFF_HAND')&&!slots.includes('MAIN_HAND'))return 'shield';
 if(item.category==='EQUIPMENT')return /great|two.hand/.test(name)?'greatsword':'sword';return null;
}
export function renderItemArt(item:ArtItem):HTMLElement|SVGElement{
 const key=itemArtKey(item);if(key){const image=document.createElement('img');image.src=`/assets/items/${key}.svg`;image.alt='';image.setAttribute('aria-hidden','true');image.className='item-illustration';image.addEventListener('error',()=>image.replaceWith(fallbackArt()),{once:true});return image;}
 return fallbackArt();
}
function fallbackArt(){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 64 64');svg.setAttribute('aria-hidden','true');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','m15 17 17-9 17 9 4 33-21 8-21-8ZM15 17l17 11 17-11M32 28v30');svg.append(path);return svg;}
