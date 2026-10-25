#!/usr/bin/env python3
"""Native development editor; source editing never directly mutates player state."""
import copy,json,queue,re,subprocess,sys,threading,time,tkinter as tk,webbrowser
from pathlib import Path
from tkinter import ttk,messagebox,filedialog
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'control_panel'))
import backend,operations,language
import model

class Studio:
 def __init__(self,root):
  self.root=root;self.busy=False;self.events=queue.Queue();self.original=None;self.dirty=False;self.package,self.loaded_digest=model.read_package();self.release_map={};self.links={}
  try:self.links=json.loads((model.ROOT/'.development/release-links.json').read_text())
  except (OSError,ValueError):pass
  root.title('Follybound Development Studio');root.geometry('1250x950');root.minsize(1100,820)
  style=ttk.Style(root);style.theme_use('clam');style.configure('.',font=('DejaVu Sans',10));style.configure('TButton',padding=(10,7))
  ttk.Label(root,text='Follybound Development Studio',font=('DejaVu Sans',22,'bold')).pack(anchor='w',padx=20,pady=(16,3))
  ttk.Label(root,text='One master source • author definitions • test a recorded build • publish with GitHub').pack(anchor='w',padx=20,pady=(0,12))
  self.tabs=ttk.Notebook(root);self.tabs.pack(fill='both',expand=True,padx=16)
  self.pages={}
  for title in ('Content library','Source & GitHub','Test & publish','Help'):
   frame=ttk.Frame(self.tabs,padding=12);self.tabs.add(frame,text=title);self.pages[title]=frame
  self.content_page();self.source_page();self.publish_page();self.help_page()
  self.status=tk.StringVar(value='Ready. Changes remain local until you publish.');ttk.Label(root,textvariable=self.status).pack(anchor='w',padx=20,pady=8)
  self.output=tk.Text(root,height=6,wrap='word',state='disabled',font=('DejaVu Sans Mono',10));self.output.pack(fill='x',padx=16,pady=(0,12))
  root.protocol('WM_DELETE_WINDOW',self.close);root.after(100,self.drain);root.after(500,self.refresh_releases);self.refresh_library();self.new_entity()
 def row(self,parent):
  row=ttk.Frame(parent);row.pack(fill='x',pady=5);return row
 def button(self,parent,text,action):return ttk.Button(parent,text=text,command=lambda:self.safe(action))
 def safe(self,action):
  if self.busy:messagebox.showinfo('Action in progress','Wait for the current action to finish.');return
  try:action()
  except Exception as exc:messagebox.showerror('Needs attention',backend.redact(str(exc)))
 def text(self,parent,height=10):
  frame=ttk.Frame(parent);frame.pack(fill='both',expand=True);text=tk.Text(frame,wrap='word',height=height,font=('DejaVu Sans Mono',10));scroll=ttk.Scrollbar(frame,command=text.yview);text.configure(yscrollcommand=scroll.set);scroll.pack(side='right',fill='y');text.pack(fill='both',expand=True);return text
 def set_text(self,widget,value):
  state=widget.cget('state');widget.configure(state='normal');widget.delete('1.0','end');widget.insert('1.0',value);widget.configure(state=state)
 def mark_dirty(self,event=None):self.dirty=True
 def discard(self):return not self.dirty or messagebox.askyesno('Unsaved definition','Discard the unsaved definition changes? Saved content will remain intact.')
 def content_page(self):
  f=self.pages['Content library'];row=self.row(f)
  self.search=tk.StringVar();ttk.Label(row,text='Find content').pack(side='left');ttk.Entry(row,textvariable=self.search,width=27).pack(side='left',padx=8);self.search.trace_add('write',lambda *_:self.refresh_library())
  self.button(row,'Guided production workspace',self.production_workspace).pack(side='left',padx=5);self.button(row,'New definition',self.new_entity).pack(side='left',padx=5);self.button(row,'Duplicate selected',self.duplicate).pack(side='left',padx=5);self.button(row,'Validate saved package',lambda:self.work('Validate content',lambda:model.validate_package(self.package))).pack(side='left')
  panes=ttk.Panedwindow(f,orient='horizontal');panes.pack(fill='both',expand=True,pady=8);left=ttk.Frame(panes);right=ttk.Frame(panes,padding=12);panes.add(left,weight=1);panes.add(right,weight=3)
  self.library=ttk.Treeview(left,columns=('name','kind'),show='headings',height=15);self.library.heading('name',text='Name');self.library.heading('kind',text='Type');self.library.column('name',width=180);self.library.column('kind',width=90);self.library.pack(fill='both',expand=True);self.library.bind('<<TreeviewSelect>>',self.select_entity)
  self.fields={}
  for label,key in [('Permanent ID','id'),('Display name','name'),('Player-facing description','description'),('Type','kind'),('Dependencies (comma separated IDs)','dependencies')]:
   row=self.row(right);ttk.Label(row,text=label,width=33).pack(side='left');var=tk.StringVar();self.fields[key]=var
   entry=ttk.Combobox(row,textvariable=var,values=model.KINDS,state='readonly') if key=='kind' else ttk.Entry(row,textvariable=var)
   entry.pack(side='left',fill='x',expand=True);entry.bind('<KeyRelease>',self.mark_dirty);entry.bind('<<ComboboxSelected>>',self.mark_dirty)
  row=self.row(right);ttk.Label(row,text='Item category / storage').pack(side='left');self.category=tk.StringVar(value='No inventory rule');self.storage=tk.StringVar(value='STACK')
  ttk.Combobox(row,textvariable=self.category,values=('No inventory rule','MATERIAL','CONSUMABLE','EQUIPMENT','OTHER'),state='readonly',width=22).pack(side='left',padx=5);ttk.Combobox(row,textvariable=self.storage,values=('STACK','INSTANCE'),state='readonly',width=12).pack(side='left')
  self.category.trace_add('write',lambda *_:self.mark_dirty());self.storage.trace_add('write',lambda *_:self.mark_dirty())
  ttk.Label(right,text='Item rules apply only to ITEM. Equipment needs INSTANCE storage; materials and consumables need STACK.',wraplength=650).pack(anchor='w',pady=5)
  self.definition_tabs=ttk.Notebook(right);self.definition_tabs.pack(fill='both',expand=True);self.parts={}
  for key,title in [('public','Player-visible information'),('mechanics','Server rules'),('advanced','Discovered details'),('secrets','Hidden lore')]:
   pane=ttk.Frame(self.definition_tabs,padding=8);self.definition_tabs.add(pane,text=title);self.parts[key]=self.text(pane,8);self.parts[key].bind('<KeyRelease>',self.mark_dirty)
  row=self.row(right);self.button(row,'Save & validate definition',self.save_entity).pack(side='left');self.button(row,'View complete package',self.view_package).pack(side='left',padx=8)
  self.content_note=tk.StringVar();ttk.Label(right,textvariable=self.content_note,wraplength=680).pack(anchor='w',pady=8)
 def production_workspace(self):
  if self.dirty:raise ValueError('Save or discard the current definition before opening the independent production workspace.')
  if getattr(self,'production_process',None) and self.production_process.poll() is None:raise ValueError('The local workspace is already open. Use its browser window or stop that process before reopening.')
  self.production_process=subprocess.Popen([sys.executable,str(model.ROOT/'infra/development_client/studio_web.py'),'--workspace',str(model.ROOT/'.development/studio-v0'),'--demo','--open'])
  self.status.set('Guided workspace opened on loopback. Drafts and approvals are local; production is untouched.')
 def refresh_library(self):
  selected=self.library.selection();self.library.delete(*self.library.get_children())
  for entity in self.package['entities']:
   if self.search.get().casefold() in (entity['id']+' '+entity['definition']['name']+' '+entity['kind']).casefold():self.library.insert('','end',iid=entity['id'],values=(entity['definition']['name'],entity['kind']))
  if selected and selected[0] in self.library.get_children():self.library.selection_set(selected[0])
 def fill_entity(self,entity,original):
  self.original=original
  for key in ('id','kind'):self.fields[key].set(entity[key])
  self.fields['name'].set(entity['definition']['name']);self.fields['description'].set(entity['definition']['public'].get('description','') if isinstance(entity['definition']['public'].get('description',''),str) else '');self.fields['dependencies'].set(', '.join(entity['definition']['dependencies']))
  for key,text in self.parts.items():self.set_text(text,json.dumps(entity['definition'].get(key,{}),indent=2))
  inventory=entity['definition'].get('mechanics',{}).get('inventory',{});self.category.set(inventory.get('category','No inventory rule'));self.storage.set(inventory.get('storageMode','STACK'))
  self.content_note.set('Revision '+str(entity['revision'])+'. Quest definitions can be authored, but a quest execution engine is not implemented. Hidden lore is game content, not credentials. This GitHub repository is public; its definitions can be read there.')
  self.dirty=False
 def new_entity(self):
  if not self.discard():return
  self.fill_entity({'id':'','kind':'ITEM','revision':1,'schemaVersion':1,'definition':{'name':'','dependencies':[],'public':{}}},None)
 def select_entity(self,event=None):
  if self.busy:return
  chosen=self.library.selection()
  if not chosen or chosen[0]==self.original:return
  if not self.discard():
   if self.original in self.library.get_children():self.library.selection_set(self.original)
   return
  entity=next(e for e in self.package['entities'] if e['id']==chosen[0]);self.fill_entity(entity,entity['id'])
 def duplicate(self):
  if self.original is None:raise ValueError('Select an existing definition first.')
  if not self.discard():return
  entity=copy.deepcopy(next(e for e in self.package['entities'] if e['id']==self.original));entity['id']='';entity['revision']=1;self.fill_entity(entity,None)
 def draft(self):
  definition={'name':self.fields['name'].get(),'dependencies':[v.strip() for v in self.fields['dependencies'].get().split(',') if v.strip()]}
  for key,text in self.parts.items():
   value=json.loads(text.get('1.0','end'))
   if not isinstance(value,dict):raise ValueError(key+' must be a JSON object, such as {}.')
   if value or key=='public':definition[key]=value
  if self.fields['description'].get():definition['public']['description']=self.fields['description'].get()
  elif isinstance(definition['public'].get('description'),str):definition['public'].pop('description',None)
  if self.fields['kind'].get()=='ITEM' and self.category.get()=='No inventory rule':definition.get('mechanics',{}).pop('inventory',None)
  if self.fields['kind'].get()=='ITEM' and self.category.get()!='No inventory rule':definition.setdefault('mechanics',{})['inventory']={'version':1,'category':self.category.get(),'storageMode':self.storage.get()}
  return {'id':self.fields['id'].get().strip(),'kind':self.fields['kind'].get(),'revision':1,'schemaVersion':1,'definition':definition}
 def save_entity(self):
  updated=model.update_entity(self.package,self.draft(),self.original)
  def done(_):self.package=updated;self.original=self.fields['id'].get().strip();self.loaded_digest=model.saved_package_digest(updated);self.dirty=False;self.refresh_library();self.content_note.set('Saved locally and validated. Publishing is a separate action. Package: '+updated['version'])
  self.work('Save content',lambda:model.save_package(updated,expected_digest=self.loaded_digest),done)
 def view_package(self):
  window=tk.Toplevel(self.root);window.title('Saved content package');window.geometry('850x650');text=self.text(window);self.set_text(text,json.dumps(self.package,indent=2));text.configure(state='disabled')
 def source_page(self):
  f=self.pages['Source & GitHub'];ttk.Label(f,text='Master source: /srv/Realms/source → github.com/rdnovotni/realms → main',font=('DejaVu Sans',12,'bold')).pack(anchor='w')
  ttk.Label(f,text='Download means fast-forward only. It refuses to overwrite local edits or resolve conflicting histories automatically.',wraplength=950).pack(anchor='w',pady=8)
  row=self.row(f);self.button(row,'Review source status',lambda:self.work('Read source status',self.source_status,self.show_source)).pack(side='left');self.button(row,'Download GitHub main',self.download_source).pack(side='left',padx=8);self.button(row,'GitHub sign-in',self.sign_in).pack(side='left',padx=8);self.button(row,'Open GitHub',lambda:webbrowser.open('https://github.com/rdnovotni/realms')).pack(side='left')
  row=self.row(f);ttk.Label(row,text='Checkpoint name').pack(side='left');self.checkpoint_name=tk.StringVar(value='Reviewed game update');ttk.Entry(row,textvariable=self.checkpoint_name,width=45).pack(side='left',padx=8);self.button(row,'Save source checkpoint',self.checkpoint).pack(side='left')
  self.source_text=self.text(f,13);self.set_text(self.source_text,'Review source status before saving a checkpoint. A checkpoint records all approved source changes, not only the selected definition.')
  ttk.Label(f,text='GitHub publishing uses this computer’s Git credentials. Set up Git SSH or an OS credential helper; or load a narrowly scoped token for this app session. Credentials are never stored in game files.',wraplength=980).pack(anchor='w',pady=8)
 def sign_in(self):
  window=tk.Toplevel(self.root);window.title('GitHub publishing permission');window.geometry('680x270');window.transient(self.root)
  ttk.Label(window,text='Use a fine-grained GitHub token limited to rdnovotni/realms with Contents read/write.\nIt stays in memory for this app session and is passed only to Git, never to builds.',wraplength=640).pack(anchor='w',padx=16,pady=14)
  token=tk.StringVar();entry=ttk.Entry(window,textvariable=token,show='•',width=65);entry.pack(padx=16,pady=8);entry.focus_set()
  ttk.Button(window,text='Open GitHub token settings',command=lambda:webbrowser.open('https://github.com/settings/personal-access-tokens/new')).pack(pady=6)
  def save():
   model.AUTH_TOKEN=token.get().strip();token.set('');window.destroy();self.status.set('GitHub session credential loaded. It will be cleared when this app closes.')
  ttk.Button(window,text='Use for this session',command=save).pack(pady=8)
 def download_source(self):
  if self.dirty:raise ValueError('Save or discard the unsaved definition before downloading GitHub changes.')
  def reload(result):
   self.package,self.loaded_digest=model.read_package();self.original=None;self.dirty=False;self.refresh_library();self.new_entity();self.show_source(result+'\nThe authoring library has been reloaded from the new master source.')
  self.confirm_work('Download source','Fetch and fast-forward GitHub main? Local edits are refused; no server is deployed.',model.synchronize,reload)
 def source_status(self):
  model.assert_master();status=operations.cache_status();live=next((c for c in status.get('containers',[]) if c.get('project')=='kol-production' and c.get('service')=='api'),{})
  remote=model.git('rev-parse','origin/main')
  record=next((r for r in status.get('releases',[]) if r.get('image')==live.get('image')),{})
  return 'Local master commit: '+model.head()+'\nLast fetched GitHub main: '+remote+'\nLive source commit: '+str(record.get('source_commit') or 'Legacy image — baseline verified; not yet deployed with a Git revision label')+'\n\n'+model.git('status','--short')+'\n\nTracked changes:\n'+model.git('diff','--stat','HEAD')+'\n\n'+model.git('log','-4','--oneline')
 def show_source(self,text):self.set_text(self.source_text,text)
 def checkpoint(self):
  if self.dirty:raise ValueError('Save or discard the unsaved definition before making a source checkpoint.')
  if messagebox.askyesno('Record source changes','Commit all approved source changes using this checkpoint name? Review source status first. No GitHub push or live deployment happens yet.'):
   name=self.checkpoint_name.get();self.work('Record source checkpoint',lambda:model.checkpoint(name),lambda sha:self.show_source('Checkpoint saved: '+sha+'\nNext: build this checkpoint on the private test game.'))
 def publish_page(self):
  f=self.pages['Test & publish'];ttk.Label(f,text='1. Build a source checkpoint → 2. Test & approve → 3. Publish to GitHub and live',font=('DejaVu Sans',12,'bold')).pack(anchor='w')
  self.migrations=tk.BooleanVar(value=False);ttk.Checkbutton(f,text='Allow reviewed database updates (older code may become incompatible)',variable=self.migrations).pack(anchor='w',pady=8)
  row=self.row(f);self.button(row,'Build checkpoint on test game',self.stage).pack(side='left');self.button(row,'Open test game',lambda:webbrowser.open('http://127.0.0.1:13001')).pack(side='left',padx=8);self.button(row,'Open Server Console',lambda:subprocess.Popen(['bash',str(model.ROOT/'infra/scripts/server-console.sh')])).pack(side='left')
  row=self.row(f);ttk.Label(row,text='Selected tested build').pack(side='left');self.release=tk.StringVar();self.release_picker=ttk.Combobox(row,textvariable=self.release,state='readonly',width=68);self.release_picker.pack(side='left',padx=8);self.release_picker.bind('<<ComboboxSelected>>',lambda _:self.clear_test())
  self.login=tk.BooleanVar(value=False);self.gameplay=tk.BooleanVar(value=False)
  ttk.Checkbutton(f,text='I signed in with a separate test account',variable=self.login).pack(anchor='w',pady=5);ttk.Checkbutton(f,text='I tried the changed content / gameplay and checked for errors',variable=self.gameplay).pack(anchor='w',pady=5)
  row=self.row(f);self.button(row,'Save test approval',self.approve).pack(side='left');self.button(row,'Review live change plan',lambda:self.admin('release-plan',self.selected())).pack(side='left',padx=8);self.button(row,'Publish tested build + GitHub',self.publish).pack(side='left')
  self.release_text=self.text(f,8)
  ttk.Label(f,text='GitHub push and live deployment cannot be one atomic transaction. If one phase fails, the app reports which phase finished; it never force-pushes or rewinds player data.',wraplength=970).pack(anchor='w',pady=8)
 def clear_test(self):self.login.set(False);self.gameplay.set(False)
 def selected(self):
  record=self.release_map.get(self.release.get())
  if not record:raise ValueError('Build and select a recorded test version first.')
  return {'release':record['id']}
 def admin(self,action,data):self.work(language.ACTIONS.get(action,action),lambda:operations.admin_action(action,data,self.emit))
 def stage(self):
  if self.dirty or model.managed_changes():raise ValueError('Save content and a clean source checkpoint first.')
  sha=model.head();label=self.checkpoint_name.get();allow=self.migrations.get()
  if not messagebox.askyesno('Build private test version','Back up and build this exact source checkpoint on the private test game? Live players keep the current version.'):return
  captured=[]
  def run():
   def emit(line):captured.append(line);self.emit(line)
   return operations.admin_action('stage',{'label':label,'source_commit':sha,'allow_migrations':allow},emit)
  def done(_):
   matches=re.findall(r'PASS: (release-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}) staging_ready','\n'.join(captured))
   if matches:
    self.links[matches[-1]]=sha;folder=model.ROOT/'.development';folder.mkdir(exist_ok=True);(folder/'release-links.json').write_text(json.dumps(self.links))
   self.status.set('Test build completed. Open the test game, try your changes, then save approval.')
  self.work('Build checkpoint for testing',run,done)
 def approve(self):
  if not self.login.get() or not self.gameplay.get():raise ValueError('Complete both test checks before saving approval.')
  if messagebox.askyesno('Save your test approval','Confirm sign-in and gameplay passed for this selected build? Backend checks also verify the image and database schema.'):
   self.admin('verify-staging',{**self.selected(),'confirmed':True})
 def publish(self):
  if self.dirty:raise ValueError('Save or discard unsaved content first.')
  record=self.release_map.get(self.release.get());payload=self.selected();sha=record.get('source_commit') or self.links.get(record['id'])
  if not sha:raise ValueError('This older build has no recorded source commit. Create and test a new checkpoint build.')
  if record.get('state')!='staging_ready' or not record.get('manual_test'):raise ValueError('Save a passed test approval for this staging build first.')
  if model.head()!=sha or model.managed_changes():raise ValueError('Source differs from the tested build. Build and test a new checkpoint.')
  if not messagebox.askyesno('Publish approved update','Push this exact tested source to GitHub main, then deploy the matching build live? Public access briefly pauses. If deployment fails, GitHub may be ahead of live; both results are shown.'):return
  def run():
   def push(commit):self.emit(model.push_master(commit));self.emit('GitHub phase completed; starting live deployment.')
   return model.publish_tested(record['id'],sha,
    lambda:operations.admin_action('publish-preflight',{**payload,'source_commit':sha},self.emit),
    push,lambda:operations.admin_action('promote',{**payload,'approved':True},self.emit))
  self.work('Publish tested source and game',run,lambda _:self.status.set('GitHub and live deployment completed. Visit the website and test gameplay.'))
 def refresh_releases(self):
  status=operations.cache_status();records=status.get('releases',[]);prior=self.release.get();self.release_map={r['id']+' · '+r.get('label','Update'):r for r in records};self.release_picker['values']=tuple(self.release_map)
  if prior not in self.release_map:self.release.set(next(iter(self.release_map),''));self.clear_test()
  text='Server observations: '+('out of date — refresh in Server Console' if status.get('cache_stale') else 'current')+'\n\n'
  record=self.release_map.get(self.release.get())
  if record:text+='Selected status: '+language.release_state(record.get('state'))+'\nSource commit: '+str(record.get('source_commit') or self.links.get(record['id']) or 'unrecorded')+'\nManual test approval: '+('saved' if record.get('manual_test') else 'not saved')
  else:text+='No recorded checkpoint builds yet. Existing live and test servers are unchanged.'
  history=model.publication_history()
  if history:text+='\n\nLast publication: '+history[-1]['state'].replace('_',' ')+' · '+history[-1]['source_commit'][:12]
  self.set_text(self.release_text,text);self.root.after(5000,self.refresh_releases)
 def help_page(self):
  text=self.text(self.pages['Help'],20);self.set_text(text,'HOW TO ADD CONTENT\nChoose New definition, a type, a stable ID and display name. Item storage/category have guided fields. Player-visible information and server rules use the existing JSON definitions; the backend validates references and mechanics before saving. Duplicate is the safe way to create a different ID. Changed definitions receive a new revision and package version.\n\nCONTENT IS NOT PLAYER STATE\nDefinitions are sealed during deployment with the existing migration role. Existing player runs retain their pinned content release. This app does not grant items/rewards or switch every player to new rules. A quest definition is supported by the shared format, but a quest execution engine has not been implemented. Additional rules must be implemented and tested in the backend.\n\nONE MASTER SOURCE\nThe canonical checkout and GitHub main contain the same project layout. Download refuses dirty or divergent source. Save a source checkpoint before building; the server builds a frozen Git commit, not files being edited. Approval belongs to that exact build.\n\nPUBLISHING\nReview source → checkpoint → test build → manually try the game → save approval → publish tested build + GitHub. GitHub is pushed first without force, followed by the approved live deployment. A failed second phase means GitHub is ahead; inspect History and correct forward. Public game testing is still required.\n\nRECOVERY\nSaved draft revisions stay privately under .development/content-history. Source checkpoints remain in Git. Server Console manages encrypted backups and safe recovery tests. Database migrations cannot be undone by reverting code.\n\nGITHUB AUTHENTICATION\nUse your normal Git SSH key or OS credential helper for pushes. The connector used in this chat does not automatically provide credentials to the desktop app. Alternatively use GitHub sign-in to load a narrowly scoped token for this app session. It is not written to disk or passed to game builds.')
  text.configure(state='disabled')
 def emit(self,line):self.events.put(('output',backend.redact(str(line))))
 def lock_editor(self,locked):
  if locked:
   self.locked_widgets=[]
   def visit(widget):
    for child in widget.winfo_children():
     if isinstance(child,(ttk.Entry,ttk.Combobox,ttk.Button,ttk.Checkbutton,tk.Text)):
      self.locked_widgets.append((child,child.cget('state')));child.configure(state='disabled')
     visit(child)
   visit(self.tabs)
  else:
   for widget,state in self.locked_widgets:
    if widget.winfo_exists():widget.configure(state=state)
 def work(self,label,fn,done=None):
  if self.busy:raise ValueError('Wait for the current action to finish.')
  self.busy=True;self.lock_editor(True);self.started=time.monotonic();self.status.set(label+' — working')
  def run():
   try:result=fn();self.events.put(('done',(result,done)))
   except Exception as exc:self.events.put(('failed',backend.redact(str(exc))))
  threading.Thread(target=run,daemon=True).start()
 def confirm_work(self,label,prompt,fn,done=None):
  if messagebox.askyesno(label,prompt):self.work(label,fn,done)
 def drain(self):
  try:
   while True:
    kind,value=self.events.get_nowait()
    if kind=='output':
     self.output.configure(state='normal');self.output.insert('end',value+'\n');self.output.see('end');self.output.configure(state='disabled')
    elif kind=='done':
     self.busy=False;self.lock_editor(False);result,done=value;self.status.set(str(result or 'Completed.'))
     if done:done(result)
    else:self.busy=False;self.lock_editor(False);self.status.set('Action needs attention');messagebox.showerror('Action needs attention',value)
  except queue.Empty:pass
  self.root.after(100,self.drain)
 def close(self):
  if self.busy:messagebox.showinfo('Action in progress','Wait for the current action to finish.');return
  if self.discard():model.AUTH_TOKEN='';self.root.destroy()

if __name__=='__main__':
 root=tk.Tk();app=Studio(root)
 if '--smoke-test' in sys.argv:root.update_idletasks();root.destroy()
 else:root.mainloop()
