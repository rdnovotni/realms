#!/usr/bin/env python3
"""Deploy/validate project-local disposable caches and PostgreSQL durable workers."""
import argparse,fcntl,hashlib,importlib.util,json,os,re,signal,subprocess
from pathlib import Path
INFRA=Path(__file__).resolve().parents[1]
def module(name,file):
 s=importlib.util.spec_from_file_location(name,INFRA/'scripts'/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
pg=module('pg_infra','postgresql.py');p=pg.p
NAMES=pg.NAMES
STATE=p.STATE_BASE/'infra-006'
def preflight():
 known=json.loads((INFRA/'compose/legacy-sha256.json').read_text())['kol']
 current=(INFRA/'compose/kol/compose.yaml').read_bytes()
 for name in NAMES:
  folder=p.BASE/name;old=(folder/'compose.yaml').read_bytes()
  pg.check(p.managed_kol(old),name+' recognized managed configuration')
  pg.check(p.read_database_name(name)==name.replace('-','_'),name+' explicit existing database')
  pg.check(bool(pg.cid(name,'db')),name+' existing database running; run INFRA-005 first')
  for key in ('db_password','migration_password','app_password','throttle_key'):
   pg.check((folder/'secrets'/key).is_file(),name+' existing '+key+' file retained')
 pg.check(pg.health(3000),'native game healthy')
def snapshot():
 return {'boot':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
  'containers':{name:{s:pg.cid(name,s) for s in ('db','cache','api','worker')} for name in NAMES},
  'volumes':{name:next(m['Name'] for m in pg.inspect('container',pg.cid(name,'db'))['Mounts'] if m['Type']=='volume') for name in NAMES}}
def check_runtime():
 secrets={}
 for name in NAMES:
  p.compose(name,'--profile','tools','config','--quiet')
  secrets[name]=[(p.BASE/name/'secrets'/k).read_bytes() for k in ('cache_password','cache_admin_password','worker_password')]
  for service in ('cache','worker'):
   c=pg.inspect('container',pg.cid(name,service))
   pg.check(c['State']['Running'] and c['State'].get('Health',{}).get('Status')=='healthy',name+' '+service+' healthy')
   pg.check(c['HostConfig'].get('PortBindings') in ({},None),name+' '+service+' no published ports')
   pg.check(list(c['NetworkSettings']['Networks'])==[name+'_private'],name+' '+service+' internal network only')
   pg.check(pg.inspect('network',name+'_private')['Internal'],name+' internal network enabled')
   pg.check(c['HostConfig']['Memory']==256*1024**2,name+' '+service+' 256MiB container memory limit')
   pg.check(c['HostConfig']['RestartPolicy']['Name']=='unless-stopped',name+' '+service+' automatic restart policy')
   mounted=[m.get('Destination','') for m in c['Mounts']]
   pg.check('/run/secrets/db_password' not in mounted and '/run/secrets/migration_password' not in mounted and '/run/secrets/cache_admin_password' not in mounted,name+' '+service+' no administration password mounts')
   if service=='cache':pg.check(c['Config']['Image']==json.loads((INFRA/'container/images.lock.json').read_text())['valkey'],name+' digest-pinned Valkey')
   # A frontend-only container must be unable to connect to the cache's real private IP.
   if service=='cache':
    ip=c['NetworkSettings']['Networks'][name+'_private']['IPAddress']
    code="import socket,sys\ntry:\n socket.create_connection((sys.argv[1],6379),timeout=2);sys.exit(1)\nexcept OSError:sys.exit(0)"
    p.run(p.DOCKER+['run','--rm','--network',name+'_frontend','--user','65534:65534','--memory','64m','--pids-limit','32','--read-only','--cap-drop','ALL','python:3.13-alpine','python','-c',code,ip])
    pg.check(True,name+' frontend cannot connect directly to cache')
  pg.check(pg.health(p.PROJECTS[name][1]),name+' game ready')
 pg.check(not(set(secrets[NAMES[0]])&set(secrets[NAMES[1]])),'separate cache and worker credentials per project')
 pg.check(pg.health(3000),'native game remains healthy')
 for unit in ('kol-postgresql.service','kol-realms.service','libvirtd.service'):pg.check(pg.out(['systemctl','is-active',unit])=='active','preserved '+unit)
def helper(name,mode):p.compose(name,'--profile','tools','run','--rm','--no-deps','jobs-check','node','container/jobs-check.mjs',mode)
def deploy():
 preflight()
 # Durable schema migration backup is completed before changing either stack.
 for name in NAMES:p.operations(argparse.Namespace(project=name,action='backup'))
 p.build('infra-006');image=pg.inspect('image','kol-realms:infra-006')['Id']
 for name in NAMES:
  folder=p.BASE/name
  for file in ('.env','compose.yaml'):
   backup=folder/(file+'.before-infra006')
   if not backup.exists():p.env_write(backup,(folder/file).read_text())
  p.configure_cache(folder,name)
 p.refresh_templates()
 for name in NAMES:
  other=next(n for n in NAMES if n!=name)
  other_db=pg.inspect('container',pg.cid(other,'db'))['State']['StartedAt']
  folder=p.BASE/name;env=folder/'.env'
  env.write_text(re.sub(r'^KOL_IMAGE=.*$',f'KOL_IMAGE={image}',env.read_text(),flags=re.M));env.chmod(0o600)
  p.compose(name,'stop','api','worker')
  try:
   p.compose(name,'--profile','setup','run','--rm','bootstrap')
   p.compose(name,'--profile','setup','run','--rm','setup')
   p.compose(name,'up','-d','--wait','--wait-timeout','180','db','cache','api','worker')
  except BaseException:
   print('Deployment stopped. Keep the backup; inspect the affected project. Do not restore a live database automatically.');raise
  pg.check(pg.inspect('container',pg.cid(other,'db'))['State']['StartedAt']==other_db,'deployment leaves other project database running')
  pg.check(pg.health(p.PROJECTS[other][1]),'other game project remains ready')
def crash_process(name,service):
 # A namespace init process ignores unhandled signals from its own namespace.
 # Signal its verified host process without Docker's administrative-stop flag.
 if name not in NAMES or service not in ('cache','worker'):raise RuntimeError('Invalid crash-test target')
 container=pg.cid(name,service)
 c=pg.inspect('container',container)
 pid=c['State']['Pid'];identity=c['Id'];started=c['State']['StartedAt']
 pg.check(c['State']['Running'] and isinstance(pid,int) and pid>1,'crash target is a running container process')
 if not re.fullmatch(r'[a-f0-9]{64}',identity):raise RuntimeError('Invalid container identity')
 descriptor=os.pidfd_open(pid)
 try:
  # Refuse signals unless the host cgroup and a second Docker inspection agree.
  group=Path(f'/proc/{pid}/cgroup').read_text()
  now=pg.inspect('container',container)
  if identity not in group or now['Id']!=identity or now['State']['Pid']!=pid or not now['State']['Running']:
   raise RuntimeError('Crash target changed or container cgroup could not be verified; no signal sent')
  signal.pidfd_send_signal(descriptor,signal.SIGKILL)
 finally:os.close(descriptor)
 return container,started

def validate():
 check_runtime()
 for name in NAMES:
  other=next(n for n in NAMES if n!=name);other_id=pg.cid(other,'worker');other_start=pg.inspect('container',other_id)['State']['StartedAt']
  p.compose(name,'stop','worker')
  pg.check(pg.inspect('container',p.compose(name,'ps','--all','-q','worker',stdout=subprocess.PIPE,text=True).stdout.strip())['State']['ExitCode']==0,name+' worker exits cleanly on SIGTERM')
  try:
   helper(name,'full')
   # Destroy the disposable container, not merely its keys; no database volumes are touched.
   p.compose(name,'stop','cache')
   pg.check(pg.health(p.PROJECTS[name][1]),name+' game ready with cache entirely stopped')
   p.compose(name,'rm','-f','cache');p.compose(name,'up','-d','--wait','--wait-timeout','180','cache')
   helper(name,'persist')
  finally:p.compose(name,'up','-d','--wait','--wait-timeout','180','worker')
  # Kill rather than gracefully stop: Docker must restart both components.
  for service in ('cache','worker'):
   container,started=crash_process(name,service)
   import time
   for _ in range(45):
    c=pg.inspect('container',container)
    if c['State']['Running'] and c['State'].get('Health',{}).get('Status')=='healthy' and c['State']['StartedAt']!=started:break
    time.sleep(1)
   else:raise RuntimeError(name+' '+service+' did not automatically recover from process kill')
   pg.check(True,name+' '+service+' automatically recovers from hard kill')
  pg.check(pg.cid(other,'worker')==other_id and pg.inspect('container',other_id)['State']['StartedAt']==other_start,'other project worker not restarted')
  pg.check(pg.health(p.PROJECTS[other][1]),'other project remains available')
 check_runtime()
 STATE.mkdir(parents=True,exist_ok=True,mode=0o700);record=STATE/'acceptance.json';record.write_text(json.dumps(snapshot(),indent=2)+'\n');record.chmod(0o600)
 print('Cache and worker initial acceptance passed. Reboot acceptance remains pending; no reboot performed.')
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('action',choices=['deploy','validate','recover-components','after-reboot','status','dead-letters']);args=ap.parse_args()
 if os.geteuid()!=0:ap.error('Run with sudo; local Docker management is an administrative privilege.')
 lockdir=Path('/run/lock/kol-docker');lockdir.mkdir(exist_ok=True,mode=0o700)
 with (lockdir/'operations.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  if args.action=='deploy':deploy();validate()
  elif args.action=='validate':validate()
  elif args.action=='recover-components':
   for name in NAMES:p.compose(name,'up','-d','--wait','--wait-timeout','180','cache','worker')
   validate()
  elif args.action=='after-reboot':
   old=json.loads((STATE/'acceptance.json').read_text());now=snapshot();pg.check(old['boot']!=now['boot'],'actual reboot since worker acceptance')
   for k in ('containers','volumes'):pg.check(old[k]==now[k],k+' preserved through reboot')
   check_runtime()
   for name in NAMES:helper(name,'persist')
   print('Cache and worker reboot acceptance passed.')
  elif args.action=='status':
   for name in NAMES:p.compose(name,'ps');p.compose(name,'logs','--tail','20','worker')
  else:
   for name in NAMES:
    print(name)
    p.compose(name,'exec','-T','db','psql','-U','postgres','-d',p.read_database_name(name),'-c',"SELECT id,kind,status,attempts,max_attempts,available_at FROM durable_jobs WHERE status='FAILED' ORDER BY available_at LIMIT 100")
if __name__=='__main__':
 try:main()
 except (OSError,RuntimeError,subprocess.CalledProcessError,BlockingIOError) as e:raise SystemExit('FAIL/UNKNOWN: '+str(e))
