"""Local content production workspace. Never connects to a live/staging game database."""
import copy,datetime,difflib,fcntl,hashlib,json,os,re,subprocess,tempfile,uuid
from pathlib import Path
import model

def encoded(value):return (json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
def digest(value):return hashlib.sha256(encoded(value)).hexdigest()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def require(value,message):
 if not value:raise ValueError(message)
def backend(operation,package,**values):
 env={k:v for k,v in os.environ.items() if not k.startswith(('DATABASE_','TEST_DATABASE','PG','AUTH_','SMTP_','REALMS_STUDIO_GITHUB_TOKEN'))}
 result=subprocess.run([model.node(),'--import','tsx','scripts/studio-tool.ts'],cwd=model.ROOT/'realms',env=env,input=json.dumps({'operation':operation,'package':package,**values},allow_nan=False),text=True,capture_output=True,timeout=90)
 if result.returncode:raise ValueError(result.stderr.strip()[-2000:] or 'Backend validation failed.')
 return json.loads(result.stdout)
def publish_fixture(package):
 # The child creates and owns its own PostgreSQL cluster; no URL/role/database is accepted here.
 with tempfile.TemporaryDirectory(prefix='studio-candidate-') as directory:
  source=Path(directory)/'candidate.json';receipt=Path(directory)/'receipt.json';source.write_bytes(encoded(package))
  process=subprocess.Popen(['python3',str(model.ROOT/'infra/scripts/studio-fixture.py'),'--package',str(source),'--receipt',str(receipt),'--confirm-disposable'],cwd=model.ROOT,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={k:v for k,v in os.environ.items() if not k.startswith(('DATABASE_','TEST_DATABASE','PG','AUTH_','SMTP_','REALMS_STUDIO_GITHUB_TOKEN'))})
  try:stdout,stderr=process.communicate(timeout=240)
  except subprocess.TimeoutExpired:
   process.terminate()
   try:process.communicate(timeout=45)
   except subprocess.TimeoutExpired:process.kill();process.communicate()
   raise ValueError('Disposable staging timed out; the owned test cluster was asked to stop.')
  if process.returncode:raise ValueError(stderr.strip()[-2000:] or stdout[-2000:] or 'Disposable publication failed.')
  proof=json.loads(receipt.read_text());require(proof['inputSha256']==hashlib.sha256(source.read_bytes()).hexdigest(),'Publication proof belongs to another package.')
  require(proof['status']=='passed' and proof['scope']=='DISPOSABLE_CLUSTER_ONLY','A disposable publication proof is required.')
  return proof

class Workspace:
 def __init__(self,path,initial=None,check=backend,publisher=publish_fixture):
  self.path=Path(path).absolute();self.check=check;self.publisher=publisher
  require(not self.path.is_symlink(),'Workspace must not be a symbolic link.')
  self.path.mkdir(parents=True,exist_ok=True,mode=0o700);self.file=self.path/'workspace.json'
  if not self.file.exists():
   package=copy.deepcopy(initial if initial is not None else model.load_package())
   self._write({'format':1,'package':package,'metadata':{},'tombstones':{},'candidates':[], 'disabled':False,'events':[]})
 def _write(self,state):
  require(not self.file.is_symlink(),'Workspace file must not be a symbolic link.')
  fd,name=tempfile.mkstemp(prefix='.workspace-',dir=self.path)
  try:
   with os.fdopen(fd,'wb') as f:f.write(encoded(state));f.flush();os.fsync(f.fileno())
   os.replace(name,self.file)
  finally:
   if os.path.exists(name):os.unlink(name)
 def _load(self):
  require(not self.file.is_symlink(),'Workspace file must not be a symbolic link.')
  state=json.loads(self.file.read_text());require(state.get('format')==1,'Unsupported workspace version.')
  for c in state['candidates']:require(digest(c['package'])==c['id'],'Immutable candidate snapshot changed.')
  return state
 def view(self,state=None):
  s=state or self._load();rows=[]
  for e in s['package']['entities']:
   meta=s['metadata'].get(e['id'],{});matching=next((c for c in reversed(s['candidates']) if any(x==e for x in c['package']['entities'])),None)
   rows.append({'id':e['id'],'kind':e['kind'],'name':e['definition']['name'],'revision':e['revision'],'sourceVersion':s['package']['version'],'tags':meta.get('tags',[]),'dependencies':e['definition']['dependencies'],'author':meta.get('author','Imported'),'status':matching['status'] if matching else 'DRAFT','lastChange':meta.get('at','Imported snapshot')})
  for id,t in s['tombstones'].items():rows.append({'id':id,'kind':t['kind'],'name':t['name'],'revision':t['revision'],'sourceVersion':t['sourceVersion'],'tags':[],'dependencies':[],'author':t['author'],'status':'TOMBSTONE','lastChange':t['at'],'replacement':t.get('replacement')})
  return {'etag':digest(s),'package':s['package'],'rows':rows,'disabled':s['disabled'],'candidates':[{k:v for k,v in c.items() if k!='package'} for c in s['candidates']],'events':s['events'][-40:],'retiredEntities':{id:t['entity'] for id,t in s['tombstones'].items() if 'entity' in t}}
 def request(self,operation,data=None,expected=None):
  data=data or {};lock=self.path/'edit.lock';require(not lock.is_symlink(),'Invalid workspace lock.')
  with open(lock,'a',opener=lambda p,f:os.open(p,f,0o600)) as stream:
   fcntl.flock(stream,fcntl.LOCK_EX);s=self._load()
   if operation=='read':return self.view(s)
   if operation in ('analyze','preview','sandbox','diff','rename-plan','export'):
    if operation=='export':
     candidate=self._candidate(s,data['candidate']);require(candidate['status']=='APPROVED','Approve the tested local package before exporting it.')
     return {'filename':'studio-candidate-'+candidate['id'][:16]+'.json','package':copy.deepcopy(candidate['package']),'checksum':candidate['id'],'scope':'LOCAL_REVIEW_ARTIFACT_NO_ACTIVATION'}
    if operation=='diff':
     candidate=self._candidate(s,data['candidate']);old=next((c for c in reversed(s['candidates']) if c['status']=='APPROVED' and c['id']!=candidate['id']),None)
     return {'against':old['id'] if old else 'empty package','diff':'\n'.join(difflib.unified_diff(json.dumps(old['package'] if old else {},indent=2,sort_keys=True).splitlines(),json.dumps(candidate['package'],indent=2,sort_keys=True).splitlines(),fromfile='previous approved',tofile='candidate')),'pinPreview':{'existingRuns':'Remain pinned; no run adoption is performed.','candidateVersion':candidate['package']['version'],'entries':[{'id':e['id'],'revision':e['revision']} for e in candidate['package']['entities']]},'rollback':'Fork an approved snapshot as a NEW draft. Never unseal content, rewind player state, or downgrade incompatible binaries.'}
    if operation=='rename-plan':return self._rename_plan(s,data['id'],data.get('replacement'))
    values={k:data[k] for k in ('known','mode','encounterId','build','seed') if k in data}
    return self.check(operation,s['package'],**values)
   require(expected==digest(s),'Workspace changed in another window. Reload before saving; no changes were overwritten.')
   require(operation in ('save','candidate','stage','approve','disable','rename','tombstone','fork'),'Unknown workspace action.')
   author=data.get('author','').strip();note=data.get('note','').strip();require(0<len(author)<=80,'Enter the author/reviewer name (up to 80 characters).')
   if operation in ('candidate','stage','approve','disable','rename','tombstone','fork'):require(0<len(note)<=2000,'Record a change or review note (up to 2000 characters).')
   if operation=='save':
    e=copy.deepcopy(data['entity']);original=data.get('original');require(e['id'] not in s['tombstones'],'Tombstoned IDs cannot be reused.')
    require(original is None or any(x['id']==original for x in s['package']['entities']),'The edited source no longer exists.')
    old=next((x for x in s['package']['entities'] if x['id']==original),None)
    s['package']=model.update_entity(s['package'],e,original)
    if old and old['definition']!=e['definition']:
     saved=next(x for x in s['package']['entities'] if x['id']==e['id'])
     saved['revision']=max([old['revision']]+[x['revision'] for c in s['candidates'] for x in c['package']['entities'] if x['id']==e['id']])+1
    # Drafts can retain validation errors for repair; only candidates can enter publication.
    tags=data.get('tags',[]);require(isinstance(tags,list) and len(tags)<=30 and all(isinstance(x,str) and re.fullmatch(r'[a-zA-Z0-9_.-]{1,40}',x) for x in tags),'Use up to 30 simple tags.')
    s['metadata'][e['id']]={'author':author,'tags':tags,'at':now()}
   elif operation=='disable':s['disabled']=bool(data['disabled'])
   elif operation in ('rename','tombstone'):
    id=data['id'];replacement=data.get('replacement') if operation=='rename' else None;plan=self._rename_plan(s,id,replacement)
    require(replacement is not None or not plan['inbound'],'Referenced definitions cannot be tombstoned; repair their dependencies first.')
    old=next(e for e in s['package']['entities'] if e['id']==id);s['tombstones'][id]={'entity':copy.deepcopy(old),'kind':old['kind'],'name':old['definition']['name'],'revision':old['revision'],'sourceVersion':s['package']['version'],'replacement':replacement,'author':author,'at':now(),'note':note}
    s['package']['entities']=[e for e in s['package']['entities'] if e['id']!=id]
    if replacement:
     clone=copy.deepcopy(old);clone.update(id=replacement,revision=1);s['package']['entities'].append(clone)
     def replace(value):
      if isinstance(value,str):return replacement if value==id else value
      if isinstance(value,list):return [replace(x) for x in value]
      if isinstance(value,dict):return {k:replace(v) for k,v in value.items()}
      return value
     for e in s['package']['entities']:
      changed=replace(e['definition'])
      if changed!=e['definition']:
       e['definition']=changed;e['revision']=max([e['revision']]+[x['revision'] for c in s['candidates'] for x in c['package']['entities'] if x['id']==e['id']])+1
       s['metadata'][e['id']]={'author':author,'tags':s['metadata'].get(e['id'],{}).get('tags',[]),'at':now()}
     s['metadata'][replacement]={'author':author,'tags':s['metadata'].get(id,{}).get('tags',[]),'at':now()}
    s['package']['version']='authored-'+uuid.uuid4().hex
   elif operation=='fork':
    c=self._candidate(s,data['candidate']);require(c['status']=='APPROVED','Only an approved historical snapshot can be forked for rollback review.')
    s['package']=copy.deepcopy(c['package']);s['package']['version']='rollback-review-'+uuid.uuid4().hex
    require(not any(e['id'] in s['tombstones'] for e in s['package']['entities']),'This snapshot contains tombstoned IDs. Duplicate/review those identities instead of resurrecting them.')
   elif operation=='candidate':
    require(not s['disabled'],'Workspace publication is disabled. Read/history/sandbox remain available.')
    analysis=self.check('analyze',s['package']);require(analysis['valid'],'Fix package diagnostics before creating a candidate.')
    prior={(e['id'],e['revision']):digest(e) for c in s['candidates'] for e in c['package']['entities']}
    require(all(prior.get((e['id'],e['revision']),digest(e))==digest(e) for e in s['package']['entities']),'An immutable revision was reused with changed content. Save a new revision.')
    id=digest(s['package']);require(not any(c['id']==id for c in s['candidates']),'This exact candidate already exists.')
    require(len(s['candidates'])<50,'Workspace has 50 retained candidates; archive this workspace and create another.')
    s['candidates'].append({'id':id,'status':'CANDIDATE','package':copy.deepcopy(s['package']),'author':author,'created':now(),'notes':[{'author':author,'note':note,'at':now()}]})
   else:
    require(not s['disabled'],'Workspace publication is disabled.')
    c=self._candidate(s,data['candidate'])
    if operation=='stage':
     require(c['status']=='CANDIDATE','Only a candidate can enter disposable staging.')
     proof=self.publisher(copy.deepcopy(c['package']))
     require(proof.get('status')=='passed' and proof.get('scope')=='DISPOSABLE_CLUSTER_ONLY' and proof.get('inputSha256')==c['id'] and proof.get('clusterStopped') is True and proof.get('sealed') is True,'Disposable staging proof is incomplete or belongs to another package.')
     c['proof']=proof;c['status']='STAGING'
    elif operation=='approve':
     require(c['status']=='STAGING' and c.get('proof',{}).get('status')=='passed','A successful disposable staging proof is required before approval.')
     require(data.get('confirmed') is True,'Review the diff, test result and release-pin preview before approving.')
     c['status']='APPROVED'
    c['notes'].append({'author':author,'note':note,'at':now()})
   s['events'].append({'operation':operation,'author':author,'note':note,'at':now()});s['events']=s['events'][-500:];self._write(s);return self.view(s)
 def _candidate(self,s,id):
  found=next((c for c in s['candidates'] if c['id']==id),None);require(found is not None,'Select an existing candidate.');return found
 def _rename_plan(self,s,id,replacement):
  require(any(e['id']==id for e in s['package']['entities']),'Select an active definition.')
  if replacement:
   require(re.fullmatch(r'[a-z][a-z0-9_.-]{2,119}',replacement),'Use a new valid stable ID.')
   reserved={e['id'] for e in s['package']['entities']}|set(s['tombstones'])|{e['id'] for c in s['candidates'] for e in c['package']['entities']}
   require(replacement not in reserved,'Replacement IDs must never have been used in this workspace.')
  def mentions(value):
   if isinstance(value,str):return value==id
   if isinstance(value,list):return any(mentions(x) for x in value)
   if isinstance(value,dict):return any(mentions(x) for x in value.values())
   return False
  inbound=[e['id'] for e in s['package']['entities'] if e['id']!=id and mentions(e['definition'])]
  return {'id':id,'replacement':replacement,'inbound':inbound,'effect':'New identity plus tombstone; inbound exact-ID references get NEW revisions. Released snapshots and old pins remain unchanged.'}
