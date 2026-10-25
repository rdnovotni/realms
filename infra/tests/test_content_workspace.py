import copy,importlib.util,json,re,sys,tempfile,threading,unittest,urllib.request,urllib.error
from pathlib import Path
from unittest.mock import Mock
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'infra/development_client'))
import workspace as w
import studio_web
DEMO=json.loads((ROOT/'realms/test/fixtures/studio-demo.json').read_text())
class WorkspaceTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.publisher=Mock(side_effect=lambda package:{'status':'passed','scope':'DISPOSABLE_CLUSTER_ONLY','inputSha256':w.digest(package),'clusterStopped':True,'sealed':True})
  self.ws=w.Workspace(Path(self.temp.name)/'workspace',initial=DEMO,publisher=self.publisher);self.author={'author':'Fixture author','note':'Reviewed ordinary content change'}
 def tearDown(self):self.temp.cleanup()
 def action(self,operation,**data):return self.ws.request(operation,{**self.author,**data},self.ws.request('read')['etag'])
 def edit(self,id,mutate):
  e=copy.deepcopy(next(e for e in self.ws.request('read')['package']['entities'] if e['id']==id));mutate(e);return self.action('save',entity=e,original=id,tags=['slice'])
 def candidate(self):self.action('candidate');return self.ws.request('read')['candidates'][-1]['id']
 def approve(self):
  id=self.candidate();self.action('stage',candidate=id);self.action('approve',candidate=id,confirmed=True);return id
 def test_real_backend_rejects_invalid_graph_as_candidate_but_retains_repairable_draft(self):
  self.edit('quest.studio_cart',lambda e:e['definition']['mechanics']['questObjectives']['nodes'][1].update(next=[]))
  result=self.ws.request('analyze');self.assertFalse(result['valid']);self.assertTrue(any(d['code']=='QUEST_DEAD_END' for d in result['diagnostics']))
  before=self.ws.file.read_bytes()
  with self.assertRaisesRegex(ValueError,'diagnostics'):self.candidate()
  self.assertEqual(before,self.ws.file.read_bytes())
 def test_stale_window_does_not_overwrite_newer_state(self):
  old=self.ws.request('read')['etag'];self.edit('item.ore',lambda e:e['definition'].update(name='New ore'));before=self.ws.file.read_bytes()
  with self.assertRaisesRegex(ValueError,'another window'):self.ws.request('disable',{**self.author,'disabled':True},old)
  self.assertEqual(before,self.ws.file.read_bytes())
 def test_no_approval_without_disposable_proof_or_confirmation(self):
  id=self.candidate()
  with self.assertRaisesRegex(ValueError,'staging proof'):self.action('approve',candidate=id,confirmed=True)
  self.action('stage',candidate=id)
  with self.assertRaisesRegex(ValueError,'Review the diff'):self.action('approve',candidate=id,confirmed=False)
  self.action('approve',candidate=id,confirmed=True);self.assertEqual(self.ws.request('read')['candidates'][0]['status'],'APPROVED')
 def test_candidate_snapshot_remains_immutable_when_draft_changes(self):
  id=self.approve();snapshot=copy.deepcopy(self.ws._load()['candidates'][0]['package'])
  self.edit('monster.tactical',lambda e:e['definition']['mechanics']['tacticalUnit']['stats'].update(maxHealth=17))
  self.assertEqual(self.ws._load()['candidates'][0]['package'],snapshot);self.assertEqual(w.digest(snapshot),id)
  self.assertEqual(next(r for r in self.ws.request('read')['rows'] if r['id']=='monster.tactical')['status'],'DRAFT')
 def test_failed_staging_keeps_candidate_and_file_unchanged(self):
  id=self.candidate();before=self.ws.file.read_bytes();self.publisher.side_effect=ValueError('test failure')
  with self.assertRaises(ValueError):self.action('stage',candidate=id)
  self.assertEqual(before,self.ws.file.read_bytes())
 def test_rename_updates_inbound_revisions_and_prevents_identity_reuse(self):
  id=self.candidate();snapshot=copy.deepcopy(self.ws._load()['candidates'][0]['package']);plan=self.ws.request('rename-plan',{'id':'item.ore','replacement':'item.reed_ore'});self.assertIn('loot.tactical',plan['inbound'])
  self.action('rename',id='item.ore',replacement='item.reed_ore');state=self.ws.request('read');loot=next(e for e in state['package']['entities'] if e['id']=='loot.tactical');self.assertEqual(loot['revision'],2);self.assertEqual(loot['definition']['mechanics']['loot']['groups'][0]['entries'][0]['itemId'],'item.reed_ore');self.assertTrue(self.ws.request('analyze')['valid']);self.assertEqual(self.ws._load()['candidates'][0]['package'],snapshot)
  entry=copy.deepcopy(next(e for e in state['package']['entities'] if e['id']=='item.reed_ore'));entry['id']='item.ore'
  with self.assertRaisesRegex(ValueError,'Tombstoned'):self.action('save',entity=entry,original=None)
 def test_wrong_or_unstopped_staging_proof_cannot_promote_candidate(self):
  id=self.candidate();before=self.ws.file.read_bytes()
  for proof in ({'status':'passed','scope':'DISPOSABLE_CLUSTER_ONLY','inputSha256':'wrong','clusterStopped':True,'sealed':True},{'status':'passed','scope':'DISPOSABLE_CLUSTER_ONLY','inputSha256':id,'clusterStopped':False,'sealed':True}):
   self.publisher.side_effect=None;self.publisher.return_value=proof
   with self.assertRaisesRegex(ValueError,'incomplete'):self.action('stage',candidate=id)
   self.assertEqual(before,self.ws.file.read_bytes())
 def test_referenced_tombstone_is_refused(self):
  with self.assertRaisesRegex(ValueError,'Referenced'):self.action('tombstone',id='item.ore')
 def test_local_emergency_disable_blocks_publication_but_retains_reads_and_drafts(self):
  id=self.candidate();self.action('disable',disabled=True)
  for operation,data in [('candidate',{}),('stage',{'candidate':id}),('approve',{'candidate':id,'confirmed':True})]:
   with self.assertRaisesRegex(ValueError,'disabled'):self.action(operation,**data)
  self.edit('item.ore',lambda e:e['definition'].update(name='Still editable'));self.assertTrue(self.ws.request('read')['disabled']);self.assertTrue(self.ws.request('analyze')['valid'])
 def test_fork_keeps_history_and_uses_new_revision_after_older_approved_snapshot(self):
  first=self.approve();self.edit('item.ore',lambda e:e['definition'].update(name='second'));self.approve();self.action('fork',candidate=first);state=self.edit('item.ore',lambda e:e['definition'].update(name='forward correction'));self.assertEqual(next(e for e in state['package']['entities'] if e['id']=='item.ore')['revision'],3);self.assertTrue(self.candidate())
 def test_diff_and_release_pin_preview_do_not_adopt_runs(self):
  id=self.approve();result=self.ws.request('diff',{'candidate':id});self.assertIn('Remain pinned',result['pinPreview']['existingRuns']);self.assertIn('New' .lower(),result['rollback'].lower());self.assertIn('quest.studio_cart',result['diff'])
 def test_export_requires_approval_and_returns_the_exact_immutable_package(self):
  id=self.candidate()
  with self.assertRaisesRegex(ValueError,'Approve'):self.ws.request('export',{'candidate':id})
  self.action('stage',candidate=id);self.action('approve',candidate=id,confirmed=True);export=self.ws.request('export',{'candidate':id});self.assertEqual(w.digest(export['package']),id);self.assertEqual(export['scope'],'LOCAL_REVIEW_ARTIFACT_NO_ACTIVATION')
 def test_changed_candidate_file_is_detected(self):
  self.candidate();state=self.ws._load();state['candidates'][0]['package']['entities'][0]['definition']['name']='illicit rewrite';self.ws.file.write_text(json.dumps(state))
  with self.assertRaisesRegex(ValueError,'Immutable'):self.ws.request('read')
 def test_library_has_required_metadata_and_private_file_permissions(self):
  row=self.ws.request('read')['rows'][0]
  for key in ('id','kind','sourceVersion','tags','dependencies','author','status','lastChange'):self.assertIn(key,row)
  self.assertEqual(self.ws.file.stat().st_mode&0o777,0o600)

class HttpBoundaryTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.ws=w.Workspace(Path(self.temp.name)/'workspace',DEMO)
  try:self.server=studio_web.make_server(self.ws)
  except PermissionError:self.temp.cleanup();self.skipTest('Loopback sockets unavailable in this sandbox')
  self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start();self.base='http://127.0.0.1:'+str(self.server.server_port);self.client=urllib.request.build_opener(urllib.request.ProxyHandler({}));html=self.client.open(self.base).read().decode();self.token=re.search('name="studio-token" content="([^"]+)"',html)[1]
 def tearDown(self):
  if hasattr(self,'server'):self.server.shutdown();self.server.server_close();self.thread.join()
  self.temp.cleanup()
 def call(self,path='/api/state',payload=None,**headers):
  data=json.dumps(payload).encode() if payload is not None else None;return self.client.open(urllib.request.Request(self.base+path,data=data,headers={'X-Studio-Token':self.token,'Content-Type':'application/json','Origin':self.base,**headers}))
 def test_cross_origin_missing_token_and_rebound_host_are_refused(self):
  for header in ({'Origin':'http://attacker.invalid'},{'X-Studio-Token':''},{'Host':'attacker.invalid'}):
   with self.assertRaises(urllib.error.HTTPError) as error:self.call(**header)
   self.assertEqual(error.exception.code,403);error.exception.close()
 def test_runtime_preview_response_excludes_hidden_definitions(self):
  response=json.loads(self.call('/api/action',{'operation':'preview','data':{'mode':'NOVICE','known':{'quest.studio_cart':'DISCOVERED'}}}).read());text=json.dumps(response);self.assertNotIn('author-only-secret-marker',text);self.assertNotIn('questObjectives',text);self.assertEqual(len(response),1)
 def test_stale_post_cannot_change_saved_state(self):
  before=self.ws.file.read_bytes()
  with self.assertRaises(urllib.error.HTTPError) as error:self.call('/api/action',{'operation':'disable','expected':'stale','data':{'disabled':True,'author':'Tester','note':'Should fail'}})
  error.exception.close()
  self.assertEqual(before,self.ws.file.read_bytes())

if __name__=='__main__':unittest.main()
