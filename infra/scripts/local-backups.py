#!/usr/bin/env python3
"""Encrypted USB backups of all three game stores, with isolated restore verification."""
import argparse,fcntl,hashlib,importlib.util,json,os,pwd,re,secrets,shutil,subprocess,tempfile,time,uuid,signal
from datetime import datetime,timezone
from pathlib import Path
INFRA=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('backup_backend',INFRA/'scripts/backend.py');b=importlib.util.module_from_spec(s);s.loader.exec_module(b)
p=b.p
ROOT=Path('/srv/Realms');STATE=ROOT/'state/backups';STAGING=ROOT/'backup-staging';MOUNT=Path('/mnt/Realms-backups')
CONFIG=STATE/'config.json';KEY=STATE/'repository-password';FSTAB=Path('/etc/fstab')
TAG='realms-local-backup';HOST='realms-server';NAMES=('kol-production','kol-staging')
RESTIC='/usr/bin/restic';UNIT_DIR=Path('/etc/systemd/system')

def stamp():return datetime.now(timezone.utc).isoformat()
def write(path,data,mode=0o600):
 path=Path(path)
 if path.is_symlink():raise RuntimeError('Refusing configuration symlink')
 tmp=path.with_name('.'+path.name+'.'+uuid.uuid4().hex)
 try:
  with tmp.open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
  tmp.chmod(mode);os.replace(tmp,path)
 finally:tmp.unlink(missing_ok=True)
def save(path,value):write(path,(json.dumps(value,indent=2)+'\n').encode())
def digest_file(path):
 digest=hashlib.sha256()
 with Path(path).open('rb') as f:
  for chunk in iter(lambda:f.read(1024*1024),b''):digest.update(chunk)
 return digest.hexdigest()
def command(args,*,env=None,cwd=None,stdin=None,stdout=None,progress_interval=20):
 started=time.monotonic()
 process=subprocess.Popen([str(x) for x in args],env=env,cwd=cwd,stdin=stdin,stdout=stdout if stdout is not None else subprocess.PIPE,stderr=subprocess.PIPE,text=stdout is None)
 try:
  while True:
   try:
    captured,errors=process.communicate(timeout=progress_interval);break
   except subprocess.TimeoutExpired:
    print('Still working:',Path(str(args[0])).name,'('+str(int(time.monotonic()-started))+' seconds elapsed)',flush=True)
 except BaseException:
  process.kill();process.communicate();raise
 result=subprocess.CompletedProcess(args,process.returncode,captured,errors)
 if result.returncode:
  if os.geteuid()==0 and STATE.is_dir():
   detail=result.stderr if isinstance(result.stderr,bytes) else result.stderr.encode()
   write(STATE/'last-command-error.log',detail)
  raise RuntimeError('Command failed: '+Path(str(args[0])).name+' (private details: state/backups/last-command-error.log)')
 return result.stdout if stdout is None else ''
def output_file(args,path,env=None):
 with Path(path).open('xb') as f:
  Path(path).chmod(0o600)
  try:command(args,env=env,stdout=f)
  except BaseException:Path(path).unlink(missing_ok=True);raise
 if Path(path).stat().st_size==0:raise RuntimeError('Empty database/image archive')
def properties(unit,key):return command(['systemctl','show',unit,'-p',key,'--value']).strip()
def native():
 folder=Path(properties('kol-realms.service','WorkingDirectory'))
 if folder!=ROOT/'native/realms' or not folder.is_dir():raise RuntimeError('Expected migrated native runtime')
 return folder

def read_config():
 for path in (STATE,CONFIG,KEY):
  if path.is_symlink() or path.stat().st_uid!=0 or path.stat().st_mode&0o077:raise RuntimeError('Backup configuration must be root-owned and private')
 cfg=json.loads(CONFIG.read_text())
 if cfg['mount']!=str(MOUNT) or cfg['repository']!=str(MOUNT/'Realms-Backups/restic'):raise RuntimeError('Unexpected backup target')
 return cfg

def mounted_info(target):
 value=json.loads(command(['findmnt','--json','--mountpoint',str(target),'-o','TARGET,SOURCE,FSTYPE,UUID']))['filesystems']
 if len(value)!=1:return None
 return value[0]
def check_target(cfg):
 info=mounted_info(MOUNT)
 if not info or str(info.get('uuid','')).casefold()!=cfg['uuid'].casefold() or info['fstype']!='ntfs3':raise RuntimeError('Expected USB filesystem is not mounted; refusing internal-disk fallback')
 marker=MOUNT/'Realms-Backups/target.json'
 if marker.is_symlink() or not marker.is_file() or json.loads(marker.read_text()).get('id')!=cfg['target_id']:raise RuntimeError('Backup target marker mismatch')
 repo=Path(cfg['repository'])
 if repo.is_symlink() or not repo.is_dir():raise RuntimeError('Expected ordinary repository directory')
 return repo

def restic(args,cfg=None):
 cfg=cfg or read_config();repo=check_target(cfg)
 env=dict(os.environ);env.update(RESTIC_PASSWORD_FILE=str(KEY),GOMAXPROCS='2')
 # Holding cwd on the mount prevents ordinary unmount during this command.
 return command([RESTIC,'--repo',repo,'--cache-dir',STATE/'cache',*args],env=env,cwd=MOUNT)

def health(**values):
 path=STATE/'health.json';record=json.loads(path.read_text()) if path.exists() else {}
 record.update(values);save(path,record)

def probe_device(device):
 if not re.fullmatch(r'/dev/sd[a-z]+[1-9][0-9]*',device):raise RuntimeError('Use the existing USB partition, e.g. /dev/sdb1')
 parent=command(['lsblk','-dnro','PKNAME',device]).strip()
 if not parent or command(['lsblk','-dnro','TRAN','/dev/'+parent]).strip()!='usb':raise RuntimeError('Target must be a USB partition')
 ident=command(['blkid','-s','UUID','-o','value',device]).strip()
 if not re.fullmatch('[A-Za-z0-9-]+',ident):raise RuntimeError('Unsafe or missing filesystem UUID')
 data=json.loads(command(['findmnt','--json','--source',device,'-o','TARGET,SOURCE,FSTYPE,UUID']))['filesystems']
 if len(data)!=1 or data[0]['fstype']!='ntfs3':raise RuntimeError('Expected the existing, mounted NTFS3 external drive')
 if any(ident.casefold() in line.casefold() for line in FSTAB.read_text().splitlines() if line.strip() and not line.lstrip().startswith('#')):raise RuntimeError('USB drive already has fstab configuration; review before changing it')
 return ident,Path(data[0]['target'])

def configure(device):
 if CONFIG.exists():
  cfg=read_config();check_target(cfg)
  if cfg['fstab_line'] not in FSTAB.read_text().splitlines():raise RuntimeError('Incomplete persistent-mount setup; inspect the saved fstab record before retry')
  restic(['cat','config'],cfg);print('Existing private backup configuration retained.');return cfg
 ident,current=probe_device(device)
 if not Path(RESTIC).is_file():raise RuntimeError('Restic must already be installed; this script installs no packages')
 folder=native();account=pwd.getpwnam(properties('kol-realms.service','User'))
 if (current/'Realms-Backups').exists():raise RuntimeError('Target folder already exists; refusing to adopt or overwrite it')
 if MOUNT.exists() and (MOUNT.is_symlink() or any(MOUNT.iterdir())):raise RuntimeError('Mount destination is not an empty ordinary directory')
 if shutil.disk_usage(current).free<5*1024**3:raise RuntimeError('External drive needs at least 5 GiB free')
 for name in NAMES:
  if not b.pg.health(p.PROJECTS[name][1]):raise RuntimeError('Game project is not ready')
 if not b.pg.health(3000):raise RuntimeError('Native game is not ready')
 STATE.mkdir(mode=0o700);STAGING.mkdir(mode=0o700);MOUNT.mkdir(exist_ok=True,mode=0o700)
 uid,gid=account.pw_uid,account.pw_gid
 line=f'UUID={ident} {MOUNT} ntfs3 rw,nofail,nosuid,nodev,noexec,uid={uid},gid={gid},acl,x-systemd.device-timeout=10s 0 0'
 old=FSTAB.read_bytes();write(STATE/'fstab.before',old)
 cfg={'version':1,'uuid':ident,'mount':str(MOUNT),'repository':str(MOUNT/'Realms-Backups/restic'),'target_id':uuid.uuid4().hex,'fstab_line':line,'configured':stamp()}
 write(KEY,(secrets.token_hex(32)+'\n').encode());save(CONFIG,cfg)
 try:
  write(FSTAB,old.rstrip()+b'\n# Realms encrypted USB backups\n'+line.encode()+b'\n',0o644)
  command(['findmnt','--verify','--tab-file',FSTAB]);command(['systemctl','daemon-reload'])
  # Bind the existing mount for this session. At reboot fstab mounts the same UUID directly.
  command(['mount','--bind',current,MOUNT])
  command(['mount','-o','remount,bind,nosuid,nodev,noexec',MOUNT])
  target=MOUNT/'Realms-Backups';target.mkdir(mode=0o700);(target/'restic').mkdir(mode=0o700)
  save(target/'target.json',{'id':cfg['target_id'],'purpose':'Encrypted Realms backups'})
  restic(['init'],cfg);print('Encrypted repository initialized. Drive not reformatted; existing files preserved.')
 except BaseException:
  # Preserve original drive contents and any initialized repo; restore only our exact fstab entry.
  text=FSTAB.read_text();write(FSTAB,text.replace('# Realms encrypted USB backups\n'+line+'\n','').encode(),0o644)
  command(['systemctl','daemon-reload']);raise
 return cfg

def native_env(folder):
 env=dict(os.environ);env.update(PGPASSWORD=(folder/'.state/db-password').read_text().strip(),LD_LIBRARY_PATH=str(folder/'.local/postgresql/usr/lib/x86_64-linux-gnu'))
 return env

def prepare_snapshot():
 folder=native();pending=Path(tempfile.mkdtemp(prefix='pending-',dir=STAGING));pending.chmod(0o700)
 try:
  manifest={'created':stamp(),'databases':{},'images':{}}
  bins=folder/'.local/postgresql/usr/lib/postgresql/18/bin';env=native_env(folder)
  args=[bins/'pg_dump','-h','127.0.0.1','-p','55432','-U','realms','-Fc','-Z0','realms_dev']
  output_file(args,pending/'native.dump',env)
  output_file([bins/'pg_dumpall','-h','127.0.0.1','-p','55432','-U','realms','--globals-only'],pending/'native-globals.sql',env)
  command([bins/'pg_restore','--list',pending/'native.dump'],env=env)
  manifest['databases']['native']={'database':'realms_dev','runtime':str(folder)}
  cfgdir=pending/'configuration';cfgdir.mkdir(mode=0o700)
  nativecfg=cfgdir/'native-state';nativecfg.mkdir(mode=0o700)
  for name in ('runtime.env','db-password'):
   shutil.copy2(folder/'.state'/name,nativecfg/name)
  for project in NAMES:
   database=p.read_database_name(project)
   base=p.DOCKER+['compose','--project-directory',str(p.BASE/project),'--env-file',str(p.BASE/project/'.env'),'-f',str(p.BASE/project/'compose.yaml'),'exec','-T','db']
   output_file(base+['pg_dump','-U','postgres','-Fc','-Z0',database],pending/(project+'.dump'))
   output_file(base+['pg_dumpall','-U','postgres','--globals-only'],pending/(project+'-globals.sql'))
   with (pending/(project+'.dump')).open('rb') as src:command(base+['pg_restore','--list'],stdin=src)
   cid=b.pg.cid(project,'api');image=b.pg.inspect('container',cid)['Image'];manifest['images'][project]=image
   manifest['databases'][project]={'database':database,'image':image}
   dest=cfgdir/project;dest.mkdir(mode=0o700)
   for name in ('compose.yaml','.env'):shutil.copy2(p.BASE/project/name,dest/name)
   for name in ('secrets','cache'):shutil.copytree(p.BASE/project/name,dest/name)
  # Save the exact running game images so recovery does not rely on a newer checkout.
  for image in set(manifest['images'].values()):
   filename='game-'+image.removeprefix('sha256:')+'.tar'
   output_file(p.DOCKER+['image','save',image],pending/filename)
  pgimage=json.loads((INFRA/'container/images.lock.json').read_text())['postgres'];manifest['postgres_image']=pgimage;manifest['postgres_id']=b.pg.inspect('image',pgimage)['Id']
  output_file(p.DOCKER+['image','save',pgimage],pending/'postgres-image.tar')
  units=cfgdir/'systemd';units.mkdir(mode=0o700)
  for name in ['kol-realms.service','kol-postgresql.service']:
   shutil.copy2(UNIT_DIR/name,units/name)
  # Console alert settings contain SMTP secrets; retain them only inside the
  # root-private staging set and encrypted repository, never public GUI cache.
  console=ROOT/'state/console';settings=cfgdir/'console-state'
  for name in ('email.json','monitoring-local.json','alert-state.json','ack.json','operations.json'):
   if (console/name).is_file():
    settings.mkdir(exist_ok=True,mode=0o700);shutil.copy2(console/name,settings/name)
  monitor_override=UNIT_DIR/'glances.service.d/90-realms-local.conf'
  if monitor_override.is_file():shutil.copy2(monitor_override,units/'glances-local.conf')
  releases=ROOT/'state/releases'
  if releases.is_dir():shutil.copytree(releases,cfgdir/'release-records')
  for name in ('realms-console-monitor.service','realms-console-monitor.timer'):
   if (UNIT_DIR/name).is_file():shutil.copy2(UNIT_DIR/name,units/name)
  edge=p.BASE/'kol-edge'
  if edge.is_dir():shutil.copytree(edge,cfgdir/'kol-edge',ignore=shutil.ignore_patterns('backups'))
  for path in pending.rglob('*'):
   if path.is_file():path.chmod(0o600)
  manifest['files']={path.name:digest_file(path) for path in pending.glob('*.dump')}
  save(pending/'manifest.json',manifest)
  current=STAGING/'current';old=STAGING/'previous'
  if old.exists():shutil.rmtree(old)
  if current.exists():os.rename(current,old)
  os.rename(pending,current)
  if old.exists():shutil.rmtree(old)
  return current
 except BaseException:shutil.rmtree(pending,ignore_errors=True);raise

def run_backup():
 cfg=read_config();check_target(cfg);health(last_attempt=stamp(),last_result='running')
 current=prepare_snapshot();folder=native()
 args=['backup','--json','--host',HOST,'--tag',TAG,'--compression','auto']
 # Snapshot current deployment files, but never a live raw database directory.
 for exclude in [str(ROOT/'source/realms/node_modules'),str(ROOT/'source/realms/dist'),'**/__pycache__','**/.state','**/.git/index.lock']:
  args+=['--exclude',exclude]
 args += [str(current),str(ROOT/'source'),str(folder),str(ROOT/'system-tools')]
 result=restic(args,cfg);summary=[json.loads(line) for line in result.splitlines() if line.strip()]
 snapshot=next((line['snapshot_id'] for line in summary if line.get('message_type')=='summary' and line.get('snapshot_id')),None)
 if not snapshot:raise RuntimeError('No successful encrypted snapshot returned')
 health(last_success=stamp(),last_result='success',snapshot=snapshot)
 print('PASS: native, production and staging dumps, roles, exact images and configuration stored in encrypted USB snapshot',snapshot)

def restore_identity(image):
 # Resolve ownership from the exact saved image. Its entrypoint fixes PGDATA
 # descendants, but does not chown our bind-mounted /var/lib/postgresql parent.
 ids=[]
 for option in ('-u','-g'):
  value=command(p.DOCKER+['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--entrypoint','id',image,option,'postgres']).strip()
  if not value.isdecimal() or int(value)==0:raise RuntimeError('Invalid PostgreSQL restore identity')
  ids.append(int(value))
 return tuple(ids)

def restore_directories(base,identity):
 base.mkdir(mode=0o700)
 pgdata=base/'postgres';pgdata.mkdir(mode=0o700);os.chown(pgdata,*identity)
 sockets=base/'sockets';sockets.mkdir(mode=0o777);sockets.chmod(0o777);os.chown(sockets,*identity)
 return pgdata,sockets

def wait_restore_ready(name,admin):
 # Entrypoint initialization itself uses the default socket directory. Wait for
 # its final postgres process, not the temporary initialization server.
 for _ in range(90):
  check=subprocess.run(p.DOCKER+['exec',name,'sh','-c','test "$(cat /proc/1/comm)" = postgres && exec pg_isready -h /var/run/postgresql -U "$1" -d postgres','--',admin],capture_output=True)
  if check.returncode==0:return
  running=subprocess.run(p.DOCKER+['inspect','--format','{{.State.Running}}',name],capture_output=True,text=True)
  if running.returncode or running.stdout.strip()!='true':break
  time.sleep(1)
 logs=subprocess.run(p.DOCKER+['logs','--tail','100',name],capture_output=True)
 write(STATE/'last-restore-startup.log',logs.stdout+b'\n'+logs.stderr)
 raise RuntimeError('Isolated restore PostgreSQL failed readiness; private startup log: /srv/Realms/state/backups/last-restore-startup.log')

def snapshot_index(cfg=None):
 rows=json.loads(restic(['snapshots','--json','--host',HOST,'--tag',TAG],cfg))
 return sorted([{'id':r['id'],'time':r['time']} for r in rows],key=lambda r:r['time'],reverse=True)

def select_snapshot(rows,identifier=None):
 if not rows:raise RuntimeError('No backup exists to restore')
 if identifier is None:return rows[0]['id']
 if not re.fullmatch('[0-9a-f]{64}',identifier):raise ValueError('Use a full recorded snapshot ID')
 if not any(r['id']==identifier for r in rows):raise RuntimeError('Snapshot is not an authorized Realms backup')
 return identifier

def restore_check(snapshot_id=None):
 cfg=read_config();check_target(cfg)
 snapshot=select_snapshot(snapshot_index(cfg),snapshot_id)
 stage=Path(tempfile.mkdtemp(prefix='restore-',dir=STATE));stage.chmod(0o700)
 containers=[]
 try:
  print('Checking every encrypted backup data block; USB verification can take several minutes.',flush=True)
  restic(['check','--read-data'],cfg)
  print('PASS: encrypted repository integrity; restoring files for isolated database tests.',flush=True)
  prefix=str(STAGING/'current');restic(['restore',snapshot,'--target',stage,'--include',prefix,'--include',str(ROOT/'native/realms'),'--verify'],cfg)
  restored=stage/prefix.lstrip('/');manifest=json.loads((restored/'manifest.json').read_text())
  # Verify that the backup contains usable exact-version images, not just identifiers.
  print('Loading saved application and PostgreSQL images for recovery tests.',flush=True)
  for imagefile in restored.glob('*.tar'):command(p.DOCKER+['image','load','-i',imagefile])
  identity=restore_identity(manifest['postgres_id'])
  for store in ('native',*NAMES):
   print('Restoring and checking '+store+' in an isolated test database.',flush=True)
   archive=restored/(store+'.dump')
   if digest_file(archive)!=manifest['files'][archive.name]:raise RuntimeError('Restored archive checksum mismatch')
   token=secrets.token_hex(8);name='realms-restore-'+token;admin='restore_admin_'+token;database='realms_restore_'+token
   base=stage/store;pgdata,sockets=restore_directories(base,identity)
   containers.append(name)
   command(p.DOCKER+['run','-d','--name',name,'--label','kol.backup.restore-test=true','--network','none','--memory','512m','--cpus','0.5','--pids-limit','128',
    '--security-opt','no-new-privileges:true','--log-driver','local','--log-opt','max-size=5m','--log-opt','max-file=2',
    '--mount','type=bind,src='+str(pgdata)+',dst=/var/lib/postgresql','--mount','type=bind,src='+str(sockets)+',dst=/var/run/postgresql',
    '-e','POSTGRES_USER='+admin,'-e','POSTGRES_HOST_AUTH_METHOD=trust',manifest['postgres_id'],'postgres','-c','listen_addresses=','-c','unix_socket_directories=/var/run/postgresql','-c','shared_buffers=64MB','-c','max_connections=15'])
   wait_restore_ready(name,admin)
   with (restored/(store+'-globals.sql')).open('rb') as src:command(p.DOCKER+['exec','-i',name,'psql','-h','/var/run/postgresql','-U',admin,'-d','postgres','-v','ON_ERROR_STOP=1'],stdin=src)
   command(p.DOCKER+['exec',name,'createdb','-h','/var/run/postgresql','-U',admin,database])
   with archive.open('rb') as src:command(p.DOCKER+['exec','-i',name,'pg_restore','-h','/var/run/postgresql','-U',admin,'-d',database,'--exit-on-error'],stdin=src)
   url=f'postgresql://{admin}@localhost/{database}?host='+str(sockets)
   if store=='native':
    folder=stage/str(ROOT/'native/realms').lstrip('/');env=dict(os.environ);env['RESTORE_DATABASE_URL']=url
    command([folder/'.local/node/bin/node',folder/'dist/restore-check.js'],env=env,cwd=folder)
   else:
    url=f'postgresql://{admin}@localhost/{database}?host=/run/restore-sockets'
    command(p.DOCKER+['run','--rm','--network','none','--user','10001:10001','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','256m','--cpus','0.5','--pids-limit','64',
     '--mount','type=bind,src='+str(sockets)+',dst=/run/restore-sockets,readonly','-e','RESTORE_DATABASE_URL='+url,'--entrypoint','node',manifest['databases'][store]['image'],'dist/restore-check.js'])
   command(p.DOCKER+['rm','-f',name]);containers.remove(name)
   print('PASS:',store,'restored from encrypted USB backup; schema, constraints and game-data invariants verified')
  health(last_restore_success=stamp(),restore_snapshot=snapshot);print('PASS: all three restore tests complete; production databases untouched')
 finally:
  for name in containers:
   subprocess.run(p.DOCKER+['rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  shutil.rmtree(stage,ignore_errors=True)

def retention(apply=False):
 args=['forget','--host',HOST,'--tag',TAG,'--group-by','host,tags','--keep-within','48h','--keep-daily','7','--keep-weekly','4','--keep-monthly','12']
 args+=['--prune'] if apply else ['--dry-run']
 print(restic(args).strip())

def install_units():
 for path in (INFRA/'systemd/backups').glob('realms-backup*.in'):
  dest=UNIT_DIR/path.name.removesuffix('.in')
  content=path.read_text()
  if dest.exists() and dest.read_text()!=content:raise RuntimeError('Customized backup unit; refusing overwrite')
  write(dest,content.encode(),0o644)
 command(['systemd-analyze','verify',UNIT_DIR/'realms-backup.service',UNIT_DIR/'realms-backup-restore.service',UNIT_DIR/'realms-backup-failure.service'])
 command(['systemctl','daemon-reload'])
 command(['systemctl','enable','--now','realms-backup.timer','realms-backup-restore.timer'])
 print('PASS: automatic backup and weekly restore timers enabled')

def finish_setup():
 if not CONFIG.exists():raise RuntimeError('No existing backup setup; run setup first')
 cfg=read_config();check_target(cfg)
 if cfg['fstab_line'] not in FSTAB.read_text().splitlines():raise RuntimeError('Incomplete persistent-mount setup; review before resuming')
 print('Resuming verification of the existing backup; no new backup is created.',flush=True)
 restore_check();install_units()

def main():
 def interrupted(signum,frame):raise InterruptedError('Backup interrupted; incomplete work is not marked successful')
 signal.signal(signal.SIGTERM,interrupted)
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['setup','finish-setup','run','restore-check','status','snapshots','check','retention-plan','retention-apply','disable','record-failure']);parser.add_argument('--device',default='/dev/sdb1');parser.add_argument('--snapshot');args=parser.parse_args()
 if os.geteuid()!=0:parser.error('Run with sudo; keep the repository password private')
 if args.action=='record-failure':
  health(last_failure=stamp(),last_result='failed',reason='Systemd backup or mount failure; inspect journal locally');return
 if args.action=='status':
  cfg=read_config();record=json.loads((STATE/'health.json').read_text()) if (STATE/'health.json').exists() else {}
  try:check_target(cfg);record['drive']='mounted and verified'
  except (OSError,RuntimeError):record['drive']='unavailable or wrong target'
  print(json.dumps(record,indent=2));return
 lockdir=Path('/run/lock/kol-docker');lockdir.mkdir(exist_ok=True,mode=0o700)
 with (lockdir/'operations.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  folder=native();console=folder/'.state/control-panel/operation.lock'
  with console.open('a') as native_lock:
   fcntl.flock(native_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
   try:
    if args.action=='setup':configure(args.device);run_backup();restore_check();install_units()
    elif args.action=='finish-setup':finish_setup()
    elif args.action=='run':run_backup()
    elif args.action=='restore-check':restore_check(args.snapshot)
    elif args.action=='snapshots':print(json.dumps(snapshot_index(),indent=2))
    elif args.action=='check':restic(['check','--read-data']);print('PASS: encrypted repository checked')
    elif args.action=='retention-plan':retention()
    elif args.action=='retention-apply':retention(True)
    elif args.action=='disable':command(['systemctl','disable','--now','realms-backup.timer','realms-backup-restore.timer']);print('Timers disabled; backups and recovery key retained')
   except (KeyboardInterrupt,InterruptedError):
    if STATE.is_dir():health(last_failure=stamp(),last_result='interrupted',reason='Operation interrupted; existing completed snapshots retained')
    raise
   except BaseException:
    if STATE.is_dir():health(last_failure=stamp(),last_result='failed',reason='Backup operation failed; inspect local configuration and journal')
    raise
if __name__=='__main__':
 try:main()
 except (KeyboardInterrupt,InterruptedError):raise SystemExit('Interrupted: completed backups retained. If initial verification was interrupted, resume with finish-setup.')
 except (OSError,ValueError,RuntimeError) as error:raise SystemExit('FAIL/UNKNOWN: '+str(error))
