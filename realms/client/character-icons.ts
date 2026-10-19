import { folioIcon,type characterMotifs } from './icons.js';
export type CharacterMotif=keyof typeof characterMotifs;
export const characterIcon=(motif:CharacterMotif)=>folioIcon(motif,'character','character-ink-icon');
