import contextlib,io,importlib.util,json,os,shutil,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch,Mock
INFRA=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('local_backup',INFRA/'scripts/local-backups.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class BackupSafetyTests(unittest.TestCase):
 def test_resume_verifies_existing_snapshot_before_enabling_timers(self):
  with tempfile.TemporaryDirectory() as directory:
   config=Path(directory)/'config';config.touch();fstab=Path(directory)/'fstab';fstab.write_text('fixture-mount-line\n');events=[]
   with patch.object(m,'CONFIG',config),patch.object(m,'FSTAB',fstab),patch.object(m,'read_config',return_value={'fstab_line':'fixture-mount-line'}),patch.object(m,'check_target'),patch.object(m,'run_backup') as backup,patch.object(m,'restore_check',side_effect=lambda:events.append('restore')),patch.object(m,'install_units',side_effect=lambda:events.append('timers')):
    m.finish_setup();self.assertEqual(events,['restore','timers']);backup.assert_not_called()
   with patch.object(m,'CONFIG',config),patch.object(m,'FSTAB',fstab),patch.object(m,'read_config',return_value={'fstab_line':'fixture-mount-line'}),patch.object(m,'check_target'),patch.object(m,'restore_check',side_effect=RuntimeError('verification failed')),patch.object(m,'install_units') as timers:
    with self.assertRaises(RuntimeError):m.finish_setup()
    timers.assert_not_called()
   config.unlink()
   with patch.object(m,'CONFIG',config),patch.object(m,'install_units') as timers:
    with self.assertRaises(RuntimeError):m.finish_setup()
    timers.assert_not_called()
 def test_long_command_heartbeat_does_not_disclose_captured_output(self):
  messages=io.StringIO()
  with contextlib.redirect_stdout(messages):
   result=m.command([sys.executable,'-c',"import time; print('private-fixture',flush=True); time.sleep(0.12)"],progress_interval=0.04)
  self.assertIn('private-fixture',result);self.assertIn('Still working:',messages.getvalue());self.assertNotIn('private-fixture',messages.getvalue())
 def test_interrupted_command_stops_and_reaps_helper(self):
  process=Mock();process.communicate.side_effect=[KeyboardInterrupt(),('','')]
  with patch.object(m.subprocess,'Popen',return_value=process):
   with self.assertRaises(KeyboardInterrupt):m.command(['fixture-helper'])
  process.kill.assert_called_once();self.assertEqual(process.communicate.call_count,2)
 def test_restore_waits_for_final_server_and_preserves_failed_startup_logs(self):
  stopped=subprocess.CompletedProcess([],0,'false\n','')
  waiting=subprocess.CompletedProcess([],1,b'',b'')
  ready=subprocess.CompletedProcess([],0,b'',b'')
  running=subprocess.CompletedProcess([],0,'true\n','')
  with patch.object(m.subprocess,'run',side_effect=[waiting,running,ready]) as run,patch.object(m.time,'sleep'):
   m.wait_restore_ready('fixture','admin')
   self.assertIn('/proc/1/comm',run.call_args_list[0].args[0][-3]);self.assertIn('/var/run/postgresql',run.call_args_list[0].args[0][-3])
  logs=subprocess.CompletedProcess([],0,b'init failed',b'detail')
  with tempfile.TemporaryDirectory() as directory,patch.object(m,'STATE',Path(directory)),patch.object(m.subprocess,'run',side_effect=[waiting,stopped,logs]),patch.object(m.time,'sleep') as sleep:
   with self.assertRaisesRegex(RuntimeError,'last-restore-startup.log'):m.wait_restore_ready('fixture','admin')
   sleep.assert_not_called();log=Path(directory)/'last-restore-startup.log';self.assertIn(b'init failed',log.read_bytes());self.assertEqual(log.stat().st_mode&0o777,0o600)
 def test_restore_mount_parent_is_private_and_owned_by_image_postgres(self):
  with patch.object(m,'command',side_effect=['999\n','999\n']) as command:
   identity=m.restore_identity('fixture-saved-image');self.assertEqual(identity,(999,999))
   for call in command.call_args_list:self.assertIn('none',call.args[0]);self.assertIn('fixture-saved-image',call.args[0])
  with patch.object(m,'command',return_value='0'):
   with self.assertRaises(RuntimeError):m.restore_identity('fixture-saved-image')
  with tempfile.TemporaryDirectory() as directory,patch.object(m.os,'chown') as chown:
   base=Path(directory)/'restore';data,sockets=m.restore_directories(base,identity)
   self.assertEqual(data.stat().st_mode&0o777,0o700);self.assertEqual(base.stat().st_mode&0o777,0o700)
   self.assertEqual(chown.call_args_list[0].args,(data,999,999));self.assertEqual(chown.call_args_list[1].args,(sockets,999,999))
 def test_wrong_or_absent_drive_never_accepts_internal_folder(self):
  cfg={'uuid':'expected','target_id':'target'}
  for info in [None,{'uuid':'other','fstype':'ntfs3'},{'uuid':'expected','fstype':'ext4'}]:
   with patch.object(m,'mounted_info',return_value=info):
    with self.assertRaises(RuntimeError):m.check_target(cfg)
 def test_marker_and_symlink_repositories_cannot_be_adopted(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);folder=root/'Realms-Backups';folder.mkdir();repo=folder/'restic';repo.mkdir();(folder/'target.json').write_text('{"id":"wrong"}')
   cfg={'uuid':'expected','target_id':'expected','repository':str(repo)}
   with patch.object(m,'MOUNT',root),patch.object(m,'mounted_info',return_value={'uuid':'expected','fstype':'ntfs3'}):
    with self.assertRaises(RuntimeError):m.check_target(cfg)
    (folder/'target.json').write_text('{"id":"expected"}');self.assertEqual(m.check_target(cfg),repo)
    repo.rmdir();repo.symlink_to(root,target_is_directory=True)
    with self.assertRaises(RuntimeError):m.check_target(cfg)
 def test_retention_is_dry_run_unless_explicitly_applied(self):
  with patch.object(m,'restic',return_value='') as restic:
   m.retention();self.assertIn('--dry-run',restic.call_args.args[0]);self.assertNotIn('--prune',restic.call_args.args[0])
   m.retention(True);self.assertIn('--prune',restic.call_args.args[0]);self.assertIn(m.TAG,restic.call_args.args[0])
 @unittest.skipUnless(Path('/usr/bin/restic').is_file(),'restic required')
 def test_actual_encrypted_backup_restore_and_wrong_password_denial(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);state=root/'state';state.mkdir(mode=0o700);key=state/'key';key.write_text('fixture-password-not-a-real-credential');key.chmod(0o600)
   folder=root/'Realms-Backups';folder.mkdir();repo=folder/'restic';repo.mkdir();(folder/'target.json').write_text('{"id":"expected"}')
   cfg={'uuid':'expected','target_id':'expected','repository':str(repo)};source=root/'source';source.mkdir();data=b'private encrypted database fixture contents';(source/'database.dump').write_bytes(data)
   with patch.object(m,'MOUNT',root),patch.object(m,'STATE',state),patch.object(m,'KEY',key),patch.object(m,'mounted_info',return_value={'uuid':'expected','fstype':'ntfs3'}):
    m.restic(['init'],cfg);m.restic(['backup','--quiet',source],cfg)
    self.assertFalse(any(data in path.read_bytes() for path in repo.rglob('*') if path.is_file()))
    restored=root/'recovered';m.restic(['restore','latest','--target',restored,'--verify'],cfg);self.assertEqual((restored/str(source).lstrip('/')/'database.dump').read_bytes(),data)
    m.restic(['check','--read-data'],cfg);key.write_text('wrong-password')
    with self.assertRaises(RuntimeError):m.restic(['snapshots'],cfg)
 def test_timer_and_service_definitions_pass_systemd_validation(self):
  if not shutil.which('systemd-analyze'):self.skipTest('systemd validator required')
  with tempfile.TemporaryDirectory() as directory:
   folder=Path(directory)
   for source in (INFRA/'systemd/backups').glob('realms-backup*.in'):(folder/source.name.removesuffix('.in')).write_text(source.read_text())
   result=subprocess.run(['systemd-analyze','verify',*[str(p) for p in folder.glob('*.service')]],capture_output=True,text=True)
   self.assertEqual(result.returncode,0,result.stderr)
   for expr in ['*-*-* 00,06,12,18:20:00','Sun *-*-* 03:30:00']:subprocess.run(['systemd-analyze','calendar',expr],check=True,capture_output=True)

@unittest.skipUnless(os.environ.get('KOL_BACKUP_PG_BIN') and os.environ.get('KOL_BACKUP_NODE'),'isolated PostgreSQL binaries required')
class BackupDatabaseRestoreTests(unittest.TestCase):
 def test_full_role_and_database_restore_with_game_integrity_checks(self):
  bins=Path(os.environ['KOL_BACKUP_PG_BIN']);node=os.environ['KOL_BACKUP_NODE'];env=dict(os.environ)
  with tempfile.TemporaryDirectory(prefix='realms-backup-pg-') as directory:
   root=Path(directory);clusters=[]
   try:
    for label,user in [('source','source_admin'),('restore','restore_admin')]:
     base=root/label;base.mkdir();data=base/'data';socket=base/'socket';socket.mkdir();clusters.append((data,socket,user))
     m.command([bins/'initdb','-D',data,'-U',user,'--auth-local=trust','--auth-host=reject','--no-instructions','--locale=C','-L',os.environ['KOL_BACKUP_PG_SHARE']],env=env)
     m.command([bins/'pg_ctl','-D',data,'-l',base/'postgres.log','-o',f"-c listen_addresses='' -c unix_socket_directories={socket} -c shared_buffers=32MB",'-w','start'],env=env)
    source,restore=clusters
    def psql(cluster,sql,database='postgres'):
     return m.command([bins/'psql','-h',cluster[1],'-U',cluster[2],'-d',database,'-v','ON_ERROR_STOP=1','-Atc',sql],env=env)
    psql(source,'CREATE ROLE realms_app; CREATE ROLE realms_migrator; CREATE ROLE realms_worker; CREATE ROLE realms_scheduler;')
    psql(source,'CREATE DATABASE source_game;')
    sourceurl='postgresql://source_admin@localhost/source_game?host='+str(source[1]);module=(INFRA.parent/'realms/dist/database.js').as_uri()
    m.command([node,'--input-type=module','-e',f"import {{poolFor,migrate}} from {json.dumps(module)}; const p=poolFor(process.env.PROBE_DATABASE_URL); try{{await migrate(p);}}finally{{await p.end();}}"],env={**env,'PROBE_DATABASE_URL':sourceurl})
    psql(source,"CREATE TABLE backup_probe(id int PRIMARY KEY,value text); INSERT INTO backup_probe VALUES(1,'restored correctly');",'source_game')
    archive=root/'database.dump';globals=root/'globals.sql'
    m.output_file([bins/'pg_dump','-h',source[1],'-U',source[2],'-Fc','source_game'],archive,env)
    m.output_file([bins/'pg_dumpall','-h',source[1],'-U',source[2],'--globals-only'],globals,env)
    with globals.open('rb') as src:m.command([bins/'psql','-h',restore[1],'-U',restore[2],'-d','postgres','-v','ON_ERROR_STOP=1'],stdin=src,env=env)
    name='realms_restore_'+'a'*16;psql(restore,'CREATE DATABASE '+name)
    with archive.open('rb') as src:m.command([bins/'pg_restore','-h',restore[1],'-U',restore[2],'-d',name,'--exit-on-error'],stdin=src,env=env)
    self.assertEqual(psql(restore,'SELECT value FROM backup_probe',name).strip(),'restored correctly')
    url='postgresql://restore_admin@localhost/'+name+'?host='+str(restore[1])
    result=m.command([node,INFRA.parent/'realms/dist/restore-check.js'],env={**env,'RESTORE_DATABASE_URL':url})
    self.assertIn('Restore verified',result)
   finally:
    for data,socket,user in reversed(clusters):subprocess.run([str(bins/'pg_ctl'),'-D',str(data),'-m','fast','-w','stop'],env=env,capture_output=True)
if __name__=='__main__':unittest.main()
