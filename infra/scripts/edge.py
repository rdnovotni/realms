#!/usr/bin/env python3
"""Stage a loopback proxy; public tunnel activation is a separate explicit action."""
import argparse,fcntl,hashlib,importlib.util,json,os,re,shutil,socket,subprocess,time,urllib.request,urllib.error,uuid
from pathlib import Path
INFRA=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('edge_backend',INFRA/'scripts/backend.py');b=importlib.util.module_from_spec(s);s.loader.exec_module(b)
p=b.p;pg=b.pg
ROOT=p.BASE/'kol-edge';STATE=p.STATE_BASE/'infra-009'
TEMPLATE=INFRA/'compose/edge'
def hostname(value):
 if not re.fullmatch(r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}',value):raise ValueError('Use a lowercase DNS hostname, without URL/path/port.')
 return value

def approved_paths():
 paths=json.loads((TEMPLATE/'public-api-paths.json').read_text())
 static=['/','/about','/announcements','/changelog','/guide','/community','/newsletter','/privacy','/monetization','/contact','/health/live']
 # Enumerated assets and APIs: future admin routes are denied unless explicitly reviewed.
 assets=json.loads((TEMPLATE/'public-client-assets.json').read_text())
 if not isinstance(assets,list) or not all(isinstance(x,str) and re.fullmatch(r'/assets/(?:items/)?[a-z0-9][a-z0-9-]*\.(?:css|js|svg|webp)',x) for x in assets):raise ValueError('Invalid reviewed client asset manifest')
 static+=assets
 parts=[re.escape(x) for x in static]
 # Matches the authenticated server's bounded, public raster-art route only.
 parts.append(r'/assets/items/authored/[a-z0-9][a-z0-9_-]{0,79}\.(png|webp|jpg|avif)')
 for path in paths:parts.append('/'.join('[^/]+' if part.startswith(':') else re.escape(part) for part in path.split('/')))
 return '^('+'|'.join(parts)+')$'

def render(host,key):
 hostname(host)
 if not re.fullmatch('[0-9a-f]{64}',key):raise ValueError('Invalid private ingress credential')
 return (TEMPLATE/'Caddyfile.template').read_text().replace('__PUBLIC_HOST__',host).replace('__INGRESS_KEY__',key).replace('__APPROVED_PATHS__',approved_paths())
def write(path,text,mode=0o444):
 # Root-only ancestor protects credentials; container bind files must be readable by its UID.
 if path.is_symlink():raise ValueError('Refusing symbolic-link deployment file')
 path.write_text(text);path.chmod(mode)
def compose(*args,capture=False):
 cmd=p.DOCKER+['compose','--project-directory',str(ROOT),'--env-file',str(ROOT/'.env'),'-f',str(ROOT/'compose.yaml'),*args]
 if capture:
  result=subprocess.run(cmd,capture_output=True,text=True)
  if result.returncode:
   STATE.mkdir(parents=True,exist_ok=True,mode=0o700)
   log=STATE/'last-edge-command-error.log'
   write(log,result.stdout+'\n'+result.stderr,0o600)
   summaries=[]
   for line in result.stderr.splitlines():
    if re.search(r'error|failed|denied|not found|unknown|invalid|unsupported',line,re.I):
     # Never emit raw credentials or adapted configuration. Only common
     # image/daemon and Caddy parser errors may be shown in shared output.
     if line.startswith(('Error:', 'Error response from daemon:', 'error:')):
      line=re.sub(r'[0-9a-f]{64}','[redacted]',line)
      summaries.append(line[:500])
   detail=' '.join(summaries[:2])
   raise RuntimeError('Edge container command failed'+(': '+detail if detail else '')+'; private details: '+str(log))
  return result.stdout
 return p.run(cmd)
def settings():return json.loads((ROOT/'settings.json').read_text())
def managed():
 record=json.loads((ROOT/'managed.json').read_text())
 for name,digest in record.items():
  if hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=digest:raise RuntimeError('Customized edge configuration; refusing operation: '+name)
def install_credentials(credentials):
 managed()
 credential=json.loads(Path(credentials).read_text())
 if credential.get('TunnelID')!=settings()['tunnel_id'] or not credential.get('TunnelSecret') or not credential.get('AccountTag'):raise ValueError('Credentials do not match this locally managed tunnel.')
 if compose('--profile','public','ps','-q','tunnel',capture=True).strip():raise RuntimeError('Stop the tunnel before changing credentials.')
 write(ROOT/'secrets/tunnel.json',json.dumps(credential)+'\n')
 print('Private credentials staged; no tunnel started.')
def prepare(host,tunnel_id,credentials=None,dashboard_managed=False):
 host=hostname(host);tunnel_id=None if dashboard_managed else str(uuid.UUID(tunnel_id))
 if dashboard_managed and credentials:raise ValueError("Dashboard mode retains the existing connector; do not supply local tunnel credentials")
 if ROOT.exists():raise RuntimeError('Edge folder already exists; preserve its private configuration, do not overwrite.')
 source=p.BASE/'kol-production/secrets/ingress_key'
 if not source.is_file():raise RuntimeError('First run deploy-backend to create the private ingress credential and deploy its reader.')
 credential=None
 if credentials:
  credential=json.loads(Path(credentials).read_text())
  if credential.get('TunnelID')!=tunnel_id or not credential.get('TunnelSecret') or not credential.get('AccountTag'):raise ValueError('Credentials do not match this locally managed tunnel.')
 ROOT.mkdir(mode=0o700);(ROOT/'secrets').mkdir(mode=0o700)
 compose_text=(TEMPLATE/'compose.yaml').read_text()
 if dashboard_managed:compose_text=compose_text.split('  tunnel:\n',1)[0]
 write(ROOT/'compose.yaml',compose_text)
 write(ROOT/'.env','PUBLIC_HOST='+host+'\n',0o600)
 write(ROOT/'Caddyfile',render(host,source.read_text().strip()))
 write(ROOT/'settings.json',json.dumps({'hostname':host,'tunnel_id':tunnel_id,'management':'dashboard' if dashboard_managed else 'local'})+'\n',0o600)
 config={'tunnel':tunnel_id,'credentials-file':'/run/secrets/tunnel_credentials','metrics':'127.0.0.1:19091','ingress':[{'hostname':host,'service':'http://127.0.0.1:19081'},{'service':'http_status:404'}]}
 write(ROOT/'tunnel.json',json.dumps(config,indent=2)+'\n')
 write(ROOT/'secrets/tunnel.json',json.dumps(credential or {})+'\n')
 write(ROOT/'managed.json',json.dumps({name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ['compose.yaml','Caddyfile','tunnel.json','.env','settings.json']})+'\n',0o600)
 compose('--profile','public','config','--quiet',capture=True)
 if dashboard_managed:print('Existing dashboard-managed connector retained; change its origin to http://127.0.0.1:19081 only after local validation passes.')
 print('Prepared private edge configuration. No containers started, no tunnel connected, no DNS changed.')
def request(path,host=None,data=None,port=19080):
 host=host or settings()['hostname'];req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=data,headers={'Host':host,'Content-Type':'application/json'})
 try:
  with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req,timeout=10) as r:return r.status,r.read()
 except urllib.error.HTTPError as e:return e.code,e.read()
def validate():
 managed()
 for path,code in [('/health/live',200),('/api/v1/client/config',200),('/api/v1/state',401),('/health/ready',404),('/admin',404),('/api/v1/admin',404),('/metrics',404),('/.env',404),('/ws',404)]:
  pg.check(request(path)[0]==code,'proxy route '+path)
 pg.check(request('/health/live','unapproved.invalid')[0]==404,'unknown Host denied')
 pg.check(request('/api/v1/auth/login',data=b'x'*17000)[0]==413,'oversized request denied')
 for name in b.ORDER:
  for svc in ['db','cache','worker','scheduler']:
   c=pg.inspect('container',pg.cid(name,svc));pg.check(not c['HostConfig'].get('PortBindings'),name+' '+svc+' no host ports')
  c=pg.inspect('container',pg.cid(name,'api'))
  pg.check(all(v['HostIp']=='127.0.0.1' for bindings in (c['HostConfig'].get('PortBindings') or {}).values() for v in bindings),name+' API loopback only')
 c=pg.inspect('container',compose('ps','-q','caddy',capture=True).strip())
 pg.check(c['HostConfig']['Memory']==128*1024**2,'Caddy memory cap')
 pg.check(c['HostConfig']['RestartPolicy']['Name']=='unless-stopped','Caddy boot restart policy')
 # Actual host socket bindings: host networking does not appear under PortBindings.
 rows=p.run(['ss','-H','-ltn'],capture_output=True,text=True).stdout.splitlines()
 for port in [19080,19081]:
  matched=[line.split()[3] for line in rows if line.split()[3].endswith(':'+str(port))]
  pg.check(matched==['127.0.0.1:'+str(port)],'proxy socket '+str(port)+' is loopback only')
 pg.check(b.request('kol-production','/health/ready')[0]==200,'production backend ready')
 pg.check(b.request('kol-staging','/health/ready')[0]==200,'staging remains local and ready')
 print('Local proxy acceptance passed. External HTTPS, tunnel restart and outside-network exposure remain unverified.')
def save():
 STATE.mkdir(parents=True,exist_ok=True,mode=0o700)
 services=['caddy'] if settings().get('management')=='dashboard' else ['caddy','tunnel']
 ids={svc:compose('--profile','public','ps','-q',svc,capture=True).strip() for svc in services}
 write(STATE/'baseline.json',json.dumps({'boot':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'containers':ids})+'\n',0o600)
def refresh_proxy():
 managed()
 path=ROOT/'compose.yaml';text=path.read_text()
 anchor='  caddy:\n    <<: *security\n'
 addition='    # Official binary carries cap_net_bind_service; keep it in the bounding set.\n    cap_add: [NET_BIND_SERVICE]\n'
 if anchor+addition in text:print('Caddy capability correction already staged; no containers restarted.');return
 if text.count(anchor)!=1 or 'cap_add:' in text:raise RuntimeError('Unexpected proxy capability configuration; refusing changes')
 record=json.loads((ROOT/'managed.json').read_text())
 write(path,text.replace(anchor,anchor+addition,1))
 record['compose.yaml']=hashlib.sha256(path.read_bytes()).hexdigest()
 write(ROOT/'managed.json',json.dumps(record)+'\n',0o600)
 compose('--profile','public','config','--quiet',capture=True)
 print('Caddy-only capability correction staged. Credentials, routes and existing connector retained; no containers restarted.')

def refresh_client_assets():
 # Check managed checksums before touching routes; preserve listeners, host,
 # credentials and connector configuration byte-for-byte. Route expressions
 # come only from the reviewed public API and static-asset catalogs.
 managed()
 path=ROOT/'Caddyfile';original=path.read_text();record_text=(ROOT/'managed.json').read_text()
 lines=re.findall(r'(?m)^  path_regexp public (.+)$',original)
 if len(lines)!=2 or lines[0]!=lines[1]:raise RuntimeError('Unexpected managed route layout; refusing changes')
 updated=re.sub(r'(?m)^  path_regexp public .+$',lambda _: '  path_regexp public '+approved_paths(),original)
 if updated==original:print('Reviewed client assets already staged; no services restarted.');return
 # Keep a protected rollback copy. Validation is inert and starts no listener.
 backup=ROOT/('Caddyfile.before-client-assets-'+str(time.time_ns()))
 write(backup,original)
 try:
  write(path,updated)
  compose('run','--rm','--no-deps','caddy','caddy','validate','--config','/etc/caddy/Caddyfile','--adapter','caddyfile',capture=True)
  record=json.loads(record_text);record['Caddyfile']=hashlib.sha256(path.read_bytes()).hexdigest()
  write(ROOT/'managed.json',json.dumps(record)+'\n',0o600)
 except Exception:
  write(path,original);write(ROOT/'managed.json',record_text,0o600);raise
 print('Reviewed client routes staged and validated; rollback copy retained. No services restarted. Restart only managed Caddy after operator approval, then run validate.')

def deploy_local():
 managed()
 if compose('ps','-q','caddy',capture=True).strip():
  validate();print('Existing local Caddy retained; no public activation.');return
 for port in [19080,19081,19091]:
  with socket.socket() as sock:
   sock.bind(('127.0.0.1',port))
 before=b.unrelated()
 compose('run','--rm','--no-deps','caddy','caddy','validate','--config','/etc/caddy/Caddyfile','--adapter','caddyfile',capture=True)
 compose('up','-d','--wait','--wait-timeout','90','caddy');validate()
 # Existing unrelated workloads must retain process starts; only this project is added.
 after=b.unrelated();pg.check(all(after.get(k)==v for k,v in before.items()),'existing unrelated workloads retained')
 save()
 if settings().get('management')=='dashboard':print('Local Caddy deployed. Existing dashboard-managed connector retained; no public route or DNS changes performed.')
 else:print('Local Caddy deployed. Tunnel remains stopped. No public activation or DNS changes.')
def require_local_tunnel():
 if settings().get("management")=="dashboard":raise RuntimeError("Existing connector is dashboard-managed; administer it through Cloudflare and cloudflared.service, not a second container")

def activate(approved):
 if not approved:raise RuntimeError('Activation requires --approve-public-exposure after explicit operator approval of this hostname.')
 managed();require_local_tunnel();validate()
 credential=json.loads((ROOT/'secrets/tunnel.json').read_text())
 if credential.get('TunnelID')!=settings()['tunnel_id'] or not credential.get('TunnelSecret') or not credential.get('AccountTag'):raise RuntimeError('Supply matching locally managed tunnel credentials privately; activation refused.')
 compose('--profile','public','run','--rm','--no-deps','tunnel','tunnel','--config','/etc/cloudflared/config.json','ingress','validate',capture=True)
 compose('--profile','public','up','-d','--wait','--wait-timeout','180','tunnel');save()
 print('Approved tunnel started. DNS remains an explicitly separate operator action. Run public verification from outside the home LAN.')
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('action',choices=['deploy-backend','prepare','refresh-proxy','refresh-client-assets','credentials','deploy-local','validate','activate','stop-public','restart-tunnel','after-reboot']);ap.add_argument('--hostname');ap.add_argument('--tunnel-id');ap.add_argument('--credentials-file');ap.add_argument('--dashboard-managed',action='store_true');ap.add_argument('--approve-public-exposure',action='store_true');args=ap.parse_args()
 if os.geteuid()!=0:ap.error('Run with sudo; uses only the fixed local Docker administrative socket.')
 lockdir=Path('/run/lock/kol-docker');lockdir.mkdir(exist_ok=True,mode=0o700)
 with (lockdir/'operations.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  if args.action=='deploy-backend':
   b.deploy('infra-009')
   spec=importlib.util.spec_from_file_location('edge_scheduler',INFRA/'scripts/scheduler.py');scheduler=importlib.util.module_from_spec(spec);spec.loader.exec_module(scheduler)
   for name in b.ORDER:scheduler.acceptance(name,'persist')
   scheduler.save()
  elif args.action=='prepare':prepare(args.hostname or '',args.tunnel_id or '',args.credentials_file,args.dashboard_managed)
  elif args.action=='credentials':
   if not args.credentials_file:ap.error('--credentials-file is required')
   install_credentials(args.credentials_file)
  elif args.action=='refresh-proxy':refresh_proxy()
  elif args.action=='refresh-client-assets':refresh_client_assets()
  elif args.action=='deploy-local':deploy_local()
  elif args.action=='validate':validate()
  elif args.action=='activate':activate(args.approve_public_exposure)
  elif args.action=='stop-public':
   require_local_tunnel()
   compose('--profile','public','stop','tunnel');save();print('Tunnel stopped; remove public DNS separately if desired.')
  elif args.action=='restart-tunnel':
   managed();require_local_tunnel();pg.check(bool(compose('--profile','public','ps','-q','tunnel',capture=True).strip()),'tunnel already running under prior approval');compose('--profile','public','restart','tunnel');compose('--profile','public','up','-d','--wait','--wait-timeout','180','tunnel');print('Connector recovered; rerun external HTTPS tests.')
  else:
   old=json.loads((STATE/'baseline.json').read_text());pg.check(old['boot']!=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'actual reboot');validate()
   for svc,cid in old['containers'].items():
    if cid:
     pg.check(compose('--profile','public','ps','-q',svc,capture=True).strip()==cid,svc+' retained after reboot')
     if svc=='tunnel':pg.check(pg.inspect('container',cid)['State'].get('Health',{}).get('Status')=='healthy','tunnel reconnected after reboot')
   print('Local reboot checks passed. Repeat outside-network verification for tunnel reconnection.')
if __name__=='__main__':
 try:main()
 except (OSError,RuntimeError,ValueError,subprocess.CalledProcessError) as e:raise SystemExit('FAIL/UNKNOWN: '+str(e))
