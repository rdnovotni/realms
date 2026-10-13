import importlib.util,json,subprocess,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
s=importlib.util.spec_from_file_location('studio_model',ROOT/'infra/development_client/model.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
s=importlib.util.spec_from_file_location('studio_snapshot',ROOT/'infra/scripts/git_snapshot.py');snap=importlib.util.module_from_spec(s);s.loader.exec_module(snap)
class DevelopmentTests(unittest.TestCase):
 def entity(self,id='item.sample'):return {'id':id,'kind':'ITEM','revision':1,'schemaVersion':1,'definition':{'name':'Sample','dependencies':[],'public':{'description':'A development draft.'}}}
 def package(self):return {'version':'test','engineVersion':'foundation-1','entities':[self.entity()]}
 def test_content_updates_bump_revision_without_modifying_input(self):
  original=self.package();entry=self.entity();entry['definition']['name']='Changed';updated=m.update_entity(original,entry,'item.sample')
  self.assertEqual(updated['entities'][0]['revision'],2);self.assertEqual(original['entities'][0]['definition']['name'],'Sample');self.assertNotEqual(updated['version'],original['version'])
 def test_existing_ids_and_types_cannot_be_reassigned(self):
  for id,kind in [('item.renamed','ITEM'),('item.sample','QUEST')]:
   e=self.entity(id);e['kind']=kind
   with self.assertRaises(ValueError):m.update_entity(self.package(),e,'item.sample')
  with self.assertRaises(ValueError):m.update_entity(self.package(),self.entity())
 def test_backend_validator_rejects_missing_dependencies_and_invalid_inventory(self):
  for value in ('dependency','inventory'):
   pkg=self.package()
   if value=='dependency':pkg['entities'][0]['definition']['dependencies']=['missing.item']
   else:pkg['entities'][0]['definition']['mechanics']={'inventory':{'version':1,'category':'EQUIPMENT','storageMode':'STACK'}}
   with self.assertRaises(ValueError):m.validate_package(pkg)
 def test_backend_validates_quest_definitions_without_database(self):
  pkg=self.package();pkg['entities'][0]['kind']='QUEST';self.assertIn('No database',m.validate_package(pkg))
 def test_failed_validation_never_overwrites_saved_content(self):
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'game.json';path.write_text('retained')
   with patch.object(m,'validate_package',side_effect=ValueError('invalid')):
    with self.assertRaises(ValueError):m.save_package(self.package(),path)
   self.assertEqual(path.read_text(),'retained')
 def test_private_or_unrelated_files_never_enter_checkpoints(self):
  for path in ('realms/.env','realms/.state/db','infra/secrets/password','../escape','/etc/passwd','photo.png','realms/key.pem'):
   self.assertFalse(m.allowed(path),path)
  for path in ('realms/content/game.json','infra/development_client/app.py','realms/.env.example','.github/workflows/checks.yml'):self.assertTrue(m.allowed(path),path)
 def test_push_refuses_changes_before_network_or_deployment(self):
  with patch.object(m,'assert_master'),patch.object(m,'head',return_value='a'*40),patch.object(m,'managed_changes',return_value=['realms/content/game.json']),patch.object(m,'git') as git:
   with self.assertRaises(RuntimeError):m.push_master('a'*40)
   git.assert_not_called()
 def test_session_token_is_only_passed_to_git_environment(self):
  with patch.object(m,'AUTH_TOKEN','session-value'),patch.object(m.subprocess,'run') as run:
   run.return_value.returncode=0;run.return_value.stdout='';m.git('status')
   self.assertNotIn('session-value',str(run.call_args.args));self.assertEqual(run.call_args.kwargs['env']['REALMS_STUDIO_GITHUB_TOKEN'],'session-value')
 def repository(self,base):
  subprocess.run(['git','init','-q',base],check=True);subprocess.run(['git','-C',base,'config','user.name','Test'],check=True);subprocess.run(['git','-C',base,'config','user.email','test@example.invalid'],check=True)
 def commit(self,base):
  subprocess.run(['git','-C',base,'add','.'],check=True);subprocess.run(['git','-C',base,'commit','-qm','snapshot'],check=True)
  return subprocess.check_output(['git','-C',base,'rev-parse','HEAD'],text=True).strip()
 def test_frozen_build_uses_commit_not_uncommitted_source(self):
  with tempfile.TemporaryDirectory() as d,tempfile.TemporaryDirectory() as out:
   self.repository(d);file=Path(d)/'source.txt';file.write_text('recorded');sha=self.commit(d);file.write_text('changed after commit')
   self.assertEqual(snap.freeze(sha,out,Path(d))['source_commit'],sha);self.assertEqual((Path(out)/'source.txt').read_text(),'recorded')
 def test_source_snapshot_rejects_tracked_secrets_symlinks_and_archive_transforms(self):
  for kind in ('secret','symlink','transform'):
   with tempfile.TemporaryDirectory() as d,tempfile.TemporaryDirectory() as out:
    self.repository(d);file=Path(d)/'source.txt';file.write_text('$Format:%H$')
    if kind=='secret':(Path(d)/'.env').write_text('private')
    if kind=='symlink':(Path(d)/'link').symlink_to(file)
    if kind=='transform':(Path(d)/'.gitattributes').write_text('source.txt export-subst\n')
    sha=self.commit(d)
    with self.assertRaises(ValueError):snap.freeze(sha,out,Path(d))

 def test_publication_phases_are_retained_without_credentials(self):
  with tempfile.TemporaryDirectory() as d,patch.object(m,'ROOT',Path(d)):
   m.record_publication('release-example','a'*40,'github_updated_live_pending')
   self.assertEqual(m.publication_history()[0]['state'],'github_updated_live_pending')
   self.assertEqual((Path(d)/'.development/publications.json').stat().st_mode&0o777,0o600)
