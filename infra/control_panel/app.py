#!/usr/bin/env python3
"""KoL Server Console: a local Ubuntu desktop app, not a network admin server."""
from __future__ import annotations
import json
import os
from pathlib import Path
import queue
import sys
sys.dont_write_bytecode=True
import threading
import time
import tkinter as tk
from tkinter import ttk, messagebox, filedialog
import webbrowser
import backend
import deploy
import operations

BG='#101722'; CARD='#192433'; PANEL='#223044'; FG='#e8eff8'; MUTED='#9baec4'; ACCENT='#58d7bd'; WARN='#ffc878'; BAD='#ff8d99'
WORKSPACE=Path(__file__).resolve().parents[2]

def size(value):
    try: value=float(value)
    except (ValueError,TypeError): return 'Unavailable'
    for unit in ('B','KiB','MiB','GiB','TiB'):
        if abs(value)<1024: return f'{value:.1f} {unit}'
        value/=1024
    return f'{value:.1f} PiB'

def uptime(value):
    value=int(value);d,value=divmod(value,86400);h,value=divmod(value,3600);m=value//60
    return f'{d}d {h}h {m}m' if d else f'{h}h {m}m'

class Console:
    def __init__(self,root,demo=False):
        self.root=root; self.demo=demo;self.events=queue.Queue();self.busy=False;self.refreshing=False;self.current=None;self.buttons=[];self.last_checklist=''
        root.title('KoL Server Console');root.configure(bg=BG);root.geometry('1320x950');root.minsize(1120,820)
        style=ttk.Style(root);style.theme_use('clam')
        style.configure('.',background=BG,foreground=FG,font=('DejaVu Sans',10))
        style.configure('TNotebook',background=BG,borderwidth=0)
        style.configure('TNotebook.Tab',background=PANEL,foreground=MUTED,padding=(20,12))
        style.map('TNotebook.Tab',background=[('selected',CARD)],foreground=[('selected',FG)])
        style.configure('TButton',background=PANEL,foreground=FG,padding=(14,9),borderwidth=0)
        style.map('TButton',background=[('active','#344b63'),('disabled','#172333')],foreground=[('disabled','#63758b')])
        style.configure('Accent.TButton',background=ACCENT,foreground=BG)
        style.map('Accent.TButton',background=[('active','#82ead5'),('disabled','#2e655e')])
        style.configure('TProgressbar',background=ACCENT,troughcolor=PANEL,borderwidth=0)
        style.configure('TCheckbutton',background=CARD,foreground=FG)
        style.configure('TCombobox',fieldbackground=BG,background=PANEL,foreground=FG,arrowcolor=MUTED)
        style.map('TCombobox',fieldbackground=[('readonly',BG)],foreground=[('readonly',FG)])
        head=tk.Frame(root,bg=BG);head.pack(fill='x',padx=24,pady=(20,16))
        tk.Label(head,text='KoL',fg=ACCENT,bg=BG,font=('DejaVu Sans',26,'bold')).pack(side='left')
        title=tk.Frame(head,bg=BG);title.pack(side='left',padx=16)
        tk.Label(title,text='Server Console',font=('DejaVu Sans',21,'bold'),fg=FG,bg=BG).pack(anchor='w')
        tk.Label(title,text='Realms • live & test games • website • backups • alerts',fg=MUTED,bg=BG).pack(anchor='w')
        self.heartbeat=tk.Label(head,text='Connecting…',fg=MUTED,bg=BG);self.heartbeat.pack(side='right')
        shell=tk.Frame(root,bg=BG);shell.pack(fill='both',expand=True,padx=20)
        sidebar=tk.Frame(shell,bg=PANEL,width=180);sidebar.pack(side='left',fill='y',padx=(0,14));sidebar.pack_propagate(False)
        content=tk.Frame(shell,bg=BG);content.pack(side='left',fill='both',expand=True)
        body=tk.Frame(content,bg=CARD);body.pack(fill='both',expand=True)
        self.pages={};self.navigation={}
        for name in ('Overview','Attention','Projects','Releases','Backups','Website','Jobs','Logs','History','Checks & alerts','Native tools','Guide'):
            frame=tk.Frame(body,bg=CARD,padx=18,pady=16);self.pages[name]=frame
            button=ttk.Button(sidebar,text={'Releases':'Game updates','Jobs':'Background tasks','Native tools':'Original local tools','Guide':'Help & guide','Attention':'Needs attention'}.get(name,name),command=lambda n=name:self.select_page(n));button.pack(fill='x',padx=8,pady=6);self.navigation[name]=button
        tabs=ttk.Notebook(self.pages['Native tools']);tabs.pack(fill='both',expand=True)
        self.dashboard=self.page(tabs,'Native overview');self.deployment=self.page(tabs,'Native deploy');self.logpage=self.page(tabs,'Native logs');self.diagpage=self.page(tabs,'Native diagnostics')
        self.make_dashboard();self.make_deployment();self.make_logs();self.make_diagnostics()
        activity_frame=tk.Frame(content,bg=BG,height=155);activity_frame.pack(fill='x',pady=(8,0));activity_frame.pack_propagate(False)
        self.label(activity_frame,'What is happening — you can switch pages while this finishes',muted=True).pack(anchor='w')
        activity=self.text_box(activity_frame,5)
        self.ops=operations.Operations(self,self.pages,activity)
        self.select_page('Overview')
        footer=tk.Frame(root,bg=BG);footer.pack(fill='x',padx=24,pady=12)
        self.status=tk.Label(footer,text='Local desktop controls. Closing the console leaves services and installed monitoring running.',fg=MUTED,bg=BG,anchor='w');self.status.pack(fill='x')
        self.root.after(100,self.drain);self.root.after(5000,self.periodic_refresh);self.refresh()
        self.root.protocol('WM_DELETE_WINDOW',self.close)

    def select_page(self,name):
        for frame in self.pages.values():frame.pack_forget()
        self.pages[name].pack(fill="both",expand=True)
        for label,button in self.navigation.items():button.configure(style="Accent.TButton" if label==name else "TButton")

    def page(self,tabs,label):
        frame=tk.Frame(tabs,bg=CARD,padx=20,pady=20);tabs.add(frame,text=label);return frame
    def label(self,parent,text='',muted=False,font=None):
        return tk.Label(parent,text=text,bg=parent['bg'],fg=MUTED if muted else FG,anchor='w',justify='left',wraplength=780,font=font or ('DejaVu Sans',10))
    def button(self,parent,text,action,accent=False):
        b=ttk.Button(parent,text=text,command=action,style='Accent.TButton' if accent else 'TButton');self.buttons.append(b);return b
    def section(self,parent,title,subtitle=''):
        self.label(parent,title,font=('DejaVu Sans',15,'bold')).pack(anchor='w',pady=(0,5))
        if subtitle:self.label(parent,subtitle,muted=True).pack(anchor='w',pady=(0,14))
    def text_box(self,parent,height=10):
        frame=tk.Frame(parent,bg=BG);frame.pack(fill='both',expand=True,pady=(8,0))
        text=tk.Text(frame,height=height,bg=BG,fg=FG,insertbackground=FG,font=('DejaVu Sans Mono',10),wrap='word',relief='flat',padx=12,pady=12,state='disabled')
        scroll=ttk.Scrollbar(frame,command=text.yview);text.configure(yscrollcommand=scroll.set)
        scroll.pack(side='right',fill='y');text.pack(fill='both',expand=True);return text
    def write(self,widget,value,append=False):
        widget.configure(state='normal')
        if not append: widget.delete('1.0','end')
        widget.insert('end',backend.redact(value)+'\n')
        if int(widget.index('end-1c').split('.')[0])>1400:widget.delete('1.0','250.0')
        widget.see('end');widget.configure(state='disabled')

    def make_dashboard(self):
        f=self.dashboard
        self.section(f,'At a glance','Service state, database checks and host capacity in one place.')
        cards=tk.Frame(f,bg=CARD);cards.pack(fill='x')
        self.service_labels={}
        for col,(unit,name) in enumerate(zip(backend.UNITS,('Game API','PostgreSQL'))):
            card=tk.Frame(cards,bg=PANEL,padx=18,pady=15);card.grid(row=0,column=col,sticky='nsew',padx=(0,12) if col==0 else (0,0));cards.columnconfigure(col,weight=1)
            self.label(card,name,font=('DejaVu Sans',15,'bold')).pack(anchor='w')
            state=self.label(card,'Connecting…',font=('DejaVu Sans',21,'bold'));state.pack(anchor='w',pady=10)
            detail=self.label(card,'',muted=True);detail.pack(anchor='w')
            self.service_labels[unit]=(state,detail)
        self.health_label=self.label(f,'Checking readiness…');self.health_label.pack(anchor='w',pady=(18,4))
        self.db_label=self.label(f,'Reading database metadata…',muted=True);self.db_label.pack(anchor='w',pady=(0,18))
        resource=tk.Frame(f,bg=CARD);resource.pack(fill='x');self.resource_labels={};self.bars={}
        for col,name in enumerate(('Memory','Storage','CPU load')):
            panel=tk.Frame(resource,bg=PANEL,padx=14,pady=12);panel.grid(row=0,column=col,sticky='nsew',padx=(0,12) if col<2 else (0,0));resource.columnconfigure(col,weight=1)
            self.label(panel,name,muted=True).pack(anchor='w');value=self.label(panel,'—',font=('DejaVu Sans',15,'bold'));value.pack(anchor='w',pady=8);self.resource_labels[name]=value
            if name!='CPU load':
                bar=ttk.Progressbar(panel,maximum=100);bar.pack(fill='x');self.bars[name]=bar
        actions=tk.Frame(f,bg=CARD);actions.pack(fill='x',pady=(22,10))
        self.button(actions,'Start services',lambda:self.control('start'),True).pack(side='left',padx=(0,10))
        self.button(actions,'Stop services',lambda:self.control('stop')).pack(side='left',padx=(0,10))
        self.button(actions,'Restart game',lambda:self.control('restart_api')).pack(side='left',padx=(0,10))
        self.button(actions,'Open game',lambda:webbrowser.open('http://127.0.0.1:3000')).pack(side='left',padx=(0,10))
        self.button(actions,'Refresh',self.refresh).pack(side='right')
        self.label(f,'Start / stop does not change boot enablement. Ubuntu may ask for administrator authentication.',muted=True).pack(anchor='w')
        self.overview_log=self.text_box(f,5)
        self.write(self.overview_log,'Ready for local administration. No service changes occur until you choose an action.')

    def make_deployment(self):
        f=self.deployment
        self.section(f,'Deploy a checked release','Build and test a source snapshot, back up the database, then restart the game with the new code.')
        pick=tk.Frame(f,bg=CARD);pick.pack(fill='x')
        self.source=tk.StringVar(value=str(WORKSPACE/'realms'))
        entry=tk.Entry(pick,textvariable=self.source,bg=BG,fg=FG,insertbackground=FG,relief='flat',font=('DejaVu Sans',10));entry.pack(side='left',fill='x',expand=True,ipady=10,padx=(0,10))
        self.button(pick,'Choose folder',self.choose_source).pack(side='right')
        self.migrations=tk.BooleanVar(value=False)
        ttk.Checkbutton(f,text='Allow pending forward database migrations (cannot be undone by code rollback)',variable=self.migrations).pack(anchor='w',pady=(15,5))
        self.label(f,'Credentials, database files and local runtime binaries are preserved. The game pauses during the final handoff.',muted=True).pack(anchor='w')
        row=tk.Frame(f,bg=CARD);row.pack(fill='x',pady=(15,8))
        self.button(row,'Deploy selected source',self.deploy_clicked,True).pack(side='left',padx=(0,10))
        self.button(row,'Roll back code',self.rollback_clicked).pack(side='left',padx=(0,10))
        self.button(row,'Create DB backup',self.backup_clicked).pack(side='left',padx=(0,10))
        self.button(row,'Backup + restore test',self.restore_clicked).pack(side='left')
        self.release_label=self.label(f,'No deployment recorded by this console yet.',muted=True);self.release_label.pack(anchor='w',pady=10)
        self.operation_log=self.text_box(f,16)
        self.write(self.operation_log,'Deployment steps: snapshot → locked dependencies → typecheck + unit tests + build → schema check → backup → handoff → readiness.\nBackups and retained code stay on this disk. Use an independent backup destination for disaster recovery.')

    def make_logs(self):
        f=self.logpage;self.section(f,'Service logs','The newest journal entries; likely credentials are redacted before display.')
        row=tk.Frame(f,bg=CARD);row.pack(fill='x');self.log_unit=tk.StringVar(value=backend.UNITS[0])
        combo=ttk.Combobox(row,textvariable=self.log_unit,values=backend.UNITS,state='readonly',width=32);combo.pack(side='left',padx=(0,12))
        self.button(row,'Load recent logs',self.load_logs).pack(side='left')
        self.button(row,'Restart database + game',lambda:self.control('restart_all')).pack(side='right')
        self.log_text=self.text_box(f,24);self.write(self.log_text,'Select a service and load its logs. Logs are shown on request, not copied into a report automatically.')

    def make_diagnostics(self):
        f=self.diagpage;self.section(f,'System checks','Useful boot, capacity and health information without running a command by hand.')
        row=tk.Frame(f,bg=CARD);row.pack(fill='x')
        self.button(row,'Run server checklist',self.checklist).pack(side='left',padx=(0,10))
        self.button(row,'Save status report',self.export).pack(side='left',padx=(0,10))
        self.button(row,'Open backup folder',self.open_backups).pack(side='left')
        self.diagnostic_text=self.text_box(f,18)
        self.write(self.diagnostic_text,'Waiting for the first status update…')
        self.label(f,'No reboot, shutdown, firewall change, database deletion or credential editor is exposed by this client.',muted=True).pack(anchor='w',pady=(12,0))

    def periodic_refresh(self):
        self.refresh()
        self.root.after(5000,self.periodic_refresh)
    def refresh(self):
        if self.refreshing:return
        self.refreshing=True
        def work():
            try:self.events.put(('snapshot',self.demo_snapshot() if self.demo else backend.snapshot()))
            except Exception as exc:self.events.put(('refresh_error',str(exc)))
        threading.Thread(target=work,daemon=True).start()
    def emit(self,text):self.events.put(('output',text))
    def perform(self,label,fn,lock_native=True):
        if self.busy:return
        if self.demo:messagebox.showinfo('Preview mode','Actions are disabled in preview mode.');return
        self.action_started=time.monotonic();self.action_name=label
        self.busy=True;self.status.configure(text=label+' • working…',fg=ACCENT)
        for b in self.buttons:b.state(['disabled'])
        self.emit('\n'+time.strftime('%H:%M:%S')+'  '+label)
        def work():
            try:
                runtime=backend.runtime_path() if lock_native else None
                if lock_native:
                    with deploy.operation_lock(runtime):result=fn(runtime)
                else:result=fn(runtime)
                self.events.put(('done',label));self.emit(str(result) if result else 'Completed.')
            except Exception as exc:self.events.put(('failed',backend.redact(str(exc))))
        threading.Thread(target=work,daemon=True).start()
        self.root.after(1000,lambda started=self.action_started:self.action_clock(started))
    def action_clock(self,started):
        if not self.busy or started!=self.action_started:return
        seconds=int(time.monotonic()-self.action_started)
        self.status.configure(text=self.action_name+' • '+str(seconds//60)+'m '+str(seconds%60)+'s elapsed • follow messages above')
        self.root.after(1000,lambda started=self.action_started:self.action_clock(started))
    def control(self,action):
        prompts={'stop':('Stop game and database?','The game will be unavailable until you start services again. Data is preserved.'),
          'restart_api':('Restart game?','The database remains running. Active requests may be interrupted.'),
          'restart_all':('Restart database and game?','Both services will briefly be unavailable. Data is preserved.')}
        if action in prompts and not messagebox.askokcancel(*prompts[action]):return
        self.perform({'start':'Start services','stop':'Stop services','restart_api':'Restart game','restart_all':'Restart database and game'}[action],lambda runtime:backend.service_action(action))
    def choose_source(self):
        folder=filedialog.askdirectory(title='Select Realms source folder',initialdir=WORKSPACE)
        if folder:self.source.set(folder)
    def deploy_clicked(self):
        source=self.source.get();migrate=self.migrations.get()
        detail='Build and test this source, create a backup, and replace running game code?\n\n'+source
        if migrate:detail+='\n\nForward migrations are enabled. A code rollback will not undo database changes.'
        if messagebox.askokcancel('Deploy selected source?',detail):self.perform('Deploy source',lambda runtime:deploy.deploy(source,runtime,migrate,self.emit))
    def rollback_clicked(self):
        if messagebox.askokcancel('Roll back code?','Restore the most recent retained previous code and restart the game? Releases with forward migrations require planned recovery instead.'):
            self.perform('Roll back code',lambda runtime:deploy.rollback(runtime,self.emit))
    def backup_clicked(self):self.perform('Create database backup',lambda runtime:backend.backup(runtime,self.emit))
    def restore_clicked(self):
        if messagebox.askokcancel('Create and test a fresh backup?','Create a new backup, restore it into a disposable database, verify schema and invariants, then delete that disposable database. Production data is not restored or replaced.'):
            self.perform('Test backup restore',lambda runtime:(backend.backup(runtime,self.emit),backend.restore_check(runtime,self.emit))[-1])
    def load_logs(self):
        unit=self.log_unit.get()
        self.perform('Read service logs',lambda runtime:self.events.put(('logs',backend.logs(unit))))
    def checklist(self):
        def run(runtime):
            try:out=backend.command(['/bin/bash',WORKSPACE/'infra/scripts/validate-server.sh',*backend.UNITS],timeout=300)
            except backend.OperationError as exc:out=str(exc)
            self.events.put(('checklist',out))
        self.perform('Run server checklist',run)
    def export(self):
        path=filedialog.asksaveasfilename(title='Save sanitized status report',defaultextension='.json',initialfile='kol-server-status.json')
        if not path:return
        def save(runtime):
            data=backend.diagnostics()
            # This export omits runtime paths, user names, PIDs and journal content.
            operations.save_private(path,json.dumps(data,indent=2))
            self.emit('Sanitized status report saved.')
        self.perform('Save status report',save)
    def open_backups(self):
        try:
            runtime=backend.runtime_path();folder=runtime/'.state/backups';folder.mkdir(mode=0o700,exist_ok=True)
            import subprocess
            subprocess.Popen(['xdg-open',str(folder)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        except Exception as exc:messagebox.showerror('Backup folder',str(exc))
    def show_snapshot(self,s):
        self.current=s;self.refreshing=False
        self.heartbeat.configure(text='Updated '+s['captured_at'].split()[-1]+'\nUptime '+uptime(s['resources']['uptime']))
        for unit,(state,detail) in self.service_labels.items():
            row=s['units'].get(unit,{})
            value=row.get('ActiveState','unavailable');color=ACCENT if value=='active' else BAD if value=='failed' else WARN
            state.configure(text=value.capitalize(),fg=color)
            detail.configure(text='Boot: '+row.get('UnitFileState','unknown')+'   •   '+row.get('SubState','unknown')+'\nMemory: '+size(row.get('MemoryCurrent'))+'   •   Restarts: '+row.get('NRestarts','?'))
        ready=s['health']['ok'];db=s['database']
        self.health_label.configure(text='Game readiness: '+('READY • accepts requests' if ready else 'UNAVAILABLE • '+s['health'].get('error','check failed')),fg=ACCENT if ready else WARN)
        if db.get('ok'):
            pending=len(db['pending']);changed=len(db['changed'])+len(db['extra'])
            self.db_label.configure(text=f"Database: {db['database']}  •  {size(db['bytes'])}  •  Migrations: {db['applied']}/{db['files']}  •  Pending: {pending}  •  Mismatches: {changed}  •  Connections: {db.get('connections','?')}",fg=MUTED if not pending and not changed else WARN)
        else:self.db_label.configure(text='Database check: '+db.get('error','unavailable'),fg=WARN)
        r=s['resources']
        self.resource_labels['Memory'].configure(text=f"{size(r['memory_used'])} / {size(r['memory_total'])}")
        self.resource_labels['Storage'].configure(text=size(r['disk_free'])+' free')
        self.resource_labels['CPU load'].configure(text=' / '.join(f'{v:.2f}' for v in r['load']))
        self.bars['Memory']['value']=100*r['memory_used']/r['memory_total'];self.bars['Storage']['value']=100*r['disk_used']/r['disk_total']
        details=[f"Updated: {s['captured_at']}",f"Uptime: {uptime(r['uptime'])}",f"Memory: {size(r['memory_used'])} / {size(r['memory_total'])}",f"Swap: {size(r['swap_used'])} / {size(r['swap_total'])}",f"Disk free: {size(r['disk_free'])}",f"Reboot-required marker: {'present — plan maintenance' if r['reboot_required'] else 'not present'}",'','Service startup:']
        for unit,row in s['units'].items():details.append(unit+': '+row.get('ActiveEnterTimestamp','unknown'))
        if db.get('ok'):details.extend(['',db.get('version',''),'Database started: '+str(db.get('started','unknown'))])
        details.extend(['','Runtime: '+s['runtime'],'','Read-only SQL uses the existing restricted application role. No credentials are displayed.'])
        if s['errors']:details.extend(s['errors'])
        if self.last_checklist:details.extend(['','Latest checklist result:',self.last_checklist])
        if not self.busy:self.write(self.diagnostic_text,'\n'.join(details))
        try:
            if s['runtime']:
                rows=deploy.history(Path(s['runtime']))
                if rows:self.release_label.configure(text='Latest console deployment: '+rows[0]['id']+' • '+rows[0]['status']+' • Retained releases: '+str(len(rows)))
        except OSError:pass
    def drain(self):
        try:
            while True:
                kind,data=self.events.get_nowait()
                if kind=='snapshot':self.show_snapshot(data)
                elif kind=='refresh_error':
                    self.refreshing=False;self.heartbeat.configure(text='Status unavailable',fg=WARN);self.write(self.overview_log,data,True)
                elif kind=='output':
                    self.write(self.operation_log,data,True);self.write(self.overview_log,data,True);self.ops.handle_output(data)
                elif kind in ('done','failed'):
                    self.busy=False
                    for b in self.buttons:b.state(['!disabled'])
                    self.ops.update_release_controls()
                    self.status.configure(text=('Completed: ' if kind=='done' else 'Action failed: ')+data,fg=ACCENT if kind=='done' else BAD)
                    self.ops.log_mode=False
                    if kind=='failed':self.emit(data);messagebox.showerror('Action needs attention',data)
                    self.refresh()
                elif kind=='logs':self.write(self.log_text,data)
                elif kind=='checklist':self.last_checklist=data;self.write(self.diagnostic_text,data)
        except queue.Empty:pass
        self.root.after(100,self.drain)
    def close(self):
        if self.busy:
            messagebox.showinfo('Action in progress','Wait for the current action to finish. Closing during deployment can interrupt recovery.');return
        self.root.destroy()
    def demo_snapshot(self):
        return {'captured_at':time.strftime('%Y-%m-%d %H:%M:%S'),'errors':[],'runtime':'',
        'units':{u:{'ActiveState':'active','SubState':'running','UnitFileState':'enabled','MemoryCurrent':'67108864','NRestarts':'0','ActiveEnterTimestamp':'Booted automatically'} for u in backend.UNITS},
        'health':{'ok':True},'database':{'ok':True,'database':'realms_dev','bytes':18000000,'applied':27,'files':27,'pending':[],'changed':[],'extra':[]},
        'resources':{'uptime':880,'load':(1.2,1.1,.8),'memory_total':16000000000,'memory_used':6500000000,'swap_total':4000000000,'swap_used':0,'disk_total':500000000000,'disk_used':38000000000,'disk_free':462000000000,'reboot_required':False}}

def main():
    import argparse
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--demo',action='store_true');p.add_argument('--smoke-test',action='store_true');args=p.parse_args()
    if os.geteuid()==0: p.error('Run this desktop app as your regular Ubuntu account, not sudo.')
    root=tk.Tk();console=Console(root,args.demo)
    if args.smoke_test:root.after(2500,root.destroy)
    root.mainloop()

if __name__=='__main__':main()
