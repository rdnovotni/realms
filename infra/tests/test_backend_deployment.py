import importlib.util,json,os,subprocess,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
INFRA=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('backend_deployment',INFRA/'scripts/backend.py');b=importlib.util.module_from_spec(s);s.loader.exec_module(b)
p=b.p
class BackendDeploymentTests(unittest.TestCase):
 def test_template_refresh_is_scoped_to_game_projects(self):
  with tempfile.TemporaryDirectory() as d,patch.object(p,'BASE',Path(d)),patch.object(p,'compose'):
   p.init();fixture=Path(d)/'example-project/compose.yaml';fixture.write_text('# unrelated operator configuration\n')
   p.refresh_templates(b.ORDER)
   self.assertEqual(fixture.read_text(),'# unrelated operator configuration\n')
 def test_custom_game_template_prevents_build_or_backup(self):
  with tempfile.TemporaryDirectory() as d,patch.object(p,'BASE',Path(d)),patch.object(p,'compose'),patch.object(p,'build') as build,patch.object(p,'operations') as operations,patch.object(b.pg,'cid',return_value='container'),patch.object(b.pg,'health',return_value=True):
   p.init();(Path(d)/'kol-staging/compose.yaml').write_text('# customized\n')
   with self.assertRaises(RuntimeError):b.deploy()
   build.assert_not_called();operations.assert_not_called()
 @unittest.skipUnless(os.environ.get('KOL_COMPOSE_CHECK'),'official Compose required')
 def test_smoke_credentials_and_shutdown_budget(self):
  with tempfile.TemporaryDirectory() as d,patch.object(p,'BASE',Path(d)),patch.object(p,'compose'):
   p.init();folder=Path(d)/'kol-production'
   config=json.loads(subprocess.check_output([os.environ['KOL_COMPOSE_CHECK'],'--project-directory',str(folder),'--env-file',str(folder/'.env'),'-f',str(folder/'compose.yaml'),'--profile','tools','config','--format','json'],text=True))
   self.assertEqual(config['services']['api']['stop_grace_period'],'45s')
   self.assertEqual({x['source'] for x in config['services']['backend-smoke']['secrets']},{'app_password','cache_password'})
   self.assertEqual(set(config['services']['backend-smoke']['networks']),{'private'})
   self.assertNotIn('ports',config['services']['backend-smoke'])
 def test_private_runtime_files_are_git_ignored(self):
  repo=INFRA.parent
  paths=['infra/secrets/db_password','infra/.env','infra/.state/release.json','realms/.env','realms/.state/runtime.env']
  result=subprocess.check_output(['git','check-ignore',*paths],cwd=repo,text=True).splitlines()
  self.assertEqual(result,paths)
if __name__=='__main__':unittest.main()
