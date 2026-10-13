"""Plain-language presentation; internal service/action IDs remain unchanged."""
PROJECTS={'kol-production':'Live game','kol-staging':'Private test game','infra-test-a':'Isolation test A','infra-test-b':'Isolation test B','example-project':'Example project','kol-edge':'Website gateway','native':'Original local game'}
SERVICES={'api':'Game server','db':'Database','cache':'Temporary cache','worker':'Background jobs','scheduler':'Scheduled tasks','web':'Web service','caddy':'Website gateway'}
ACTIONS={'stage':'Build a version for testing','verify-staging':'Save your test approval','release-plan':'Review the live update','promote':'Publish the approved version','rollback':'Use the previous game version','backup':'Save an encrypted USB backup','restore':'Test recovery from the selected backup','backup-index':'Load saved backups','retention-preview':'Show which backups could be kept','public-check':'Check the public website','proxy-check':'Check website routing on this computer','monitor':'Refresh server status','install':'Install or update background monitoring','project-start':'Start the selected project','project-stop':'Stop the selected project','api-restart':'Restart the selected game server','tunnel-restart':'Reconnect the public website','jobs-report':'Show scheduled-task results','jobs-preview':'Preview scheduled tasks without running them','logs':'Read recent messages','email-test':'Send a test alert email','email-configure':'Save private email settings','exposure':'Check which services accept network connections','alert-acknowledge':'Mark alerts as reviewed','monitoring-private':'Keep system monitoring on this computer','monitoring-rollback':'Restore the previous monitoring access'}
RELEASES={'building':'Preparing the test build','build_failed':'Build or preparation failed','staging_ready':'Available on the private test game','staging_failed':'Test installation failed','production_live':'Published on the live game','production_failed':'Live installation needs attention','staging_rolled_back':'Test game returned to its previous version','production_rolled_back':'Live game returned to its previous version'}
def project(value):return PROJECTS.get(value,value)
def project_id(value):return next((key for key,label in PROJECTS.items() if label==value),value)
def service(value):return SERVICES.get(value,value)
def service_id(value):return next((key for key,label in SERVICES.items() if label==value),value)
def release_state(value):return RELEASES.get(value,'Unknown release status')
def release_controls(record,status):
 if not record:return {'approve':False,'publish':False,'undo_live':False,'undo_test':False,'message':'Start with step 1: build your current source code for the private test game.'}
 if status.get('cache_stale',True):return {'approve':False,'publish':False,'undo_live':False,'undo_test':False,'message':'Server information is out of date. Refresh status before approving or publishing.'}
 image=record.get('image');containers=status.get('containers',[])
 matches=lambda name:bool(image) and any(c.get('project')==name and c.get('service')=='api' and c.get('image')==image and c.get('state')=='running' for c in containers)
 test=matches('kol-staging');live=matches('kol-production');state=record.get('state');receipt=record.get('manual_test') or {}
 approved=bool(receipt.get('at')) and receipt.get('image')==image
 approve=state=='staging_ready' and test;publish=approve and approved
 if state=='staging_ready' and not test:message='The test game is running a different build, or is unavailable. Build and test a new version.'
 elif publish:message='Your test approval is recorded. Step 3 is ready: review this build, then publish it.'
 elif approve:message='Step 2: open the private test game, check sign-in and gameplay, then save your approval.'
 elif state=='production_live':message='This build was published. Use Check live website to confirm it still responds.'
 else:message=release_state(state)+'. Read the details below before trying another update.'
 return {'approve':approve,'publish':publish,'undo_live':state=='production_live' and live,'undo_test':state in ('staging_ready','production_live') and test,'message':message}
def failure_message(output,code):
 lower=output.lower()
 if code in (126,127) or any(x in lower for x in ('not authorized','authentication was cancelled','authorization failed')):return 'Ubuntu did not approve the administrator request. Try again and enter your password in Ubuntu’s dialog.'
 if 'manual staging test' in lower:return 'First test this build on the private test game, then choose “Save test approval”. Nothing was published.'
 if 'schema changed' in lower or 'rollback is unsafe' in lower:return 'The database structure has changed, so returning to older code is unsafe. Keep the backup and prepare a corrected build.'
 if 'pending migrations' in lower:return 'This build needs a database update. Review the change, then rebuild with “Allow required database updates” selected.'
 if 'already running' in lower or 'temporarily unavailable' in lower:return 'Another server action is running. Wait for it to finish, then try again.'
 if 'backup' in lower and any(x in lower for x in ('not mounted','target','unavailable')):return 'The expected backup drive is unavailable. Check that the USB drive is connected and mounted, then retry.'
 return 'The action did not finish successfully. Read the messages in “What is happening”, or open Logs for more detail. Do not assume the change was applied.'
