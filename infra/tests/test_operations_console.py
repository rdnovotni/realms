import importlib.util,json,os,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch,Mock
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'infra/control_panel'))
import operations,backend
s=importlib.util.spec_from_file_location('console_admin_tests',ROOT/'infra/scripts/console-admin.py');admin=importlib.util.module_from_spec(s);s.loader.exec_module(admin)
r=admin.releases
class OperationsTests(unittest.TestCase):
 def test_unknown_gui_action_never_requests_privileges(self):
  with patch.object(operations.subprocess,'Popen') as popen:
   with self.assertRaises(backend.OperationError):operations.admin_action('delete database',{},lambda _:None)
   popen.assert_not_called()
 def test_release_schema_rejects_changed_removed_and_unapproved_migrations(self):
  before=[{'name':'001.sql','checksum':'a'}];new=before+[{'name':'002.sql','checksum':'b'}]
  self.assertEqual(r.check_schema(before,new,True),['002.sql'])
  for target,allow in [(new,False),([],True),([{'name':'001.sql','checksum':'wrong'}],True)]:
   with self.assertRaises(RuntimeError):r.check_schema(before,target,allow)
 def test_promotion_requires_approval_and_exact_staging_image(self):
  with patch.object(r,'deploy_project') as deploy:
   with self.assertRaises(RuntimeError):r.promote('anything',False)
   deploy.assert_not_called()
  with tempfile.TemporaryDirectory() as directory:
   name='release-20261011T010000Z-abcdef12';folder=Path(directory)/name;folder.mkdir();(folder/'release.json').write_text(json.dumps({'state':'staging_ready','image':'sealed','schema':[]}))
   with patch.object(r,'STATE',Path(directory)),patch.object(r,'current_image',return_value='changed'),patch.object(r,'deploy_project') as deploy:
    with self.assertRaisesRegex(RuntimeError,'Staging has changed'):r.promote(name,True)
    deploy.assert_not_called()
 def test_rollback_cannot_cross_schema_changes(self):
  with tempfile.TemporaryDirectory() as directory:
   name='release-20261011T010000Z-abcdef12';folder=Path(directory)/name;folder.mkdir();(folder/'release.json').write_text(json.dumps({'image':'current','production':{'state':'passed','before_schema':[]}}))
   with patch.object(r,'STATE',Path(directory)),patch.object(r,'current_image',return_value='current'),patch.object(r,'schema',return_value=[{'name':'new.sql','checksum':'abc'}]),patch.object(r.p,'compose') as compose:
    with self.assertRaisesRegex(RuntimeError,'Schema changed'):r.rollback(name,'kol-production')
    compose.assert_not_called()
 def test_failed_staging_handoff_restores_code_only_when_schema_unchanged(self):
  old=[{'name':'001.sql','checksum':'a'}];new=old+[{'name':'002.sql','checksum':'b'}]
  for changed in (False,True):
   with tempfile.TemporaryDirectory() as directory:
    identifier='release-20261011T010000Z-abcdef12';folder=Path(directory)/identifier;folder.mkdir();record={'id':identifier,'schema':new if changed else old,'image':'new-image','allow_migrations':True}
    with patch.object(r,'STATE',Path(directory)),patch.object(r,'schema',side_effect=[old,new if changed else old]),patch.object(r,'current_image',return_value='old-image'),patch.object(r.pg,'inspect'),patch.object(r,'protected_state',return_value={'other-project':'unchanged'}),patch.object(r.p,'operations'),patch.object(r.p,'compose') as compose,patch.object(r,'set_image') as image,patch.object(r.b,'smoke',side_effect=[RuntimeError('readiness failed'),None]):
     with self.assertRaisesRegex(RuntimeError,'readiness failed'):r.deploy_project('kol-staging',record,'staging')
     self.assertEqual(record['state'],'staging_failed')
     if changed:self.assertEqual(image.call_count,1);self.assertIn('schema changed',record['staging']['recovery'])
     else:self.assertEqual(image.call_args.args,('kol-staging','old-image'));self.assertEqual(record['staging']['recovery'],'previous code restored')
     self.assertTrue(all(call.args[0]=='kol-staging' for call in compose.call_args_list))
 def test_promote_passes_only_production_after_staging_smoke(self):
  with tempfile.TemporaryDirectory() as directory:
   identifier='release-20261011T010000Z-abcdef12';folder=Path(directory)/identifier;folder.mkdir();record={'state':'staging_ready','image':'sealed','schema':[],'allow_migrations':False,'manual_test':{'image':'sealed','schema':[],'at':'2026-10-11T00:00:00+00:00'}};(folder/'release.json').write_text(json.dumps(record))
   with patch.object(r,'STATE',Path(directory)),patch.object(r,'current_image',return_value='sealed'),patch.object(r,'schema',return_value=[]),patch.object(r.b,'smoke') as smoke,patch.object(r,'deploy_project') as deploy:
    r.promote(identifier,True);smoke.assert_called_once_with('kol-staging');self.assertEqual(deploy.call_args.args,('kol-production',record,'production'))
 def test_promotion_refuses_missing_manual_test_before_backup(self):
  with tempfile.TemporaryDirectory() as directory:
   identifier='release-20261011T010000Z-abcdef12';folder=Path(directory)/identifier;folder.mkdir();(folder/'release.json').write_text(json.dumps({'state':'staging_ready','image':'sealed','schema':[]}))
   with patch.object(r,'STATE',Path(directory)),patch.object(r,'current_image',return_value='sealed'),patch.object(r,'schema',return_value=[]),patch.object(r.os,'geteuid',return_value=0),patch.object(r.sys if hasattr(r,'sys') else sys,'argv',['releases.py','promote','--release',identifier,'--approve-production']),patch.object(r.p,'run') as command:
    with self.assertRaisesRegex(RuntimeError,'manual staging test'):r.main()
    command.assert_not_called()
 def test_manual_staging_receipt_seals_image_and_schema(self):
  with tempfile.TemporaryDirectory() as directory:
   identifier='release-20261011T010000Z-abcdef12';folder=Path(directory)/identifier;folder.mkdir();record={'state':'staging_ready','image':'sealed','schema':[]};(folder/'release.json').write_text(json.dumps(record))
   with patch.object(r,'STATE',Path(directory)),patch.object(r,'current_image',return_value='sealed'),patch.object(r,'schema',return_value=[]),patch.object(r.b,'smoke'):
    r.verify_staging(identifier,True);saved=json.loads((folder/'release.json').read_text());self.assertEqual(saved['manual_test']['image'],'sealed');self.assertEqual(saved['manual_test']['schema'],[])
 def test_cpu_counter_wrap_and_valid_usage(self):
  self.assertEqual(admin.cpu_percentage({'total':100,'idle':40},{'total':200,'idle':100}),40.0)
  self.assertIsNone(admin.cpu_percentage({'total':200,'idle':100},{'total':100,'idle':40}))
 def test_snapshot_selection_rejects_unknown_id_and_keeps_latest_default(self):
  spec=importlib.util.spec_from_file_location('snapshot_tests',ROOT/'infra/scripts/local-backups.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  rows=[{'id':'a'*64},{'id':'b'*64}]
  self.assertEqual(module.select_snapshot(rows),'a'*64);self.assertEqual(module.select_snapshot(rows,'b'*64),'b'*64)
  with self.assertRaises(RuntimeError):module.select_snapshot(rows,'c'*64)
  with self.assertRaises(ValueError):module.select_snapshot(rows,'../other')
 def test_overwriting_export_keeps_private_permissions_and_refuses_symlink(self):
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/'report';path.write_text('old');path.chmod(0o644)
   operations.save_private(path,'sanitized');self.assertEqual(path.stat().st_mode&0o777,0o600)
   link=Path(directory)/'link';link.symlink_to(path)
   with self.assertRaises(backend.OperationError):operations.save_private(link,'overwrite')
   self.assertEqual(path.read_text(),'sanitized')
 def test_release_id_cannot_escape_state_directory(self):
  for name in ['../secrets','/etc/passwd','release-;reboot']:
   with self.assertRaises(ValueError):r.release_path(name)
 def test_restore_and_capacity_alerts_have_stable_ids(self):
  status={'health':{'kol-production':{'ok':False}},'backup':{},'drive_mounted':False,'resources':{'disk_free':1,'disk_total':100,'memory_available':1},'public':{'ok':False}}
  ids={x['id'] for x in admin.issues(status)}
  self.assertTrue({'health:kol-production','backup:stale','backup:drive','capacity:disk','website:public'}.issubset(ids))
 def test_email_requires_tls_valid_addresses_and_no_header_injection(self):
  cfg={'host':'smtp.example.com','port':587,'tls':'starttls','username':'account','password':'fixture-password','sender':'server@example.com','recipient':'owner@example.com','enabled':True}
  self.assertEqual(admin.validate_email(cfg),cfg)
  for changes in [{'tls':'none'},{'recipient':'bad\nBcc: attacker@example.com'},{'port':0},{'password':'bad\rvalue'}]:
   with self.assertRaises(ValueError):admin.validate_email({**cfg,**changes})
 def test_email_starttls_and_auth_before_send_and_private_storage(self):
  cfg={'host':'smtp.example.com','port':587,'tls':'starttls','username':'account','password':'fixture-password','sender':'server@example.com','recipient':'owner@example.com','enabled':True}
  with tempfile.TemporaryDirectory() as directory,patch.object(admin,'STATE',Path(directory)),patch.object(admin.smtplib,'SMTP') as smtp:
   admin.write_json(Path(directory)/'email.json',cfg);self.assertEqual((Path(directory)/'email.json').stat().st_mode&0o777,0o600)
   admin.send_email('Test','Safe test body');connection=smtp.return_value.__enter__.return_value
   methods=[call[0] for call in connection.method_calls];self.assertLess(methods.index('starttls'),methods.index('login'));self.assertLess(methods.index('login'),methods.index('send_message'))
 def test_email_failure_does_not_disclose_password(self):
  with tempfile.TemporaryDirectory() as directory,patch.object(admin,'STATE',Path(directory)),patch.object(admin,'validate_email'),patch.object(admin,'read_json',return_value={'enabled':True,'host':'x','port':465,'tls':'ssl','username':'x','password':'private-password','sender':'x','recipient':'x'}),patch.object(admin.smtplib,'SMTP_SSL',side_effect=RuntimeError('private-password')):
   with self.assertRaises(RuntimeError) as err:admin.send_email('test','body')
   self.assertNotIn('private-password',str(err.exception));self.assertNotIn('private-password',(Path(directory)/'email-status.json').read_text())
 def test_monitor_alert_transitions_are_not_repeated_and_resolutions_retained(self):
  initial={'captured_at':admin.stamp(),'issues':[{'id':'backup:drive','severity':'critical','message':'USB missing'}],'email':{}}
  healthy={**initial,'issues':[]}
  with tempfile.TemporaryDirectory() as directory,patch.object(admin,'STATE',Path(directory)/'private'),patch.object(admin,'PUBLIC',Path(directory)/'public'),patch.object(admin,'collect',side_effect=[initial,initial,healthy]):
   admin.monitor();admin.monitor();admin.monitor();record=admin.read_json(Path(directory)/'private/alert-state.json')
   self.assertEqual([r['kind'] for r in record['history']],['opened','resolved']);self.assertEqual(record['active'],{})
   self.assertEqual((Path(directory)/'public/status.json').stat().st_mode&0o777,0o644)
 def test_json_and_command_token_redaction(self):
  text='{"TunnelSecret":"private-value"} --token private-cli Cookie: sensitive-cookie'
  clean=backend.redact(text)
  for secret in ('private-value','private-cli','sensitive-cookie'):self.assertNotIn(secret,clean)
 def test_monitoring_bind_change_preserves_executable_and_refuses_custom_commands(self):
  text='[Service]\nUser=fixture\nExecStart=/usr/bin/glances -w -B 0.0.0.0\n'
  fixed=admin.private_monitor_command(text);self.assertIn('"/usr/bin/glances" -w -B 127.0.0.1',fixed)
  self.assertNotIn('0.0.0.0',fixed)
  for command in ['ExecStart=/usr/bin/glances -w --custom','ExecStart=/tmp/untrusted -w -B 0.0.0.0','ExecStart=/usr/bin/glances -w -B 0.0.0.0\nExecStart=/usr/bin/other']:
   with self.assertRaises(RuntimeError):admin.private_monitor_command(command)
 def test_origin_probe_reports_real_tcp_result_and_requires_positive_control(self):
  import socket,threading
  spec=importlib.util.spec_from_file_location('origin_probe',ROOT/'infra/scripts/check-origin-ports.py');probe=importlib.util.module_from_spec(spec);spec.loader.exec_module(probe)
  with socket.socket() as server:
   server.bind(('127.0.0.1',0));server.listen();port=server.getsockname()[1]
   self.assertTrue(probe.probe('127.0.0.1',port)['reachable'])
  self.assertFalse(probe.probe('127.0.0.1',port)['reachable'])
  with patch.object(probe.urllib.request,'urlopen',side_effect=OSError('offline')):
   with self.assertRaises(OSError):probe.connectivity_control()
 def test_runtime_bundle_rejects_symlink_and_has_only_reviewed_scripts(self):
  with tempfile.TemporaryDirectory() as directory:
   base=Path(directory);source=base/'source';(source/'scripts').mkdir(parents=True)
   for name in admin.RUNTIME_FILES:(source/'scripts'/name).write_text('value=1\n')
   target=base/'runtime';admin.runtime_copy(source,target)
   self.assertEqual(set(json.loads((target/'manifest.json').read_text())),set(admin.RUNTIME_FILES))
   self.assertEqual((target/'infra/scripts/console-admin.py').stat().st_mode&0o777,0o644)
   (source/'scripts/console-admin.py').unlink();(source/'scripts/console-admin.py').symlink_to(source/'scripts/releases.py')
   with self.assertRaises(RuntimeError):admin.runtime_copy(source,base/'unsafe')
 def test_protected_runtime_has_complete_monitor_import_dependencies(self):
  with tempfile.TemporaryDirectory() as directory:
   base=Path(directory);target=base/'runtime';admin.runtime_copy(ROOT/'infra',target)
   spec=importlib.util.spec_from_file_location('bundled_console_test',target/'infra/scripts/console-admin.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
   module.STATE=base/'state';module.PUBLIC=base/'public'
   with patch.object(module,'collect',return_value={'issues':[],'email':{},'captured_at':module.stamp()}):module.monitor()
   self.assertTrue((module.PUBLIC/'status.json').is_file())
 def test_monitor_units_validate(self):
  with tempfile.TemporaryDirectory() as directory:
   dest=Path(directory)
   for source in (ROOT/'infra/systemd/console').glob('*.in'):(dest/source.name.removesuffix('.in')).write_text(source.read_text().replace('__SOURCE__',str(ROOT)))
   result=subprocess.run(['systemd-analyze','verify',str(dest/'realms-console-monitor.service')],capture_output=True,text=True)
   self.assertEqual(result.returncode,0,result.stderr)
if __name__=='__main__':unittest.main()
