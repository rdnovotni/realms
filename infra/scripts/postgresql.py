#!/usr/bin/env python3
"""Deploy and validate the two scoped PostgreSQL stacks without touching native data."""
import argparse,fcntl,hashlib,importlib.util,json,os,re,subprocess,urllib.request
from pathlib import Path
INFRA=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('projects',INFRA/'scripts/docker-projects.py');p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
NAMES=['kol-production','kol-staging']
STATE=p.STATE_BASE/'infra-005'
def out(args):return subprocess.check_output(args,text=True).strip()
def inspect(kind,name):return json.loads(out(p.DOCKER+[kind,'inspect',name]))[0]
def cid(name,service):return p.compose(name,'ps','-q',service,stdout=subprocess.PIPE,text=True).stdout.strip()
def check(value,label):
 if not value:raise RuntimeError(label)
 print('PASS: '+label,flush=True)
def health(port):
 with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(f'http://127.0.0.1:{port}/health/ready',timeout=5) as r:return r.status==200

def configure():
 legacy=json.loads((INFRA/'compose/legacy-sha256.json').read_text())['kol']
 new=(INFRA/'compose/kol/compose.yaml').read_bytes()
 # Preflight both projects before changing either. Refuse ambiguous prior DB storage.
 for name in NAMES:
  folder=p.BASE/name;old=(folder/'compose.yaml').read_bytes()
  check(p.managed_kol(old),name+' recognized managed configuration')
  text=(folder/'.env').read_text()
  if not re.search(r'^DB_NAME=',text,re.M):
   result=subprocess.run(p.DOCKER+['volume','inspect',name+'_database'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   check(result.returncode!=0,name+' no pre-existing ambiguous database volume')
  else:check(re.search(r'^DB_NAME='+name.replace('-','_')+r'$',text,re.M) is not None,name+' expected database identity')
 for name in NAMES:
  folder=p.BASE/name
  text=(folder/'.env').read_text()
  backup=folder/'.env.before-infra005'
  if not backup.exists():p.env_write(backup,text)
  if not re.search(r'^DB_NAME=',text,re.M):text+=f'\nDB_NAME={name.replace("-","_")}\n'
  secret=folder/'secrets/migration_password'
  if not secret.exists():p.env_write(secret,p.secrets.token_hex(32)+'\n');secret.chmod(0o444)
  (folder/'.env').write_text(text);(folder/'.env').chmod(0o600)
  p.configure_cache(folder,name)
 p.refresh_templates()
 p.build('infra-006')
 image=inspect('image','kol-realms:infra-006')['Id']
 for name in NAMES:
  file=p.BASE/name/'.env';text=re.sub(r'^KOL_IMAGE=.*$',f'KOL_IMAGE={image}',file.read_text(),flags=re.M);file.write_text(text);file.chmod(0o600)
  p.compose(name,'--profile','setup','--profile','tools','config','--quiet')

def verify(mode='full'):
 ids={};volumes={};nets={}
 secrets_by_project={}
 for name in NAMES:
  c=inspect('container',cid(name,'db'));ids[name]=c['Id']
  expected=json.loads((INFRA/'container/images.lock.json').read_text())['postgres']
  check(c['Config']['Image']==expected,name+' immutable supported PostgreSQL image')
  check(c['HostConfig'].get('PortBindings') in ({},None),name+' no published database ports')
  check(c['HostConfig']['RestartPolicy']['Name']=='unless-stopped',name+' automatic DB restart policy')
  networks=c['NetworkSettings']['Networks'];check(list(networks)==[name+'_private'],name+' database has only its private network')
  net=inspect('network',name+'_private');check(net['Internal'],name+' internal DB network');nets[name]=net['Id']
  mounts=[m for m in c['Mounts'] if m['Type']=='volume'];check(len(mounts)==1 and mounts[0]['Name']==p.read_database_volume(name),name+' dedicated durable volume');volumes[name]=mounts[0]['Name']
  perm=p.compose(name,'exec','-T','db','sh','-c','stat -c "%a %U" "$PGDATA"',stdout=subprocess.PIPE,text=True).stdout.strip()
  check(perm=='700 postgres',name+' PGDATA owner and mode 700')
  p.compose(name,'--profile','tools','run','--rm','--no-deps','verify','node','container/database-check.mjs',mode)
  check(health(p.PROJECTS[name][1]),name+' game uses its restricted database and reports ready')
  secrets_by_project[name]=[(p.BASE/name/'secrets'/key).read_bytes() for key in ['db_password','migration_password','app_password']]
  for key in ['db_password','migration_password','app_password']:
   check((p.BASE/name/'secrets').stat().st_mode&0o777==0o700,name+' host secret directory private')
  api=inspect('container',cid(name,'api'))
  check(not any('/db_password' in m.get('Source','') or '/migration_password' in m.get('Source','') for m in api['Mounts']),name+' API has no admin or migration password mount')
 check(len(set(volumes.values()))==2 and len(set(nets.values()))==2,'production and staging storage/networks are separate')
 check(not(set(secrets_by_project[NAMES[0]])&set(secrets_by_project[NAMES[1]])),'production/staging credentials are distinct')
 # Probe a DB from its project's frontend-only network: no backend membership.
 code='import socket,sys\ntry:\n s=socket.create_connection((sys.argv[1],5432),timeout=2);s.close();sys.exit(1)\nexcept OSError:sys.exit(0)'
 for name in NAMES:
  c=inspect('container',ids[name]);ip=c['NetworkSettings']['Networks'][name+'_private']['IPAddress']
  p.run(p.DOCKER+['run','--rm','--network',name+'_frontend','--user','65534:65534','--memory','64m','--cpus','0.25','--pids-limit','32','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','python:3.13-alpine','python','-c',code,ip])
  check(True,name+' frontend-only container cannot connect directly to DB')
 check(health(3000),'native game remains ready')
 for unit in ['kol-postgresql.service','kol-realms.service','libvirtd.service']:check(out(['systemctl','is-active',unit])=='active','native workload preserved: '+unit)
 return {'boot':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'containers':ids,'volumes':volumes,'networks':nets}

def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('action',choices=['deploy','validate','after-reboot','status']);args=ap.parse_args()
 if os.geteuid()!=0:ap.error('Run with sudo or graphical administrator authentication.')
 lockdir=Path('/run/lock/kol-docker');lockdir.mkdir(exist_ok=True,mode=0o700)
 with (lockdir/'operations.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  if args.action=='status':
   for name in NAMES:p.compose(name,'ps');p.compose(name,'exec','-T','db','psql','-U','postgres','-d',p.read_database_name(name),'-c','SELECT numbackends,xact_commit,xact_rollback,deadlocks,temp_bytes,blks_read,blks_hit FROM pg_stat_database WHERE datname=current_database()')
   return
  STATE.mkdir(parents=True,exist_ok=True,mode=0o700);record=STATE/'acceptance.json'
  if args.action=='deploy':
   check(health(3000),'native game healthy before deployment')
   configure()
   for name in NAMES:
    p.operations(argparse.Namespace(project=name,action='prepare'));p.operations(argparse.Namespace(project=name,action='up'))
  if args.action=='after-reboot':
   old=json.loads(record.read_text());check(old['boot']!=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'actual reboot after PostgreSQL acceptance')
   current=verify('persist')
   for key in ['containers','volumes','networks']:check(old[key]==current[key],key+' survived host reboot unchanged')
   print('PostgreSQL reboot acceptance passed.');return
  baseline=verify()
  # Exercise restart durability on the new stores only; retain the other project's startup time.
  for name in NAMES:
   other=next(n for n in NAMES if n!=name);start=inspect('container',cid(other,'db'))['State']['StartedAt']
   p.compose(name,'stop','api');p.compose(name,'restart','db');p.compose(name,'up','-d','--wait','--wait-timeout','180','db');p.compose(name,'up','-d','--wait','--wait-timeout','180','api')
   p.compose(name,'--profile','tools','run','--rm','--no-deps','verify','node','container/database-check.mjs','persist')
   check(inspect('container',cid(other,'db'))['State']['StartedAt']==start,'restarting '+name+' leaves '+other+' DB running')
   check(health(p.PROJECTS[other][1]),other+' game remains available')
   p.operations(argparse.Namespace(project=name,action='backup'))
  current=verify('persist');check(baseline['containers']==current['containers'],'same database containers retained data through restart')
  record.write_text(json.dumps(current,indent=2)+'\n');record.chmod(0o600)
  print('PostgreSQL initial acceptance passed; host-reboot acceptance remains pending. Native data has not been imported or cut over.')
if __name__=='__main__':
 try:main()
 except (OSError,RuntimeError,subprocess.CalledProcessError) as e:raise SystemExit('FAIL/UNKNOWN: '+str(e))
