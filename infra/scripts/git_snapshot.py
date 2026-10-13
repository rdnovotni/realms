"""Freeze a recorded commit without checkout/reset or trusting archive attributes."""
import hashlib,io,re,subprocess,tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def freeze(commit,destination,root=ROOT):
 if not re.fullmatch(r'[0-9a-f]{40}',commit):raise ValueError('A full Git source commit is required')
 def git(*args):return subprocess.check_output(['git','-c','safe.directory='+str(root),'-C',str(root),*args],timeout=60)
 if git('rev-parse',commit+'^{commit}').decode().strip()!=commit:raise ValueError('Unknown source commit')
 entries={}
 for item in git('ls-tree','-rz',commit).split(b'\0'):
  if not item:continue
  metadata,name=item.split(b'\t');mode,kind,digest=metadata.decode().split();name=name.decode()
  p=Path(name)
  if p.is_absolute() or '..' in p.parts or mode not in ('100644','100755') or kind!='blob':raise ValueError('Source must contain regular files only')
  if any(part in ('.state','.local','node_modules','dist','secrets','.git','.development') for part in p.parts) or any(part.startswith('.env') and not part.endswith('.example') for part in p.parts) or p.suffix in ('.pem','.key','.dump'):raise ValueError('Private or generated files are tracked in source')
  entries[name]=(mode,digest)
 data=git('archive','--format=tar',commit)
 if len(data)>256*1024*1024:raise ValueError('Source snapshot exceeds the size budget')
 seen=set()
 with tarfile.open(fileobj=io.BytesIO(data)) as archive:
  for member in archive:
   if member.isdir():continue
   if not member.isfile() or member.name not in entries or member.size>32*1024*1024:raise ValueError('Unexpected source archive entry')
   value=archive.extractfile(member).read();digest=hashlib.sha1(b'blob '+str(len(value)).encode()+b'\0'+value).hexdigest()
   if digest!=entries[member.name][1]:raise ValueError('Git attributes transformed the source; exact source is required')
   path=Path(destination)/member.name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(value);path.chmod(0o755 if entries[member.name][0]=='100755' else 0o644);seen.add(member.name)
 if seen!=set(entries):raise ValueError('Git attributes omitted source files')
 return {'source_commit':commit,'source_repository':'https://github.com/rdnovotni/realms','source_files':len(seen)}
