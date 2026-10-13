#!/usr/bin/env python3
"""Report source/runtime identity without credentials or player payloads; default uses cached observations."""
import argparse,hashlib,importlib.util,json,os,re,subprocess
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
CACHE=Path('/run/realms-console/status.json')

def git(root,*args):return subprocess.check_output(['git','-C',str(root),*args],text=True,timeout=20).strip()
def schemas(root):
 return [{'name':p.name,'checksum':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted((root/'realms/migrations').glob('*.sql'))]
def report(root,cache,live=None):
 head=git(root,'rev-parse','HEAD');changes=git(root,'status','--porcelain')
 try:remote=git(root,'rev-parse','origin/main')
 except subprocess.CalledProcessError:remote=None
 package=json.loads((root/'realms/content/game.json').read_text())
 observed=[]
 for project in ('kol-production','kol-staging'):
  c=next((c for c in cache.get('containers',[]) if c.get('project')==project and c.get('service')=='api'),{})
  release=next((x for x in cache.get('releases',[]) if x.get('image')==c.get('image') and x.get('state')=='production_live'),{}) if project=='kol-production' else next((x for x in cache.get('releases',[]) if x.get('image')==c.get('image') and x.get('state') in ('staging_ready','production_live')), {})
  row={'project':project,'image':c.get('image'),'health':cache.get('health',{}).get(project),
   'source_commit':release.get('source_commit'),'source_evidence':'release record' if release.get('source_commit') else 'unknown; image identity alone is not source provenance',
   'schema':None,'content_releases':None}
  if live and project in live:row.update(live[project])
  observed.append(row)
 return {'captured_at':datetime.now(timezone.utc).isoformat(),'mode':'live read-only inspection' if live else 'cached observations; no live database query',
  'source':{'repository':'https://github.com/rdnovotni/realms','checkout':str(root),'commit':head,'tree':git(root,'rev-parse','HEAD^{tree}'),
   'last_fetched_main':remote,'clean':not bool(changes),'migration_manifest':schemas(root),
   'authored_package':{'version':package.get('version'),'engine_version':package.get('engineVersion'),'entities':len(package.get('entities',[]))}},
  'observations_at':cache.get('captured_at'),'environments':observed,
  'native':{'runtime':'/srv/Realms/native/realms','role':'separate legacy/local game store; not the public container source','health':cache.get('health',{}).get('native'),**((live or {}).get('native',{}))},
  'public_authority':{'project':'kol-production','verification':'pending live ingress inspection','native_data_cutover':'not implied by source reconciliation'},
  'acceptance':cache.get('readiness',[]),'backup':{k:cache.get('backup',{}).get(k) for k in ('last_result','last_success','last_restore_success')},
  'limitations':['Last fetched main is not a fresh remote query.','Cached health is timestamped evidence, not live certification.','Unknown source labels must remain unknown.']}

def inspect_live(root):
 spec=importlib.util.spec_from_file_location('baseline_releases',root/'infra/scripts/releases.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 result={}
 for project in ('kol-production','kol-staging'):
  image=m.current_image(project);info=m.pg.inspect('image',image);label=info['Config'].get('Labels',{}).get('org.opencontainers.image.revision')
  label=label if isinstance(label,str) and re.fullmatch(r'[0-9a-f]{40}',label) else None
  # Only non-player release metadata and aggregate membership counts are returned.
  sql="BEGIN READ ONLY; SELECT coalesce(json_agg(t ORDER BY version),'[]'::json) FROM (SELECT r.id,r.version,r.engine_version,r.checksum,r.sealed,(SELECT count(*) FROM release_entries e WHERE e.release_id=r.id) AS entities,(SELECT count(*) FROM runs x WHERE x.content_release_id=r.id AND x.status IN ('ACTIVE','AFTERCORE')) AS current_runs FROM content_releases r) t; COMMIT;"
  data=m.p.compose(project,'exec','-T','db','psql','-X','-qAt','-U','postgres','-d',m.p.read_database_name(project),'-c',sql,stdout=subprocess.PIPE,text=True).stdout
  result[project]={'image':image,'source_commit':label,'source_evidence':'immutable image revision label' if label else 'legacy image without source label',
   'schema':m.schema(project),'content_releases':json.loads(data.strip())}
 # Inspect the separate native store through its own private configuration, never through container credentials.
 native=Path('/srv/Realms/native/realms')
 script="""const pg=require('./node_modules/pg'); const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,statement_timeout:5000}); (async()=>{const c=await pool.connect();try{await c.query('BEGIN READ ONLY');const schema=(await c.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).rows;const content=(await c.query('SELECT id,version,engine_version,checksum,sealed FROM content_releases ORDER BY version')).rows;await c.query('COMMIT');console.log(JSON.stringify({schema,content_releases:content}));}finally{c.release();await pool.end();}})().catch(()=>{console.error('Native read-only database inspection failed');process.exitCode=1;});"""
 raw=subprocess.run([str(native/'.local/node/bin/node'),'--env-file=.env','-e',script],cwd=native,capture_output=True,text=True,timeout=30)
 if raw.returncode:raise RuntimeError('Native read-only inspection failed; inspect configuration locally without sharing credentials')
 result['native']=json.loads(raw.stdout)
 return result

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--live',action='store_true');args=parser.parse_args()
 if args.live and os.geteuid()!=0:parser.error('Live Docker/database inspection requires Ubuntu administrator authentication.')
 try:cache=json.loads(CACHE.read_text())
 except (OSError,ValueError):cache={}
 live=inspect_live(ROOT) if args.live else None
 value=report(ROOT,cache,live)
 if args.live:
  edge=Path('/srv/Realms/projects/kol-edge/Caddyfile')
  targets=re.findall(r'(?m)^\s*reverse_proxy\s+(\S+)\s*\{',edge.read_text()) if edge.is_file() else []
  value['public_authority']['verification']='live ingress configuration targets production port 13000' if targets and set(targets)=={'127.0.0.1:13000'} else 'unverified; inspect ingress locally'
 print(json.dumps(value,indent=2))
if __name__=='__main__':main()
