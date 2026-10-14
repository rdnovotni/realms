"""Local, unprivileged observations and fixed systemd actions for the desktop console."""
from __future__ import annotations
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.request

UNITS = ('kol-realms.service', 'kol-postgresql.service')
PROPERTIES = ('Id','LoadState','ActiveState','SubState','UnitFileState','MainPID','MemoryCurrent','CPUUsageNSec','ActiveEnterTimestamp','WorkingDirectory','User','Result','NRestarts')

class OperationError(RuntimeError): pass

def redact(text: str) -> str:
    text = re.sub(r'(?i)(postgres(?:ql)?://)[^\s"\']+', r'\1[redacted]', text)
    text = re.sub(r'(?i)(bearer\s+)[A-Za-z0-9._~+/-]+', r'\1[redacted]', text)
    text = re.sub(r'(?i)((?:password|token|secret|DATABASE_URL|DATABASE_ADMIN_URL|AUTH_THROTTLE_KEY)\s*[=:]\s*)(?:"[^"\n]*"|\x27[^\x27\n]*\x27|[^\s,;]+)', r'\1[redacted]', text)
    text = re.sub(r'(?i)(--(?:token|password|secret)(?:=|\s+))[^\s]+',r'\1[redacted]',text)
    text = re.sub(r'(?i)("(?:password|token|secret|TunnelSecret|ingress_key|authorization|cookie)"\s*:\s*")[^"]*',r'\1[redacted]',text)
    text = re.sub(r'(?i)((?:x-kol-proxy-key|set-cookie|cookie|authorization)\s*:\s*)[^\n]+',r'\1[redacted]',text)
    return text

def environment() -> dict[str,str]:
    env = dict(os.environ)
    for key in list(env):
        if key.startswith(('DATABASE_', 'TEST_DATABASE_', 'DEV_API_', 'DEV_ACCOUNT_', 'AUTH_')): env.pop(key)
    env.update(LC_ALL='C', SYSTEMD_COLORS='0', SYSTEMD_PAGER='cat')
    return env

def command(args, *, cwd=None, timeout=20, env=None) -> str:
    try:
        p = subprocess.run([str(x) for x in args], cwd=cwd, env=env or environment(), text=True, capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise OperationError(redact(str(exc))) from exc
    if p.returncode:
        raise OperationError(redact((p.stderr or p.stdout or f'Command failed ({p.returncode})').strip()))
    return p.stdout.strip()

def parse_units(text):
    units = {}
    for block in text.strip().split('\n\n'):
        row = dict(line.split('=',1) for line in block.splitlines() if '=' in line)
        if row.get('Id') in UNITS: units[row['Id']] = row
    return units

def units():
    return parse_units(command(['systemctl','show',*UNITS, *[f'--property={p}' for p in PROPERTIES]]))

def runtime_path(info=None) -> Path:
    row = (info or units()).get('kol-realms.service', {})
    value = row.get('WorkingDirectory','')
    path = Path(value)
    if not value or not path.is_absolute() or not path.is_dir():
        raise OperationError('Runtime folder unavailable. The Follybound system services must be installed first.')
    return path

def runtime_env(runtime):
    env = environment()
    env['PATH'] = f'{runtime}/.local/node/bin:{runtime}/.local/postgresql/usr/lib/postgresql/18/bin:/usr/bin:/bin'
    env['LD_LIBRARY_PATH'] = str(runtime / '.local/postgresql/usr/lib/x86_64-linux-gnu')
    return env

def health(path='/health/ready'):
    try:
        with urllib.request.urlopen('http://127.0.0.1:3000'+path, timeout=3) as response:
            return {'code':response.status, 'body':json.loads(response.read(8192)), 'ok':True}
    except urllib.error.HTTPError as exc:
        return {'code':exc.code, 'ok':False, 'error':f'HTTP {exc.code}: application is not ready'}
    except (OSError, ValueError) as exc:
        return {'code':None, 'ok':False, 'error':redact(str(exc))}

DB_PROBE = r'''
import pg from 'pg';
import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:2500,statement_timeout:4000});
try {
 const c=await pool.connect();
 try {
  await c.query('BEGIN READ ONLY');
  const basic=(await c.query('SELECT current_database() AS database, pg_database_size(current_database())::text AS bytes, version() AS version, pg_postmaster_start_time() AS started, (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()) AS connections')).rows[0];
  const applied=(await c.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).rows;
  const dir=process.argv[1]||'migrations';
  const files=(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort();
  const hashes=new Map(await Promise.all(files.map(async n=>[n,createHash('sha256').update(await readFile(dir+'/'+n,'utf8')).digest('hex')])));
  console.log(JSON.stringify({ok:true,...basic,applied:applied.length,files:files.length,
   pending:files.filter(n=>!applied.some(r=>r.name===n)),
   changed:applied.filter(r=>hashes.has(r.name)&&hashes.get(r.name)!==r.checksum).map(r=>r.name),
   extra:applied.filter(r=>!hashes.has(r.name)).map(r=>r.name)}));
  await c.query('ROLLBACK');
 }finally{c.release();}
}catch(e){console.log(JSON.stringify({ok:false,error:'Database query failed',code:e.code||'unknown'}));}
finally{await pool.end();}
'''

def database(runtime, migration_dir=None):
    node = runtime / '.local/node/bin/node'
    try:
        out = command([node,f'--env-file={runtime}/.state/runtime.env','--input-type=module','-e',DB_PROBE,str(migration_dir or runtime/'migrations')], cwd=runtime, env=runtime_env(runtime), timeout=15)
        return json.loads(out)
    except (OperationError, ValueError) as exc:
        return {'ok':False,'error':redact(str(exc))}

def resources(runtime=None):
    mem = {}
    for line in Path('/proc/meminfo').read_text().splitlines():
        k,v = line.split(':',1); mem[k] = int(v.strip().split()[0])*1024
    disk = shutil.disk_usage(runtime or '/')
    return {'uptime':float(Path('/proc/uptime').read_text().split()[0]),'load':os.getloadavg(),
      'memory_total':mem['MemTotal'],'memory_used':mem['MemTotal']-mem['MemAvailable'],
      'swap_total':mem['SwapTotal'],'swap_used':mem['SwapTotal']-mem['SwapFree'],
      'disk_total':disk.total,'disk_used':disk.used,'disk_free':disk.free,
      'reboot_required':Path('/var/run/reboot-required').exists()}

def snapshot():
    result = {'captured_at':time.strftime('%Y-%m-%d %H:%M:%S'),'errors':[]}
    try: result['units'] = units()
    except OperationError as exc: result['units']={};result['errors'].append(str(exc))
    try: runtime = runtime_path(result['units'])
    except OperationError: runtime=None
    result['health'] = health()
    result['resources'] = resources(runtime)
    result['database'] = database(runtime) if runtime else {'ok':False,'error':'Runtime unavailable'}
    result['runtime'] = str(runtime) if runtime else ''
    return result

def service_action(action):
    # A fixed allowlist; no shell, no stored password, no polkit policy changes.
    choices = {'start':['start','kol-postgresql.service','kol-realms.service'],
        'stop':['stop','kol-realms.service','kol-postgresql.service'],
        'restart_api':['restart','kol-realms.service'],
        'restart_all':['restart','kol-postgresql.service','kol-realms.service'],
        'stop_api':['stop','kol-realms.service'],'start_api':['start','kol-realms.service']}
    if action not in choices: raise OperationError('Unknown service action')
    return command(['pkexec','/usr/bin/systemctl',*choices[action]],timeout=240)

def logs(unit, count=160):
    if unit not in UNITS: raise OperationError('Unknown log source')
    return redact(command(['journalctl','-u',unit,'-n',str(min(count,400)),'--no-pager','--output=short-iso'],timeout=15))

def backup(runtime, emit=lambda text:None):
    emit('Creating a database backup…')
    out = command(['/bin/bash','scripts/runtime.sh','/bin/bash','scripts/database.sh','backup'],cwd=runtime,env=runtime_env(runtime),timeout=180)
    if not out.startswith('Backup created: '): raise OperationError('Backup did not return an archive path')
    path=Path(out.removeprefix('Backup created: ').strip())
    if not path.is_absolute(): path=runtime/path
    if not path.is_file() or not path.stat().st_size: raise OperationError('Backup archive is missing or empty')
    command(['/bin/bash','scripts/runtime.sh','pg_restore','--list',str(path)],cwd=runtime,env=runtime_env(runtime),timeout=30)
    emit('Backup created; archive readable. A full restore test is a separate action.')
    return path

def latest_backup(runtime):
    files = list((runtime/'.state/backups').glob('*.dump'))
    return max(files,key=lambda p:p.stat().st_mtime) if files else None

def restore_check(runtime, emit):
    path=latest_backup(runtime)
    if not path: raise OperationError('Create a fresh backup first.')
    emit('Restoring latest backup into a disposable database and checking it…')
    out=command(['/bin/bash','scripts/runtime.sh','/bin/bash','scripts/database.sh','restore-check',str(path)],cwd=runtime,env=runtime_env(runtime),timeout=300)
    emit(redact(out)); return path

def diagnostics():
    snap=snapshot()
    snap.pop('runtime',None)
    for row in snap['units'].values():
        for key in ('WorkingDirectory','User','MainPID'): row.pop(key,None)
    return snap
