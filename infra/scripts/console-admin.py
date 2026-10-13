#!/usr/bin/env python3
"""Fixed local console actions and root-private monitoring; no administration listener."""
import argparse,fcntl,hashlib,importlib.util,json,os,re,shlex,shutil,smtplib,ssl,subprocess,sys,time,urllib.request,urllib.error,uuid
from datetime import datetime,timezone
from email.message import EmailMessage
from pathlib import Path
INFRA=Path(__file__).resolve().parents[1];ROOT=Path('/srv/Realms');STATE=ROOT/'state/console';PUBLIC=Path('/run/realms-console')
s=importlib.util.spec_from_file_location('console_releases',INFRA/'scripts/releases.py');releases=importlib.util.module_from_spec(s);s.loader.exec_module(releases)
p=releases.p;pg=releases.pg
PROJECTS=('kol-production','kol-staging','infra-test-a','infra-test-b','example-project');GAME=PROJECTS[:2]
UNITS=('cloudflared.service','docker.service','kol-realms.service','kol-postgresql.service','realms-backup.timer','realms-backup-restore.timer','realms-console-monitor.timer')
ACTIONS=('install','monitor','status','backup','restore','retention-preview','public-check','proxy-check','exposure','stage','promote','rollback','project-start','project-stop','api-restart','tunnel-restart','logs','jobs-report','jobs-preview','email-configure','email-test','alert-acknowledge','monitoring-private','monitoring-rollback','release-plan','verify-staging','backup-index','publish-preflight')
SERVICES=('api','db','cache','worker','scheduler','web')
def stamp():return datetime.now(timezone.utc).isoformat()
def write_json(path,value,mode=0o600):
 path.parent.mkdir(parents=True,exist_ok=True,mode=0o700 if path.parent==STATE else 0o755)
 if path.is_symlink():raise RuntimeError('Refusing a symlink destination')
 tmp=path.with_name('.'+path.name+'.'+uuid.uuid4().hex)
 with tmp.open('x') as f:os.chmod(tmp,mode);json.dump(value,f,indent=2);f.flush();os.fsync(f.fileno())
 os.replace(tmp,path)
def read_json(path,default=None):
 try:return json.loads(path.read_text())
 except (OSError,ValueError):return default if default is not None else {}
def capture(args,timeout=15):
 r=subprocess.run([str(x) for x in args],capture_output=True,text=True,timeout=timeout)
 if r.returncode:raise RuntimeError(Path(str(args[0])).name+' query unavailable')
 return r.stdout.strip()
def script(name,*args):
 return subprocess.run(['/usr/bin/python3',str(INFRA/'scripts'/name),*map(str,args)],check=True).returncode

def probe(url):
 req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 (compatible; RealmsConsole/1.0)','Cache-Control':'no-cache'})
 try:
  with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req,timeout=5) as r:
   body=r.read(8192);return {'code':r.status,'ok':r.status==200,'body':json.loads(body) if 'json' in r.headers.get('Content-Type','') else {}}
 except urllib.error.HTTPError as e:return {'code':e.code,'ok':False}
 except (OSError,ValueError):return {'code':None,'ok':False}
def unit_status():
 raw=capture(['systemctl','show',*UNITS,'-p','Id','-p','ActiveState','-p','UnitFileState','-p','NextElapseUSecRealtime','-p','Result','-p','ActiveEnterTimestamp'])
 result={}
 for block in raw.split('\n\n'):
  row=dict(line.split('=',1) for line in block.splitlines() if '=' in line)
  if row.get('Id') in UNITS:result[row['Id']]=row
 return result

def container_status():
 ids=capture(p.DOCKER+['ps','-aq']).splitlines();result=[]
 if not ids:return result
 for c in json.loads(capture(p.DOCKER+['inspect',*ids],timeout=30)):
  labels=c['Config'].get('Labels',{}) or {};project=labels.get('com.docker.compose.project')
  if project not in (*PROJECTS,'kol-edge'):continue
  result.append({'project':project,'service':labels.get('com.docker.compose.service','unknown'),'state':c['State']['Status'],
   'health':c['State'].get('Health',{}).get('Status','not configured'),'image':c['Image'],'memory_limit':c['HostConfig'].get('Memory',0),'restarts':c.get('RestartCount',0),
   'restart_policy':c['HostConfig']['RestartPolicy']['Name'],'ports':c['HostConfig'].get('PortBindings') or {},'networks':list(c['NetworkSettings']['Networks']),
   'volumes':[m.get('Name','bind storage') for m in c['Mounts'] if m['Type']=='volume']})
 return result

def exposure():
 rows=capture(['ss','-H','-lnt']).splitlines();bindings=[]
 for row in rows:
  parts=row.split()
  if len(parts)<4:continue
  endpoint=parts[3];address,port=endpoint.rsplit(':',1);address=address.strip('[]')
  bindings.append({'address':address,'port':int(port),'loopback':address in ('127.0.0.1','::1')})
 issues=[r for r in bindings if not r['loopback'] and r['port'] in (3000,13000,13001,5432,55432,6379,19080,19081,19091,61208)]
 return {'checked':stamp(),'bindings':bindings,'unexpected_sensitive_bindings':issues,'external_scan':'pending operator outside-network IPv4/IPv6 scan; local bindings do not prove router safety'}
def database_metrics(project):
 sql="BEGIN READ ONLY; SELECT json_build_object('bytes',pg_database_size(current_database()),'connections',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()),'commits',xact_commit,'rollbacks',xact_rollback,'deadlocks',deadlocks,'cache_hits',blks_hit,'disk_reads',blks_read) FROM pg_stat_database WHERE datname=current_database(); COMMIT;"
 base=p.DOCKER+['compose','--project-directory',str(p.BASE/project),'--env-file',str(p.BASE/project/'.env'),'-f',str(p.BASE/project/'compose.yaml'),'exec','-T','db','psql','-X','-qAt','-U','postgres','-d',p.read_database_name(project),'-c',sql]
 return json.loads(capture(base))

def collect():
 result={'captured_at':stamp(),'errors':[],'units':{},'containers':[],'databases':{},'health':{},'releases':releases.history()}
 for key,fn in [('units',unit_status),('containers',container_status),('exposure',exposure)]:
  try:result[key]=fn()
  except Exception:result['errors'].append(key+' unavailable')
 for project,port in [('native',3000),('kol-production',13000),('kol-staging',13001)]:result['health'][project]=probe(f'http://127.0.0.1:{port}/health/ready')
 for project in GAME:
  try:result['databases'][project]=database_metrics(project)
  except Exception:result['databases'][project]={'error':'Database metrics unavailable'}
 result['backup']=read_json(ROOT/'state/backups/health.json');result['drive_mounted']=os.path.ismount('/mnt/Realms-backups')
 disk=shutil.disk_usage(ROOT);mem={line.split(':')[0]:int(line.split()[1])*1024 for line in Path('/proc/meminfo').read_text().splitlines()}
 result['resources']={'disk_free':disk.free,'disk_total':disk.total,'memory_available':mem['MemAvailable'],'memory_total':mem['MemTotal'],'load':os.getloadavg()}
 previous=read_json(PUBLIC/'status.json');cached=previous.get('public',{})
 if time.time()-cached.get('checked_epoch',0)>300:cached={**probe('https://playfollybound.com/health/live'),'checked_epoch':time.time()}
 result['public']=cached
 try:result['protected_monitor']=str(RUNTIME/'infra/scripts/console-admin.py') in capture(['systemctl','show','realms-console-monitor.service','-p','ExecStart','--value'])
 except Exception:result['protected_monitor']=False
 result['snapshots']=read_json(STATE/'snapshots.json',[])
 result['operation']=read_json(STATE/'operation.json');result['operation_history']=read_json(STATE/'operations.json',[])
 email=read_json(STATE/'email.json');result['email']={'configured':bool(email),'enabled':bool(email.get('enabled')),'last_delivery':read_json(STATE/'email-status.json')}
 result['resource_history']=resource_history(result['resources']);result['readiness']=readiness(result)
 result['issues']=issues(result);return result

def cpu_percentage(previous,current):
 total=current['total']-previous['total'];idle=current['idle']-previous['idle']
 if total<=0 or idle<0:return None
 return round(max(0,min(100,100*(total-idle)/total)),1)

def resource_history(resources):
 ticks=[int(x) for x in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
 sample={'total':sum(ticks),'idle':ticks[3]+ticks[4]};previous=read_json(STATE/'cpu-sample.json')
 resources['cpu_percent']=cpu_percentage(previous,sample) if previous else None
 write_json(STATE/'cpu-sample.json',sample)
 rows=read_json(STATE/'resource-history.json',[])
 rows.append({'at':stamp(),'cpu':resources['cpu_percent'],'memory':round(100*(1-resources['memory_available']/resources['memory_total']),1),'disk_free':resources['disk_free']})
 write_json(STATE/'resource-history.json',rows[-240:]);return rows[-60:]

def readiness(status):
 backup=status.get('backup',{});email=status.get('email',{})
 return [{'name':'Protected unattended monitor runtime','state':'passed' if status.get('protected_monitor') else 'pending'},
 {'name':'Production ready','state':'passed' if status.get('health',{}).get('kol-production',{}).get('ok') else 'failed'},
 {'name':'Public website health','state':'passed' if status.get('public',{}).get('ok') else 'failed'},
 {'name':'Encrypted backup within 12 hours','state':'passed' if age_hours(backup.get('last_success'))<12 else 'failed'},
 {'name':'Restore verified within eight days','state':'passed' if age_hours(backup.get('last_restore_success'))<192 else 'failed'},
 {'name':'Email alert delivery','state':'passed' if email.get('enabled') and email.get('last_delivery',{}).get('state')=='sent' else 'pending'},
 {'name':'Outside-network origin port scan','state':'pending'},
 {'name':'Gated production release rehearsal','state':'passed' if any(r.get('state')=='production_live' for r in status.get('releases',[])) else 'pending'}]

def age_hours(value):
 try:return (datetime.now(timezone.utc)-datetime.fromisoformat(value)).total_seconds()/3600
 except (ValueError,TypeError):return float('inf')
def issues(status):
 result=[]
 def add(code,message,severity='warning'):result.append({'id':code,'message':message,'severity':severity})
 operation=status.get('operation',{});maintenance=operation.get('active') and age_hours(operation.get('started'))<2
 scope=operation.get('project') if maintenance and operation.get('action') in ('rollback','project-start','project-stop','api-restart') else None
 if maintenance and operation.get('action')=='stage':scope='kol-staging'
 if maintenance and operation.get('action')=='promote':scope='kol-production'
 for project,row in status.get('health',{}).items():
  if project==scope:continue
  if not row.get('ok'):add('health:'+project,project+' is not ready','critical')
 if not status.get('drive_mounted'):add('backup:drive','USB backup drive is not mounted','critical')
 backup=status.get('backup',{})
 if age_hours(backup.get('last_success'))>12:add('backup:stale','No successful encrypted backup in the last 12 hours','critical')
 if age_hours(backup.get('last_restore_success'))>24*8:add('backup:restore','Restore verification is more than eight days old')
 if backup.get('last_result') in ('failed','interrupted'):add('backup:failure','The latest backup operation needs attention')
 for unit,row in status.get('units',{}).items():
  if row.get('ActiveState')!='active':add('unit:'+unit,unit+' is not active','critical')
 for row in status.get('containers',[]):
  if row['project'] in GAME or row['project']=='kol-edge':
   if row['project']==scope:continue
   if row['service'] in ('api','db','cache','worker','scheduler','caddy') and (row['state']!='running' or row['health']=='unhealthy'):add('container:'+row['project']+':'+row['service'],row['project']+' '+row['service']+' needs attention','critical')
 for expected in [(n,s) for n in GAME for s in ('api','db','cache','worker','scheduler')]+[('kol-edge','caddy')]:
  if expected[0]==scope:continue
  if not any((c['project'],c['service'])==expected for c in status.get('containers',[])):add('missing:'+':'.join(expected),expected[0]+' '+expected[1]+' status unavailable','critical')
 resource=status.get('resources',{})
 if resource.get('disk_free',0)<5*1024**3 or resource.get('disk_free',0)/max(resource.get('disk_total',1),1)<.1:add('capacity:disk','Server storage is running low','critical')
 if resource.get('memory_available',0)<1024**3:add('capacity:memory','Less than 1 GiB memory available')
 if scope!='kol-production' and not status.get('public',{}).get('ok'):add('website:public','Public website health check failed','critical')
 if status.get('email',{}).get('last_delivery',{}).get('state')=='failed':add('email:delivery','Email alert delivery failed; check mail settings')
 if status.get('operation',{}).get('active') and age_hours(status['operation'].get('started'))>=2:add('operation:stalled','A console operation has been active for more than two hours; review before retrying','critical')
 if status.get('releases') and status['releases'][0].get('state','').endswith('_failed'):add('release:failed','Latest release failed; review its recovery record')
 for error in status.get('errors',[]):add('query:'+error,error)
 if status.get('exposure',{}).get('unexpected_sensitive_bindings'):add('ports:sensitive','A database, cache, monitoring or game-origin port is listening beyond localhost','critical')
 return result

def validate_email(cfg):
 allowed={'host','port','username','password','sender','recipient','tls','enabled'}
 if set(cfg)-allowed:raise ValueError('Unknown email field')
 for field in ('host','username','password','sender','recipient'):
  if not isinstance(cfg.get(field),str) or any(c in cfg[field] for c in ('\n','\r','\x00')):raise ValueError('Invalid email setting')
 if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]{1,252}',cfg['host']):raise ValueError('Use a mail-server hostname')
 for field in ('sender','recipient'):
  if not re.fullmatch(r'[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+',cfg[field]):raise ValueError('Use complete email addresses')
 if cfg.get('tls') not in ('starttls','ssl') or not isinstance(cfg.get('port'),int) or not 1<=cfg['port']<=65535:raise ValueError('TLS and a valid mail port are required')
 if not isinstance(cfg.get('enabled'),bool):raise ValueError('Choose whether email is enabled')
 return cfg

def send_email(subject,body,test=False):
 cfg=read_json(STATE/'email.json')
 if not cfg.get('enabled'):raise RuntimeError('Email is not configured and enabled')
 validate_email(cfg);msg=EmailMessage();msg['Subject']=subject;msg['From']=cfg['sender'];msg['To']=cfg['recipient'];msg.set_content(body)
 try:
  cls=smtplib.SMTP_SSL if cfg['tls']=='ssl' else smtplib.SMTP
  options={'context':ssl.create_default_context()} if cfg['tls']=='ssl' else {}
  with cls(cfg['host'],cfg['port'],timeout=15,**options) as smtp:
   if cfg['tls']=='starttls':smtp.ehlo();smtp.starttls(context=ssl.create_default_context());smtp.ehlo()
   smtp.login(cfg['username'],cfg['password']);smtp.send_message(msg)
  write_json(STATE/'email-status.json',{'state':'sent','at':stamp()})
 except Exception as e:
  write_json(STATE/'email-status.json',{'state':'failed','at':stamp(),'reason':type(e).__name__});raise RuntimeError('Email delivery failed; check SMTP settings privately') from None

def monitor():
 STATE.mkdir(parents=True,exist_ok=True,mode=0o700)
 with (STATE/'monitor.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  status=collect();old=read_json(STATE/'alert-state.json');active={r['id']:r for r in status['issues']};prior=old.get('active',{})
  changes=[{'kind':'opened','issue':active[k],'at':stamp()} for k in active.keys()-prior.keys()]+[{'kind':'resolved','issue':prior[k],'at':stamp()} for k in prior.keys()-active.keys()]
  history=(old.get('history',[])+changes)[-200:];notification=old.get('notification',{})
  if changes:notification={'id':uuid.uuid4().hex,'summary':'; '.join(x['kind']+': '+x['issue']['message'] for x in changes)[:1000]}
  pending=old.get('email_pending',[])+changes
  if pending and read_json(STATE/'email.json').get('enabled'):
   try:send_email('Realms server status changed','\n'.join(x['at']+' '+x['kind']+': '+x['issue']['message'] for x in pending));pending=[]
   except RuntimeError:pass
  write_json(STATE/'alert-state.json',{'active':active,'history':history,'notification':notification,'email_pending':pending[-200:]})
  status.update(alert_history=history,notification=notification,acknowledged=read_json(STATE/'ack.json').get('at'));status['email']['last_delivery']=read_json(STATE/'email-status.json')
  PUBLIC.mkdir(exist_ok=True,mode=0o755);PUBLIC.chmod(0o755);write_json(PUBLIC/'status.json',status,0o644)
  print(json.dumps({'issues':len(active),'changes':len(changes),'at':status['captured_at']}),flush=True)

RUNTIME=ROOT/'system-tools/console-runtime'
RUNTIME_FILES=('console-admin.py','git_snapshot.py','release_verification.py','releases.py','backend.py','cache-workers.py','postgresql.py','docker-projects.py')
def runtime_copy(source,destination):
 destination.mkdir(mode=0o755)
 scripts=destination/'infra/scripts';scripts.mkdir(parents=True,mode=0o755)
 manifest={}
 for name in RUNTIME_FILES:
  origin=source/'scripts'/name
  if origin.is_symlink() or not origin.is_file():raise RuntimeError('Unexpected runtime source file')
  data=origin.read_bytes();compile(data,str(origin),'exec');path=scripts/name;path.write_bytes(data);path.chmod(0o644);manifest[name]=hashlib.sha256(data).hexdigest()
 write_json(destination/'manifest.json',manifest,0o644)
 for folder in (destination,destination/'infra',scripts):folder.chmod(0o755)

def install():
 desired=[]
 for path in (INFRA/'systemd/console').glob('*.in'):
  dest=Path('/etc/systemd/system')/path.name.removesuffix('.in');text=path.read_text().replace('__SOURCE__',str(RUNTIME))
  legacy=path.read_text().replace('__SOURCE__',str(INFRA.parent))
  if dest.exists() and dest.read_text() not in (text,legacy):raise RuntimeError('Customized console monitor unit; refusing overwrite')
  desired.append((dest,text))
 RUNTIME.parent.mkdir(parents=True,exist_ok=True,mode=0o755)
 for ancestor in (RUNTIME.parent,*RUNTIME.parent.parents):
  if ancestor.is_symlink() or ancestor.stat().st_uid!=0 or ancestor.stat().st_mode&0o022:raise RuntimeError('Monitor runtime ancestors must be administrator-owned and not writable by other users')
 if RUNTIME.is_symlink() or (RUNTIME.exists() and RUNTIME.stat().st_uid!=0):raise RuntimeError('Runtime must be administrator-owned')
 stage=RUNTIME.with_name('.console-runtime-'+uuid.uuid4().hex);runtime_copy(INFRA,stage)
 previous=RUNTIME.with_name('console-runtime.previous')
 original={dest:dest.read_text() if dest.exists() else None for dest,text in desired};replaced=False
 subprocess.run(['systemctl','stop','realms-console-monitor.timer','realms-console-monitor.service'],check=True)
 try:
  if previous.exists():shutil.rmtree(previous)
  if RUNTIME.exists():os.replace(RUNTIME,previous)
  os.replace(stage,RUNTIME);replaced=True
  for dest,text in desired:dest.write_text(text);dest.chmod(0o644)
  subprocess.run(['systemd-analyze','verify','/etc/systemd/system/realms-console-monitor.service'],check=True)
  subprocess.run(['systemctl','daemon-reload'],check=True)
  try:
   spec=importlib.util.spec_from_file_location('install_backups',INFRA/'scripts/local-backups.py');backups=importlib.util.module_from_spec(spec);spec.loader.exec_module(backups)
   write_json(STATE/'snapshots.json',backups.snapshot_index())
  except (OSError,RuntimeError,ValueError):print('Backup list unavailable; use Refresh restore points when the drive is available.')
  # Probe before re-enabling the timer to avoid two concurrent monitor jobs.
  subprocess.run(['/usr/bin/python3','-I',str(RUNTIME/'infra/scripts/console-admin.py'),'monitor'],stdin=subprocess.DEVNULL,check=True)
 except BaseException:
  if replaced and RUNTIME.exists():shutil.rmtree(RUNTIME)
  if previous.exists() and not RUNTIME.exists():os.replace(previous,RUNTIME)
  for dest,text in original.items():
   if text is None:dest.unlink(missing_ok=True)
   else:dest.write_text(text);dest.chmod(0o644)
  subprocess.run(['systemctl','daemon-reload']);raise
 finally:
  if stage.exists():shutil.rmtree(stage)
  if Path('/etc/systemd/system/realms-console-monitor.timer').exists():subprocess.run(['systemctl','enable','--now','realms-console-monitor.timer'],check=True)
 print('Protected console monitoring installed. No game services restarted; no public administrator port opened.')

def private_monitor_command(text):
 lines=[line.removeprefix('ExecStart=') for line in text.splitlines() if line.startswith('ExecStart=') and line!='ExecStart=']
 if len(lines)!=1:raise RuntimeError('Ambiguous monitoring service command')
 args=shlex.split(lines[0])
 if len(args)!=4 or args[1:3]!=['-w','-B'] or args[3] not in ('0.0.0.0','127.0.0.1'):raise RuntimeError('Customized Glances command; review before modifying')
 if not re.fullmatch(r'(?:/home/[A-Za-z0-9_-]+/\.local/bin|/usr/(?:local/)?bin)/glances',args[0]):raise RuntimeError('Unexpected Glances executable')
 return '[Service]\nExecStart=\nExecStart='+json.dumps(args[0])+' -w -B 127.0.0.1\n'

def monitoring_binding(rollback=False):
 folder=Path('/etc/systemd/system/glances.service.d');path=folder/'90-realms-local.conf';recordpath=STATE/'monitoring-local.json'
 if rollback:
  record=read_json(recordpath)
  if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=record.get('hash'):raise RuntimeError('Monitoring override changed; refusing rollback')
  path.unlink();subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','restart','glances.service'],check=True)
  print('Removed only the console monitoring override; prior binding restored.');return
 fragment=capture(['systemctl','show','glances.service','-p','FragmentPath','--value']);source=Path(fragment)
 if not source.is_file():raise RuntimeError('Monitoring unit is unavailable')
 content=private_monitor_command(source.read_text())
 drops=capture(['systemctl','show','glances.service','-p','DropInPaths','--value']).split()
 if any(drop!=str(path) for drop in drops):raise RuntimeError('Other Glances drop-ins exist; review rather than overwrite')
 if path.exists() and path.read_text()!=content:raise RuntimeError('Customized local override; refusing overwrite')
 if not recordpath.exists():write_json(recordpath,{'hash':hashlib.sha256(content.encode()).hexdigest(),'original_unit':source.read_text()})
 folder.mkdir(exist_ok=True,mode=0o755);path.write_text(content);path.chmod(0o644)
 try:
  subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','restart','glances.service'],check=True)
  for _ in range(40):
   endpoints=[r for r in exposure()['bindings'] if r['port']==61208]
   if endpoints and all(r['loopback'] for r in endpoints):break
   time.sleep(.5)
  else:raise RuntimeError('Local monitoring listener did not become ready')
 except BaseException:
  if path.read_text()==content:path.unlink();subprocess.run(['systemctl','daemon-reload']);subprocess.run(['systemctl','restart','glances.service'])
  raise
 print('PASS: Glances restricted to localhost:61208; game and database services untouched.')

def project_action(action,project):
 lockdir=Path('/run/lock/kol-docker');lockdir.mkdir(exist_ok=True,mode=0o700)
 with (lockdir/'operations.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  if not (p.BASE/project/'compose.yaml').is_file():raise RuntimeError('Project has not been initialized')
  if action=='project-start':
   if project in GAME:
    p.compose(project,'up','-d','--no-deps','--wait','db','cache');p.compose(project,'up','-d','--no-deps','--wait',*releases.SERVICES)
   else:p.compose(project,'up','-d','--wait')
  elif action=='project-stop':p.compose(project,'stop',*(list(releases.SERVICES)+['cache','db'] if project in GAME else []))
  else:
   if project not in GAME:raise ValueError('Choose a game project')
   p.compose(project,'restart','api');releases.b.wait_ready(project,'ready')

def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('action',choices=ACTIONS);args=ap.parse_args()
 if os.geteuid()!=0:ap.error('Use desktop administrator authentication or sudo')
 # Private GUI settings travel over stdin, never command arguments or journal.
 raw=sys.stdin.read(16385) if not sys.stdin.isatty() else '{}'
 if len(raw)>16384:raise ValueError('Oversized action settings')
 data=json.loads(raw or '{}')
 if not isinstance(data,dict):raise ValueError('Settings must be an object')
 project=data.get('project','kol-production');service=data.get('service','api')
 if project not in PROJECTS or service not in SERVICES:raise ValueError('Unknown project or service')
 action=args.action
 tracked=action in ('stage','promote','rollback','project-start','project-stop','api-restart','tunnel-restart','backup','restore')
 action_lock=None
 if tracked:
  STATE.mkdir(parents=True,exist_ok=True,mode=0o700);action_lock=(STATE/'action.lock').open('a')
  try:fcntl.flock(action_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except OSError:
   action_lock.close();raise RuntimeError('Another console action is already running')
 if tracked:write_json(STATE/'operation.json',{'action':action,'project':project,'started':stamp(),'active':True})
 outcome='failed'
 try:
  execute(action,data,project,service);outcome='completed'
 finally:
  if tracked:
   operation=read_json(STATE/'operation.json');operation.update(active=False,finished=stamp(),outcome=outcome);write_json(STATE/'operation.json',operation)
   rows=read_json(STATE/'operations.json',[]);write_json(STATE/'operations.json',(rows+[operation])[-80:]);action_lock.close()
  if action not in ('install','monitor','status','logs','exposure'):
   try:monitor()
   except Exception:print('Status refresh unavailable; monitoring timer will retry.',flush=True)

def execute(action,data,project,service):
 if action=='install':install()
 elif action=='monitor':monitor()
 elif action=='status':print(json.dumps(collect()))
 elif action in ('backup','restore','retention-preview'):script('local-backups.py',{'backup':'run','restore':'restore-check','retention-preview':'retention-plan'}[action],*(['--snapshot',str(data['snapshot'])] if action=='restore' and data.get('snapshot') else []))
 elif action=='public-check':script('verify-public.py','playfollybound.com')
 elif action=='proxy-check':script('edge.py','validate')
 elif action=='exposure':print(json.dumps(exposure(),indent=2))
 elif action=='stage':script('releases.py','stage','--label',str(data.get('label','Game update')),'--source-commit',str(data.get('source_commit','')),*(['--allow-migrations'] if data.get('allow_migrations') is True else []))
 elif action=='backup-index':
  spec=importlib.util.spec_from_file_location('console_backups',INFRA/'scripts/local-backups.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  rows=module.snapshot_index();write_json(STATE/'snapshots.json',rows);print(json.dumps(rows,indent=2))
 elif action=='release-plan':script('releases.py','plan','--release',str(data.get('release','')),'--project',project)
 elif action=='verify-staging':
  if data.get('confirmed') is not True:raise ValueError('Manual staging test confirmation required')
  script('releases.py','verify-staging','--release',str(data.get('release','')),'--confirm-manual-test')
 elif action=='promote':
  if data.get('approved') is not True:raise ValueError('Production approval required')
  script('releases.py','promote','--release',str(data.get('release','')),'--approve-production')
 elif action=='publish-preflight':script('releases.py','preflight','--release',str(data.get('release','')),'--source-commit',str(data.get('source_commit','')))
 elif action=='rollback':script('releases.py','rollback','--release',str(data.get('release','')),'--project',project)
 elif action in ('project-start','project-stop','api-restart'):project_action(action,project)
 elif action=='tunnel-restart':subprocess.run(['systemctl','restart','cloudflared.service'],check=True)
 elif action=='logs':
  source=data.get('source','containers')
  if source=='containers':p.compose(project,'logs','--no-color','--tail','180',service)
  elif source in UNITS or source in ('realms-backup.service','realms-backup-restore.service','realms-console-monitor.service'):subprocess.run(['journalctl','-u',source,'-n','180','--no-pager','-o','short-iso'],check=True)
  else:raise ValueError('Unknown log source')
 elif action in ('jobs-report','jobs-preview'):
  if project not in GAME:raise ValueError('Choose a game project')
  script('scheduler.py','report' if action=='jobs-report' else 'dry-run','--project',project)
 elif action=='email-configure':
  cfg=data.get('email',{});existing=read_json(STATE/'email.json')
  if not cfg.get('password'):cfg['password']=existing.get('password','')
  write_json(STATE/'email.json',validate_email(cfg));print('Email settings saved privately. Send a test email before relying on alerts.')
 elif action=='email-test':send_email('Realms server alert test','Your Realms console can deliver server alerts. This is an operator-requested test.',True);print('Test email sent.')
 elif action in ('monitoring-private','monitoring-rollback'):monitoring_binding(action=='monitoring-rollback')
 elif action=='alert-acknowledge':write_json(STATE/'ack.json',{'at':stamp()});print('Acknowledged; unresolved issues remain visible.')
if __name__=='__main__':
 try:main()
 except (OSError,ValueError,RuntimeError,subprocess.CalledProcessError) as e:raise SystemExit('Console action failed: '+str(e))
