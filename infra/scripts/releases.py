#!/usr/bin/env python3
"""Operator-gated staging, promotion and schema-compatible code rollback."""
import argparse,fcntl,hashlib,importlib.util,json,os,re,subprocess,uuid,tempfile
from datetime import datetime,timezone
from pathlib import Path
INFRA=Path(__file__).resolve().parents[1]
snapshot_spec=importlib.util.spec_from_file_location('release_git_snapshot',INFRA/'scripts/git_snapshot.py');snapshot_module=importlib.util.module_from_spec(snapshot_spec);snapshot_spec.loader.exec_module(snapshot_module);freeze=snapshot_module.freeze
s=importlib.util.spec_from_file_location('release_backend',INFRA/'scripts/backend.py');b=importlib.util.module_from_spec(s);s.loader.exec_module(b)
verification_spec=importlib.util.spec_from_file_location('release_verification',INFRA/'scripts/release_verification.py');verification=importlib.util.module_from_spec(verification_spec);verification_spec.loader.exec_module(verification)
p=b.p;pg=b.pg;STATE=p.STATE_BASE/'releases';SERVICES=('api','worker','scheduler');PROJECTS=('kol-staging','kol-production')
def now():return datetime.now(timezone.utc).isoformat()
def save(path,value):
 path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 tmp=path.with_name('.'+path.name+'.'+uuid.uuid4().hex)
 with tmp.open('x') as f:os.chmod(tmp,0o600);json.dump(value,f,indent=2);f.flush();os.fsync(f.fileno())
 os.replace(tmp,path)
def release_path(identifier):
 if not re.fullmatch(r'release-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}',identifier):raise ValueError('Choose a recorded release ID')
 return STATE/identifier

def schema(project):
 sql="BEGIN READ ONLY; SELECT coalesce(json_agg(t ORDER BY name),'[]'::json) FROM (SELECT name,checksum FROM schema_migrations) t; COMMIT;"
 out=p.compose(project,'exec','-T','db','psql','-X','-qAt','-U','postgres','-d',p.read_database_name(project),'-c',sql,stdout=subprocess.PIPE,text=True).stdout
 return json.loads(out.strip())
def image_schema(image):
 script="const fs=require('fs'),c=require('crypto');console.log(JSON.stringify(fs.readdirSync('/app/migrations').filter(x=>x.endsWith('.sql')).sort().map(name=>({name,checksum:c.createHash('sha256').update(fs.readFileSync('/app/migrations/'+name,'utf8')).digest('hex')}))));"
 return json.loads(pg.out(p.DOCKER+['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','128m','--pids-limit','32','--entrypoint','node',image,'-e',script]))
def check_schema(current,target,allow=False):
 targetmap={r['name']:r['checksum'] for r in target}
 if any(targetmap.get(r['name'])!=r['checksum'] for r in current):raise RuntimeError('Applied migrations changed or disappeared; release refused')
 pending=[r['name'] for r in target if r['name'] not in {x['name'] for x in current}]
 if pending and not allow:raise RuntimeError('Pending migrations require explicit consent: '+', '.join(pending))
 return pending

def set_image(project,image):
 if not re.fullmatch(r'sha256:[0-9a-f]{64}',image):raise ValueError('An immutable local image is required')
 path=p.BASE/project/'.env';text=path.read_text()
 if len(re.findall(r'^KOL_IMAGE=.*$',text,re.M))!=1:raise RuntimeError('Ambiguous image configuration')
 text=re.sub(r'^KOL_IMAGE=.*$',f'KOL_IMAGE={image}',text,flags=re.M)
 tmp=path.with_name('.env.release-'+uuid.uuid4().hex)
 with tmp.open('x') as f:os.chmod(tmp,0o600);f.write(text);f.flush();os.fsync(f.fileno())
 os.replace(tmp,path)
def current_image(project):return pg.inspect('container',pg.cid(project,'api'))['Image']
def protected_state(project):
 result={}
 for cid in pg.out(p.DOCKER+['ps','-q']).splitlines():
  c=pg.inspect('container',cid);labels=c['Config'].get('Labels',{}) or {}
  if labels.get('com.docker.compose.project')!=project or labels.get('com.docker.compose.service') not in SERVICES:
   result[c['Id']]=c['State']['StartedAt']
 return result

def deploy_project(project,record,phase):
 target=record['schema'];before_schema=schema(project);pending=check_schema(before_schema,target,record['allow_migrations'])
 old_image=current_image(project);pg.inspect('image',old_image)
 protected=protected_state(project)
 p.operations(argparse.Namespace(project=project,action='backup'))
 item={'previous_image':old_image,'before_schema':before_schema,'pending_migrations':pending,'started':now(),'state':'in_progress'}
 record[phase]=item;save(release_path(record['id'])/'release.json',record)
 try:
  set_image(project,record['image'])
  p.compose(project,'--profile','setup','--profile','tools','config','--quiet')
  p.compose(project,'stop',*SERVICES)
  p.compose(project,'--profile','setup','run','--rm','--no-deps','bootstrap')
  p.compose(project,'--profile','setup','run','--rm','--no-deps','setup')
  p.compose(project,'up','-d','--no-deps','--wait','--wait-timeout','180',*SERVICES)
  b.smoke(project)
  if schema(project)!=target:raise RuntimeError('Deployed database schema differs from the sealed image')
  if protected_state(project)!=protected:raise RuntimeError('Protected workload identities changed')
  item.update(state='passed',completed=now());record['state']='staging_ready' if phase=='staging' else 'production_live'
 except BaseException:
  item.update(state='failed',completed=now());record['state']=phase+'_failed'
  # An application-only failure can restore code; migrations are never reversed.
  try:
   p.compose(project,'stop',*SERVICES)
  except BaseException:pass
  try:
   if schema(project)==before_schema:
    set_image(project,old_image);p.compose(project,'up','-d','--no-deps','--wait','--wait-timeout','180',*SERVICES);b.smoke(project);item['recovery']='previous code restored'
   else:item['recovery']='schema changed; forward recovery required; old image not restored'
  except BaseException:item['recovery']='manual recovery required'
  save(release_path(record['id'])/'release.json',record);raise
 save(release_path(record['id'])/'release.json',record)
 print('PASS:',record['id'],record['state'],flush=True)

def stage(label,allow,source_commit=None):
 if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}',label):raise ValueError('Use a short release name without special characters')
 b.preflight()
 identifier='release-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8]
 folder=release_path(identifier);folder.mkdir(parents=True,mode=0o700)
 record={'id':identifier,'label':label,'created':now(),'state':'building','allow_migrations':allow}
 save(folder/'release.json',record)
 try:
  tag='kol-realms:'+identifier
  if source_commit:
   with tempfile.TemporaryDirectory(prefix='realms-source-') as snapshot_folder:
    record.update(freeze(source_commit,snapshot_folder));context=Path(snapshot_folder)
    dockerfile=context/'infra/container/Dockerfile.release'
    if not dockerfile.is_file():raise RuntimeError('Source commit needs the monorepo release Dockerfile')
    record['verification']=verification.verify_checkpoint(context,source_commit,identifier,p,pg.inspect)
    save(folder/'release.json',record)
    p.run(p.DOCKER+['build','-f',str(dockerfile),'--build-arg','SOURCE_COMMIT='+source_commit,'-t',tag,str(context)])
  else:
   raise RuntimeError('A recorded source commit is required. Save a checkpoint in Development Studio first.')
  runtime_image=pg.inspect('image',tag)
  if runtime_image['Config'].get('Labels',{}).get('org.opencontainers.image.revision')!=source_commit:raise RuntimeError('Runtime image source label does not match the verified checkpoint')
  record['image']=runtime_image['Id'];record['schema']=image_schema(record['image'])
  record['verification'].update(image=record['image'],schema=record['schema'])
  verification.require_verification(record)
  save(folder/'release.json',record);deploy_project('kol-staging',record,'staging')
 except BaseException:
  if record['state']=='building':record['state']='build_failed';save(folder/'release.json',record)
  raise
 print('Staging is ready. Test it manually before promoting this exact release. Production was not deployed.',flush=True)

def staging_record(identifier):
 record=json.loads((release_path(identifier)/'release.json').read_text())
 if record['state']!='staging_ready':raise RuntimeError('Only a passed staging release can be promoted')
 if current_image('kol-staging')!=record['image'] or schema('kol-staging')!=record['schema']:raise RuntimeError('Staging has changed since this release; restage and retest')
 return record

def verify_staging(identifier,confirmed):
 if not confirmed:raise RuntimeError('Confirm manual staging login and game-action testing first')
 record=staging_record(identifier);b.smoke('kol-staging')
 record['manual_test']={'at':now(),'image':record['image'],'schema':record['schema']}
 save(release_path(identifier)/'release.json',record)
 print('PASS: manual staging test recorded for this exact image and schema')

def promotion_record(identifier):
 record=staging_record(identifier);test=record.get('manual_test',{})
 if test.get('image')!=record['image'] or test.get('schema')!=record['schema'] or not test.get('at'):raise RuntimeError('Record a passed manual staging test before promotion')
 verification.require_verification(record)
 check_schema(schema('kol-production'),record['schema'],record['allow_migrations'])
 return record

def publish_preflight(identifier,source_commit):
 record=promotion_record(identifier)
 if record.get('source_commit')!=source_commit or not re.fullmatch(r'[0-9a-f]{40}',source_commit or ''):raise RuntimeError('Tested build does not match the source checkpoint')
 b.smoke('kol-staging')
 return {'source_commit':source_commit,'release':identifier,'ready_for_publication':True}

def plan(identifier,project):
 record=json.loads((release_path(identifier)/'release.json').read_text())
 current=schema(project);pending=check_schema(current,record['schema'],True)
 return {'release':identifier,'project':project,'image':record['image'],'pending_migrations':pending,'migration_consent':record['allow_migrations'],'manual_test_recorded':bool(record.get('manual_test')),'code_rollback_after_deploy':not pending,'changes':'API, worker, scheduler; data storage retained','mode':'read-only plan; no backup, build or restart performed'}

def promote(identifier,approved):
 if not approved:raise RuntimeError('Explicit production approval is required')
 record=promotion_record(identifier)
 b.smoke('kol-staging');deploy_project('kol-production',record,'production')

def rollback(identifier,project):
 record=json.loads((release_path(identifier)/'release.json').read_text());phase='production' if project=='kol-production' else 'staging';item=record.get(phase,{})
 if item.get('state')!='passed' or item.get('rollback'):raise RuntimeError('No passed deployment available for this rollback')
 if current_image(project)!=record['image']:raise RuntimeError('This release is not currently running')
 if schema(project)!=item['before_schema']:raise RuntimeError('Schema changed; code rollback is unsafe. Use a reviewed forward fix')
 image=item['previous_image'];pg.inspect('image',image)
 if image_schema(image)!=schema(project):raise RuntimeError('Previous image is incompatible with the current schema')
 p.operations(argparse.Namespace(project=project,action='backup'));protected=protected_state(project)
 try:
  p.compose(project,'stop',*SERVICES);set_image(project,image)
  p.compose(project,'up','-d','--no-deps','--wait','--wait-timeout','180',*SERVICES);b.smoke(project)
  if protected_state(project)!=protected:raise RuntimeError('Protected workload identities changed')
 except BaseException:
  item['rollback']='failed; manual recovery required';save(release_path(identifier)/'release.json',record);raise
 item['rollback']='completed';record['state']=phase+'_rolled_back';save(release_path(identifier)/'release.json',record)
 print('PASS: code rolled back; database contents retained',flush=True)

def history():
 result=[]
 for path in sorted(STATE.glob('release-*/release.json'),reverse=True)[:40]:
  try:
   r=json.loads(path.read_text());result.append({k:r.get(k) for k in ('id','label','created','state','image','allow_migrations','manual_test','source_commit','source_repository','verification')})
  except (OSError,ValueError):continue
 return result

def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('action',choices=['stage','promote','rollback','history','verify-staging','plan','preflight']);ap.add_argument('--source-commit');ap.add_argument('--label',default='Game update');ap.add_argument('--release');ap.add_argument('--project',choices=PROJECTS,default='kol-production');ap.add_argument('--allow-migrations',action='store_true');ap.add_argument('--approve-production',action='store_true');ap.add_argument('--confirm-manual-test',action='store_true');args=ap.parse_args()
 if os.geteuid()!=0:ap.error('Administrator authentication is required')
 if args.action=='history':print(json.dumps(history()));return
 if args.action=='preflight':print(json.dumps(publish_preflight(args.release or '',args.source_commit or '')));return
 if args.action=='plan':print(json.dumps(plan(args.release or '',args.project),indent=2));return
 if args.action=='promote':
  if not args.approve_production:raise RuntimeError('Explicit production approval is required')
  promotion_record(args.release or '')
 if args.action=='rollback':release_path(args.release or '')
 if args.action=='stage' and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}',args.label):raise ValueError('Invalid release name')
 if args.action=='stage' and not re.fullmatch(r'[0-9a-f]{40}',args.source_commit or ''):raise ValueError('Save a recorded source checkpoint in Development Studio first')
 if args.action in ('stage','promote','rollback'):
  # Backup script acquires the same lock itself; complete it before this lock.
  p.run(['/usr/bin/python3',str(INFRA/'scripts/local-backups.py'),'run'])
 lockdir=Path('/run/lock/kol-docker');lockdir.mkdir(exist_ok=True,mode=0o700)
 with (lockdir/'operations.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  if args.action=='stage':stage(args.label,args.allow_migrations,args.source_commit)
  elif args.action=='verify-staging':verify_staging(args.release or '',args.confirm_manual_test)
  elif args.action=='promote':promote(args.release or '',args.approve_production)
  else:rollback(args.release or '',args.project)
if __name__=='__main__':
 try:main()
 except (OSError,RuntimeError,ValueError,subprocess.CalledProcessError) as e:raise SystemExit('Release failed: '+str(e))
