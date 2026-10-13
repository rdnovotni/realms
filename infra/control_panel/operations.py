"""Desktop operations pages, fixed privileged actions and sanitized monitoring cache."""
import json,os,re,stat,subprocess,time,urllib.request,urllib.error
from datetime import datetime,timezone
from pathlib import Path
import tkinter as tk
from tkinter import ttk,messagebox,filedialog
import webbrowser
import backend
import language as words
import operator_tools as helpers
INFRA=Path(__file__).resolve().parents[1];CACHE=Path('/run/realms-console/status.json')
PROJECTS=('kol-production','kol-staging','infra-test-a','infra-test-b','example-project')
SERVICES=('api','db','cache','worker','scheduler','web')
ACTIONS={'install','monitor','backup','restore','retention-preview','public-check','proxy-check','exposure','stage','promote','rollback','project-start','project-stop','api-restart','tunnel-restart','logs','jobs-report','jobs-preview','email-configure','email-test','alert-acknowledge','monitoring-private','monitoring-rollback','release-plan','verify-staging','backup-index','publish-preflight'}

def admin_action(action,data,emit):
 if action not in ACTIONS:raise backend.OperationError('Unknown infrastructure action')
 env=backend.environment()
 for key in list(env):
  if key.startswith(('PYTHON','LD_','DOCKER_','RESTIC_','SMTP_','PG')):env.pop(key)
 proc=subprocess.Popen(['pkexec','/usr/bin/python3','-I',str(INFRA/'scripts/console-admin.py'),action],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
 try:
  proc.stdin.write(json.dumps(data));proc.stdin.close()
  lines=[]
  for line in proc.stdout:
   text=backend.redact(line.rstrip());lines.append(text);lines=lines[-40:];emit(text)
  code=proc.wait()
  if code!=0:raise backend.OperationError(words.failure_message('\n'.join(lines),code))
 finally:
  if proc.poll() is None:proc.terminate();proc.wait()
 return 'Completed.'

def save_private(path,text):
 descriptor=None
 try:
  descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW|os.O_NONBLOCK,0o600)
  if not stat.S_ISREG(os.fstat(descriptor).st_mode):raise backend.OperationError('Choose a regular output file')
  os.fchmod(descriptor,0o600);os.ftruncate(descriptor,0)
  with os.fdopen(descriptor,'w') as f:
   descriptor=None;f.write(text)
 except OSError as exc:raise backend.OperationError('Could not save the report. Choose a regular file in a folder you can write to.') from exc
 finally:
  if descriptor is not None:os.close(descriptor)

def cache_status():
 try:
  value=json.loads(CACHE.read_text())
  if not isinstance(value,dict):raise ValueError('Invalid monitor record')
  for key in ('containers','issues','readiness','releases','snapshots','operation_history','alert_history'):
   if not isinstance(value.get(key,[]),list) or any(not isinstance(row,dict) for row in value.get(key,[])):raise ValueError('Invalid monitor rows')
  for key in ('health','resources','backup','units','email','operation','public'):
   if not isinstance(value.get(key,{}),dict):raise ValueError('Invalid monitor section')
  for row in value.get('containers',[]):
   if not all(key in row for key in ('project','service','state','health','memory_limit','restarts')):raise ValueError('Incomplete service record')
  value['cache_stale']=helpers.cache_is_stale(value['captured_at']);return value
 except (OSError,ValueError,KeyError):return {'cache_stale':True,'issues':[],'containers':[],'releases':[],'health':{},'backup':{},'units':{},'email':{},'alert_history':[]}

def when(value):
 try:return datetime.fromisoformat(value).astimezone().strftime('%b %d, %H:%M:%S %Z')
 except (ValueError,TypeError):return 'Unknown'

def amount(value):
 try:return f'{float(value)/1024**3:.1f} GiB'
 except (ValueError,TypeError):return 'Unknown'

class Operations:
 def __init__(self,console,pages,activity):
  self.c=console;self.pages=pages;self.activity=activity;self.log_lines=[];self.log_mode=False;self.last_notification=None;self.snapshot={};self.release_ids=[];self.snapshot_map={"Latest":None};self.history_signature=None
  self.build_overview();self.build_projects();self.build_releases();self.build_backups();self.build_website();self.build_jobs();self.build_logs();self.build_checks();self.build_history();self.build_guide();self.build_attention()
  console.root.after(800,self.refresh)
  console.root.bind('<F1>',lambda _:console.select_page('Guide'))
  console.root.bind('<Control-f>',self.focus_log_search)
 def label(self,*args,**kw):return self.c.label(*args,**kw)
 def button(self,parent,text,action,accent=False):return self.c.button(parent,text,action,accent)
 def section(self,page,title,subtitle):self.c.section(self.pages[page],title,subtitle);return self.pages[page]
 def row(self,parent):
  row=tk.Frame(parent,bg=parent['bg']);row.pack(fill='x',pady=8);return row
 def buttons(self,parent,items):
  row=self.row(parent)
  for title,fn in items:self.button(row,title,fn).pack(side='left',padx=(0,8))
 def selector(self,parent,variable,values,width=24):
  box=ttk.Combobox(parent,textvariable=variable,values=values,state='readonly',width=width);box.pack(side='left',padx=(0,10));return box
 def run(self,action,data=None,label=None,confirm=None):
  if self.c.busy:
   messagebox.showinfo('Operation in progress','Wait for the current operation to finish.');return
  if confirm and not messagebox.askokcancel('Confirm operation',confirm):return
  self.log_mode=action=='logs'
  if self.log_mode:self.log_lines=[]
  payload=data or {}
  self.c.perform(label or words.ACTIONS.get(action,action.replace('-',' ').title()),lambda runtime:admin_action(action,payload,self.c.emit),lock_native=False)
 def build_overview(self):
  f=self.section('Overview','Realms operations','Live game, private test game, website and backups. Status updates automatically.')
  self.summary=self.label(f,'Reading the latest server information…',font=('DejaVu Sans',14,'bold'));self.summary.pack(anchor='w',pady=8)
  self.chart=tk.Canvas(f,height=100,bg='#101722',highlightthickness=0);self.chart.pack(fill='x',pady=8);self.chart.bind('<Configure>',lambda event:self.draw_chart())
  self.overview=self.c.text_box(f,8)
  self.buttons(f,[('Refresh now',lambda:self.run('monitor')),('Install / update monitoring',lambda:self.run('install')),('Open live website',lambda:webbrowser.open('https://playfollybound.com')),('Mark alerts as reviewed',lambda:self.run('alert-acknowledge'))])
  self.buttons(f,[('Review what needs attention',lambda:self.c.select_page('Attention')),('Open private test game',lambda:webbrowser.open('http://127.0.0.1:13001'))])
  self.alerts=self.c.text_box(f,7)
 def build_projects(self):
  f=self.section('Projects','Projects and services','Choose a project before starting, stopping or restarting it. Its saved data is retained.')
  row=self.row(f);self.project=tk.StringVar(value=words.project(PROJECTS[0]));self.project_picker=self.selector(row,self.project,tuple(words.project(p) for p in PROJECTS),27)
  self.buttons(f,[('Start project',lambda:self.run('project-start',{'project':words.project_id(self.project.get())})),('Stop project',lambda:self.run('project-stop',{'project':words.project_id(self.project.get())},confirm='Stop '+self.project.get()+'? Players using this project will lose access. Storage is retained.')),('Restart game server',lambda:self.run('api-restart',{'project':words.project_id(self.project.get())},confirm='Restart the selected game API? Active requests may be interrupted.'))])
  self.tree=ttk.Treeview(f,columns=('project','service','state','health','memory','restarts'),show='headings',height=13)
  for name,width in [('project',190),('service',160),('state',90),('health',130),('memory',100),('restarts',70)]:self.tree.heading(name,text={'project':'Project','service':'Service','state':'Running status','health':'Health check','memory':'Memory limit','restarts':'Restarts'}[name]);self.tree.column(name,width=width,stretch=True)
  self.tree.pack(fill='both',expand=True,pady=10)
  self.project_detail=self.c.text_box(f,5);self.tree.bind('<<TreeviewSelect>>',self.show_container)
  self.buttons(f,[('Read selected service logs',self.selected_service_logs)])
 def show_container(self,event=None):
  chosen=self.tree.selection()
  if not chosen:return
  row=self.container_map.get(chosen[0])
  if row:
   self.project.set(words.project(row['project']))
   lines=[words.project(row['project'])+' — '+words.service(row['service']),
    'Running status: '+row.get('state','unknown'),'Health check: '+row.get('health','unknown'),
    'Maximum memory: '+amount(row.get('memory_limit')),'Restarts: '+str(row.get('restarts','?')),
    'Restart policy: '+row.get('restart_policy','unknown'),'Technical details:',json.dumps(row,indent=2)]
   self.c.write(self.project_detail,'\n'.join(lines))
 def selected_service_logs(self):
  chosen=self.tree.selection();row=self.container_map.get(chosen[0]) if chosen else None
  if not row:messagebox.showinfo('Choose a service','Select a service in the table first.');return
  if row['project'] not in PROJECTS or row['service'] not in SERVICES:messagebox.showinfo('System logs','Use system logs for the website gateway or other system services.');return
  self.log_project.set(words.project(row['project']));self.update_log_services();self.log_service.set(words.service(row['service']))
  self.c.select_page('Logs');self.load_container_logs()
 def build_releases(self):
  f=self.section('Releases','Update the game: test first, then go live','A build is a saved version of your game. Testing uses a separate database; live players stay on the current version.')
  self.release_map={};self.release=tk.StringVar();self.release_label=tk.StringVar(value='Game update')
  row=self.row(f);self.label(row,'Selected build').pack(side='left',padx=(0,10));self.release_picker=self.selector(row,self.release,(),62)
  self.release_picker.bind('<<ComboboxSelected>>',lambda event:self.change_selected_release())
  self.release_hint=self.label(f,'Start at step 1.',font=('DejaVu Sans',11,'bold'));self.release_hint.pack(anchor='w',pady=8)
  self.workflow=ttk.Notebook(f);self.workflow.pack(fill='both',expand=True)
  frames=[]
  for title in ('1 · Build for testing','2 · Test and approve','3 · Publish or recover'):
   frame=tk.Frame(self.workflow,bg=f['bg'],padx=16,pady=12);self.workflow.add(frame,text=title);frames.append(frame)
  first,second,third=frames
  self.label(first,'1. Save changes and a source checkpoint in Development Studio first.').pack(anchor='w',pady=4)
  self.buttons(first,[('Open game source folder',lambda:subprocess.Popen(['xdg-open',str(INFRA.parent/'realms')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL))])
  self.label(first,'2. Name this update so you can recognize it later.').pack(anchor='w',pady=4)
  row=self.row(first);self.label(row,'Update name').pack(side='left',padx=(0,10));tk.Entry(row,textvariable=self.release_label,width=35).pack(side='left')
  self.allow_migrations=tk.BooleanVar(value=False)
  ttk.Checkbutton(first,text='Allow required database updates — select only for reviewed changes',variable=self.allow_migrations).pack(anchor='w',pady=8)
  self.label(first,'Database updates change how data is stored. Older code may no longer work afterward.',muted=True).pack(anchor='w')
  self.buttons(first,[('Build and install on test game',lambda:self.stage_checkpoint(confirm='Build your saved Git checkpoint, run automated tests, make a USB backup, and install it on the PRIVATE TEST GAME?\n\nLive players stay on the current version. Testing uses separate player data.'))])
  self.label(first,'This may take several minutes. Follow progress in “What is happening” below.',muted=True).pack(anchor='w',pady=8)
  self.label(second,'Open the private test game on this computer. Accounts and progress are separate from the live game.').pack(anchor='w',pady=6)
  self.buttons(second,[('Open private test game',lambda:webbrowser.open('http://127.0.0.1:13001'))])
  self.test_login=tk.BooleanVar(value=False);self.test_gameplay=tk.BooleanVar(value=False)
  ttk.Checkbutton(second,text='I signed in successfully with a test account',variable=self.test_login,command=self.update_release_controls).pack(anchor='w',pady=6)
  ttk.Checkbutton(second,text='I tried the changed gameplay and checked for errors',variable=self.test_gameplay,command=self.update_release_controls).pack(anchor='w',pady=6)
  self.approve_button=self.button(second,'Save test approval',self.approve_test,True);self.approve_button.pack(anchor='w',pady=8)
  self.label(second,'Approval belongs only to the selected build. A different build needs its own test and approval.',muted=True).pack(anchor='w')
  self.buttons(third,[('Review what will change',lambda:self.selected_action('release-plan'))])
  self.publish_button=self.button(third,'Publish this build to the live game',self.promote,True);self.publish_button.pack(anchor='w',pady=8)
  self.label(third,'Publishing briefly interrupts the live game. It uses the exact tested build, makes a backup, and keeps player data.',muted=True).pack(anchor='w')
  self.buttons(third,[('Check live website',lambda:self.run('public-check'))])
  row=self.row(third)
  self.undo_live=self.button(row,'Previous live version',lambda:self.rollback('kol-production'));self.undo_live.pack(side='left',padx=(0,8))
  self.undo_test=self.button(row,'Previous test version',lambda:self.rollback('kol-staging'));self.undo_test.pack(side='left')
  self.label(third,'Previous version changes code only. It cannot undo database updates or restore older player progress.',muted=True).pack(anchor='w')
  self.build_summary=self.label(f,'Reading the currently installed builds…',muted=True);self.build_summary.pack(anchor='w',pady=6)
  self.release_text=self.c.text_box(f,5)
  self.update_release_controls()
 def stage_checkpoint(self,confirm):
  try:commit=self.source_checkpoint()
  except backend.OperationError as exc:messagebox.showerror('Save a source checkpoint',str(exc));return
  self.run('stage',{'label':self.release_label.get(),'allow_migrations':self.allow_migrations.get(),'source_commit':commit},confirm=confirm)
 def source_checkpoint(self):
  out=backend.command(['git','status','--porcelain'],cwd=INFRA.parent)
  if out:raise backend.OperationError('Save a clean source checkpoint in Development Studio before building.')
  return backend.command(['git','rev-parse','HEAD'],cwd=INFRA.parent)
 def change_selected_release(self):
  self.test_login.set(False);self.test_gameplay.set(False);self.update_release_controls()
 def selected_release(self):return self.release_map.get(self.release.get())
 def selected_action(self,action,extra=None,confirm=None):
  record=self.selected_release()
  if not record:messagebox.showinfo('Choose a build','Build a version for testing first, then select it above.');return
  self.run(action,{'release':record['id'],**(extra or {})},confirm=confirm)
 def approve_test(self):
  if not self.test_login.get() or not self.test_gameplay.get():messagebox.showinfo('Finish the test checklist','Check sign-in and the changed gameplay before saving your approval.');return
  self.selected_action('verify-staging',{'confirmed':True},'Save your passed test for this selected build? The console also checks the test server and its database version. Nothing is published yet.')
 def promote(self):
  record=self.selected_release()
  if not record:messagebox.showinfo('Choose a build','Build and approve a test version first.');return
  self.selected_action('promote',{'approved':True},'Publish “'+str(record.get('label','Game update'))+'” to playfollybound.com?\n\nLive players may briefly lose connection. A fresh backup is made first. The approved database updates, if any, are also applied. Player progress is kept.')
 def rollback(self,project):
  self.selected_action('rollback',{'project':project},'Use the previous code for '+words.project(project)+'?\n\nThe console checks whether older code can still use the current database. It refuses unsafe changes. It does not rewind player progress.')
 def update_release_controls(self):
  if not hasattr(self,'approve_button'):return
  gates=words.release_controls(self.selected_release(),self.snapshot)
  self.release_hint.configure(text=gates['message'],wraplength=780)
  for button,allowed in ((self.approve_button,gates['approve'] and self.test_login.get() and self.test_gameplay.get()),(self.publish_button,gates['publish']),(self.undo_live,gates['undo_live']),(self.undo_test,gates['undo_test'])):
   button.state(['!disabled'] if allowed and not self.c.busy else ['disabled'])
 def build_backups(self):
  f=self.section('Backups','Encrypted USB backups','Encrypted copies of all three databases, settings and the game versions needed for recovery.')
  row=self.row(f);self.snapshot_choice=tk.StringVar(value='Latest');self.snapshot_picker=self.selector(row,self.snapshot_choice,('Latest',),48)
  self.button(row,'Refresh restore points',lambda:self.run('backup-index')).pack(side='left')
  self.backup_text=self.c.text_box(f,10)
  self.buttons(f,[('Back up now',lambda:self.run('backup')),('Test recovery safely',lambda:self.run('restore',{'snapshot':self.snapshot_map.get(self.snapshot_choice.get())},confirm='Read the encrypted repository and restore all three databases into isolated test containers? This can take several minutes; live data is not replaced.')),('Review backup retention',lambda:self.run('retention-preview'))])
  self.label(f,'Save the repository recovery password outside this computer. This console never displays it. Retention preview deletes nothing.',muted=True).pack(anchor='w',pady=10)
 def build_website(self):
  f=self.section('Website','Public website and tunnel','Cloudflare connects your public website to the live game through the local website gateway.')
  self.website_text=self.c.text_box(f,10)
  self.buttons(f,[('Open website',lambda:webbrowser.open('https://playfollybound.com')),('Check public access',lambda:self.run('public-check')),('Check local website routing',lambda:self.run('proxy-check')),('Restart tunnel',lambda:self.run('tunnel-restart',confirm='Restart the existing Cloudflare connector? Public access will briefly pause.'))])
  self.label(f,'DNS and Cloudflare account changes stay in your account dashboard. No public administrative website is created.',muted=True).pack(anchor='w',pady=10)
 def build_jobs(self):
  f=self.section('Jobs','Background jobs and daily tasks','Inspect scheduled execution without changing gameplay policy or granting resources.')
  row=self.row(f);self.jobs_project=tk.StringVar(value=words.project('kol-staging'));self.selector(row,self.jobs_project,tuple(words.project(p) for p in PROJECTS[:2]))
  self.buttons(f,[('Show task results',lambda:self.run('jobs-report',{'project':words.project_id(self.jobs_project.get())})),('Preview tasks (no changes)',lambda:self.run('jobs-preview',{'project':words.project_id(self.jobs_project.get())}))])
  self.c.write(self.c.text_box(f,10),'Background jobs save their progress in the database. Losing temporary cache data does not erase permanent game progress.\n\nDaily awards remain unconfigured until gameplay values are finalized. Use reports to see actual periods and failures.\n\nReports appear in the activity panel below. No reward, schedule-enrollment or force-replay button is provided.')
 def build_logs(self):
  f=self.section('Logs','Searchable service logs','Read recent container or system logs; secrets are redacted before display or export.')
  row=self.row(f);self.log_project=tk.StringVar(value=words.project(PROJECTS[0]));self.log_project_picker=self.selector(row,self.log_project,tuple(words.project(p) for p in PROJECTS),23);self.log_project_picker.bind('<<ComboboxSelected>>',lambda event:self.update_log_services());self.log_service=tk.StringVar(value=words.service('api'));self.log_service_picker=self.selector(row,self.log_service,tuple(words.service(s) for s in SERVICES),18)
  self.button(row,'Load container logs',self.load_container_logs).pack(side='left')
  row=self.row(f);self.log_unit=tk.StringVar(value='cloudflared.service');self.selector(row,self.log_unit,('cloudflared.service','kol-realms.service','kol-postgresql.service','docker.service','realms-backup.service','realms-backup-restore.service','realms-console-monitor.service'),35)
  self.button(row,'Load system logs',lambda:self.run('logs',{'source':self.log_unit.get()})).pack(side='left')
  row=self.row(f);self.search=tk.StringVar();self.search_entry=tk.Entry(row,textvariable=self.search,width=28);self.search_entry.pack(side='left',padx=(0,10));self.severity=tk.StringVar(value='All');self.selector(row,self.severity,('All','Errors','Warnings'),12)
  self.button(row,'Filter',self.filter_logs).pack(side='left',padx=8);self.button(row,'Save filtered logs',self.export_logs).pack(side='left')
  self.follow_logs=tk.BooleanVar(value=True);ttk.Checkbutton(row,text='Follow newest',variable=self.follow_logs).pack(side='left',padx=8)
  self.log_hint=self.label(f,'Select a project and service, then load its recent messages.',muted=True);self.log_hint.pack(anchor='w',pady=6)
  self.logs=self.c.text_box(f,16)
  self.search.trace_add('write',lambda *_:self.filter_logs());self.severity.trace_add('write',lambda *_:self.filter_logs())
 def focus_log_search(self,event=None):
  self.c.select_page('Logs');self.search_entry.focus_set();self.search_entry.select_range(0,'end');return 'break'
 def update_log_services(self):
  ids=helpers.project_services(self.snapshot,words.project_id(self.log_project.get()))
  choices=tuple(words.service(s) for s in ids);self.log_service_picker['values']=choices
  if self.log_service.get() not in choices:self.log_service.set(choices[0] if choices else '')
 def load_container_logs(self):
  project=words.project_id(self.log_project.get());service=words.service_id(self.log_service.get())
  if service not in helpers.project_services(self.snapshot,project):messagebox.showinfo('No observed service','Refresh status and select a service currently listed for this project.');return
  self.log_hint.configure(text='Recent messages for '+words.project(project)+' / '+words.service(service)+'. Loading requires Ubuntu administrator approval.')
  self.run('logs',{'project':project,'service':service})
 def handle_output(self,text):
  self.c.write(self.activity,time.strftime('%H:%M:%S')+'  '+text,True)
  if self.log_mode:self.log_lines.extend(backend.redact(text).splitlines());self.log_lines=self.log_lines[-1800:];self.filter_logs()
 def filter_logs(self):
  query=self.search.get().casefold();severity=self.severity.get();rows=[]
  for line in self.log_lines:
   lower=line.casefold()
   if query not in lower:continue
   if severity=='Errors' and not re.search(r'error|fail|fatal|"level"\s*:\s*(?:50|60)',lower):continue
   if severity=='Warnings' and not re.search(r'warn|"level"\s*:\s*40',lower):continue
   rows.append(line)
  position=self.logs.yview()[0]
  self.c.write(self.logs,'\n'.join(rows) if rows else 'No messages match this filter. Try All or clear the search.')
  if not self.follow_logs.get():self.logs.yview_moveto(position)
  self.log_hint.configure(text=str(len(rows))+' matching lines / '+str(len(self.log_lines))+' loaded. Search updates as you type. Logs are redacted before display.')
 def export_logs(self):
  path=filedialog.asksaveasfilename(defaultextension='.txt',initialfile='realms-filtered-logs.txt')
  if path:
   save_private(path,backend.redact(self.logs.get('1.0','end')))
 def build_checks(self):
  f=self.section('Checks & alerts','Operational checks and notifications','Active issues stay visible even after acknowledgement; recovery is recorded separately.')
  self.buttons(f,[('Check local port exposure',lambda:self.run('exposure')),('Export status',self.export_status),('Test email',lambda:self.run('email-test'))])
  self.buttons(f,[('Open local monitoring',lambda:webbrowser.open('http://127.0.0.1:61208')),('Keep monitoring local',lambda:self.run('monitoring-private',confirm='Restrict Glances to this desktop and restart only its monitoring service? LAN devices will no longer reach its web interface.')),('Restore prior binding',lambda:self.run('monitoring-rollback',confirm='Remove only the console Glances binding override? This may make monitoring reachable on the LAN again.'))])
  self.readiness_text=self.c.text_box(f,5)
  self.email_status=self.label(f,'Email not configured.',muted=True);self.email_status.pack(anchor='w',pady=8)
  self.button(f,'Configure email alerts',self.email_dialog).pack(anchor='w')
  self.c.write(self.c.text_box(f,9),'Exposure checks inspect local IPv4/IPv6 listening sockets. An outside-network scan of the actual router WAN IPv4 and server global IPv6 is still required; public domain scans test Cloudflare, not your home origin.\n\nDesktop notifications appear while this console is open. The monitoring timer keeps alert history and sends configured email while logged out.\n\nEmail uses TLS with certificate verification and root-private settings. Enter an existing provider’s SMTP server and app password privately in the settings window. Do not paste passwords into chat.\n\nSee infra/docs/operations-console.md for the external scan procedure and release recovery steps.')
 def export_status(self):
  path=filedialog.asksaveasfilename(defaultextension='.json',initialfile='realms-operations-status.json')
  if not path:return
  save_private(path,json.dumps(helpers.support_report(self.snapshot),indent=2))
 def build_history(self):
  f=self.section('History','Operation and incident history','Persistent results survive closing the console and restarting the server.')
  self.history_text=self.c.text_box(f,18)
  self.button(f,'Save history',self.export_history).pack(anchor='w',pady=8)
 def export_history(self):
  path=filedialog.asksaveasfilename(defaultextension='.json',initialfile='realms-history.json')
  if path:
   data={k:self.snapshot.get(k,[]) for k in ('operation_history','alert_history')}
   save_private(path,json.dumps(data,indent=2))
 def build_attention(self):
  f=self.section('Attention','What needs attention','Unresolved problems and unfinished checks, with a suggested next step. No changes run automatically.')
  self.attention_map={}
  self.attention_tree=ttk.Treeview(f,columns=('state','name'),show='headings',height=8)
  self.attention_tree.heading('state',text='Status');self.attention_tree.column('state',width=170,stretch=False)
  self.attention_tree.heading('name',text='Problem or remaining check');self.attention_tree.column('name',width=570)
  self.attention_tree.tag_configure('pending',foreground='#ffc878');self.attention_tree.tag_configure('problem',foreground='#ff8d99')
  self.attention_tree.pack(fill='both',expand=True,pady=8);self.attention_tree.bind('<<TreeviewSelect>>',lambda _:self.show_attention())
  self.attention_detail=self.c.text_box(f,7)
  self.buttons(f,[('Open the relevant tool',self.open_attention),('Refresh server status',lambda:self.run('monitor')),('Save shareable summary',self.export_status)])
 def show_attention(self):
  selected=self.attention_tree.selection();row=self.attention_map.get(selected[0]) if selected else None
  if row:self.c.write(self.attention_detail,row['name']+'\n\n'+row['advice']+'\n\nOpen the relevant tool to continue. The console will ask before changes.')
 def open_attention(self):
  selected=self.attention_tree.selection();row=self.attention_map.get(selected[0]) if selected else None
  if row:self.c.select_page(row['page'])
 def refresh_attention(self):
  selected=self.attention_tree.selection();selected=selected[0] if selected else None
  self.attention_map={row['key']:row for row in helpers.attention_items(self.snapshot)}
  self.attention_tree.delete(*self.attention_tree.get_children())
  for key,row in self.attention_map.items():self.attention_tree.insert('','end',iid=key,values=(row['state'],row['name']),tags=('pending' if row['state']=='Not yet verified' else 'problem',))
  if selected in self.attention_map:self.attention_tree.selection_set(selected)
  elif self.attention_map:self.attention_tree.selection_set(next(iter(self.attention_map)))
  else:self.c.write(self.attention_detail,'No active problems or unfinished checks were reported. Keep checking backups and test the live game after updates.')
  self.show_attention()
 def build_guide(self):
  f=self.section('Guide','How to use your server','Start here when updating the game, checking a problem or testing backups.')
  tabs=ttk.Notebook(f);tabs.pack(fill='both',expand=True)
  guides={
   'Update the game':"Press F1 to open this guide. Ctrl+F opens log search.\n\n1. SAVE YOUR CHANGES\nSave the game source under /srv/Realms/source/realms. Save a source checkpoint in Development Studio. The build uses that recorded Git commit; uncommitted edits are excluded.\n\n2. BUILD FOR TESTING\nOpen Game updates → 1 · Build for testing. Name the update. Leave database updates off unless you have reviewed new migration files. Choose Build and install on test game. This creates a USB backup and runs automated checks before updating the private test game.\n\n3. TEST AND APPROVE\nSelect that build. Open 2 · Test and approve. Sign in with a test account and try the changed gameplay. Test accounts and progress are separate from live players. Check both boxes, then Save test approval. Approval applies to this exact build.\n\n4. PUBLISH\nOpen 3 · Publish or recover. Review what will change, then Publish this build to the live game. Confirm the brief interruption. A fresh backup is made first; the tested build is reused without rebuilding.\n\n5. CHECK LIVE\nChoose Check live website, then visit playfollybound.com and try sign-in and gameplay. Record any problems in the update notes. Closing this console leaves the game running.",
   'Understand the tools':"LIVE GAME / PRODUCTION\nThe version public players use at playfollybound.com.\n\nPRIVATE TEST GAME / STAGING\nA separate game on this computer for checking changes before publishing. It has separate accounts, credentials and player data.\n\nBUILD\nA saved application image made from the source files. A release record tracks which build was tested and published.\n\nDATABASE UPDATE / MIGRATION\nA change to the structure of stored data. It can prevent older code from working, so review it before allowing it.\n\nTEMPORARY CACHE / VALKEY\nDisposable fast storage. Permanent character and economy data belongs in PostgreSQL, the database.\n\nBACKGROUND JOBS AND SCHEDULED TASKS\nWorkers finish saved tasks; the scheduler plans recurring work. Daily rewards stay unconfigured until gameplay values are finalized.\n\nWEBSITE GATEWAY AND TUNNEL\nCaddy routes requests locally; Cloudflare connects the public website to this computer.\n\nORIGINAL LOCAL TOOLS\nAdvanced controls for the older native game. They do not publish a container build to the public website.",
   'Backups and problems':"BACK UP NOW\nKeep the external USB drive connected. Backups → Back up now saves all three databases, settings and exact game images in an encrypted archive. Scheduled backups run every six hours.\n\nTEST A BACKUP\nChoose a saved restore point, then Test recovery safely. This restores into disposable test databases and checks the data. It does not replace live player data. Weekly recovery tests are also scheduled. Keep the recovery password somewhere outside this computer.\n\nIF AN UPDATE FAILS\nRead What is happening below and Logs → Errors. Check History for the result. Do not assume a failed action changed nothing. If database structure is unchanged, previous code may be usable. If it changed, prepare a corrected build; do not overwrite new player progress with an old backup.\n\nIF THE WEBSITE IS DOWN\nCheck the live game on Overview. Website → Check local website routing tests the gateway; Check public access tests HTTPS. Restart tunnel briefly interrupts public access and reconnects it.\n\nIF STATUS IS OUT OF DATE\nChoose Refresh now. If needed, Install / update monitoring authenticates through Ubuntu. Administrator actions ask for your password in Ubuntu’s own dialog.\n\nALERTS\nMark alerts as reviewed records that you saw them; it does not repair or hide a problem. Desktop notifications need this app open. Configured email and history continue while logged out. Test email delivery before relying on it."
  }
  for title,text in guides.items():
   frame=tk.Frame(tabs,bg=f['bg'],padx=12,pady=8);tabs.add(frame,text=title);box=self.c.text_box(frame,20);self.c.write(box,text)
 def draw_chart(self):
  self.chart.delete('all');width=max(self.chart.winfo_width(),200);height=100
  rows=self.snapshot.get('resource_history',[])
  self.chart.create_text(12,12,text='Recent CPU (mint) and memory use (gold) · percent',anchor='w',fill='#9baec4')
  for field,color in [('cpu','#58d7bd'),('memory','#ffc878')]:
   points=[]
   for i,row in enumerate(rows):
    value=row.get(field)
    if value is None:continue
    points.extend((12+i*(width-24)/max(len(rows)-1,1),height-8-float(value)*.65))
   if len(points)>=4:self.chart.create_line(*points,fill=color,width=2)
 def email_dialog(self):
  window=tk.Toplevel(self.c.root);window.title('Private email alert settings');window.geometry('680x490');window.transient(self.c.root)
  fields={};defaults={'host':'','port':'587','username':'','password':'','sender':'','recipient':''}
  for i,(name,default) in enumerate(defaults.items()):
   ttk.Label(window,text={'host':'Mail provider’s server (SMTP)','port':'Provider’s mail port','username':'Mail sign-in name','password':'Provider’s app password','sender':'Send alerts from (email)','recipient':'Send alerts to (email)'}[name]).grid(row=i,column=0,padx=15,pady=10,sticky='w');value=tk.StringVar(value=default);fields[name]=value
   ttk.Entry(window,textvariable=value,show='•' if name=='password' else '',width=40).grid(row=i,column=1,padx=10,pady=10)
  tls=tk.StringVar(value='starttls');enabled=tk.BooleanVar(value=True)
  ttk.Combobox(window,textvariable=tls,values=('starttls','ssl'),state='readonly').grid(row=6,column=1,pady=10)
  ttk.Checkbutton(window,text='Enable email alerts',variable=enabled).grid(row=7,column=1)
  ttk.Label(window,text='Password stays private. Blank preserves a previously saved password.').grid(row=8,column=0,columnspan=2,pady=10)
  def save():
   if self.c.busy:messagebox.showinfo('Operation in progress','Finish the current operation before saving email settings.');return
   try:cfg={k:v.get() for k,v in fields.items()};cfg.update(port=int(cfg['port']),tls=tls.get(),enabled=enabled.get())
   except ValueError:messagebox.showerror('Mail port','Enter a number for the port.');return
   fields['password'].set('');window.destroy();self.run('email-configure',{'email':cfg},label='Save private email settings')
  ttk.Button(window,text='Save settings',command=save).grid(row=9,column=1,pady=10)
 def refresh(self):
  status=cache_status();self.snapshot=status
  stale=status['cache_stale'];issues=status.get('issues',[])
  self.summary.configure(text='Status is out of date — refresh before making decisions' if stale else ('All monitored systems healthy' if not issues else str(len(issues))+' active issues need attention'))
  health=status.get('health',{});resources=status.get('resources',{});units=status.get('units',{})
  rows=['Live game: '+('Ready' if health.get('kol-production',{}).get('ok') else 'Unknown / unavailable'),'Private test game: '+('Ready' if health.get('kol-staging',{}).get('ok') else 'Unknown / unavailable'),'Website: '+('Responding' if status.get('public',{}).get('ok') else 'Unknown / unavailable'),'USB drive: '+('Mounted' if status.get('drive_mounted') else 'Missing / unknown'),'Storage free: '+amount(resources.get('disk_free')),'Available RAM: '+amount(resources.get('memory_available')),'Updated: '+when(status.get('captured_at'))]
  for project,row in status.get('databases',{}).items():rows.append(words.project(project)+' database: '+amount(row.get('bytes'))+' · connections '+str(row.get('connections','?'))+' · deadlocks '+str(row.get('deadlocks','?')))
  self.c.write(self.overview,'\n'.join(rows))
  alertrows=[x['severity'].upper()+': '+x['message'] for x in issues]
  op=status.get('operation',{})
  if op.get('active'):alertrows.append('Planned operation: '+op.get('action','unknown')+' · started '+op.get('started','unknown'))
  alertrows+=['','Recent changes:']+[x['at']+' '+x['kind']+': '+x['issue']['message'] for x in status.get('alert_history',[])[-8:]]
  self.c.write(self.alerts,'\n'.join(alertrows) if issues or status.get('alert_history') else 'No recorded alerts.')
  backup=status.get('backup',{});self.c.write(self.backup_text,'\n'.join(['USB drive: '+('Mounted' if status.get('drive_mounted') else 'Missing / unknown'),'Last successful backup: '+when(backup.get('last_success')),'Last successful recovery test: '+when(backup.get('last_restore_success')),'Latest operation: '+backup.get('last_result','Unknown'),'Backup timer: '+units.get('realms-backup.timer',{}).get('ActiveState','unknown'),'Restore timer: '+units.get('realms-backup-restore.timer',{}).get('ActiveState','unknown'),'Backup schedule: every six hours; restore drill: Sunday 03:30 (America/Chicago)','Repository: /mnt/Realms-backups/Realms-Backups/restic','Encrypted snapshot: '+backup.get('snapshot','Unknown')]))
  self.c.write(self.website_text,'\n'.join(['Public URL: https://playfollybound.com','Production: http://127.0.0.1:13000','Proxy: http://127.0.0.1:19081','Tunnel: '+units.get('cloudflared.service',{}).get('ActiveState','unknown'),'Public health: '+str(status.get('public',{}).get('code','unknown')),'No public database/cache/admin route is configured. Use Check public access to verify boundaries.']))
  selected=self.tree.selection();selected=selected[0] if selected else None
  self.tree.delete(*self.tree.get_children())
  self.container_map={row['project']+'/'+row['service']:row for row in status.get('containers',[])}
  for key,row in self.container_map.items():self.tree.insert('', 'end',iid=key,values=(words.project(row['project']),words.service(row['service']),row['state'],row['health'],amount(row['memory_limit']),row['restarts']))
  if selected in self.tree.get_children():self.tree.selection_set(selected);self.show_container()
  self.update_log_services();self.refresh_attention()
  self.build_summary.configure(text=helpers.running_builds(status))
  releases=status.get('releases',[]);old=self.selected_release();old_id=old['id'] if old else None
  self.release_map={str(r.get('label') or 'Game update')+' · '+when(r.get('created'))+' · '+r['id'][-8:]:r for r in releases}
  choices=list(self.release_map);self.release_picker['values']=choices
  chosen=next((label for label,r in self.release_map.items() if r['id']==old_id),choices[0] if choices else '')
  if chosen!=self.release.get():self.release.set(chosen);self.test_login.set(False);self.test_gameplay.set(False)
  self.update_release_controls()
  record=self.selected_release()
  summary='No saved test builds yet. Live players are still on the existing version. Begin with step 1.'
  if record:
   summary='Selected: '+str(record.get('label'))+'\nStatus: '+words.release_state(record.get('state'))+'\nTest approval: '+('saved '+when(record['manual_test'].get('at')) if record.get('manual_test') else 'not saved yet')+'\nBuild reference: '+record['id']
  self.c.write(self.release_text,summary)
  self.draw_chart()
  self.snapshot_map={'Latest':None,**{when(r['time'])+' · '+r['id'][:12]:r['id'] for r in status.get('snapshots',[])}}
  ids=list(self.snapshot_map)
  self.snapshot_picker['values']=ids
  if self.snapshot_choice.get() not in ids:self.snapshot_choice.set('Latest')
  self.c.write(self.readiness_text,'\n'.join(r['state'].upper()+' · '+r['name'] for r in status.get('readiness',[])) or 'Waiting for the monitor readiness checklist.')
  records=status.get('operation_history',[])
  lines=['Operations:']+[when(r.get('finished'))+' · '+words.ACTIONS.get(r.get('action'),r.get('action','unknown'))+' · '+words.project(r.get('project',''))+' · '+r.get('outcome','unknown') for r in reversed(records[-30:])]
  lines+=['','Incidents:']+[when(r.get('at'))+' · '+r['kind']+' · '+r['issue']['message'] for r in reversed(status.get('alert_history',[])[-30:])]
  text='\n'.join(lines)
  if text!=self.history_signature:
   self.history_signature=text;self.c.write(self.history_text,text);self.history_text.see('1.0')
  email=status.get('email',{});self.email_status.configure(text='Email: '+('enabled' if email.get('enabled') else 'not enabled')+' · last delivery: '+str(email.get('last_delivery',{}).get('state','not tested')))
  note=status.get('notification',{})
  if self.last_notification is not None and note.get('id') and note['id']!=self.last_notification:
   try:subprocess.Popen(['notify-send','--app-name=KoL Server Console','Realms server status changed',backend.redact(note.get('summary','Check the console'))],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   except OSError:pass # Missing desktop notification support must not stop status refresh.
  self.last_notification=note.get('id','')
  self.c.root.after(5000,self.refresh)
