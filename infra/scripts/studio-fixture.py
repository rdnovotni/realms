#!/usr/bin/env python3
"""One-command fixture publication. Always owns a new disposable cluster; accepts no DB URL."""
import argparse,hashlib,json,os,shutil,signal,socket,subprocess,tempfile,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]

def executable(name,folder):
 choices=[folder/name] if folder else []
 choices += [Path('/srv/Realms/native/realms/.local/postgresql/usr/lib/postgresql/18/bin')/name]
 found=shutil.which(name)
 if found:choices.append(Path(found))
 for choice in choices:
  if choice.is_file():return str(choice)
 raise ValueError('Local PostgreSQL client/server tools are required: '+name)

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--package',type=Path,required=True);parser.add_argument('--receipt',type=Path,required=True);parser.add_argument('--pg-bin',type=Path);parser.add_argument('--confirm-disposable',action='store_true');args=parser.parse_args()
 if not args.confirm_disposable:parser.error('Pass --confirm-disposable; this creates only a new temporary cluster.')
 if args.receipt.exists():parser.error('Choose a new receipt path; proof files are not overwritten.')
 if os.geteuid()==0:parser.error('Run as a normal development user, not root.')
 data=args.package.read_bytes();json.loads(data);initdb=executable('initdb',args.pg_bin);pg_ctl=executable('pg_ctl',args.pg_bin);createdb=executable('createdb',args.pg_bin)
 env={k:v for k,v in os.environ.items() if not k.startswith(('DATABASE_','TEST_DATABASE','PG','AUTH_','SMTP_','REALMS_STUDIO_GITHUB_TOKEN'))}
 libs=Path('/srv/Realms/native/realms/.local/postgresql/usr/lib/x86_64-linux-gnu')
 if libs.is_dir():env['LD_LIBRARY_PATH']=str(libs)+(os.pathsep+env['LD_LIBRARY_PATH'] if env.get('LD_LIBRARY_PATH') else '')
 def run(command,timeout=90):return subprocess.run(command,env=env,check=True,text=True,capture_output=True,timeout=timeout)
 # SIGTERM from the Studio timeout enters finally so the owned server is stopped.
 signal.signal(signal.SIGTERM,lambda *_:(_ for _ in ()).throw(SystemExit('Fixture publication stopped')))
 with tempfile.TemporaryDirectory(prefix='follybound-studio-',dir='/tmp') as folder:
  base=Path(folder);pgdata=base/'pgdata';package=base/'candidate.json';package.write_bytes(data);token=uuid.uuid4().hex
  (base/'disposable.json').write_text(json.dumps({'directory':str(pgdata),'token':token}));(base/'disposable.json').chmod(0o600)
  with socket.socket() as probe:probe.bind(('127.0.0.1',0));port=probe.getsockname()[1]
  started=False
  try:
   run([initdb,'-D',str(pgdata),'-U','studio_fixture','-A','trust','--no-locale','--encoding=UTF8'])
   run([pg_ctl,'-D',str(pgdata),'-l',str(base/'postgres.log'),'-o',f'-h 127.0.0.1 -p {port} -k {base}','-w','start']);started=True
   run([createdb,'-h','127.0.0.1','-p',str(port),'-U','studio_fixture','realms_test'])
   env.update(TEST_DATABASE_URL=f'postgresql://studio_fixture@127.0.0.1:{port}/realms_test',M02_DISPOSABLE_DATA_DIR=str(pgdata),M02_DISPOSABLE_TOKEN=token)
   node=Path('/srv/Realms/native/realms/.local/node/bin/node');node=str(node) if node.is_file() else shutil.which('node')
   if not node:raise ValueError('Node.js is required.')
   result=subprocess.run([node,'--import','tsx','scripts/studio-publish.ts',str(package)],cwd=ROOT/'realms',env=env,check=True,text=True,capture_output=True,timeout=180)
   proof=json.loads(result.stdout);proof['clusterStopped']=False
  finally:
   if started:run([pg_ctl,'-D',str(pgdata),'-m','immediate','-w','stop'],timeout=30)
  proof['clusterStopped']=True
  tracked=subprocess.check_output(['git','ls-files','realms/src','realms/migrations','realms/scripts','infra/development_client','infra/scripts/studio-fixture.py'],cwd=ROOT,text=True).splitlines()
  relevant=set(tracked)|{str(p.relative_to(ROOT)) for parent,glob in [('realms/src','*.ts'),('realms/scripts','studio-*.ts'),('infra/development_client','*.py')] for p in (ROOT/parent).rglob(glob)}
  proof['implementationSha256']=hashlib.sha256(json.dumps({p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in sorted(relevant) if (ROOT/p).is_file()},sort_keys=True,separators=(',',':')).encode()).hexdigest()
  proof['sourceCommit']=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip();proof['sourceDirty']=bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip())
  args.receipt.parent.mkdir(parents=True,exist_ok=True)
  with args.receipt.open('x') as f:json.dump(proof,f,indent=2);f.write('\n')
  args.receipt.chmod(0o600);print(json.dumps({'status':proof['status'],'receipt':str(args.receipt),'release':proof['contentReleaseId'],'clusterStopped':True}))

if __name__=='__main__':
 try:main()
 except (ValueError,subprocess.SubprocessError) as e:
  detail=getattr(e,'stderr','') or str(e);raise SystemExit(detail[-3000:])
