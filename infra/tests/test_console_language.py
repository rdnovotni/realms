"""Operator wording and release eligibility; backend enforcement remains authoritative."""
import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'control_panel'))
import language as words
class LanguageTests(unittest.TestCase):
 def setUp(self):
  self.record={'state':'staging_ready','image':'sealed','manual_test':{'at':'now','image':'sealed'}}
  self.status={'cache_stale':False,'containers':[{'project':'kol-staging','service':'api','state':'running','image':'sealed'}]}
 def test_friendly_names_preserve_exact_action_targets(self):
  for identifier in words.PROJECTS:self.assertEqual(words.project_id(words.project(identifier)),identifier)
  for identifier in words.SERVICES:self.assertEqual(words.service_id(words.service(identifier)),identifier)
 def test_approval_allows_exact_running_build(self):
  self.assertTrue(words.release_controls(self.record,self.status)['publish'])
 def test_missing_or_stale_observations_never_allow_publish(self):
  for status in ({},{**self.status,'cache_stale':True}):self.assertFalse(words.release_controls(self.record,status)['publish'])
 def test_changed_test_image_requires_new_approval(self):
  self.status['containers'][0]['image']='newer'
  gates=words.release_controls(self.record,self.status)
  self.assertFalse(gates['approve']);self.assertFalse(gates['publish'])
 def test_missing_or_wrong_build_receipt_cannot_publish(self):
  for receipt in ({},{'at':'now','image':'other'}):
   self.record['manual_test']=receipt
   self.assertFalse(words.release_controls(self.record,self.status)['publish'])
 def test_failed_build_and_stopped_test_cannot_publish(self):
  self.record['state']='staging_failed';self.assertFalse(words.release_controls(self.record,self.status)['publish'])
  self.record['state']='staging_ready';self.status['containers'][0]['state']='exited'
  self.assertFalse(words.release_controls(self.record,self.status)['publish'])
 def test_error_explanations_preserve_uncertainty(self):
  self.assertIn('Do not assume',words.failure_message('unexpected failure',1))
  self.assertIn('older code is unsafe',words.failure_message('Schema changed',1))
  self.assertIn('Ubuntu',words.failure_message('',126))
