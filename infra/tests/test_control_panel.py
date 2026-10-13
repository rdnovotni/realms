#!/usr/bin/env python3
import json
import os
from pathlib import Path
import subprocess
import sys
sys.dont_write_bytecode=True
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).parents[1]/'control_panel'))
import backend
import deploy

class BackendTests(unittest.TestCase):
    def test_parse_two_units_and_preserve_spaces(self):
        result=backend.parse_units('Id=kol-realms.service\nActiveState=active\nWorkingDirectory=/tmp/a folder\n\nId=kol-postgresql.service\nActiveState=failed\n')
        self.assertEqual(result['kol-realms.service']['WorkingDirectory'],'/tmp/a folder')
        self.assertEqual(result['kol-postgresql.service']['ActiveState'],'failed')
    def test_query_failure_is_not_reported_as_inactive(self):
        with patch.object(backend,'command',side_effect=backend.OperationError('bus unavailable')):
            with self.assertRaises(backend.OperationError):backend.units()
    def test_actions_are_allowlisted_and_no_shell(self):
        with patch.object(backend,'command',return_value='') as run:
            backend.service_action('stop')
            self.assertEqual(run.call_args.args[0],['pkexec','/usr/bin/systemctl','stop','kol-realms.service','kol-postgresql.service'])
            with self.assertRaises(backend.OperationError):backend.service_action('stop; reboot')
    def test_redaction(self):
        raw='DATABASE_URL=postgresql://user:secret@localhost/db Authorization: Bearer abcDEF123 password=hunter2'
        cleaned=backend.redact(raw)
        for value in ('secret','abcDEF123','hunter2'):self.assertNotIn(value,cleaned)
    def test_environment_does_not_pass_admin_secrets(self):
        with patch.dict(os.environ,{'DATABASE_ADMIN_URL':'secret','AUTH_ENROLL_PASSWORD':'private','DEV_API_TOKEN':'token'}):
            cleaned=backend.environment()
            for key in ('DATABASE_ADMIN_URL','AUTH_ENROLL_PASSWORD','DEV_API_TOKEN'):self.assertNotIn(key,cleaned)
    def test_backup_relative_path_from_other_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            runtime=Path(tmp)/'project';archive=runtime/'.state/backups/test.dump';archive.parent.mkdir(parents=True);archive.write_bytes(b'dump')
            with patch.object(backend,'command',side_effect=['Backup created: .state/backups/test.dump','']):
                self.assertEqual(backend.backup(runtime),archive)
    def test_database_failed_query_has_no_secret_error(self):
        with patch.object(backend,'command',return_value='{"ok":false,"error":"Database query failed","code":"28P01"}'):
            self.assertEqual(backend.database(Path('/tmp/project'))['code'],'28P01')

class DeploymentTests(unittest.TestCase):
    def fixtures(self,root):
        source=root/'source';stage=root/'stage';runtime=root/'runtime';previous=root/'previous'
        for p in (source,stage,runtime,previous):p.mkdir()
        for name in deploy.SOURCE:
            if name in ('src','client','scripts','migrations','test'):
                (source/name).mkdir();(source/name/'sample').write_text('new '+name)
            else:(source/name).write_text('{"name":"realms-server"}' if name=='package.json' else '{}')
        return source,stage,runtime,previous
    def test_snapshot_excludes_credentials_and_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            source,stage,runtime,previous=self.fixtures(Path(tmp))
            (source/'.env').write_text('SECRET');(source/'.state').mkdir();(source/'.state/secret').write_text('SECRET')
            (source/'client/.env.private').write_text('SECRET')
            deploy.copy_source(source,stage)
            self.assertFalse((stage/'.env').exists());self.assertFalse((stage/'.state').exists());self.assertFalse((stage/'client/.env.private').exists())
    def test_source_symlink_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            source,stage,runtime,previous=self.fixtures(Path(tmp))
            (source/'src/link').symlink_to('/etc/passwd')
            with self.assertRaises(backend.OperationError):deploy.copy_source(source,stage)
    def test_partial_swap_restores_old_artifacts_and_preserves_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source,stage,runtime,previous=self.fixtures(root)
            for name in deploy.ARTIFACTS:
                (stage/name).write_text('new')
                (runtime/name).write_text('old')
            state=runtime/'.state';state.mkdir();(state/'data').write_text('keep data')
            manifest={'files':[]}
            real_replace=os.replace
            def failing_replace(a,b):
                if Path(a)==stage/'client':raise OSError('simulated interruption')
                return real_replace(a,b)
            with patch.object(deploy.os,'replace',side_effect=failing_replace):
                with self.assertRaises(OSError):deploy.swap_artifacts(stage,runtime,previous,manifest)
            deploy.restore_artifacts(runtime,previous,manifest)
            for name in deploy.ARTIFACTS:self.assertEqual((runtime/name).read_text(),'old')
            self.assertEqual((state/'data').read_text(),'keep data')
    def test_successful_swap_can_restore_previous_code(self):
        with tempfile.TemporaryDirectory() as tmp:
            source,stage,runtime,previous=self.fixtures(Path(tmp))
            for name in deploy.ARTIFACTS:(stage/name).write_text('new');(runtime/name).write_text('old')
            manifest={'files':[]};deploy.swap_artifacts(stage,runtime,previous,manifest)
            self.assertTrue(all((runtime/n).read_text()=='new' for n in deploy.ARTIFACTS))
            deploy.restore_artifacts(runtime,previous,manifest)
            self.assertTrue(all((runtime/n).read_text()=='old' for n in deploy.ARTIFACTS))
    def test_schema_deployment_cannot_automatically_roll_back(self):
        with patch.object(deploy,'history',return_value=[{'status':'deployed','migrations_applied':True}]):
            with self.assertRaisesRegex(backend.OperationError,'database migrations'):deploy.rollback(Path('/tmp/project'),lambda _:None)
    def test_operations_are_mutually_exclusive(self):
        with tempfile.TemporaryDirectory() as tmp:
            with deploy.operation_lock(Path(tmp)):
                with self.assertRaises(backend.OperationError):
                    with deploy.operation_lock(Path(tmp)):pass



class WorkflowTests(unittest.TestCase):
    def run_workflow(self, root, pending=False, fail_start=False):
        import pwd
        runtime=root/'runtime';source=root/'source';runtime.mkdir();source.mkdir()
        (runtime/'.local').mkdir();(runtime/'.state').mkdir();(runtime/'.state/data').write_text('persistent')
        (runtime/'.env').write_text('PRIVATE')
        for name in deploy.ARTIFACTS:(runtime/name).write_text('old')
        info={'kol-realms.service':{'User':pwd.getpwuid(os.getuid()).pw_name,'ActiveState':'active'},'kol-postgresql.service':{'ActiveState':'active'}}
        def copy(source,stage):
            for name in deploy.ARTIFACTS:(stage/name).write_text('new')
        calls=[]
        def action(name):
            calls.append(name)
            if fail_start and calls.count('start_api')==1 and name=='start_api':raise backend.OperationError('new release failed')
        probe={'ok':True,'changed':[],'extra':[],'pending':['002.sql'] if pending else []}
        with patch.object(backend,'units',return_value=info),patch.object(deploy,'copy_source',side_effect=copy),patch.object(backend,'command',return_value='checks passed'),patch.object(backend,'database',return_value=probe),patch.object(backend,'backup',return_value=runtime/'.state/backup.dump') as backup,patch.object(backend,'service_action',side_effect=action),patch.object(backend,'health',return_value={'ok':True}):
            if pending:
                with self.assertRaisesRegex(backend.OperationError,'Pending migrations'):deploy.deploy(source,runtime,False,lambda _:None)
                backup.assert_not_called();self.assertEqual(calls,[])
            elif fail_start:
                with self.assertRaisesRegex(backend.OperationError,'new release failed'):deploy.deploy(source,runtime,False,lambda _:None)
                self.assertEqual(calls,['stop_api','start_api','stop_api','start_api'])
            else:
                release=deploy.deploy(source,runtime,False,lambda _:None)
                self.assertEqual(calls,['stop_api','start_api']);self.assertEqual(deploy.history(runtime)[0]['status'],'deployed')
            expected='old' if pending or fail_start else 'new'
            for name in deploy.ARTIFACTS:self.assertEqual((runtime/name).read_text(),expected)
            self.assertEqual((runtime/'.env').read_text(),'PRIVATE')
            self.assertEqual((runtime/'.state/data').read_text(),'persistent')
    def test_successful_deployment_preserves_database_and_credentials(self):
        with tempfile.TemporaryDirectory() as tmp:self.run_workflow(Path(tmp))
    def test_pending_schema_refuses_before_backup_or_stop(self):
        with tempfile.TemporaryDirectory() as tmp:self.run_workflow(Path(tmp),pending=True)
    def test_failed_new_service_restores_previous_code(self):
        with tempfile.TemporaryDirectory() as tmp:self.run_workflow(Path(tmp),fail_start=True)

if __name__=='__main__':unittest.main()
