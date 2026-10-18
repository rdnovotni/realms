import type { Screen } from './views.js';
/** Presentation only: a saved encounter belongs to the Adventure navigation area. */
export const shellChapter=(screen:Screen)=>({adventure:'Adventure',character:'Character',pack:'Pack',combat:'Combat'})[screen];
export const shellNavigationPage=(screen:Screen)=>screen==='combat'?'adventure':screen;
export const shellNoticeLabel=(kind:string,busy:boolean)=>busy?'Connecting':kind==='error'?'Error':kind==='success'?'Success':kind==='warning'?'Warning':'Information';
