import importlib.util,sys,tkinter as tk,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'infra/development_client'))
s=importlib.util.spec_from_file_location('development_ui_test',ROOT/'infra/development_client/app.py');studio=importlib.util.module_from_spec(s);s.loader.exec_module(studio)
class StudioUITests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  try:cls.root=tk.Tk()
  except tk.TclError:raise unittest.SkipTest('A desktop display is needed')
  cls.root.withdraw();cls.app=studio.Studio(cls.root)
 @classmethod
 def tearDownClass(cls):cls.root.destroy()
 def test_new_definition_form_reuses_backend_item_format(self):
  a=self.app;a.dirty=False;a.new_entity();a.fields['id'].set('item.new');a.fields['name'].set('New item');a.category.set('EQUIPMENT');a.storage.set('INSTANCE')
  entity=a.draft();self.assertEqual(entity['definition']['mechanics']['inventory'],{'version':1,'category':'EQUIPMENT','storageMode':'INSTANCE'});a.dirty=False
 def test_busy_work_locks_editable_fields_and_restores_readonly_selectors(self):
  a=self.app;a.lock_editor(True);self.assertEqual(a.parts['mechanics'].cget('state'),'disabled');a.lock_editor(False)
  self.assertEqual(a.parts['mechanics'].cget('state'),'normal')
 def test_changing_build_resets_both_approval_checkboxes(self):
  a=self.app;a.login.set(True);a.gameplay.set(True);a.clear_test();self.assertFalse(a.login.get());self.assertFalse(a.gameplay.get())
 def test_unsaved_draft_cannot_publish(self):
  a=self.app;a.dirty=True
  with self.assertRaises(ValueError):a.publish()
  a.dirty=False
