import importlib.util,json,os,signal,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
INFRA=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('cache_workers',INFRA/'scripts/cache-workers.py');c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
p=c.p
class CacheWorkersTests(unittest.TestCase):
 def test_crash_refuses_database_or_unmanaged_project(self):
  with patch.object(c.pg,'cid') as cid:
   for name,service in [('kol-production','db'),('other-project','cache')]:
    with self.assertRaises(RuntimeError):c.crash_process(name,service)
   cid.assert_not_called()
 def test_crash_refuses_changed_pid_or_wrong_cgroup_and_closes_descriptor(self):
  identity='a'*64
  original={'Id':identity,'State':{'Pid':12345,'Running':True,'StartedAt':'before'}}
  for group,current in [('0::/different-container',original),('0::/docker-'+identity,{'Id':identity,'State':{'Pid':12346,'Running':True}})]:
   with patch.object(c.pg,'cid',return_value=identity),patch.object(c.pg,'inspect',side_effect=[original,current]),patch.object(c.os,'pidfd_open',return_value=99),patch.object(c.os,'close') as close,patch.object(Path,'read_text',return_value=group),patch.object(c.signal,'pidfd_send_signal') as send:
    with self.assertRaises(RuntimeError):c.crash_process('kol-production','cache')
    send.assert_not_called();close.assert_called_once_with(99)
 def test_host_process_descriptor_delivers_real_crash_signal(self):
  # An isolated child owned by this test is the only real process signaled.
  child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'])
  identity='a'*64;record={'Id':identity,'State':{'Pid':child.pid,'Running':True,'StartedAt':'before'}}
  try:
   with patch.object(c.pg,'cid',return_value=identity),patch.object(c.pg,'inspect',return_value=record),patch.object(Path,'read_text',return_value='0::/system.slice/docker-'+identity+'.scope'):
    self.assertEqual(c.crash_process('kol-production','cache'),(identity,'before'))
   self.assertEqual(child.wait(timeout=5),-signal.SIGKILL)
  finally:
   if child.poll() is None:child.terminate();child.wait(timeout=5)
 def test_cache_refresh_preserves_all_credentials_and_rejects_custom_acl(self):
  with tempfile.TemporaryDirectory() as d,patch.object(p,'BASE',Path(d)),patch.object(p,'compose'):
   p.init();folder=Path(d)/'kol-production';before={f.name:f.read_bytes() for f in (folder/'secrets').iterdir()};p.configure_cache(folder,'kol-production')
   self.assertEqual(before,{f.name:f.read_bytes() for f in (folder/'secrets').iterdir()})
   (folder/'secrets/cache_acl').chmod(0o600)
   (folder/'secrets/cache_acl').write_text('user custom off\n')
   with self.assertRaises(SystemExit):p.configure_cache(folder,'kol-production')
 def test_both_projects_preflight_before_any_deployment_changes(self):
  with tempfile.TemporaryDirectory() as d,patch.object(p,'BASE',Path(d)),patch.object(p,'compose'),patch.object(c.pg,'cid',return_value='known-container'),patch.object(c.pg,'health',return_value=True):
   p.init();(Path(d)/'kol-staging/compose.yaml').write_text('# custom\n')
   with self.assertRaises(RuntimeError):c.preflight()
   self.assertFalse((Path(d)/'kol-production/.env.before-infra006').exists())
 @unittest.skipUnless(os.environ.get('KOL_COMPOSE_CHECK'),'official Compose binary required')
 def test_future_worker_template_compose_schema(self):
  env=dict(os.environ,WORKER_IMAGE='example/worker@sha256:'+'a'*64)
  subprocess.run([os.environ['KOL_COMPOSE_CHECK'],'--project-name','worker-template','-f',str(INFRA/'templates/worker.compose.yaml'),'config','--quiet'],env=env,check=True)
 @unittest.skipUnless(os.environ.get('KOL_COMPOSE_CHECK'),'official Compose binary required')
 def test_runtime_is_private_and_admin_credentials_are_tools_only(self):
  with tempfile.TemporaryDirectory() as d,patch.object(p,'BASE',Path(d)),patch.object(p,'compose'):
   p.init()
   for name in c.NAMES:
    folder=Path(d)/name
    cfg=json.loads(subprocess.check_output([os.environ['KOL_COMPOSE_CHECK'],'--project-directory',str(folder),'--env-file',str(folder/'.env'),'-f',str(folder/'compose.yaml'),'--profile','tools','--profile','setup','config','--format','json'],text=True))
    for svc in ('cache','worker'):
     v=cfg['services'][svc];self.assertNotIn('ports',v);self.assertEqual(set(v['networks']),{'private'});self.assertEqual(v['restart'],'unless-stopped');self.assertEqual(v['mem_limit'],'268435456')
    self.assertRegex(cfg['services']['cache']['image'],r'valkey/valkey:9\.1\.2-alpine@sha256:[a-f0-9]{64}')
    for svc in ('cache','api','worker'):
     mounted={x['source'] for x in cfg['services'][svc].get('secrets',[])}
     self.assertFalse(mounted&{'db_password','migration_password','cache_admin_password'})
    self.assertEqual({x['source'] for x in cfg['services']['worker']['secrets']},{'worker_password','cache_password'})
    acl=(folder/'secrets/cache_acl').read_text();self.assertIn(f'~{name}:*',acl);self.assertIn('user default off',acl)
    self.assertNotIn((folder/'secrets/cache_password').read_text().strip(),acl)
if __name__=='__main__':unittest.main()
