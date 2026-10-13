#!/usr/bin/env python3
"""Deploy and administer PostgreSQL-backed schedules for explicit KoL environments."""
import argparse,fcntl,importlib.util,json,os,subprocess
from pathlib import Path
INFRA=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('backend_release',INFRA/'scripts/backend.py');b=importlib.util.module_from_spec(s);s.loader.exec_module(b)
p=b.p;pg=b.pg;STATE=p.STATE_BASE/'infra-008'
def helper(project,action,*args):p.compose(project,'--profile','tools','run','--rm','--no-deps','scheduler-admin','node','container/scheduler-admin.mjs',action,*args)
def acceptance(project,mode):p.compose(project,'--profile','tools','run','--rm','--no-deps','scheduler-check','node','container/scheduler-check.mjs',mode)
def snapshot():
 result=b.baseline();result['schedulers']={n:pg.cid(n,'scheduler') for n in b.ORDER};return result

def check_runtime():
 for name in b.ORDER:
  c=pg.inspect('container',pg.cid(name,'scheduler'))
  pg.check(c['State']['Running'] and c['State'].get('Health',{}).get('Status')=='healthy',name+' scheduler healthy')
  pg.check(c['HostConfig'].get('PortBindings') in ({},None),name+' scheduler no published ports')
  pg.check(list(c['NetworkSettings']['Networks'])==[name+'_private'],name+' scheduler private network only')
  pg.check(c['HostConfig']['Memory']==256*1024**2,name+' scheduler 256MiB memory limit')
  pg.check(c['HostConfig']['RestartPolicy']['Name']=='unless-stopped',name+' scheduler automatic restart')
  mounted={m.get('Destination') for m in c['Mounts']}
  pg.check('/run/secrets/scheduler_password' in mounted and not mounted.intersection({'/run/secrets/db_password','/run/secrets/migration_password','/run/secrets/app_password','/run/secrets/worker_password'}),name+' scheduler only its dedicated credential')
  b.smoke(name)
def save():
 STATE.mkdir(parents=True,exist_ok=True,mode=0o700);file=STATE/'acceptance.json';file.write_text(json.dumps(snapshot(),indent=2)+'\n');file.chmod(0o600)
def validate():
 before=b.unrelated()
 check_runtime()
 for name in b.ORDER:
  acceptance(name,'initial')
  other=next(n for n in b.ORDER if n!=name)
  starts={s:pg.inspect('container',pg.cid(other,s))['State']['StartedAt'] for s in ('db','cache','api','worker','scheduler')}
  p.compose(name,'stop','scheduler')
  try:
   cid=p.compose(name,'ps','--all','-q','scheduler',stdout=subprocess.PIPE,text=True).stdout.strip()
   pg.check(pg.inspect('container',cid)['State']['ExitCode']==0,name+' scheduler graceful shutdown')
  finally:p.compose(name,'start','--wait','--wait-timeout','180','scheduler')
  acceptance(name,'persist')
  for service,started in starts.items():pg.check(pg.inspect('container',pg.cid(other,service))['State']['StartedAt']==started,other+' '+service+' preserved')
 pg.check(b.unrelated()==before,'unrelated workloads unchanged through scheduler validation')
 save();print('Scheduler initial acceptance passed. Actual gameplay schedules remain separately configured; reboot acceptance pending.')
def main():
 ap=argparse.ArgumentParser(description=__doc__)
 ap.add_argument('action',choices=['deploy','validate','after-reboot','report','dry-run','run','configure-daily','configure-hook','resume','pause','enable'])
 ap.add_argument('--project',choices=b.ORDER);ap.add_argument('--timezone');ap.add_argument('--at');ap.add_argument('--start-date')
 ap.add_argument('--turn-grant',type=int);ap.add_argument('--soft-cap',type=int);ap.add_argument('--id');ap.add_argument('--hook');ap.add_argument('--once',action='store_true')
 ap.add_argument('--config',default='{}',help='Non-secret hook configuration as JSON')
 args=ap.parse_args()
 if os.geteuid()!=0:ap.error('Run with sudo; uses only the local Docker administrative socket.')
 if args.action not in ('deploy','validate','after-reboot') and not args.project:ap.error('--project is required')
 if args.action.startswith('configure') and not all((args.timezone,args.at,args.start_date)):ap.error('Explicit --timezone, --at and --start-date required')
 if args.action=='configure-daily' and (args.turn_grant is None or args.soft_cap is None):ap.error('Finalized --turn-grant and --soft-cap are required; no fixture defaults')
 if args.action in ('resume','pause','enable','configure-hook') and not args.id:ap.error('--id is required')
 if args.action=='configure-hook' and not args.hook:ap.error('--hook is required; implement and test its SQL handler first')
 lockdir=Path('/run/lock/kol-docker');lockdir.mkdir(exist_ok=True,mode=0o700)
 with (lockdir/'operations.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  if args.action=='deploy':b.deploy('infra-008');validate()
  elif args.action=='validate':validate()
  elif args.action=='after-reboot':
   old=json.loads((STATE/'acceptance.json').read_text());now=snapshot();pg.check(old['boot']!=now['boot'],'actual reboot after scheduler acceptance')
   for key in ('containers','volumes','schedulers'):pg.check(old[key]==now[key],key+' retained through reboot')
   check_runtime()
   for n in b.ORDER:acceptance(n,'persist')
   print('Scheduler reboot acceptance passed.')
  elif args.action.startswith('configure'):
   d={'id':'game-daily' if args.action=='configure-daily' else args.id,'hook':'DAILY_ROLLOVER' if args.action=='configure-daily' else args.hook,
    'cadence':'ONCE' if args.once else 'DAILY','timezone':args.timezone,'localTime':args.at,'startDate':args.start_date,
    'enabled':False,'config':{'turns':args.turn_grant,'cap':args.soft_cap} if args.action=='configure-daily' else json.loads(args.config)}
   helper(args.project,'configure',json.dumps(d));print('Schedule created paused. Inspect with dry-run/report, then explicitly enable its ID to allow due-date processing.')
  elif args.action in ('resume','pause','enable'):helper(args.project,args.action,args.id)
  else:helper(args.project,args.action)
if __name__=='__main__':
 try:main()
 except (OSError,RuntimeError,ValueError,subprocess.CalledProcessError) as e:raise SystemExit('FAIL/UNKNOWN: '+str(e))
