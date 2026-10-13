#!/usr/bin/env python3
"""Render private systemd units for a verified existing runtime. Does not install/start units."""
import argparse
import os
from pathlib import Path
import pwd
import re

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--project-dir', required=True)
p.add_argument('--user', required=True)
p.add_argument('--output-dir', required=True)
a = p.parse_args()
project = Path(a.project_dir)
if not project.is_absolute() or str(project) != str(project).strip() or '\n' in str(project) or '\r' in str(project): p.error('Use an absolute path without line breaks')
if not re.fullmatch(r'[a-z_][a-z0-9_-]*[$]?', a.user): p.error('Unsupported account name')
account = pwd.getpwnam(a.user)
if account.pw_uid == 0: p.error('Do not run the application/database as root')
for relative in ['.local/node/bin/node', '.local/postgresql/usr/lib/postgresql/18/bin/postgres', '.local/postgresql/usr/lib/postgresql/18/bin/pg_isready', '.state/postgres/PG_VERSION', '.state/runtime.env', 'dist/main.js']:
    f = project / relative
    if not f.is_file(): p.error('Existing runtime artifact missing: ' + relative)
for relative in ['.state/postgres', '.state/runtime.env']:
    if (project / relative).stat().st_uid != account.pw_uid: p.error('Service account must own existing state/runtime settings')
if (project / '.state/runtime.env').stat().st_mode & 0o077: p.error('Runtime credential file must be private to owner')
# Escaping for quoted systemd values; % is a specifier and must be doubled.
quoted = str(project).replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%')
out = Path(a.output_dir)
out.mkdir(mode=0o700, parents=True, exist_ok=True)
if out.stat().st_mode & 0o077: p.error('Output directory must be private (mode 700)')
for template in (Path(__file__).parents[1] / 'systemd').glob('*.service.in'):
    dest = out / template.name.removesuffix('.in')
    # Never overwrite a staged file unexpectedly.
    with dest.open('x') as f:
        f.write(template.read_text().replace('@PROJECT_DIR@', quoted).replace('@RUN_USER@', a.user).replace('@WORKING_DIR@', str(project).replace('%', '%%')))
    dest.chmod(0o600)
print('Staged two private service files. Review, then follow the maintenance handoff documentation.')
