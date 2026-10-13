#!/usr/bin/env python3
"""Release the existing backend, staging first, and validate recovery without native cutover."""
import argparse,fcntl,hashlib,importlib.util,json,os,re,subprocess,time,urllib.error,urllib.request
from pathlib import Path
INFRA=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('cache_workers',INFRA/'scripts/cache-workers.py');cache=importlib.util.module_from_spec(s);s.loader.exec_module(cache)
p=cache.p;pg=cache.pg
ORDER=['kol-staging','kol-production']
STATE=p.STATE_BASE/'infra-007'
def request(name,path):
 try:
  with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(f'http://127.0.0.1:{p.PROJECTS[name][1]}{path}',timeout=10) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
def wait_ready(name,cache_state=None):
 for _ in range(45):
  try:
   code,body=request(name,'/health/ready')
   if code==200 and body.get('status')=='ready' and (cache_state is None or body.get('dependencies',{}).get('cache')==cache_state):return
  except (OSError,ValueError):pass
  time.sleep(1)
 raise RuntimeError(name+' did not reach expected readiness')
def unrelated():
 ids=pg.out(p.DOCKER+['ps','-q']).splitlines();result={}
 for cid in ids:
  c=pg.inspect('container',cid)
  if c['Config'].get('Labels',{}).get('com.docker.compose.project') not in ORDER:
   result[c['Id']]={'start':c['State']['StartedAt'],'image':c['Config']['Image']}
 return result

def smoke(name):
 p.compose(name,'--profile','tools','run','--rm','--no-deps','backend-smoke')
 pg.check(request(name,'/health/live')[0]==200,name+' liveness from desktop host')
 wait_ready(name,'ready');pg.check(True,name+' database and cache readiness from actual API')

def identities(name):return {service:pg.cid(name,service) for service in ('db','cache','api','worker')}
def baseline():
 return {'boot':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'containers':{n:identities(n) for n in ORDER},
 'volumes':{n:[m['Name'] for m in pg.inspect('container',pg.cid(n,'db'))['Mounts'] if m['Type']=='volume'] for n in ORDER}}
def save():
 STATE.mkdir(parents=True,exist_ok=True,mode=0o700);file=STATE/'acceptance.json';file.write_text(json.dumps(baseline(),indent=2)+'\n');file.chmod(0o600)
def preflight():
 cache.preflight()
 for name in ORDER:
  pg.check(all(identities(name).values()),name+' existing INFRA-005/006 stack present')
  for key in ('cache_password','worker_password'):pg.check((p.BASE/name/'secrets'/key).is_file(),name+' existing runtime secret preserved')

def deploy(tag="infra-007"):
 services=("api","worker","scheduler")
 preflight();before=unrelated()
 known_db_cache={name:{service:pg.inspect('container',pg.cid(name,service))['Id'] for service in ('db','cache')} for name in ORDER}
 for name in ORDER:p.operations(argparse.Namespace(project=name,action='backup'))
 p.build(tag);image=pg.inspect('image','kol-realms:'+tag)['Id']
 for name in ORDER:p.configure_cache(p.BASE/name,name)
 from datetime import datetime,timezone
 record=STATE/('release-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));record.mkdir(parents=True,mode=0o700)
 for name in ORDER:
  folder=p.BASE/name;old=record/name;old.mkdir(mode=0o700)
  for file in ('.env','compose.yaml'):p.env_write(old/file,(folder/file).read_text())
 # Only the two explicitly managed game projects get new files.
 p.refresh_templates(ORDER)
 for name in ORDER:
  other=next(n for n in ORDER if n!=name);other_before={s:pg.inspect('container',pg.cid(other,s))['State']['StartedAt'] for s in ('db','cache','api','worker')}
  env=p.BASE/name/'.env';text=re.sub(r'^KOL_IMAGE=.*$',f'KOL_IMAGE={image}',env.read_text(),flags=re.M);env.write_text(text);env.chmod(0o600)
  p.compose(name,'--profile','tools','--profile','setup','config','--quiet')
  p.compose(name,'stop',*services)
  try:
   p.compose(name,'--profile','setup','run','--rm','--no-deps','bootstrap')
   p.compose(name,'--profile','setup','run','--rm','--no-deps','setup')
   p.compose(name,'up','-d','--no-deps','--wait','--wait-timeout','180',*services)
   smoke(name)
  except BaseException:
   print('Release stopped before advancing to the next project. Preserve the private release record and DB backup; inspect this project. No automatic database rollback performed.');raise
  for service in ('db','cache'):pg.check(pg.cid(name,service)==known_db_cache[name][service],name+' existing '+service+' container retained')
  for service,started in other_before.items():pg.check(pg.inspect('container',pg.cid(other,service))['State']['StartedAt']==started,other+' '+service+' not restarted by this release')
 pg.check(unrelated()==before,'unrelated Docker workloads unchanged')
 cache.check_runtime()
 # Verify retained INFRA-006 receipts before replacing its reboot baseline to account for this release's new API/worker containers.
 for name in ORDER:cache.helper(name,'persist')
 cache.STATE.mkdir(parents=True,exist_ok=True,mode=0o700)
 cache_record=cache.STATE/'acceptance.json';cache_record.write_text(json.dumps(cache.snapshot(),indent=2)+'\n');cache_record.chmod(0o600)
 save()
 print('Backend release and smoke acceptance passed. Reconnection validation and reboot verification remain separate. No native data cutover performed.')

def validate():
 before=unrelated()
 for name in ORDER:
  smoke(name);original=identities(name)
  process_start={s:pg.inspect('container',original[s])['State']['StartedAt'] for s in ('api','worker')}
  other=next(n for n in ORDER if n!=name);other_start={s:pg.inspect('container',pg.cid(other,s))['State']['StartedAt'] for s in ('db','cache','api','worker')}
  # No volumes removed. Restore dependencies even if any assertion fails.
  try:
   p.compose(name,'stop','db')
   pg.check(request(name,'/health/live')[0]==200,name+' process remains live while DB stopped')
   pg.check(request(name,'/health/ready')[0]==503,name+' readiness rejects database outage')
   p.compose(name,'start','--wait','--wait-timeout','180','db');wait_ready(name,'ready')
   pg.check(pg.cid(name,'api')==original['api'],name+' API recovers DB connections without container replacement')
   p.compose(name,'stop','cache');wait_ready(name,'degraded')
   pg.check(request(name,'/health/live')[0]==200,name+' remains live through cache loss')
   p.compose(name,'start','--wait','--wait-timeout','180','cache');wait_ready(name,'ready')
   pg.check(pg.cid(name,'api')==original['api'],name+' API reconnects cache without container replacement')
  finally:
   p.compose(name,'start','--wait','--wait-timeout','180','db','cache')
  # Explicitly prove the Node process was not automatically restarted during recovery.
  for service in ('api','worker'):
   pg.check(pg.cid(name,service)==original[service] and pg.inspect('container',original[service])['State']['StartedAt']==process_start[service],name+' same '+service+' process through dependency failures')
  smoke(name)
  p.compose(name,'stop','api')
  try:
   stopped=p.compose(name,'ps','--all','-q','api',stdout=subprocess.PIPE,text=True).stdout.strip()
   pg.check(pg.inspect('container',stopped)['State']['ExitCode']==0,name+' API exits cleanly on SIGTERM')
  finally:p.compose(name,'start','--wait','--wait-timeout','180','api')
  smoke(name)
  for service,started in other_start.items():pg.check(pg.inspect('container',pg.cid(other,service))['State']['StartedAt']==started,other+' '+service+' survived independently')
 pg.check(unrelated()==before,'unrelated workloads unchanged through fault drills')
 cache.check_runtime();save();print('Backend reconnection and graceful shutdown acceptance passed. Reboot acceptance remains pending.')
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('action',choices=['deploy','validate','smoke','after-reboot','status']);args=ap.parse_args()
 if os.geteuid()!=0:ap.error('Run with sudo; Docker uses the local administrative socket.')
 lockdir=Path('/run/lock/kol-docker');lockdir.mkdir(exist_ok=True,mode=0o700)
 with (lockdir/'operations.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  if args.action=='deploy':deploy()
  elif args.action=='validate':validate()
  elif args.action=='smoke':
   for name in ORDER:smoke(name)
  elif args.action=='status':
   for name in ORDER:p.compose(name,'ps');print(request(name,'/health/ready'))
  else:
   old=json.loads((STATE/'acceptance.json').read_text());now=baseline();pg.check(old['boot']!=now['boot'],'actual reboot after backend acceptance')
   for k in ('containers','volumes'):pg.check(old[k]==now[k],k+' retained after reboot')
   for name in ORDER:smoke(name)
   cache.check_runtime();print('Backend reboot acceptance passed.')
if __name__=='__main__':
 try:main()
 except (OSError,RuntimeError,ValueError,subprocess.CalledProcessError) as e:raise SystemExit('FAIL/UNKNOWN: '+str(e))
