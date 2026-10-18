import type { AttributeName } from './types.js';

export type CharacterMotif=AttributeName|'adventurer'|'class'|'subclass'|'feat'|'proficiency'|'milestone'|'active'|'reaction'|'utility'|'passive'|'book'|'history';
/** Original ink illustrations. Decorative companions to visible, authoritative text. */
const drawings:Record<CharacterMotif,string>={
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
};
export function characterIcon(motif:CharacterMotif){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 32 32');svg.setAttribute('class','folio-icon character-ink-icon');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
 const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',drawings[motif]);svg.append(path);return svg;
}
