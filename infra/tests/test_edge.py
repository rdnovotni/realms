import importlib.util,json,os,re,socket,subprocess,tempfile,threading,unittest,urllib.request,urllib.error,time
from unittest.mock import patch
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
INFRA=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('edge_ops',INFRA/'scripts/edge.py');e=importlib.util.module_from_spec(s);s.loader.exec_module(e)
class EdgeTests(unittest.TestCase):
 def test_activation_requires_explicit_approval_before_commands(self):
  with patch.object(e,'compose') as command,patch.object(e,'managed') as managed:
   with self.assertRaises(RuntimeError):e.activate(False)
   command.assert_not_called();managed.assert_not_called()
 @unittest.skipUnless(os.environ.get('KOL_COMPOSE_CHECK'),'official Compose required')
 def test_actual_edge_compose_profile_ports_credentials_and_memory(self):
  with tempfile.TemporaryDirectory() as directory:
   folder=Path(directory);(folder/'compose.yaml').write_text((e.TEMPLATE/'compose.yaml').read_text());(folder/'.env').write_text('PUBLIC_HOST=game.example.com\n');(folder/'secrets').mkdir();(folder/'secrets/tunnel.json').write_text('{}');(folder/'Caddyfile').write_text(e.render('game.example.com','a'*64));(folder/'tunnel.json').write_text('{}')
   config=json.loads(subprocess.check_output([os.environ['KOL_COMPOSE_CHECK'],'--project-directory',str(folder),'--env-file',str(folder/'.env'),'-f',str(folder/'compose.yaml'),'--profile','public','config','--format','json'],text=True))
   for name in ['caddy','tunnel']:
    service=config['services'][name];self.assertNotIn('ports',service);self.assertEqual(service['network_mode'],'host');self.assertEqual(int(service['mem_limit']),134217728);self.assertEqual(service['restart'],'unless-stopped');self.assertIn('@sha256:',service['image'])
   self.assertEqual(config['services']['caddy']['cap_add'],['NET_BIND_SERVICE']);self.assertEqual(config['services']['caddy']['cap_drop'],['ALL']);self.assertIn('no-new-privileges:true',config['services']['caddy']['security_opt']);self.assertNotIn('cap_add',config['services']['tunnel'])
   self.assertEqual(config['services']['tunnel']['profiles'],['public']);self.assertNotIn('secrets',config['services']['caddy']);self.assertEqual(config['services']['tunnel']['secrets'][0]['source'],'tunnel_credentials')
 @unittest.skipUnless(os.environ.get('KOL_COMPOSE_CHECK'),'official Compose required')
 def test_dashboard_preparation_only_deploys_proxy_and_preserves_connector(self):
  with tempfile.TemporaryDirectory() as directory:
   base=Path(directory);source=base/'kol-production/secrets';source.mkdir(parents=True);(source/'ingress_key').write_text('a'*64);root=base/'kol-edge'
   with patch.object(e,'ROOT',root),patch.object(e.p,'BASE',base),patch.object(e,'compose') as commands:
    e.prepare('game.example.com','',dashboard_managed=True)
    cfg=json.loads(subprocess.check_output([os.environ['KOL_COMPOSE_CHECK'],'--project-directory',str(root),'--env-file',str(root/'.env'),'-f',str(root/'compose.yaml'),'--profile','public','config','--format','json'],text=True))
    self.assertEqual(set(cfg['services']),{'caddy'});self.assertEqual(e.settings()['management'],'dashboard')
    self.assertEqual(commands.call_count,1);self.assertIn('config',commands.call_args.args)
    with self.assertRaisesRegex(RuntimeError,'dashboard-managed'):e.require_local_tunnel()
    with patch.object(e,'validate') as validate:
     with self.assertRaises(RuntimeError):e.activate(True)
     validate.assert_not_called()
 def test_capture_failure_preserves_private_diagnostic_without_configuration_output(self):
  with tempfile.TemporaryDirectory() as directory,patch.object(e,'STATE',Path(directory)),patch.object(e.subprocess,'run',return_value=subprocess.CompletedProcess([],1,'private configuration data','Error: adapting config: unrecognized directive')):
   with self.assertRaisesRegex(RuntimeError,'unrecognized directive'):e.compose('run',capture=True)
   log=Path(directory)/'last-edge-command-error.log';self.assertEqual(log.stat().st_mode&0o777,0o600);self.assertIn('private configuration data',log.read_text())
 def test_proxy_refresh_only_changes_caddy_capability_and_rejects_custom_files(self):
  import hashlib
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);text=(e.TEMPLATE/'compose.yaml').read_text().replace('    # Official binary carries cap_net_bind_service; keep it in the bounding set.\n    cap_add: [NET_BIND_SERVICE]\n','')
   (root/'compose.yaml').write_text(text);(root/'Caddyfile').write_text('fixture route/key');(root/'tunnel.json').write_text('fixture private connector')
   names=['compose.yaml','Caddyfile','tunnel.json'];(root/'managed.json').write_text(json.dumps({n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in names}))
   with patch.object(e,'ROOT',root),patch.object(e,'compose') as commands:
    e.refresh_proxy();self.assertIn('cap_add: [NET_BIND_SERVICE]',(root/'compose.yaml').read_text());e.managed()
    self.assertEqual((root/'Caddyfile').read_text(),'fixture route/key');self.assertEqual((root/'tunnel.json').read_text(),'fixture private connector');self.assertEqual(commands.call_count,1)
    e.refresh_proxy();self.assertEqual(commands.call_count,1)
    (root/'Caddyfile').write_text('operator customization')
    with self.assertRaisesRegex(RuntimeError,'Customized'):e.refresh_proxy()
 def test_hostname_and_injection_rejection(self):
  for name in ['https://x.example.com','x.example.com:443','x.example.com\nrespond 200','*','localhost']:
   with self.assertRaises(ValueError):e.hostname(name)
  self.assertEqual(e.hostname('game.example.com'),'game.example.com')
 def test_reviewed_routes_exclude_admin_health_and_future_endpoints(self):
  pattern=e.approved_paths()
  for path in ['/api/v1/state','/api/v1/tactical/test','/api/v1/turns','/api/v1/turns/plans/step','/api/v1/consumption','/api/v1/consumption/meals/step','/assets/consumption.js','/assets/turn-planner.js','/assets/app.js']:self.assertRegex(path,pattern)
  for path in ['/health/ready','/admin','/api/v1/admin','/api/v1/future-route','/api/v1/turns/unknown','/api/v1/consumption/unknown','/metrics','/.env','/ws']:self.assertIsNone(re.fullmatch(pattern,path))
 def test_all_client_entry_styles_modules_and_item_art_are_reviewed(self):
  client=INFRA.parent/'realms/client';pattern=e.approved_paths()
  for path in re.findall(r'href="(/assets/[^" ]+\.css)"',(client/'index.html').read_text()):self.assertRegex(path,pattern)
  for source in client.glob('*.ts'):self.assertRegex('/assets/'+source.stem+'.js',pattern)
  self.assertNotRegex('/assets/dev/visual-reference.js',pattern)
  self.assertNotRegex('/dev/fixture/pack',pattern)
  for art in (client/'art/items').glob('*.svg'):self.assertRegex('/assets/items/'+art.name,pattern)
  for path in ['/assets/items/authored/test-sword_2.avif','/assets/folio-grain.svg']:self.assertRegex(path,pattern)
  for path in ['/assets/unreviewed.js','/assets/anything.css','/assets/items/authored/a.svg','/assets/items/authored/../private.jpg','/assets/items/authored/'+('a'*81)+'.png','/assets/items/.env','/dev/folio']:self.assertIsNone(re.fullmatch(pattern,path))
 def test_client_asset_refresh_is_inert_idempotent_and_rolls_back_failed_validation(self):
  import hashlib
  original_write=e.write
  def root_write(path,text,mode=0o444):
   # The operator command requires root; emulate overwriting its read-only files.
   if path.exists():path.chmod(0o600)
   original_write(path,text,mode)
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);old=e.render('game.example.com','a'*64).replace(e.approved_paths(),r'^(/|/assets/app\.js)$')
   files={'Caddyfile':old,'compose.yaml':'fixture compose','tunnel.json':'fixture connector','settings.json':'fixture settings','.env':'fixture environment'}
   for name,text in files.items():(root/name).write_text(text)
   record=json.dumps({n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in files});(root/'managed.json').write_text(record)
   with patch.object(e,'ROOT',root),patch.object(e,'write',side_effect=root_write),patch.object(e,'compose',side_effect=RuntimeError('invalid candidate')) as command:
    with self.assertRaisesRegex(RuntimeError,'invalid candidate'):e.refresh_client_assets()
    self.assertEqual((root/'Caddyfile').read_text(),old);self.assertEqual((root/'managed.json').read_text(),record);e.managed()
   with patch.object(e,'ROOT',root),patch.object(e,'write',side_effect=root_write),patch.object(e,'compose') as command:
    e.refresh_client_assets();e.managed();self.assertEqual((root/'Caddyfile').read_text(),e.render('game.example.com','a'*64))
    self.assertEqual(command.call_count,1);self.assertEqual(command.call_args.args[:5],('run','--rm','--no-deps','caddy','caddy'))
    self.assertNotIn('up',command.call_args.args);self.assertNotIn('restart',command.call_args.args)
    for name,text in files.items():
     if name!='Caddyfile':self.assertEqual((root/name).read_text(),text)
    self.assertTrue(list(root.glob('Caddyfile.before-client-assets-*')))
    e.refresh_client_assets();self.assertEqual(command.call_count,1)
    (root/'Caddyfile').chmod(0o600);(root/'Caddyfile').write_text('operator customization')
    with self.assertRaisesRegex(RuntimeError,'Customized'):e.refresh_client_assets()
 def test_template_has_no_public_listener_or_general_forwarded_trust(self):
  rendered=e.render('game.example.com','a'*64)
  self.assertEqual(rendered.count('bind 127.0.0.1'),2);self.assertIn('admin off',rendered)
  self.assertNotIn('trusted_proxies',rendered);self.assertIn('max_size 16KB',rendered)
  self.assertNotIn('13001',rendered)
 @unittest.skipUnless(os.environ.get('KOL_CADDY_CHECK'),'verified Caddy binary required')
 def test_actual_proxy_routes_limits_and_overwrites_forged_headers(self):
  key='a'*64;observed=[]
  class Handler(BaseHTTPRequestHandler):
   def log_message(self,*args):pass
   def do_GET(self):
    observed.append(dict(self.headers));self.send_response(200);self.end_headers();self.wfile.write(b'{}')
   def do_POST(self):
    length=int(self.headers.get('Content-Length','0'));body=self.rfile.read(length)
    if len(body)==length:self.do_GET()
  upstream=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=upstream.serve_forever,daemon=True);thread.start()
  sockets=[];ports=[]
  for _ in range(2):
   sock=socket.socket();sock.bind(('127.0.0.1',0));ports.append(sock.getsockname()[1]);sockets.append(sock)
  for sock in sockets:sock.close()
  with tempfile.TemporaryDirectory() as directory:
   folder=Path(directory);config=e.render('game.example.com',key).replace('127.0.0.1:13000','127.0.0.1:'+str(upstream.server_port)).replace(':19080',':'+str(ports[0])).replace(':19081',':'+str(ports[1]));path=folder/'Caddyfile';path.write_text(config)
   binary=os.environ['KOL_CADDY_CHECK'];subprocess.run([binary,'validate','--config',str(path),'--adapter','caddyfile'],check=True,capture_output=True)
   with (folder/'log').open('w') as log:
    proc=subprocess.Popen([binary,'run','--config',str(path),'--adapter','caddyfile'],stdout=log,stderr=log)
    try:
     for _ in range(100):
      try:
       with socket.create_connection(('127.0.0.1',ports[0]),timeout=.1):break
      except OSError:time.sleep(.02)
     def request(path,port=0,host='game.example.com',data=None,headers=None):
      req=urllib.request.Request('http://127.0.0.1:'+str(ports[port])+path,data=data,headers={'Host':host,**(headers or {})})
      try:
       with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req,timeout=3) as response:return response.status
      except urllib.error.HTTPError as error:
       code=error.code;error.close();return code
     self.assertEqual(request('/health/live'),200)
     self.assertEqual(request('/health/live',host='wrong.example.com'),404)
     self.assertEqual(request('/api/v1/admin'),404);self.assertEqual(request('/health/ready'),404)
     forged={'X-Kol-Proxy-Key':'evil','X-Kol-Client-Ip':'6.6.6.6','Cf-Connecting-Ip':'7.7.7.7','X-Forwarded-For':'8.8.8.8','Forwarded':'for=9.9.9.9'}
     self.assertEqual(request('/api/v1/state',headers=forged),200)
     normalized={k.lower():v for k,v in observed[-1].items()}
     self.assertEqual(normalized['x-kol-proxy-key'],key);self.assertEqual(normalized['x-kol-client-ip'],'127.0.0.1');self.assertNotIn('forwarded',normalized)
     self.assertEqual(request('/api/v1/state',port=1,headers=forged),200)
     normalized={k.lower():v for k,v in observed[-1].items()};self.assertEqual(normalized['x-kol-client-ip'],'7.7.7.7')
     self.assertEqual(request('/api/v1/auth/login',data=b'x'*17000),413)
    finally:
     proc.terminate();proc.wait(timeout=5);upstream.shutdown();upstream.server_close()
if __name__=='__main__':unittest.main()
