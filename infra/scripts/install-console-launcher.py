#!/usr/bin/env python3
"""Install a menu entry for the current user; no sudo or host service changes."""
import os
from pathlib import Path
if os.geteuid()==0: raise SystemExit('Run as your desktop user, not sudo.')
root=Path(__file__).resolve().parents[2]
def quote(value): return '"'+str(value).replace('\\','\\\\').replace('"','\\"').replace('`','\\`').replace('$','\\$').replace('%','%%')+'"'
folder=Path.home()/'.local/share/applications';folder.mkdir(parents=True,exist_ok=True)
entry=folder/'kol-server-console.desktop'
entry.write_text('[Desktop Entry]\nVersion=1.0\nType=Application\nName=Follybound Server Console\nComment=Manage the local game and PostgreSQL services\nExec='+quote(root/'infra/scripts/server-console.sh')+'\nIcon='+str(root/'infra/control_panel/icon.svg')+'\nTerminal=false\nCategories=System;Utility;\nStartupNotify=false\n')
entry.chmod(0o644)
print('Installed menu entry: Follybound Server Console')
