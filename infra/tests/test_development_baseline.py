import importlib.util,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
s=importlib.util.spec_from_file_location('baseline_tests',ROOT/'infra/scripts/development-baseline.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class BaselineTests(unittest.TestCase):
 def test_cached_identity_never_invents_source_or_live_schema(self):
  cache={'captured_at':'fixture','containers':[{'project':'kol-production','service':'api','image':'sha256:fixture'}],'backup':{'last_success':'fixture','password':'must-not-leak'}}
  value=m.report(ROOT,cache)
  self.assertIsNone(value['environments'][0]['source_commit']);self.assertIsNone(value['environments'][0]['schema'])
  self.assertNotIn('password',value['backup']);self.assertIn('cached',value['mode'])
 def test_live_inspection_keeps_environment_sources_distinct(self):
  value=m.report(ROOT,{}, {'kol-production':{'source_commit':'a'*40,'image':'prod','schema':[]},'kol-staging':{'source_commit':'b'*40,'image':'test','schema':[]}})
  self.assertEqual([x['source_commit'] for x in value['environments']],['a'*40,'b'*40]);self.assertIn('live read-only',value['mode'])
