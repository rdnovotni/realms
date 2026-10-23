import { applyAppearance } from './appearance.js';
applyAppearance();
import { GameSession } from './session.js';
import { render,type Screen } from './views.js';
const root=document.getElementById('app');if(!root)throw new Error('Missing client root');
const session=new GameSession();let screen:Screen='adventure',previousActive:string|null=null,previousConnected=false,previousRun:string|null=null;
const draw=()=>{
 if(session.snapshot&&(!previousConnected||session.snapshot.game.run.runId!==previousRun)&&session.snapshot.progression.build.mode==='UNCONFIGURED')screen='character';
 previousRun=session.snapshot?.game.run.runId??null;
 previousConnected=!!session.snapshot;
 const active=session.snapshot?.game.activeEncounter;
 if(active?.kind==='TACTICAL'&&active.id!==previousActive)screen='combat';
 previousActive=active?.id??null;
 render(root,session,screen,next=>{if(next!=='daily')session.stopRepeatingTurns();if(next!=='consumption')session.stopRepeatingMeal();screen=next;draw();root.querySelector<HTMLElement>('main h1')?.focus();},command=>{
  const battle=session.snapshot?.battle;if(!battle)return;
  void session.action('/api/v1/tactical/actions','TACTICAL_ACTION',{instanceId:battle.instanceId,expectedEncounterRevision:battle.encounterRevision,expectedTacticalRevision:battle.tacticalRevision,command});
 });
};session.subscribe(draw);draw();void session.initialize();
