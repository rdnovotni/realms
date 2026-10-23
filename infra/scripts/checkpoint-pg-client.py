#!/usr/bin/env python3
"""CI-only pg_dump/pg_restore bridge to the job's disposable PostgreSQL service."""
import os,pathlib,subprocess,sys
name=pathlib.Path(sys.argv[0]).name
if name not in ('pg_dump','pg_restore') or os.environ.get('GITHUB_ACTIONS')!='true':
 raise SystemExit('Disposable GitHub Actions clients only')
container=os.environ['M00_DB_CONTAINER']
if not container or any(c not in '0123456789abcdef' for c in container):raise SystemExit('Exact service container ID required')
args=sys.argv[1:];command=['docker','exec','-i']
for key in ('PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE'):
 if key in os.environ:command+=['-e',key+'='+os.environ[key]]
command += [container,name]
if name=='pg_dump':
 index=args.index('--file');file=pathlib.Path(args[index+1]);args=args[:index]+args[index+2:]
 with file.open('wb') as output:subprocess.run(command+args,stdout=output,check=True)
else:
 file=pathlib.Path(args[-1])
 with file.open('rb') as source:subprocess.run(command+args[:-1],stdin=source,check=True)
