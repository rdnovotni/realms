import importlib.util,json,os,subprocess,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
INFRA=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('docker_projects',INFRA/'scripts/docker-projects.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
class ProjectTests(unittest.TestCase):
    def test_init_preserves_existing_secrets_and_stages_unique_projects(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(p,'BASE',Path(directory)),patch.object(p,'compose') as compose:
            p.init(); password=(Path(directory)/'kol-staging/secrets/db_password').read_text()
            p.init();self.assertEqual(password,(Path(directory)/'kol-staging/secrets/db_password').read_text())
            self.assertEqual(compose.call_count,5)
            for name in p.PROJECTS:
                path=Path(directory)/name
                self.assertEqual((path/'.env').stat().st_mode&0o777,0o600)
                self.assertIn('COMPOSE_PROJECT_NAME='+name,(path/'.env').read_text())
            self.assertEqual((Path(directory)/'kol-staging/secrets').stat().st_mode&0o777,0o700)
            self.assertNotEqual(password,(Path(directory)/'kol-production/secrets/db_password').read_text())
    def test_up_never_migrates_and_down_never_deletes_volumes(self):
        import argparse
        with patch.object(p,'compose') as compose:
            p.operations(argparse.Namespace(project='kol-staging',action='up'))
            self.assertNotIn('setup',str(compose.call_args_list))
            compose.reset_mock();p.operations(argparse.Namespace(project='kol-staging',action='down'))
            compose.assert_called_once_with('kol-staging','down')
    def test_refresh_original_templates_preserves_credentials_and_only_validates(self):
        with tempfile.TemporaryDirectory() as directory,patch.object(p,'BASE',Path(directory)),patch.object(p,'compose') as compose:
            p.init();compose.reset_mock()
            password=(Path(directory)/'kol-staging/secrets/db_password').read_bytes()
            env=(Path(directory)/'kol-staging/.env').read_bytes()
            frontend='  frontend:\n    driver_opts: {com.docker.network.bridge.host_binding_ipv4: "127.0.0.1"}\n'
            for name,(kind,_) in p.PROJECTS.items():
                path=Path(directory)/name/'compose.yaml';text=(INFRA/'tests/fixtures/kol-infra004.yaml').read_text() if kind=='kol' else path.read_text()
                text=text.replace(frontend,'')
                if kind=='kol': text=text.replace('    networks: [private, frontend]\n','')
                else:text=text.replace('    networks: [private, frontend]','    networks: [private]')
                path.write_text(text)
            p.refresh_templates()
            self.assertEqual(compose.call_count,5)
            for call in compose.call_args_list: self.assertEqual(call.args[1:],('--profile','setup','config','--quiet'))
            self.assertEqual(password,(Path(directory)/'kol-staging/secrets/db_password').read_bytes())
            self.assertEqual(env,(Path(directory)/'kol-staging/.env').read_bytes())
            self.assertEqual(len(list((Path(directory)/'kol-staging').glob('compose.before-refresh-*.yaml'))),1)

    def test_refresh_rejects_custom_configuration_without_touching_other_projects(self):
        with tempfile.TemporaryDirectory() as directory,patch.object(p,'BASE',Path(directory)),patch.object(p,'compose'):
            p.init();path=Path(directory)/'example-project/compose.yaml'
            path.write_text('# operator configuration\n')
            before=(Path(directory)/'kol-production/compose.yaml').read_bytes()
            with self.assertRaises(SystemExit):p.refresh_templates()
            self.assertEqual(path.read_text(),'# operator configuration\n')
            self.assertEqual(before,(Path(directory)/'kol-production/compose.yaml').read_bytes())

    @unittest.skipUnless(os.environ.get('KOL_COMPOSE_CHECK'),'set KOL_COMPOSE_CHECK to official standalone Compose binary')
    def test_real_compose_schema_and_isolation(self):
        with tempfile.TemporaryDirectory() as directory,patch.object(p,'BASE',Path(directory)),patch.object(p,'compose'):
            p.init();configs={}
            for name in p.PROJECTS:
                path=Path(directory)/name
                result=subprocess.check_output([os.environ['KOL_COMPOSE_CHECK'],'--project-directory',str(path),'--env-file',str(path/'.env'),'-f',str(path/'compose.yaml'),'--profile','setup','config','--format','json'],text=True)
                c=json.loads(result);configs[name]=c
                self.assertEqual(c['name'],name)
                self.assertTrue(c['networks']['private']['internal'])
                self.assertEqual(c['networks']['private']['name'],name+'_private')
                self.assertFalse(c['networks']['frontend'].get('internal',False))
                for service in c['services'].values():
                    if service.get('ports'): self.assertIn('frontend',service['networks'])
                    else: self.assertNotIn('frontend',service['networks'])
                for service in c['services'].values():
                    self.assertRegex(str(service['mem_limit']),r'^[1-9][0-9]*([kmgtKMGT][bB]?)?$')
                    self.assertEqual(service['logging']['driver'],'local')
                    for port in service.get('ports',[]):self.assertEqual(port['host_ip'],'127.0.0.1')
                    self.assertNotIn('container_name',service)
                    mounts=service.get('tmpfs',[])
                    self.assertTrue(all(m.startswith('/') for m in mounts), 'every tmpfs entry must have an absolute mount path')
                    if name.startswith('kol-') and service is not c['services']['db']:
                        self.assertEqual(mounts,['/tmp:size=64m,mode=1777'])
                if name.startswith('kol-'):
                    self.assertNotIn('ports',c['services']['db'])
                    self.assertRegex(c['services']['db']['image'],r'^postgres:18\.6-bookworm@sha256:[0-9a-f]{64}$')
                    self.assertEqual({x['source'] for x in c['services']['setup']['secrets']},{'migration_password'})
                    self.assertEqual({x['source'] for x in c['services']['bootstrap']['secrets']},{'db_password','migration_password','app_password','worker_password','scheduler_password'})
                    self.assertEqual(c['services']['api']['environment']['DB_NAME'],name.replace('-','_'))
                    self.assertEqual(c['volumes']['database']['name'],name+'_database')
                    app=c['services']['api'];self.assertEqual(app['user'],'10001:10001' if name=='kol-production' else '10002:10002')
                    self.assertEqual({x['source'] for x in app['secrets']},{'app_password','throttle_key','cache_password','ingress_key'})
                    self.assertNotIn('DATABASE_ADMIN_URL',app.get('environment',{}))
                else:self.assertEqual(c['volumes']['data']['name'],name+'_data')
            self.assertNotEqual(configs['kol-production']['secrets']['db_password']['file'],configs['kol-staging']['secrets']['db_password']['file'])
if __name__=='__main__':unittest.main()
