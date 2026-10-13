#!/usr/bin/env python3
"""Capture application artifacts only; no database, environment or secret exports."""
import hashlib,io,json,os,subprocess,tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
DEST=ROOT/'.development/live-artifacts'
if os.geteuid()!=0:raise SystemExit('Administrator authentication is required to read the live container.')
def command(*args):return subprocess.check_output(['docker','--host','unix:///var/run/docker.sock',*args],timeout=120)
cids=command('ps','--filter','label=com.docker.compose.project=kol-production','--filter','label=com.docker.compose.service=api','-q').decode().split()
if len(cids)!=1:raise SystemExit('Expected one running production API.')
cid=cids[0];image=command('inspect','--format','{{.Image}}',cid).decode().strip()
if DEST.parent.is_symlink():raise SystemExit('Capture parent must not be a symbolic link.')
owner=ROOT.stat()
if DEST.parent.exists():os.chown(DEST.parent,owner.st_uid,owner.st_gid);DEST.parent.chmod(0o700)
if DEST.exists():raise SystemExit('Existing live capture preserved; private development-folder ownership verified.')
DEST.mkdir(parents=True,mode=0o700);os.chown(DEST.parent,owner.st_uid,owner.st_gid);DEST.parent.chmod(0o700);files={}
for area in ('dist','client','package.json'):
 data=command('cp',cid+':/app/'+area,'-')
 with tarfile.open(fileobj=io.BytesIO(data)) as archive:
  for entry in archive:
   if entry.isdir():continue
   if not entry.isfile() or entry.size>16*1024*1024:raise SystemExit('Unexpected application artifact.')
   relative=Path(entry.name)
   if relative.is_absolute() or '..' in relative.parts:raise SystemExit('Unsafe artifact path.')
   target=DEST/relative;target.parent.mkdir(parents=True,exist_ok=True)
   content=archive.extractfile(entry).read();target.write_bytes(content);files[str(relative)]=hashlib.sha256(content).hexdigest()
if command('inspect','--format','{{.Image}}',cid).decode().strip()!=image:raise SystemExit('Live image changed during capture.')
(DEST/'capture.json').write_text(json.dumps({'image':image,'project':'kol-production','files':files,'note':'Deployed JavaScript/client artifacts; original TypeScript is not embedded.'},indent=2))
for p in [DEST,*DEST.rglob('*')]:os.chown(p,owner.st_uid,owner.st_gid);p.chmod(0o700 if p.is_dir() else 0o600)
print('Live application artifacts captured privately. Databases and settings were not exported.')
