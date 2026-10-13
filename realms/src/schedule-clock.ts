// Civil dates are stable identifiers; elapsed 24-hour timers are not game days.
const minute=60000;
export function validateDate(date:string){
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new Error('INVALID_GAME_DATE');
 return date;
}
export function nextDate(date:string){return new Date(Date.parse(validateDate(date)+'T00:00:00Z')+86400000).toISOString().slice(0,10);}
export function rolloverInstant(date:string,time:string,zone:string){
 validateDate(date);if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('INVALID_ROLLOVER_TIME');
 const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const civil=(ms:number)=>{const p=Object.fromEntries(fmt.formatToParts(ms).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`;};
 const target=Date.parse(date+'T'+time+':00Z'),offsets=new Set<number>();
 for(let hours=-36;hours<=36;hours+=6){const t=target+hours*3600000;offsets.add(Date.parse(civil(t))-t);}
 // Repeated local times choose the earlier occurrence. A gap moves forward to
 // the first valid local minute. Whole skipped civil dates fail visibly.
 for(let gap=0;gap<=180;gap++){
  const wanted=target+gap*minute,iso=new Date(wanted).toISOString().slice(0,19)+'Z';
  if(iso.slice(0,10)!==date)break;
  const matches=[...offsets].map(o=>wanted-o).filter(t=>civil(t)===iso).sort((a,b)=>a-b);
  if(matches.length)return new Date(matches[0]!).toISOString();
 }
 throw new Error('UNSUPPORTED_CIVIL_TIME_GAP');
}
