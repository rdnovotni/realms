/** Original local ink motifs. Item illustrations remain owned by item-art.ts. */
export const characterMotifs = {
 strength:'M9 23V12l4-2 2 2V7l3-1 2 2v7l3-2 3 3-2 10H12l-3-3ZM13 13v6m5-8v8m4-2-2 5',
 dexterity:'M7 26 25 8m-9 0h9v9M6 10l4-4m-2 8 6-6M5 22l5 5m-1-9 6 6',
 constitution:'M16 4 27 9v9c0 5-5 9-11 12C10 27 5 23 5 18V9l11-5Zm0 7v12m-6-6h12',
 intelligence:'M4 7c5-2 9-1 12 2 3-3 7-4 12-2v19c-5-2-9-1-12 2-3-3-7-4-12-2V7Zm12 2v19M8 12l4 1m-4 4 4 1m8-5 4-1m-4 6 4-1',
 wisdom:'M3 16s5-8 13-8 13 8 13 8-5 8-13 8S3 16 3 16Zm17 0a4 4 0 1 0-8 0 4 4 0 0 0 8 0ZM16 3v2m0 22v2',
 charisma:'M7 6v20m0-18c6 4 11-5 18-1v12c-7-4-12 5-18 1M4 27h6m6-15h5',
 luck:'M16 16c-9-3-10-10-5-11 4-1 5 5 5 8 0-3 1-9 5-8 5 1 4 8-5 11Zm0 0c9 3 10 10 5 11-4 1-5-5-5-8 0 3-1 9-5 8-5-1-4-8 5-11Zm0 0c-3 9-10 10-11 5-1-4 5-5 8-5-3 0-9-1-8-5 1-5 8-4 11 5Zm0 0c3-9 10-10 11-5 1 4-5 5-8 5 3 0 9 1 8 5-1 5-8 4-11-5Z',
 adventurer:'M16 3 28 9v10c0 5-6 9-12 12C10 28 4 24 4 19V9l12-6Zm0 5v17M9 17h14m-7-8 5 13-5-3-5 3 5-13Z',
 class:'M16 3 27 9v9c0 5-5 9-11 12C10 27 5 23 5 18V9l11-6Zm0 5 3 7 7 1-7 3-3 7-3-7-7-3 7-1 3-7Z',
 subclass:'M16 4v24M6 8l10 8L26 8M7 24l9-8 9 8M3 8h6M23 8h6M4 24h6m12 0h6',
 feat:'M16 3 20 12l10 1-8 7 2 10-8-5-8 5 2-10-8-7 10-1 4-9Z',
 proficiency:'M6 26h20M8 23v-5h4v5m2 0V12h4v11m2 0V6h4v17',
 milestone:'M16 3 27 16 16 29 5 16 16 3Zm0 7v12m-6-6h12',
 active:'M19 3 7 18h8l-2 11 12-16h-8l2-10Z',
 reaction:'M8 10h11a8 8 0 1 1-7 12M8 10l6-6M8 10l6 6',
 utility:'M6 27 24 9m-5-5 9 9M5 20l7 7M18 8l6 6M5 7h6m-3-3v6m13 13h6m-3-3v6',
 passive:'M16 3 27 9v9c0 5-5 9-11 12C10 27 5 23 5 18V9l11-6Zm-6 14 4 4 8-10',
 book:'M4 6c5-2 9-1 12 2 3-3 7-4 12-2v20c-5-2-9-1-12 2-3-3-7-4-12-2V6Zm12 2v20m-8-16 4 1m8 0 4-1',
 history:'M9 4h17v22H9M9 8H5v20h17M13 10h9m-9 5h9m-9 5h6',
} as const;
export const slotMotifs = {
 HEAD:'M7 19v-7a9 9 0 0 1 18 0v7l-5 4h-8ZM7 14h18M16 5v9M12 23v4h8v-4',
 NECK:'M6 5q0 15 10 16Q26 20 26 5M12 23l4-3 4 3-4 6Z',
 SHOULDERS:'M3 18 7 9l7 3v10H4ZM29 18l-4-9-7 3v10h10Z',
 CHEST:'M11 5h10l3 5 5 3-4 7-4-3v11H11V17l-4 3-4-7 5-3ZM12 5q4 7 8 0',
 HANDS:'M7 14V7h4v6-9h4v9-9h4v9-7h4v11l-4 10H10L4 18v-5Z',
 WAIST:'M3 12h26v10H3ZM12 10h8v14h-8ZM4 17h7m10 0h7',
 LEGS:'M7 5h18v9l3 14H18l-2-14-2 14H4l3-14ZM7 10h18',
 FEET:'M7 4h10v14l9 4v6H5V14ZM6 23h19M9 8h5',
 TOOL:'m7 5 6 2 2 6-4 4 13 11 4-4-11-13 1-6-6-2 1 6-4 2Z',
 MAIN_HAND:'m21 3 6 2-2 6-12 12-4-4ZM7 17l10 10M5 27l5-5M3 29l3-1',
 OFF_HAND:'M5 6 16 2l11 4v10q-2 9-11 14Q7 25 5 16ZM16 7v16M10 12h12',
 TRINKET:'M8 17a8 8 0 1 0 16 0 8 8 0 1 0-16 0M12 6l4-4 4 4-4 5Z'
} as const;
export const statusMotifs = {collection:'M4 3h16v18l-8-4-8 4ZM8 8h8M8 12h8',favorite:'m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z',new:'M12 2v4m0 12v4M2 12h4m12 0h4M5 5l3 3m8 8 3 3M5 19l3-3M16 8l3-3M9 9h6v6H9Z',locked:'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5ZM12 14v3',equipped:'M9 3h6l2 4 5 3-3 5-3-2v8H8v-8l-3 2-3-5 5-3Z',loadout:'M5 3h14v18l-7-4-7 4Z',restricted:'M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0M6 6l12 12',copies:'M8 3h13v13H8ZM3 8v13h13',durability:'M12 2 21 6v6q-1 7-9 10Q4 19 3 12V6ZM12 6v8m0 3v1'} as const;
export const actionMotifs = {equip:'M9 3h6l2 4 5 3-3 5-3-2v8H8v-8l-3 2-3-5 5-3Z',use:'M9 3h6M10 3v5L5 18q-1 3 2 3h10q3 0 2-3L14 8V3M8 14h8',move:'M3 7h12m-4-4 4 4-4 4M21 17H9m4-4-4 4 4 4',lock:'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5ZM12 14v3',favorite:'m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z',repair:'m4 20 9-9M12 4q3-3 7-1l-4 4 2 2 4-4q2 7-5 8L6 22Z',compare:'M5 4v16M19 4v16M2 8h6M16 8h6M10 5l4 3-4 3M14 13l-4 3 4 3',history:'M3 4v6h6M3 10a9 9 0 1 1 1 8M12 7v6l4 2',collection:'M5 3h14v18l-7-4-7 4ZM8 8h8M8 12h8'} as const;
export const commonMotifs={
 health:'M12 21S2 14 2 8a5 5 0 0 1 10-1A5 5 0 0 1 22 8c0 6-10 13-10 13Z',
 mana:'M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13ZM9 15q0 4 4 4',
 weight:'M9 7a3 3 0 1 1 6 0M7 7h10l4 14H3Z',
 info:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM12 10v7m0-11v1',
 success:'M4 12l5 5L20 6', warning:'M12 2 23 21H1L12 2Zm0 7v5m0 3v1',
 error:'M5 5l14 14M19 5 5 19M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z',
 seal:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm5 5-3 7-7 3 3-7 7-3Z',
 road:'M3 22h18M6 22 11 2h4l-2 9 5 11M12 4l-1 4m-1 4-1 4m-1 3-1 3',
 battle:'m5 2 4 2 8 12-3 3L7 6ZM2 17l8-6M3 22l4-6M19 2l-4 2-3 5m5 5 5 5',
 journal:'M5 3h16v19H5q-4 0-3-4V5q0-2 3-2ZM6 3v19M9 8h9M9 12h9M9 16h6',
 result:'M4 3h16v11l-8 8-8-8ZM8 11l3 3 5-7'
} as const;
export type IconFamily='character'|'slot'|'status'|'action'|'common';
export const iconCatalog={character:characterMotifs,slot:slotMotifs,status:statusMotifs,action:actionMotifs,common:commonMotifs};
/** Decorative by default: meaning belongs to adjacent text or the owning control. */
export function folioIcon(name:string,family:IconFamily='common',className=''){
 const catalog:Readonly<Record<string,string>>=iconCatalog[family];
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('viewBox',family==='character'||family==='slot'?'0 0 32 32':'0 0 24 24');
 svg.setAttribute('class','folio-icon '+className);svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
 const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',catalog[name]??commonMotifs.info);svg.append(path);return svg;
}
