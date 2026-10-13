import importlib.util,json,os,subprocess,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
INFRA=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('scheduler_infra',INFRA/'scripts/scheduler.py');mod=importlib.util.module_from_spec(s);s.loader.exec_module(mod)
p=mod.p
class SchedulerInfrastructureTests(unittest.TestCase):
 @unittest.skipUnless(os.environ.get('KOL_COMPOSE_CHECK'),'official Compose required')
 def test_scheduler_has_private_identity_resources_and_no_admin_credentials(self):
  with tempfile.TemporaryDirectory() as d,patch.object(p,'BASE',Path(d)),patch.object(p,'compose'):
   p.init();folder=Path(d)/'kol-staging'
   config=json.loads(subprocess.check_output([os.environ['KOL_COMPOSE_CHECK'],'--project-directory',str(folder),'--env-file',str(folder/'.env'),'-f',str(folder/'compose.yaml'),'--profile','tools','--profile','setup','config','--format','json'],text=True))
   service=config['services']['scheduler']
   self.assertEqual(service['restart'],'unless-stopped');self.assertEqual(int(service['mem_limit']),256*1024**2)
   self.assertEqual(set(service['networks']),{'private'});self.assertNotIn('ports',service)
   self.assertEqual({x['source'] for x in service['secrets']},{'scheduler_password'})
   self.assertEqual(service['stop_grace_period'],'45s')
   self.assertTrue((folder/'secrets/scheduler_password').exists())
   self.assertNotIn('db_password',{x['source'] for x in config['services']['scheduler-admin']['secrets']})
 def test_cli_rejects_implicit_environment_and_missing_gameplay_values(self):
  with patch.object(os,'geteuid',return_value=0),patch('sys.argv',['scheduler.py','configure-daily','--project','kol-staging','--timezone','UTC','--at','00:00','--start-date','2026-01-01']):
   with self.assertRaises(SystemExit):mod.main()
  with patch.object(os,'geteuid',return_value=0),patch('sys.argv',['scheduler.py','run']):
   with self.assertRaises(SystemExit):mod.main()
