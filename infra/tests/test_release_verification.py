import importlib.util,json,subprocess,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock,patch
ROOT=Path(__file__).resolve().parents[2]
s=importlib.util.spec_from_file_location('verification_tests',ROOT/'infra/scripts/release_verification.py');v=importlib.util.module_from_spec(s);s.loader.exec_module(v)
class VerificationTests(unittest.TestCase):
 def record(self):return {'source_commit':'a'*40,'image':'sha256:'+'b'*64,'schema':[{'name':'001.sql','checksum':'c'}],'verification':{'status':'passed','source_commit':'a'*40,'image':'sha256:'+'b'*64,'schema':[{'name':'001.sql','checksum':'c'}],'checks':v.CHECKS.copy()}}
 def test_receipt_requires_same_commit_image_schema_and_complete_checks(self):
  v.require_verification(self.record())
  for key,value in [('source_commit','d'*40),('image','other'),('schema',[]),('status','failed'),('checks',['unit'])]:
   r=self.record();r['verification'][key]=value
   with self.assertRaises(RuntimeError):v.require_verification(r)
  with self.assertRaises(RuntimeError):v.require_verification({'source_commit':'a'*40})
 def test_failed_database_suite_cleans_only_disposable_resources(self):
  calls=[]
  def run(args,**kwargs):
   calls.append(args)
   if '--name' in args and args[args.index('--name')+1].endswith('-tests'):raise subprocess.CalledProcessError(1,args)
  image={'Id':'sha256:'+'b'*64,'Config':{'Labels':{'org.opencontainers.image.revision':'a'*40}}}
  p=SimpleNamespace(DOCKER=['docker'],run=run)
  cleanup=[]
  def command(args,**kwargs):cleanup.append(args);return SimpleNamespace(returncode=0)
  with patch.object(v.subprocess,'run',side_effect=command),patch.object(v.time,'sleep'):
   with self.assertRaises(subprocess.CalledProcessError):v.verify_checkpoint(ROOT,'a'*40,'release-test',p,lambda *_:image)
  self.assertTrue(any('--internal' in x for x in calls))
  database=next(x for x in calls if 'run' in x and '-d' in x)
  self.assertNotIn('-p',database);self.assertIn('--tmpfs',database)
  removed=[x[-1] for x in cleanup if 'rm' in x]
  self.assertEqual(len(removed),3);self.assertTrue(all(x.startswith('realms-verify-') for x in removed))
  self.assertFalse(any('kol-production' in str(x) or 'kol-staging' in str(x) for x in calls+cleanup))
 def test_wrong_source_label_refuses_database_creation(self):
  p=SimpleNamespace(DOCKER=['docker'],run=Mock())
  with self.assertRaisesRegex(RuntimeError,'source label'):v.verify_checkpoint(ROOT,'a'*40,'release-test',p,lambda *_:{'Config':{'Labels':{}}})
  self.assertEqual(p.run.call_count,1)
 def test_promotion_without_automated_receipt_never_deploys(self):
  s=importlib.util.spec_from_file_location('verified_release_tests',ROOT/'infra/scripts/releases.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
  with patch.object(r,'staging_record',return_value={'image':'same','schema':[],'manual_test':{'image':'same','schema':[],'at':'now'}}),patch.object(r,'deploy_project') as deploy:
   with self.assertRaisesRegex(RuntimeError,'automated verification'):r.promote('release-test',True)
   deploy.assert_not_called()
