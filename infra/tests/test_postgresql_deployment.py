import importlib.util,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
INFRA=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('postgresql',INFRA/'scripts/postgresql.py');pg=importlib.util.module_from_spec(spec);spec.loader.exec_module(pg)
class DeploymentTests(unittest.TestCase):
 def test_existing_volume_without_explicit_identity_prevents_any_reconfiguration(self):
  with tempfile.TemporaryDirectory() as directory,patch.object(pg.p,'BASE',Path(directory)),patch.object(pg.p,'compose'),patch.object(pg.p,'build') as build,patch.object(pg.subprocess,'run') as run:
   pg.p.init();folder=Path(directory)/'kol-production';env=folder/'.env';before=env.read_text().replace('DB_NAME=kol_production\n','');env.write_text(before)
   secret=(folder/'secrets/app_password').read_bytes();run.return_value.returncode=0
   with self.assertRaises(RuntimeError):pg.configure()
   build.assert_not_called();self.assertEqual(env.read_text(),before);self.assertEqual(secret,(folder/'secrets/app_password').read_bytes())
 def test_mismatched_database_identity_prevents_deployment(self):
  with tempfile.TemporaryDirectory() as directory,patch.object(pg.p,'BASE',Path(directory)),patch.object(pg.p,'compose'),patch.object(pg.p,'build') as build:
   pg.p.init();env=Path(directory)/'kol-staging/.env';env.write_text(env.read_text().replace('DB_NAME=kol_staging','DB_NAME=kol_production'))
   with self.assertRaises(RuntimeError):pg.configure()
   build.assert_not_called()
 def test_database_name_cannot_inject_arguments_or_sql(self):
  with tempfile.TemporaryDirectory() as directory,patch.object(pg.p,'BASE',Path(directory)),patch.object(pg.p,'compose'):
   pg.p.init();env=Path(directory)/'kol-staging/.env';env.write_text('DB_NAME=kol_staging; DROP DATABASE game\n')
   with self.assertRaises(SystemExit):pg.p.read_database_name('kol-staging')
if __name__=='__main__':unittest.main()
