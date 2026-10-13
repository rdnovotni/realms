import json,sys,unittest,tempfile
from pathlib import Path
from datetime import datetime,timezone,timedelta
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'control_panel'))
import operator_tools as tools
import operations
class OperatorToolsTests(unittest.TestCase):
 def test_invalid_or_future_cache_is_unknown(self):
  now=datetime.now(timezone.utc)
  for value in (None,'garbage','2026-10-12T10:00:00',(now+timedelta(seconds=10)).isoformat()):self.assertTrue(tools.cache_is_stale(value,now))
  self.assertFalse(tools.cache_is_stale((now-timedelta(seconds=180)).isoformat(),now))
  self.assertTrue(tools.cache_is_stale((now-timedelta(seconds=181)).isoformat(),now))
 def test_malformed_cache_fails_closed(self):
  with tempfile.TemporaryDirectory() as d:
   f=Path(d)/'cache.json'
   for value in ([],{'captured_at':'invalid'},{'captured_at':datetime.now(timezone.utc).isoformat(),'containers':[None]},{'captured_at':datetime.now(timezone.utc).isoformat(),'containers':[{}]}):
    f.write_text(json.dumps(value))
    with patch.object(operations,'CACHE',f):self.assertTrue(operations.cache_status()['cache_stale'])
 def test_pending_checks_are_separate_from_active_problems(self):
  rows=tools.attention_items({'cache_stale':False,'issues':[{'id':'backup','message':'USB backup failed'}],'readiness':[{'name':'Email alert delivery','state':'pending'},{'name':'Production ready','state':'passed'}]})
  self.assertEqual(len(rows),2);self.assertEqual(rows[0]['page'],'Backups');self.assertEqual(rows[1]['state'],'Not yet verified');self.assertEqual(rows[1]['page'],'Checks & alerts')
 def test_stale_cache_is_an_actionable_problem(self):
  row=tools.attention_items({})[0];self.assertEqual(row['page'],'Overview');self.assertEqual(row['state'],'Unknown')
 def test_shareable_report_drops_identifying_free_text(self):
  secret='private-user-password-192.168.0.133'
  value={'cache_stale':False,'captured_at':secret,'resources':{'disk_free':secret},'backup':{'snapshot':secret,'reason':secret},'email':{'password':secret},'issues':[{'message':secret}], 'releases':[{'label':secret}], 'containers':[{'project':'kol-production','service':'api','state':secret,'health':secret,'image':secret,'ports':secret,'memory_limit':secret,'restarts':secret}]}
  self.assertNotIn(secret,json.dumps(tools.support_report(value)))
  self.assertEqual(tools.support_report(value)['active_issue_count'],1)
 def test_stale_report_cannot_claim_ready(self):
  report=tools.support_report({'cache_stale':True,'health':{'kol-production':{'ok':True}}})
  self.assertIsNone(report['projects']['Live game']['ready'])
 def test_log_choices_match_selected_project_only(self):
  value={'containers':[{'project':'infra-test-a','service':'web'},{'project':'kol-production','service':'db'},{'project':'kol-production','service':'not-allowed'}]}
  self.assertEqual(tools.project_services(value,'infra-test-a'),('web',));self.assertEqual(tools.project_services(value,'kol-production'),('db',));self.assertEqual(tools.project_services(value,'missing'),())
 def test_current_build_summary_matches_images_not_names(self):
  value={'containers':[{'project':'kol-production','service':'api','state':'running','image':'exact'}],'releases':[{'image':'different','label':'Wrong build'},{'image':'exact','label':'Approved update'}]}
  summary=tools.running_builds(value);self.assertIn('Approved update',summary);self.assertNotIn('Wrong build',summary)

 def test_private_export_refuses_special_files_without_truncating(self):
  import os
  with tempfile.TemporaryDirectory() as directory:
   fifo=Path(directory)/'pipe';os.mkfifo(fifo)
   with self.assertRaises(operations.backend.OperationError):operations.save_private(fifo,'report')
   source=Path(directory)/'source';source.write_text('retained');link=Path(directory)/'link';link.symlink_to(source)
   with self.assertRaises(operations.backend.OperationError):operations.save_private(link,'replacement')
   self.assertEqual(source.read_text(),'retained')
