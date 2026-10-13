#!/usr/bin/env python3
"""Install the per-user Development Studio launcher; no system services."""
import os
from pathlib import Path
if os.geteuid()==0:raise SystemExit('Run as your desktop user.')
root=Path(__file__).resolve().parents[2]
def quote(value):return '"'+str(value).replace('\\','\\\\').replace('"','\\"').replace('`','\\`').replace('$','\\$').replace('%','%%')+'"'
folder=Path.home()/'.local/share/applications';folder.mkdir(parents=True,exist_ok=True)
file=folder/'realms-development-studio.desktop'
file.write_text('[Desktop Entry]\nType=Application\nName=Realms Development Studio\nComment=Author game definitions and publish tested source checkpoints\nExec='+quote(root/'infra/scripts/development-studio.sh')+'\nIcon='+str(root/'infra/control_panel/icon.svg')+'\nTerminal=false\nCategories=Development;Game;\nStartupNotify=false\n')
file.chmod(0o644);print('Realms Development Studio added to your application menu.')
