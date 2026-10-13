"""Read-only desktop workflow tests; privileged actions are intercepted."""
import sys,unittest,tkinter as tk
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'control_panel'))
from app import Console
import operations
class ConsoleWorkflows(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  try:cls.root=tk.Tk()
  except tk.TclError:raise unittest.SkipTest('A desktop display is needed')
  cls.root.withdraw();cls.console=Console(cls.root,demo=True)
 @classmethod
 def tearDownClass(cls):cls.root.destroy()
 def observe(self,containers):
  status={'captured_at':'2026-10-12T22:00:00+00:00','cache_stale':False,'containers':containers,'readiness':[]}
  with patch.object(operations,'cache_status',return_value=status):self.console.ops.refresh()
  return self.console.ops
 def container(self,project,service):
  return {'project':project,'service':service,'state':'running','health':'healthy','memory_limit':100,'restarts':0,'restart_policy':'unless-stopped'}
 def test_reordered_monitor_rows_preserve_selected_service(self):
  a=self.container('kol-production','api');b=self.container('kol-staging','db')
  ops=self.observe([a,b]);ops.tree.selection_set('kol-staging/db');ops.show_container()
  self.observe([b,a]);self.assertEqual(ops.tree.selection(),('kol-staging/db',));self.assertEqual(ops.project.get(),'Private test game')
 def test_selected_service_logs_use_exact_internal_ids(self):
  ops=self.observe([self.container('infra-test-a','web')]);ops.tree.selection_set('infra-test-a/web')
  with patch.object(ops,'run') as run:ops.selected_service_logs()
  run.assert_called_once_with('logs',{'project':'infra-test-a','service':'web'})
  self.assertEqual(ops.log_service_picker['values'],('Web service',))
 def test_live_filters_recognize_formatted_structured_levels(self):
  ops=self.console.ops;ops.search.set('');ops.log_lines=['{"level": 50, "msg": "broken"}','{"level":40,"msg":"warning"}','ordinary message']
  ops.severity.set('Errors');self.assertIn('broken',ops.logs.get('1.0','end'));self.assertNotIn('ordinary',ops.logs.get('1.0','end'))
  ops.search.set('no-match');self.assertIn('No messages match',ops.logs.get('1.0','end'))
  ops.search.set('');ops.severity.set('All')
 def test_old_progress_callback_does_not_overwrite_new_action(self):
  c=self.console;c.busy=True;c.action_started=20;c.action_name='New action';c.status.configure(text='unchanged')
  c.action_clock(10);self.assertEqual(c.status.cget('text'),'unchanged');c.busy=False
 def test_test_checklist_reset_when_build_selection_changes(self):
  ops=self.console.ops;ops.test_login.set(True);ops.test_gameplay.set(True);ops.change_selected_release()
  self.assertFalse(ops.test_login.get());self.assertFalse(ops.test_gameplay.get());self.assertTrue(ops.publish_button.instate(['disabled']))
