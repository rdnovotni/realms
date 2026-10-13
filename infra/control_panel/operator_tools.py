"""Read-only operator guidance and deliberately limited support reports."""
from datetime import datetime, timezone
import language as words

def age_seconds(value,now=None):
 try:
  stamp=datetime.fromisoformat(value)
  if stamp.tzinfo is None:return None
  age=((now or datetime.now(timezone.utc))-stamp).total_seconds()
  return age if age>=0 else None
 except (TypeError,ValueError,OverflowError):return None

def cache_is_stale(value,now=None):
 age=age_seconds(value,now)
 return age is None or age>180

def guidance(name):
 text=name.lower()
 if 'email' in text:return ('Checks & alerts','Configure your mail provider, then send a test email. Delivery must succeed before relying on remote alerts.')
 if 'outside' in text or 'port' in text or 'exposure' in text:return ('Checks & alerts','Run the documented port check from another Internet connection against your own home origin. A domain check only tests Cloudflare. Keep your home IP address private.')
 if 'release' in text or 'build' in text:return ('Releases','Build for testing, try sign-in and changed gameplay, save approval, then publish the approved version. Publishing interrupts live access briefly; it is never done automatically.')
 if 'restore' in text:return ('Backups','Select a backup and choose Test recovery safely. The test uses disposable databases and leaves live player data intact.')
 if 'backup' in text or 'usb' in text or 'drive' in text:return ('Backups','Check that the external drive is connected. Review the last successful backup and create a fresh backup. Keep the recovery password outside this computer.')
 if 'monitor' in text or 'stale' in text:return ('Overview','Choose Refresh now. If the monitor is missing or broken, Install / update monitoring uses Ubuntu administrator authentication.')
 if 'website' in text or 'tunnel' in text or 'public' in text:return ('Website','Check local website routing, then public access. If the game is healthy but the tunnel is disconnected, a tunnel restart may help.')
 if any(word in text for word in ('disk','storage','memory','capacity')):return ('Projects','Review resource limits and the running projects. Check logs and backup retention before removing anything; this console does not automatically delete data.')
 return ('Projects','Inspect the affected service and its logs. Check History for recent changes. Avoid restarting unrelated projects.')

def attention_items(status):
 rows=[]
 if status.get('cache_stale',True):rows.append({'key':'stale','state':'Unknown','name':'Server information is out of date','page':'Overview','advice':guidance('stale')[1]})
 for index,issue in enumerate(status.get('issues',[])):
  name=issue.get('message','An active issue needs review');page,advice=guidance(str(issue.get('id',''))+' '+name)
  rows.append({'key':'issue:'+str(issue.get('id',index)),'state':'Needs attention','name':name,'page':page,'advice':advice})
 for index,check in enumerate(status.get('readiness',[])):
  if check.get('state')=='passed':continue
  name=check.get('name','Unverified check');page,advice=guidance(name)
  rows.append({'key':'check:'+name,'state':'Not yet verified' if check.get('state')=='pending' else 'Needs review','name':name,'page':page,'advice':advice})
 return rows

def support_report(status):
 """Whitelist facts, not raw records: no addresses, credentials, paths or free text."""
 stale=bool(status.get('cache_stale',True))
 resources=status.get('resources',{});backup=status.get('backup',{})
 number=lambda value:value if isinstance(value,(int,float)) and not isinstance(value,bool) else None
 stamp=lambda value:value if age_seconds(value) is not None else None
 report={'captured_at':stamp(status.get('captured_at')),'observations_current':not stale,
  'projects':{},'backup':{k:stamp(backup.get(k)) for k in ('last_success','last_restore_success')},
  'active_issue_count':len(status.get('issues',[])),
  'remaining_check_count':sum(c.get('state')!='passed' for c in status.get('readiness',[])),
  'resources':{k:number(resources.get(k)) for k in ('disk_free','disk_total','memory_available','memory_total','cpu_percent')}}
 for project in ('kol-production','kol-staging'):
  report['projects'][words.project(project)]={'ready':None if stale else (status.get('health',{}).get(project,{}).get('ok') if isinstance(status.get('health',{}).get(project,{}).get('ok'),bool) else None),
   'services':[{'service':words.service(c['service']),'state':c.get('state') if c.get('state') in ('running','exited','created','restarting','paused','dead','removing') else 'unknown','health':c.get('health') if c.get('health') in ('healthy','unhealthy','starting','none') else 'unknown','memory_limit':number(c.get('memory_limit')),'restarts':number(c.get('restarts'))} for c in status.get('containers',[]) if c.get('project')==project and c.get('service') in words.SERVICES]}
 return report

def project_services(status,project):
 return tuple(s for s in words.SERVICES if s in ('api','db','cache','worker','scheduler','web') and any(c.get('project')==project and c.get('service')==s for c in status.get('containers',[])))

def running_builds(status):
 rows=[]
 for project in ('kol-production','kol-staging'):
  api=next((c for c in status.get('containers',[]) if c.get('project')==project and c.get('service')=='api'),None)
  if not api:rows.append(words.project(project)+': no observed game server');continue
  record=next((r for r in status.get('releases',[]) if r.get('image')==api.get('image')),None)
  title=record.get('label','Named update') if record else 'Existing build (no console release record)'
  rows.append(words.project(project)+': '+title+' · '+api.get('state','unknown'))
 return '\n'.join(rows)
