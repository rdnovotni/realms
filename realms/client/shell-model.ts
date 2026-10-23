import type { Screen } from './views.js';
export const shellRenderedScreen=(screen:Screen,hasBattle:boolean):Screen=>screen==='combat'&&!hasBattle?'adventure':screen;
/** Presentation only: a saved encounter belongs to the Adventure navigation area. */
export const shellChapter=(screen:Screen)=>({adventure:'Adventure',character:'Character',pack:'Pack',combat:'Combat',daily:'Turns & daily planner',consumption:'Food, drink & Tolerance'})[screen];
export const shellNavigationPage=(screen:Screen)=>screen==='combat'||screen==='daily'||screen==='consumption'?'adventure':screen;
export const shellNoticeLabel=(kind:string,busy:boolean)=>busy?'Connecting':kind==='error'?'Error':kind==='success'?'Success':kind==='warning'?'Warning':'Information';
