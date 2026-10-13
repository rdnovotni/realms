#!/usr/bin/env python3
"""Read-only plan, checked maintenance relocation to /srv/Realms, and data-preserving rollback."""
import argparse,fcntl,hashlib,importlib.util,json,os,pwd,re,shutil,stat,subprocess,time,urllib.request,uuid
from pathlib import Path
INFRA=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('relocation_backend',INFRA/'scripts/backend.py');b=importlib.util.module_from_spec(s);s.loader.exec_module(b)
p=b.p;pg=b.pg
ROOT=Path('/srv/Realms');RECORD=ROOT/'relocation';MANIFEST=RECORD/'manifest.json'
UNITS=('kol-realms.service','kol-postgresql.service');NAMES=('kol-production','kol-staging')
OLD_PROJECTS=Path('/srv/kol-infra/projects');OLD_STATE=Path('/var/lib/kol-infra');OLD_TOOLS=Path('/usr/local/lib/kol-infra')
UNIT_DIR=Path('/etc/systemd/system')
SERVICES=('api','worker','scheduler','cache','db')

def run(args,**kw):return subprocess.run([str(x) for x in args],check=True,**kw)
def show(unit,prop):return run(['systemctl','show',unit,'--property='+prop,'--value'],capture_output=True,text=True).stdout.strip()
def atomic(path,data,mode=0o600):
 path=Path(path);tmp=path.with_name('.'+path.name+'.'+uuid.uuid4().hex)
 try:
  with tmp.open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
  tmp.chmod(mode);os.replace(tmp,path)
 finally:
  if tmp.exists():tmp.unlink()
def save(record):atomic(MANIFEST,(json.dumps(record,indent=2)+'\n').encode())
def load():
 for path in (ROOT,RECORD,MANIFEST):
  if path.is_symlink() or path.stat().st_uid!=0 or (path!=ROOT and path.stat().st_mode&0o077):raise RuntimeError('Unsafe relocation record')
 record=json.loads(MANIFEST.read_text())
 if record.get('version')!=1:raise RuntimeError('Unsupported relocation record')
 return record

def tree_signature(folder):
 """Hash file contents and compare ownership/mode/time/link identity, never output contents."""
 folder=Path(folder);result={}
 for base,dirs,files in os.walk(folder,followlinks=False):
  for name in ['.']+dirs+files:
   path=Path(base) if name=='.' else Path(base)/name
   relative=str(path.relative_to(folder));st=path.lstat()
   row={'mode':stat.S_IMODE(st.st_mode),'uid':st.st_uid,'gid':st.st_gid,'type':stat.S_IFMT(st.st_mode)}
   if stat.S_ISREG(st.st_mode):
    digest=hashlib.sha256()
    with path.open('rb') as f:
     for chunk in iter(lambda:f.read(1024*1024),b''):digest.update(chunk)
    row.update(size=st.st_size,mtime=st.st_mtime_ns,sha256=digest.hexdigest())
   elif stat.S_ISLNK(st.st_mode):row['link']=os.readlink(path)
   elif not stat.S_ISDIR(st.st_mode):raise RuntimeError('Unsupported file type in cold database directory')
   result[relative]=row
 return result

def cold_copy(source,dest):
 source=Path(source);dest=Path(dest)
 if dest.exists() or dest.is_symlink():raise RuntimeError('Copy destination must not exist')
 before=tree_signature(source);dest.mkdir(parents=True,mode=0o700)
 run(['cp','--archive','--reflink=auto',str(source)+'/.',str(dest)])
 if tree_signature(source)!=before or tree_signature(dest)!=before:raise RuntimeError('Cold database copy verification failed')
 return len(before)

def cluster_directory(folder):
 # Each database also has PG_VERSION; only the cluster root has global/pg_control.
 versions=[file for file in Path(folder).rglob('PG_VERSION') if (file.parent/'global/pg_control').is_file()]
 if len(versions)!=1 or versions[0].read_text().strip()!='18':raise RuntimeError('Expected exactly one PostgreSQL 18 cluster root with global/pg_control')
 return versions[0].parent

def check_cold_cluster(folder,native):
 cluster=cluster_directory(folder)
 native=Path(native);binary=native/'.local/postgresql/usr/lib/postgresql/18/bin/pg_controldata'
 result=run(['env','LC_ALL=C','LD_LIBRARY_PATH='+str(native/'.local/postgresql/usr/lib/x86_64-linux-gnu'),str(binary),str(cluster)],capture_output=True,text=True).stdout
 if not re.search(r'^Database cluster state:\s+shut down\s*$',result,re.M):raise RuntimeError('PostgreSQL did not shut down cleanly; copying refused')

def move_alias(source,dest):
 source=Path(source);dest=Path(dest)
 if source.is_symlink() or not source.exists() or dest.exists() or dest.is_symlink():raise RuntimeError('Unsafe directory relocation')
 dest.parent.mkdir(parents=True,exist_ok=True,mode=0o755)
 os.rename(source,dest);source.symlink_to(dest,target_is_directory=dest.is_dir())

def reverse_alias(source,dest):
 source=Path(source);dest=Path(dest)
 if source.is_symlink() and source.resolve()==dest.resolve() and not dest.is_symlink():
  source.unlink();os.rename(dest,source)
  # Keep the new spelling as a compatibility alias for any already-open tools.
  dest.symlink_to(source,target_is_directory=source.is_dir())
 elif not source.exists() and not source.is_symlink() and dest.exists() and not dest.is_symlink():
  os.rename(dest,source);dest.symlink_to(source,target_is_directory=source.is_dir())
 elif not source.is_symlink() and source.exists() and (not dest.exists() or dest.is_symlink()):return
 else:raise RuntimeError('Directory state does not match journal; manual recovery required')

def volume_template(content):
 old='  database: {}';new='  database:\n    name: ${DB_VOLUME_NAME:-${COMPOSE_PROJECT_NAME}_database}\n    external: ${DB_VOLUME_EXTERNAL:-false}'
 if new in content:return content
 intermediate='  database:\n    name: ${DB_VOLUME_NAME:-${COMPOSE_PROJECT_NAME}_database}'
 if intermediate in content:return content.replace(intermediate,new)
 if content.count(old)!=1:raise RuntimeError('Unrecognized database volume template')
 return content.replace(old,new)
def volume_env(content,name):
 value='realms_'+name.replace('-','_')+'_database'
 if re.search(r'^DB_VOLUME_NAME=',content,re.M):raise RuntimeError('Existing custom DB_VOLUME_NAME; manual review required')
 if re.search(r'^DB_VOLUME_EXTERNAL=',content,re.M):raise RuntimeError('Existing custom volume external setting')
 return content.rstrip()+'\nDB_VOLUME_NAME='+value+'\nDB_VOLUME_EXTERNAL=true\n'

def unrelated():
 result=b.unrelated()
 # Includes fixtures, edge, Home Assistant Docker workloads if any: none may restart.
 return result

def preflight():
 if ROOT.exists() or ROOT.is_symlink():raise RuntimeError('/srv/Realms already exists; use validate/rollback rather than overwrite it')
 native=Path(show('kol-realms.service','WorkingDirectory'));user=show('kol-realms.service','User')
 if not native.is_absolute() or native.is_symlink() or not native.is_dir() or native!=Path(show('kol-postgresql.service','WorkingDirectory')):raise RuntimeError('Ambiguous native runtime paths')
 account=pwd.getpwnam(user)
 if account.pw_uid==0 or show('kol-postgresql.service','User')!=user:raise RuntimeError('Unexpected native service identity')
 for unit in UNITS:
  if show(unit,'ActiveState')!='active' or show(unit,'UnitFileState')!='enabled':raise RuntimeError('Native services must be healthy and boot-enabled')
  if show(unit,'DropInPaths'):raise RuntimeError('Customized native unit drop-ins require review')
  unitfile=UNIT_DIR/unit
  if unitfile.is_symlink() or not unitfile.is_file() or unitfile.stat().st_uid!=0:raise RuntimeError('Unsafe systemd service file')
  if str(native) not in unitfile.read_text():raise RuntimeError('Native service path is not explicitly configured')
 if not pg.health(3000):raise RuntimeError('Native readiness failed')
 if (native/'.state/postgres/postmaster.pid').read_text().splitlines()[1]!=str(native/'.state/postgres'):raise RuntimeError('Native PostgreSQL uses an unexpected physical data directory')
 cluster_directory(native/'.state/postgres')
 for node in (native/'.state/postgres').rglob('*'):
  if node.is_symlink():raise RuntimeError('Native database contains links/tablespaces; manual review required')
 source=INFRA.parent
 moves=[{'old':str(source),'new':str(ROOT/'source')},{'old':str(native),'new':str(ROOT/'native/realms')},
        {'old':str(OLD_PROJECTS),'new':str(ROOT/'projects')},{'old':str(OLD_STATE),'new':str(ROOT/'state')},{'old':str(OLD_TOOLS),'new':str(ROOT/'system-tools')}]
 for file in Path('/var/lib').glob('kol-docker-install.*'):
  moves.append({'old':str(file),'new':str(ROOT/'state/install-records'/file.name)})
 device=ROOT.parent.stat().st_dev
 for move in moves:
  path=Path(move['old'])
  if path.is_symlink() or not path.exists() or path.stat().st_dev!=device:raise RuntimeError('Expected ordinary source on the same filesystem: '+str(path))
 if source==native or source in native.parents or native in source.parents:raise RuntimeError('Source/runtime directories overlap')
 if p.BASE.resolve()!=OLD_PROJECTS.resolve():raise RuntimeError('Unexpected infrastructure project base')
 volumes={};need=0
 allcontainers=[]
 allids=pg.out(p.DOCKER+['ps','--all','-q']).splitlines()
 if allids:allcontainers=json.loads(pg.out(p.DOCKER+['container','inspect',*allids]))
 for container in allcontainers:
  labels=container['Config'].get('Labels') or {}
  if labels.get('com.docker.compose.project')=='kol-edge' and labels.get('com.docker.compose.service')=='tunnel' and container['State']['Running']:raise RuntimeError('Stop the public tunnel for this storage maintenance window first')
 for name in NAMES:
  folder=p.BASE/name;content=(folder/'compose.yaml').read_bytes()
  if not p.managed_kol(content):raise RuntimeError(name+': customized Compose configuration')
  volume_template(content.decode());volume_env((folder/'.env').read_text(),name)
  for service in SERVICES:
   c=pg.inspect('container',pg.cid(name,service))
   if not c['State']['Running'] or c['State'].get('Health',{}).get('Status')!='healthy':raise RuntimeError(name+' '+service+' must be healthy')
   if service=='api' and any(x['HostIp']!='127.0.0.1' for vals in (c['HostConfig'].get('PortBindings') or {}).values() for x in vals):raise RuntimeError('Game API has non-loopback exposure; maintenance routing must be reviewed')
  db=pg.inspect('container',pg.cid(name,'db'));mounts=[m for m in db['Mounts'] if m['Type']=='volume']
  if len(mounts)!=1 or mounts[0]['Name']!=name+'_database':raise RuntimeError('Ambiguous original database volume')
  volume=pg.inspect('volume',mounts[0]['Name']);path=Path(volume['Mountpoint'])
  if volume['Driver']!='local' or volume.get('Options') or path.is_symlink() or path.stat().st_dev!=device:raise RuntimeError('Only ordinary local database volumes on this filesystem are supported')
  cluster_directory(path)
  if any(n.is_symlink() for n in path.rglob('*')):raise RuntimeError('Container database tablespaces/links require manual review')
  users=[c for c in allcontainers if any(m.get('Name')==volume['Name'] for m in c['Mounts'])]
  if any(c['Id']!=db['Id'] for c in users):raise RuntimeError('Original database volume is shared with another container')
  newname='realms_'+name.replace('-','_')+'_database'
  result=subprocess.run(p.DOCKER+['volume','inspect',newname],capture_output=True)
  if result.returncode==0:raise RuntimeError('Destination volume already exists; refusing reuse')
  size=sum(f.stat().st_size for f in path.rglob('*') if f.is_file());need+=size
  volumes[name]={'old_name':volume['Name'],'old_path':str(path),'new_name':newname,'new_path':str(ROOT/'data'/name/'database'),'bytes':size,'new_database_started':False}
 if shutil.disk_usage(ROOT.parent).free<need*2+1024**3:raise RuntimeError('Insufficient free space for cold copies and recovery margin')
 return {'version':1,'status':'planned','native':str(native),'user':user,'moves':moves,'volumes':volumes,'unrelated':unrelated(),'units':{},'moves_attempted':[],
         'boot':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'writer_services_resumed':False,
         'other_units':{unit:{'active':show(unit,'ActiveState'),'started':show(unit,'ActiveEnterTimestampMonotonic')} for unit in ('libvirtd.service','glances.service','NetworkManager.service')}}

def plan():
 record=preflight()
 print('Read-only checks passed. Proposed permanent root: /srv/Realms')
 for move in record['moves'][:5]:print(move['old']+' -> '+move['new'])
 print('Production/staging database files -> /srv/Realms/data/<project>/database')
 print('Docker images/engine, OS services and unrelated volumes remain in their standard locations.')
 print('Original container volumes remain available for recovery; no volumes will be deleted.')
 print('Apply will back up databases, briefly stop game services, preserve identities/permissions, and restart them.')

def stop_all():
 run(['systemctl','stop','kol-realms.service'])
 for name in NAMES:p.compose(name,'stop','api','worker','scheduler')
 for name in NAMES:p.compose(name,'stop','db','cache')
 run(['systemctl','stop','kol-postgresql.service'])
 for unit in UNITS:
  if show(unit,'ActiveState') not in ('inactive','failed'):raise RuntimeError('Native service did not stop')
 for name in NAMES:
  ids=p.compose(name,'ps','--all','--format','json',stdout=subprocess.PIPE,text=True).stdout.splitlines()
  for line in ids:
   if json.loads(line).get('State')=='running':raise RuntimeError('A game project container is still running; cold copy refused')

def start_databases():
 run(['systemctl','daemon-reload']);run(['systemctl','start','kol-postgresql.service'])
 for name in NAMES:p.compose(name,'up','-d','--no-deps','--wait','--wait-timeout','180','db','cache')
def start_writers():
 run(['systemctl','start','kol-realms.service'])
 for name in NAMES:p.compose(name,'up','-d','--no-deps','--wait','--wait-timeout','180','api','worker','scheduler')

def refresh_checks():
 current=pg.verify('persist')
 atomic(p.STATE_BASE/'infra-005/acceptance.json',(json.dumps(current,indent=2)+'\n').encode())
 b.cache.check_runtime()
 for name in NAMES:b.cache.helper(name,'persist')
 atomic(b.cache.STATE/'acceptance.json',(json.dumps(b.cache.snapshot(),indent=2)+'\n').encode())
 b.save()
 spec=importlib.util.spec_from_file_location('relocation_scheduler',INFRA/'scripts/scheduler.py');scheduler=importlib.util.module_from_spec(spec);spec.loader.exec_module(scheduler)
 for name in NAMES:scheduler.acceptance(name,'persist')
 scheduler.save()
 for unit in UNITS:
  if show(unit,'UnitFileState')!='enabled':raise RuntimeError('Native boot enablement lost')

def check_unrelated(record):
 current=unrelated()
 if record['boot']==Path('/proc/sys/kernel/random/boot_id').read_text().strip():
  unchanged=current==record['unrelated']
 else:
  unchanged={k:v['image'] for k,v in current.items()}=={k:v['image'] for k,v in record['unrelated'].items()}
 if not unchanged:raise RuntimeError('An unrelated workload changed during relocation')
 for unit,old in record.get('other_units',{}).items():
  if show(unit,'ActiveState')!=old['active']:raise RuntimeError('Existing host service state changed')
  if record['boot']==Path('/proc/sys/kernel/random/boot_id').read_text().strip() and show(unit,'ActiveEnterTimestampMonotonic')!=old['started']:raise RuntimeError('Existing host service restarted during relocation')

def validate(record):
 if Path(show('kol-realms.service','WorkingDirectory')).resolve()!=(ROOT/'native/realms').resolve():raise RuntimeError('Native runtime did not relocate')
 for move in record['moves']:
  if Path(move['old']).resolve()!=Path(move['new']).resolve():raise RuntimeError('Compatibility alias does not match relocated directory')
 for name,volume in record['volumes'].items():
  c=pg.inspect('container',pg.cid(name,'db'));mount=[m for m in c['Mounts'] if m['Type']=='volume']
  if len(mount)!=1 or mount[0]['Name']!=volume['new_name']:raise RuntimeError('Database is not using its relocated volume')
  actual=pg.inspect('volume',volume['new_name'])
  expected={'type':'none','o':'bind','device':volume['new_path']}
  if actual.get('Options')!=expected:raise RuntimeError('Relocated database mount is not bound to the recorded data directory')
 check_unrelated(record)
 refresh_checks()
 print('PASS: native/production/staging ready; database permissions and durable receipts retained; unrelated workloads unchanged')

def apply():
 record=preflight();ROOT.mkdir(mode=0o755);RECORD.mkdir(mode=0o700);save(record)
 try:
  for unit in UNITS:
   path=UNIT_DIR/unit;target=RECORD/unit;shutil.copy2(path,target);target.chmod(0o600)
   record['units'][unit]={'mode':stat.S_IMODE(path.stat().st_mode),'uid':path.stat().st_uid,'gid':path.stat().st_gid}
  for name in NAMES:
   folder=RECORD/name;folder.mkdir(mode=0o700)
   for filename in ['compose.yaml','.env']:shutil.copy2(p.BASE/name/filename,folder/filename);(folder/filename).chmod(0o600)
  save(record)
  # Freeze application writers before making backups; do not publish anything.
  run(['systemctl','stop','kol-realms.service'])
  for name in NAMES:p.compose(name,'stop','api','worker','scheduler')
  record['status']='writers-frozen';save(record)
  native=Path(record['native'])
  run(['runuser','-u',record['user'],'--','/bin/bash','scripts/database.sh','backup'],cwd=native,capture_output=True,text=True)
  archive=max((native/'.state/backups').glob('*.dump'),key=lambda f:f.stat().st_mtime_ns)
  run(['runuser','-u',record['user'],'--','/bin/bash','scripts/runtime.sh','pg_restore','--list',str(archive)],cwd=native,capture_output=True,text=True)
  for name in NAMES:p.operations(argparse.Namespace(project=name,action='backup'))
  stop_all();record['status']='databases-stopped';save(record)
  check_cold_cluster(native/'.state/postgres',native)
  (ROOT/'data').mkdir(mode=0o700)
  for name,volume in record['volumes'].items():
   check_cold_cluster(volume['old_path'],native)
   Path(volume['new_path']).parent.mkdir(mode=0o700)
   count=cold_copy(volume['old_path'],volume['new_path']);print('PASS:',name,'cold copy verified;',count,'filesystem entries')
   p.run(p.DOCKER+['volume','create','--driver','local','--label','com.docker.compose.project='+name,'--label','com.docker.compose.volume=database',
     '--opt','type=none','--opt','o=bind','--opt','device='+volume['new_path'],volume['new_name']],stdout=subprocess.DEVNULL)
  for move in record['moves']:
   record['moves_attempted'].append(move);save(record);move_alias(move['old'],move['new'])
  for name,volume in record['volumes'].items():
   folder=p.BASE/name;atomic(folder/'compose.yaml',volume_template((folder/'compose.yaml').read_text()).encode(),0o644)
   atomic(folder/'.env',volume_env((folder/'.env').read_text(),name).encode())
   p.compose(name,'--profile','setup','--profile','tools','config','--quiet')
  for unit,metadata in record['units'].items():
   text=(RECORD/unit).read_text().replace(record['native'],str(ROOT/'native/realms'))
   atomic(UNIT_DIR/unit,text.encode(),metadata['mode']);os.chown(UNIT_DIR/unit,metadata['uid'],metadata['gid'])
  run(['systemd-analyze','verify',str(UNIT_DIR/'kol-postgresql.service'),str(UNIT_DIR/'kol-realms.service')],capture_output=True,text=True)
  # Set intent before startup: rollback must always preserve the latest relocated files.
  for volume in record['volumes'].values():volume['new_database_started']=True
  record['status']='starting-databases';save(record);start_databases()
  record['writer_services_resumed']=True;record['status']='starting-applications';save(record);start_writers()
  validate(record)
  record['status']='complete';record['acceptance']=b.baseline();record['acceptance']['schedulers']={name:pg.cid(name,'scheduler') for name in NAMES};save(record)
  atomic(ROOT/'README.txt',b'Realms server layout\nsource/ - editable source code, scripts and documentation\nnative/realms/ - original runtime, authoritative database and native backups\nprojects/ - production/staging Compose configurations, secrets and backups\ndata/ - durable production/staging PostgreSQL files (do not edit)\nstate/ - private infrastructure records\nsystem-tools/ - root-owned startup helpers\nrelocation/ - private migration and rollback journal\nDocker Engine and unrelated workloads remain in standard OS locations.\n',0o644)
  print('Migration complete: /srv/Realms. Source: /srv/Realms/source. No reboot or Internet exposure performed.')
  print('Original database volumes retained for rollback. This remains one physical disk; off-machine backups are still needed.')
 except BaseException:
  print('Migration failed; attempting data-preserving rollback. Private journal:',MANIFEST,flush=True)
  try:rollback(record)
  except BaseException:print('Rollback incomplete. Keep services stopped and preserve all copies; use the private journal for recovery.',flush=True)
  raise

def restore_latest_volume(volume):
 """Rollback must carry post-move writes back, never swap in stale pre-move data."""
 if not volume.get('new_database_started'):return
 source=Path(volume['new_path']);old=Path(volume['old_path'])
 stage=old.with_name('_data.realms-restoring-'+uuid.uuid4().hex)
 cold_copy(source,stage)
 retained=RECORD/'retained-pre-move';retained.mkdir(exist_ok=True,mode=0o700)
 saved=retained/volume['old_name']
 if saved.exists():raise RuntimeError('Original recovery copy already retained; manual recovery required')
 os.rename(old,saved)
 try:os.rename(stage,old)
 except BaseException:os.rename(saved,old);raise
 print('PASS: latest relocated database preserved during rollback:',volume['old_name'])

def rollback(record=None):
 record=record or load()
 if record['status']=='rolled-back':raise RuntimeError('Relocation already rolled back')
 stop_all()
 for volume in record['volumes'].values():
  if not volume.get('restored'):
   if volume.get('new_database_started'):check_cold_cluster(volume['new_path'],record['native'])
   restore_latest_volume(volume);volume['restored']=True;save(record)
 for name in NAMES:
  for filename in ['compose.yaml','.env']:
   saved=RECORD/name/filename
   if saved.is_file():atomic(p.BASE/name/filename,saved.read_bytes(),0o600 if filename=='.env' else 0o644)
 for unit,metadata in record['units'].items():
  atomic(UNIT_DIR/unit,(RECORD/unit).read_bytes(),metadata['mode']);os.chown(UNIT_DIR/unit,metadata['uid'],metadata['gid'])
 for move in reversed(record['moves_attempted']):reverse_alias(move['old'],move['new'])
 start_databases();start_writers();refresh_checks()
 check_unrelated(record)
 record['status']='rolled-back';save(record)
 print('Rollback complete. Latest database contents preserved; all recovery copies retained. New paths remain compatibility aliases.')

def archive_early_rollback(record):
 # Restrict automatic retry to a failure before any directory/volume cutover.
 if record.get('status')!='rolled-back' or record.get('moves_attempted') or any(v.get('new_database_started') for v in record['volumes'].values()):raise RuntimeError('Retry requires an early, fully rolled-back attempt; otherwise review recovery manually')
 if {path.name for path in ROOT.iterdir()}!={'relocation'}:raise RuntimeError('Unexpected destination files; retry will not remove or archive data')
 for volume in record['volumes'].values():
  result=subprocess.run(p.DOCKER+['volume','inspect',volume['new_name']],capture_output=True)
  if result.returncode==0:raise RuntimeError('Destination volume already exists; retry refused')
 history=ROOT.parent/'Realms-relocation-history'
 if not history.exists():history.mkdir(mode=0o700)
 if history.is_symlink() or history.stat().st_uid!=os.geteuid() or history.stat().st_mode&0o077:raise RuntimeError('Unsafe relocation history directory')
 archive=history/('attempt-'+uuid.uuid4().hex)
 os.rename(ROOT,archive)
 print('Prior failed attempt preserved:',archive)
 return archive

def retry():
 record=load()
 if Path(show('kol-realms.service','WorkingDirectory'))!=Path(record['native']) or Path(show('kol-postgresql.service','WorkingDirectory'))!=Path(record['native']):raise RuntimeError('Original native service paths were not restored')
 if not all(pg.health(port) for port in (3000,13000,13001)):raise RuntimeError('Services must be healthy before retry')
 archive_early_rollback(record)
 apply()

def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('action',choices=['plan','apply','retry','validate','after-reboot','rollback']);args=ap.parse_args()
 if os.geteuid()!=0:ap.error('Use sudo for complete read-only inspection and migration; no passwords belong in chat.')
 if args.action=='plan':plan();return
 folder=Path('/run/lock/kol-docker');folder.mkdir(exist_ok=True,mode=0o700)
 with (folder/'operations.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  native=Path(show('kol-realms.service','WorkingDirectory'));console=native/'.state/control-panel'
  if not console.exists():
   console.mkdir(mode=0o700);owner=native.stat();os.chown(console,owner.st_uid,owner.st_gid)
  if console.is_symlink():raise RuntimeError('Unsafe native console lock directory')
  # Same inode remains locked when the runtime directory moves.
  descriptor=os.open(console/'operation.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
  owner=native.stat();os.fchown(descriptor,owner.st_uid,owner.st_gid)
  with os.fdopen(descriptor,'a') as native_lock:
   fcntl.flock(native_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
   if args.action=='plan':plan()
   elif args.action=='apply':apply()
   elif args.action=='retry':retry()
   elif args.action=='rollback':rollback()
   else:
    record=load()
    if record['status']!='complete':raise RuntimeError('Migration is not complete')
    if args.action=='after-reboot':
     if record['boot']==Path('/proc/sys/kernel/random/boot_id').read_text().strip():raise RuntimeError('Actual host reboot has not occurred')
     now=b.baseline();now['schedulers']={name:pg.cid(name,'scheduler') for name in NAMES}
     for key in ['containers','volumes','schedulers']:
      if now[key]!=record['acceptance'][key]:raise RuntimeError('Migrated '+key+' did not survive reboot unchanged')
    validate(record)
    # Snapshot successful validation after all helpers; disposable cache IDs may
    # differ following older validator versions that reconciled dependencies.
    record['acceptance']=b.baseline();record['acceptance']['schedulers']={name:pg.cid(name,'scheduler') for name in NAMES};save(record)
    print('Relocation validation passed'+(' after actual host reboot.' if args.action=='after-reboot' else '.'))
if __name__=='__main__':
 try:main()
 except (OSError,RuntimeError,ValueError,subprocess.CalledProcessError) as error:
  # Command stderr and private configuration are deliberately not emitted.
  raise SystemExit('FAIL/UNKNOWN: '+(str(error) if not isinstance(error,subprocess.CalledProcessError) else 'A host command failed; inspect the private journal and local service status.'))
