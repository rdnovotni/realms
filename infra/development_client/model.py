"""Content drafts and Git operations against the one canonical source checkout."""
import copy,hashlib,json,os,re,subprocess,tempfile,uuid,fcntl
from functools import wraps
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
CONTENT=ROOT/'realms/content/game.json'
KINDS=('ITEM','EFFECT','ABILITY','CLASS','SPECIES','MONSTER','NPC','ENCOUNTER','QUEST','RECIPE','LOCATION','ROUTE','FACTION','PATH','EVENT','ACTIVITY','CARD','FAMILIAR','BOSS','LOOT_TABLE','LORE','TUNING','SKILL')
AUTH_TOKEN=''
REPOSITORY='https://github.com/rdnovotni/realms.git'
EXCLUDED={'.git','.development','.state','.local','node_modules','dist','secrets','__pycache__'}
def allowed(path):
 p=Path(path)
 if not p.parts:return False
 return not p.is_absolute() and '..' not in p.parts and not any(x in EXCLUDED for x in p.parts) and not any(x.startswith('.env') and not x.endswith('.example') for x in p.parts) and p.suffix not in ('.dump','.pyc','.log','.key','.pem') and (p.parts[0] in ('realms','infra','.github') or str(p) in ('.gitignore','AGENTS.md','README.md'))
def git(*args,root=ROOT):
 env=dict(os.environ);env['GIT_TERMINAL_PROMPT']='0'
 if AUTH_TOKEN:env.update(REALMS_STUDIO_GITHUB_TOKEN=AUTH_TOKEN,GIT_ASKPASS=str(ROOT/'infra/development_client/askpass.py'))
 result=subprocess.run(['git',*(['-c','credential.helper='] if AUTH_TOKEN else []),*args],cwd=root,env=env,text=True,capture_output=True,timeout=120)
 if result.returncode:raise RuntimeError(result.stderr.strip() or 'Git operation failed. Configure GitHub authentication on this computer.')
 return result.stdout.strip()
def head():return git('rev-parse','HEAD')
def managed_changes():
 names=git('diff','--name-only','HEAD').splitlines()+git('ls-files','--others','--exclude-standard').splitlines()
 return sorted({name for name in names if allowed(name)})
def assert_master():
 if git('remote','get-url','origin') not in (REPOSITORY,'git@github.com:rdnovotni/realms.git'):raise RuntimeError('The source must use the verified Follybound GitHub repository.')
 if git('branch','--show-current')!='main':raise RuntimeError('Switch the canonical source to main before using this workflow.')
 for name in git('ls-files').splitlines():
  if not allowed(name):raise RuntimeError('Tracked file outside the approved source layout: '+name)
def source_lock(fn):
 @wraps(fn)
 def locked(*args,**kwargs):
  folder=ROOT/'.development';folder.mkdir(parents=True,exist_ok=True,mode=0o700)
  with open(folder/'source-edit.lock','a',opener=lambda p,flags:os.open(p,flags,0o600)) as lock:
   fcntl.flock(lock,fcntl.LOCK_EX)
   return fn(*args,**kwargs)
 return locked
@source_lock
def synchronize():
 assert_master()
 if managed_changes():raise RuntimeError('Save a source checkpoint before downloading changes. Local edits will not be overwritten.')
 git('fetch','origin','main');git('merge','--ff-only','origin/main')
 return 'GitHub main synchronized. The live server has not been deployed.'
@source_lock
def checkpoint(message):
 assert_master()
 if not message.strip():raise ValueError('Name this source checkpoint.')
 changes=managed_changes()
 if not changes:return head()
 # Explicit paths prevent private runtime state or other host files entering a commit.
 for name in changes:
  if (ROOT/name).is_symlink():raise RuntimeError('Source symlinks are not accepted: '+name)
 git('add','--',*changes)
 staged=git('diff','--cached','--name-only').splitlines()
 if any(not allowed(name) for name in staged):raise RuntimeError('Unapproved files are staged. Review Git status before committing.')
 git('commit','-m',message)
 return head()
def push_master(expected):
 assert_master()
 if head()!=expected or managed_changes():raise RuntimeError('Source changed after the tested build. Save a new checkpoint, rebuild and retest.')
 git('fetch','origin','main')
 git('merge-base','--is-ancestor','origin/main',expected)
 git('push','origin',expected+':refs/heads/main')
 return 'GitHub main updated to the tested source commit. Live deployment is the next phase.'
def read_package(path=CONTENT):
 try:data=path.read_bytes()
 except FileNotFoundError:return {'version':'draft-1','engineVersion':'foundation-1','entities':[]},'absent'
 return json.loads(data),hashlib.sha256(data).hexdigest()
def load_package(path=CONTENT):return read_package(path)[0]
def saved_package_digest(package):return hashlib.sha256((json.dumps(package,indent=2)+'\n').encode()).hexdigest()
def update_entity(package,entity,original=None):
 result=copy.deepcopy(package)
 if not re.fullmatch(r'[a-z][a-z0-9_.-]{2,119}',entity.get('id','')):raise ValueError('Use an ID like item.iron_sword (letters, digits, dots, underscores or hyphens).')
 if entity.get('kind') not in KINDS:raise ValueError('Select an existing content type.')
 if original and entity['id']!=original:raise ValueError('Existing IDs cannot be renamed. Duplicate the definition with a new ID instead.')
 existing=next((e for e in result['entities'] if e['id']==entity['id']),None)
 if existing and original is None:raise ValueError('That content ID already exists.')
 if existing:
  if existing.get('kind')!=entity['kind']:raise ValueError('Existing content types cannot be changed.')
  entity=copy.deepcopy(entity);entity['revision']=existing['revision']+(entity['definition']!=existing['definition'])
  result['entities']=[entity if e['id']==original else e for e in result['entities']]
 else:result['entities'].append(copy.deepcopy(entity))
 result['version']='authored-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8]
 return result
def node():
 for file in (Path('/srv/Realms/native/realms/.local/node/bin/node'),ROOT/'realms/.local/node/bin/node'):
  if file.is_file():return str(file)
 return 'node'
def validate_package(package):
 env=dict(os.environ)
 for key in list(env):
  if key.startswith(('DATABASE_','PG','AUTH_','SMTP_')):env.pop(key)
 result=subprocess.run([node(),'--import','tsx','scripts/content-check.ts'],cwd=ROOT/'realms',env=env,input=json.dumps(package),text=True,capture_output=True,timeout=60)
 if result.returncode:
  detail=result.stderr.strip();explanations={'MISSING_CONTENT_DEPENDENCY':'A dependency ID is missing from this package. Add it or correct the dependency list.','CYCLIC_CONTENT_DEPENDENCY':'Definitions depend on each other in a loop. Remove the circular dependency.','INVALID_ITEM_INVENTORY_SPEC':'Equipment needs INSTANCE storage. Materials and consumables need STACK storage.','DUPLICATE_CONTENT_ID':'Two definitions use the same permanent ID. Give the new definition a unique ID.','INVALID_CONTENT_PACKAGE':'Check the name, ID, type, JSON fields and required package properties.'}
  raise ValueError(explanations.get(detail,detail or 'The backend rejected this content package.'))
 return result.stdout.strip()
def package_digest(path=CONTENT):
 return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else 'absent'
@source_lock
def save_package(package,path=CONTENT,expected_digest=None):
 validate_package(package)
 if expected_digest is not None and package_digest(path)!=expected_digest:raise ValueError('Saved content changed outside this window. Reload the current source before editing; your draft was not written over it.')
 path.parent.mkdir(parents=True,exist_ok=True)
 if path.is_symlink():raise ValueError('Content file must not be a symbolic link.')
 if path.exists():
  history=ROOT/'.development/content-history';history.mkdir(parents=True,exist_ok=True,mode=0o700)
  data=path.read_bytes();prior=history/(hashlib.sha256(data).hexdigest()+'.json')
  if not prior.exists():prior.write_bytes(data);prior.chmod(0o600)
 fd,temp=tempfile.mkstemp(prefix='.game-',suffix='.json',dir=path.parent)
 try:
  with os.fdopen(fd,'w') as f:json.dump(package,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
  os.replace(temp,path)
 finally:
  if os.path.exists(temp):os.unlink(temp)
 return 'Content saved and validated. It is not active on a server yet.'

def publish_tested(release,commit,preflight,push,promote):
 # A failed or interrupted push must remain distinguishable from a completed push.
 preflight()
 record_publication(release,commit,'github_push_started_live_not_started')
 try:push(commit)
 except Exception:
  record_publication(release,commit,'github_push_needs_review_live_not_started')
  raise
 record_publication(release,commit,'github_updated_live_pending')
 try:result=promote()
 except Exception as exc:
  record_publication(release,commit,'github_updated_live_needs_review')
  raise RuntimeError('GitHub was updated, but live deployment did not finish. Inspect the recorded image and Server Console before retrying; player data must not be rewound.') from exc
 record_publication(release,commit,'github_and_live_completed')
 return result

def publication_history():
 try:return json.loads((ROOT/'.development/publications.json').read_text())
 except (OSError,ValueError):return []
def record_publication(release,commit,state):
 path=ROOT/'.development/publications.json';path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 values=publication_history()+[{'release':release,'source_commit':commit,'state':state,'at':datetime.now(timezone.utc).isoformat()}]
 fd,temp=tempfile.mkstemp(prefix='.publication-',dir=path.parent)
 try:
  with os.fdopen(fd,'w') as f:json.dump(values[-40:],f,indent=2);f.flush();os.fsync(f.fileno())
  os.replace(temp,path)
 finally:
  if os.path.exists(temp):os.unlink(temp)
