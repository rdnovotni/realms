import importlib.util,json,os,subprocess,tempfile,unittest,sys
from pathlib import Path
from unittest.mock import patch
INFRA=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('relocation',INFRA/'scripts/relocate-realms.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class RelocationTests(unittest.TestCase):
 def test_reboot_allows_unrelated_process_restart_but_not_image_changes(self):
  record={'boot':'previous-boot','unrelated':{'fixture':{'image':'unchanged','start':'before'}},'other_units':{}}
  with patch.object(m,'unrelated',return_value={'fixture':{'image':'unchanged','start':'after'}}):m.check_unrelated(record)
  with patch.object(m,'unrelated',return_value={'fixture':{'image':'different','start':'after'}}):
   with self.assertRaises(RuntimeError):m.check_unrelated(record)
 def test_plan_dispatch_never_creates_locks_or_directories(self):
  with patch.object(sys,'argv',['relocate-realms.py','plan']),patch.object(m.os,'geteuid',return_value=0),patch.object(m,'plan') as plan,patch.object(Path,'mkdir') as mkdir:
   m.main();plan.assert_called_once();mkdir.assert_not_called()
 def test_cluster_root_ignores_per_database_version_files(self):
  with tempfile.TemporaryDirectory() as directory:
   folder=Path(directory);cluster=folder/'18/docker';(cluster/'global').mkdir(parents=True);(cluster/'global/pg_control').write_bytes(b'control');(cluster/'PG_VERSION').write_text('18')
   for database in ['1','4','5','16384']:
    path=cluster/'base'/database;path.mkdir(parents=True);(path/'PG_VERSION').write_text('18')
   self.assertEqual(m.cluster_directory(folder),cluster)
   second=folder/'another';(second/'global').mkdir(parents=True);(second/'PG_VERSION').write_text('18');(second/'global/pg_control').write_bytes(b'control')
   with self.assertRaises(RuntimeError):m.cluster_directory(folder)
 def test_retry_archives_only_the_early_failure_and_never_deletes_data(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory)/'Realms';root.mkdir();(root/'relocation').mkdir();(root/'relocation/manifest.json').write_text('private journal')
   record={'status':'rolled-back','moves_attempted':[],'volumes':{'project':{'new_database_started':False,'new_name':'test'}}}
   with patch.object(m,'ROOT',root),patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],1)):
    (root/'data').mkdir()
    with self.assertRaises(RuntimeError):m.archive_early_rollback(record)
    self.assertTrue((root/'relocation/manifest.json').exists());(root/'data').rmdir()
    saved=m.archive_early_rollback(record);self.assertFalse(root.exists());self.assertEqual((saved/'relocation/manifest.json').read_text(),'private journal')
 def test_retry_refuses_any_prior_cutover(self):
  for record in [{'status':'complete','moves_attempted':[],'volumes':{}},{'status':'rolled-back','moves_attempted':[{}],'volumes':{}},{'status':'rolled-back','moves_attempted':[],'volumes':{'project':{'new_database_started':True}}}]:
   with self.assertRaises(RuntimeError):m.archive_early_rollback(record)
 def test_cold_cluster_check_rejects_crash_state_before_copying(self):
  with tempfile.TemporaryDirectory() as directory:
   folder=Path(directory);(folder/'PG_VERSION').write_text('18');(folder/'global').mkdir();(folder/'global/pg_control').write_bytes(b'control')
   with patch.object(m,'run',return_value=subprocess.CompletedProcess([],0,stdout='Database cluster state: in production\n')):
    with self.assertRaises(RuntimeError):m.check_cold_cluster(folder,folder)
   with patch.object(m,'run',return_value=subprocess.CompletedProcess([],0,stdout='Database cluster state: shut down\n')):m.check_cold_cluster(folder,folder)
 def test_cold_copy_preserves_content_modes_links_and_rejects_changes(self):
  with tempfile.TemporaryDirectory() as directory:
   base=Path(directory);source=base/'old';source.mkdir(mode=0o700);(source/'data').write_bytes(b'durable data');(source/'data').chmod(0o600);(source/'alias').symlink_to('data')
   self.assertEqual(m.cold_copy(source,base/'new'),3);self.assertEqual(m.tree_signature(source),m.tree_signature(base/'new'))
   with self.assertRaises(RuntimeError):m.cold_copy(source,base/'new')
   (base/'new/data').write_text('corruption');self.assertNotEqual(m.tree_signature(source),m.tree_signature(base/'new'))
 def test_directory_move_preserves_old_path_and_rollback_preserves_new_writes(self):
  with tempfile.TemporaryDirectory() as directory:
   base=Path(directory);old=base/'old';new=base/'new';old.mkdir();(old/'state').write_text('before')
   m.move_alias(old,new);self.assertEqual((old/'state').read_text(),'before');(new/'state').write_text('after')
   m.reverse_alias(old,new);self.assertFalse(old.is_symlink());self.assertEqual((old/'state').read_text(),'after');self.assertEqual(new.resolve(),old.resolve())
 def test_recovers_interrupted_rename_before_alias_creation(self):
  with tempfile.TemporaryDirectory() as directory:
   base=Path(directory);new=base/'new';new.mkdir();(new/'data').write_text('retained')
   m.reverse_alias(base/'old',new);self.assertEqual((base/'old/data').read_text(),'retained')
 def test_rollback_uses_latest_database_not_stale_original(self):
  with tempfile.TemporaryDirectory() as directory:
   base=Path(directory);old=base/'old';new=base/'new';record=base/'record';old.mkdir();new.mkdir();record.mkdir();(old/'ledger').write_text('original');(new/'ledger').write_text('reward committed after migration')
   with patch.object(m,'RECORD',record):m.restore_latest_volume({'old_path':str(old),'new_path':str(new),'old_name':'kol-production_database','new_database_started':True})
   self.assertEqual((old/'ledger').read_text(),'reward committed after migration');self.assertEqual((record/'retained-pre-move/kol-production_database/ledger').read_text(),'original')
 def test_rollback_does_not_copy_unused_new_database(self):
  with patch.object(m,'cold_copy') as copy:m.restore_latest_volume({'new_database_started':False});copy.assert_not_called()
 def test_volume_template_rejects_custom_layout(self):
  self.assertIn('DB_VOLUME_NAME',m.volume_template('volumes:\n  database: {}\n'))
  with self.assertRaises(RuntimeError):m.volume_template('volumes:\n  database: customized\n')
  with self.assertRaises(RuntimeError):m.volume_env('DB_VOLUME_NAME=unknown\n','kol-production')
 def test_migrated_templates_remain_managed_without_accepting_custom_changes(self):
  content=(INFRA/'compose/kol/compose.yaml').read_bytes();self.assertTrue(m.p.managed_kol(content));self.assertTrue(m.p.managed_kol(content.replace(b'  database:\n    name: ${DB_VOLUME_NAME:-${COMPOSE_PROJECT_NAME}_database}',b'  database: {}')))
  self.assertFalse(m.p.managed_kol(content.replace(b'max_connections=40',b'max_connections=999')))
 @unittest.skipUnless(os.environ.get('KOL_COMPOSE_CHECK'),'official Compose required')
 def test_compose_resolves_relocated_volume_and_preserves_default(self):
  with tempfile.TemporaryDirectory() as directory,patch.object(m.p,'BASE',Path(directory)),patch.object(m.p,'compose'):
   m.p.init();folder=Path(directory)/'kol-production'
   command=[os.environ['KOL_COMPOSE_CHECK'],'--project-directory',str(folder),'--env-file',str(folder/'.env'),'-f',str(folder/'compose.yaml'),'--profile','tools','config','--format','json']
   config=json.loads(subprocess.check_output(command,text=True));self.assertEqual(config['volumes']['database']['name'],'kol-production_database')
   (folder/'.env').write_text(m.volume_env((folder/'.env').read_text(),'kol-production'))
   config=json.loads(subprocess.check_output(command,text=True));self.assertEqual(config['volumes']['database']['name'],'realms_kol_production_database');self.assertTrue(config['volumes']['database']['external'])
   self.assertEqual(m.p.read_database_volume('kol-production'),'realms_kol_production_database')
if __name__=='__main__':unittest.main()
