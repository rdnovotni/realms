"""Verify a frozen checkpoint against disposable PostgreSQL; never joins live networks."""
import json,os,re,secrets,subprocess,tempfile,time,uuid
from pathlib import Path
CHECKS=['typecheck','unit','content','build','integration','workers','runtime']

def verify_checkpoint(context,commit,identifier,p,inspect):
 if not re.fullmatch(r'[0-9a-f]{40}',commit):raise ValueError('Full source commit required')
 tag='kol-realms:'+identifier+'-verification'
 p.run(p.DOCKER+['build','--target','verification','-f',str(context/'infra/container/Dockerfile.release'),
  '--build-arg','SOURCE_COMMIT='+commit,'-t',tag,str(context)])
 image=inspect('image',tag)
 if image['Config'].get('Labels',{}).get('org.opencontainers.image.revision')!=commit:
  raise RuntimeError('Verification image source label does not match the checkpoint')
 name='realms-verify-'+uuid.uuid4().hex;network=name+'-network';db=name+'-db';test=name+'-tests';volume=name+'-data'
 postgres=json.loads((context/'infra/container/images.lock.json').read_text())['postgres']
 if not re.fullmatch(r'postgres:[^@]+@sha256:[0-9a-f]{64}',postgres):raise ValueError('Pinned PostgreSQL image required')
 created_network=False;created_volume=False;created_db=False;test_started=False
 with tempfile.TemporaryDirectory(prefix='realms-verification-') as directory:
  password=secrets.token_hex(32)
  db_env=Path(directory)/'database.env';test_env=Path(directory)/'test.env'
  for path,content in [(db_env,'POSTGRES_DB=realms_test\nPOSTGRES_USER=realms\nPOSTGRES_PASSWORD='+password+'\n'),
    (test_env,'TEST_DATABASE_URL=postgresql://realms:'+password+'@'+db+':5432/realms_test\n')]:
   path.touch(mode=0o600);path.write_text(content)
  try:
   p.run(p.DOCKER+['network','create','--internal','--label','realms.release-verification=true',network]);created_network=True
   created_volume=True
   p.run(p.DOCKER+['volume','create','--label','realms.release-verification=true',volume])
   # Mark before invocation so interrupted Docker replies still get scoped cleanup.
   created_db=True
   p.run(p.DOCKER+['run','-d','--name',db,'--network',network,'--label','realms.release-verification=true',
    '--env-file',str(db_env),'--mount','type=volume,source='+volume+',target=/var/lib/postgresql','--memory','768m','--cpus','1',
    '--pids-limit','256',postgres],timeout=180)
   for attempt in range(90):
    ready=subprocess.run(p.DOCKER+['exec',db,'pg_isready','-h','127.0.0.1','-U','realms','-d','realms_test'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
    if ready.returncode==0:break
    time.sleep(1)
   else:raise RuntimeError('Disposable verification database did not become ready')
   test_started=True
   p.run(p.DOCKER+['run','--rm','--name',test,'--network',network,'--label','realms.release-verification=true',
    '--env-file',str(test_env),'--memory','1g','--cpus','2','--pids-limit','256','--cap-drop','ALL',
    '--security-opt','no-new-privileges:true',image['Id']],timeout=1200)
   return {'status':'passed','source_commit':commit,'verification_image':image['Id'],'checks':CHECKS.copy()}
  except Exception:
   try:
    state=inspect('container',db).get('State',{})
    print('Disposable verification database:',json.dumps({k:state.get(k) for k in ('Status','ExitCode','OOMKilled')}),flush=True)
   except Exception:pass
   raise
  finally:
   failures=[]
   for kind,resource,created in [('container',test,test_started),('container',db,created_db),('volume',volume,created_volume),('network',network,created_network)]:
    if not created:continue
    # A --rm test container may already be absent. Inspect before removing only our UUID resource.
    exists=subprocess.run(p.DOCKER+[kind,'inspect',resource],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)
    if exists.returncode==0:
     command=p.DOCKER+(['rm','-f',resource] if kind=='container' else [kind,'rm',resource])
     if subprocess.run(command,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30).returncode:failures.append(resource)
   if failures:raise RuntimeError('Verification resource cleanup failed; inspect the release-verification labels locally')

def require_verification(record):
 proof=record.get('verification',{})
 if (proof.get('status')!='passed' or not re.fullmatch(r'[0-9a-f]{40}',record.get('source_commit',''))
  or proof.get('source_commit')!=record.get('source_commit') or proof.get('image')!=record.get('image')
  or proof.get('schema')!=record.get('schema') or proof.get('checks')!=CHECKS):
  raise RuntimeError('Exact-checkpoint automated verification is missing or changed; create a new verified staging build')
