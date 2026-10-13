#!/usr/bin/env python3
"""Explicitly scoped local Docker operations; never reads the native game's secrets."""
import argparse,fcntl,hashlib,json,os,re,secrets,shutil,subprocess,sys
from pathlib import Path
INFRA=Path(__file__).resolve().parents[1]
REALMS_ROOT=Path('/srv/Realms')
BASE=REALMS_ROOT/'projects' if (REALMS_ROOT/'projects').is_dir() and not (REALMS_ROOT/'projects').is_symlink() else Path('/srv/kol-infra/projects')
STATE_BASE=REALMS_ROOT/'state' if (REALMS_ROOT/'state').is_dir() and not (REALMS_ROOT/'state').is_symlink() else Path('/var/lib/kol-infra')
def managed_kol(content):
    known=json.loads((INFRA/'compose/legacy-sha256.json').read_text())['kol']
    normalized=content.replace(b'\n    external: ${DB_VOLUME_EXTERNAL:-false}',b'').replace(b'  database:\n    name: ${DB_VOLUME_NAME:-${COMPOSE_PROJECT_NAME}_database}',b'  database: {}')
    return content==(INFRA/'compose/kol/compose.yaml').read_bytes() or any(hashlib.sha256(c).hexdigest() in known for c in (content,normalized))
DOCKER=['docker','--host','unix:///var/run/docker.sock']
PROJECTS={'kol-production':('kol',13000),'kol-staging':('kol',13001),
          'infra-test-a':('test-project',18081),'infra-test-b':('test-project',18082),
          'example-project':('test-project',18090)}
def run(args,**kw): return subprocess.run(args,check=True,**kw)
def compose(name,*args,**kw):
    p=BASE/name
    return run(DOCKER+['compose','--project-directory',str(p),'--env-file',str(p/'.env'),'-f',str(p/'compose.yaml'),*args],**kw)
def env_write(path,content):
    with path.open('x') as f: os.chmod(path,0o600);f.write(content)
def configure_cache(folder,name):
    if name not in ('kol-production','kol-staging'): raise ValueError('Unknown cache identity')
    for key in ('worker_password','cache_password','cache_admin_password','scheduler_password','ingress_key'):
        path=folder/'secrets'/key
        if not path.exists(): env_write(path,secrets.token_hex(32)+'\n');path.chmod(0o444)
    (folder/'cache').mkdir(exist_ok=True,mode=0o750)
    config=folder/'cache/valkey.conf';expected=(INFRA/'compose/kol/valkey.conf').read_bytes()
    if config.exists() and config.read_bytes()!=expected: raise SystemExit('Customized cache configuration; refusing to overwrite')
    config.write_bytes(expected)
    digest=lambda key:hashlib.sha256((folder/'secrets'/key).read_text().strip().encode()).hexdigest()
    acl=f"user default off\nuser cache on #{digest('cache_password')} ~{name}:* -@all +ping +get +set +del +eval +incr +expire +hello +client|setinfo +client|setname\nuser admin on #{digest('cache_admin_password')} ~* &* +@all\n"
    path=folder/'secrets/cache_acl'
    if path.exists() and path.read_text()!=acl: raise SystemExit('Customized cache ACL; refusing to overwrite')
    if not path.exists(): path.write_text(acl)
    path.chmod(0o444)

def init():
    BASE.mkdir(parents=True,exist_ok=True,mode=0o750)
    for name,(kind,port) in PROJECTS.items():
        p=BASE/name
        if p.exists():
            print(f'{name}: already exists; configuration and secrets preserved');continue
        p.mkdir(mode=0o750)
        shutil.copyfile(INFRA/'compose'/kind/'compose.yaml',p/'compose.yaml')
        content=f'COMPOSE_PROJECT_NAME={name}\nHTTP_PORT={port}\n'
        if kind=='kol':
            content+='KOL_IMAGE=kol-realms:infra-006\n'
            content+=f'DB_NAME={name.replace("-","_")}\n'
            uid=10001 if name=='kol-production' else 10002
            content+=f'APP_UID={uid}\nAPP_GID={uid}\n'
            content+='DB_MEMORY=1g\nAPI_MEMORY=512m\n' if name=='kol-production' else 'DB_MEMORY=512m\nAPI_MEMORY=256m\n'
            (p/'secrets').mkdir(mode=0o700)
            for key in ['db_password','migration_password','app_password','throttle_key','worker_password','cache_password','cache_admin_password','scheduler_password']:
                path=p/'secrets'/key
                env_write(path,secrets.token_hex(32)+'\n')
                # Compose bind-backed secrets do not implement uid/gid remapping.
                # Parent stays root-only; fixed container users can read mounted files.
                os.chmod(path,0o444)
        if kind=='kol': configure_cache(p,name)
        env_write(p/'.env',content)
        (p/'backups').mkdir(mode=0o700)
        compose(name,'--profile','setup','config','--quiet') if kind=='kol' else compose(name,'config','--quiet')
        print(f'{name}: staged; no containers started')
def refresh_templates(names=None):
    legacy=json.loads((INFRA/'compose/legacy-sha256.json').read_text())
    changes=[]
    if names is not None and any(name not in PROJECTS for name in names): raise ValueError('Unknown managed project')
    for name,(kind,_) in PROJECTS.items():
        if names is not None and name not in names: continue
        path=BASE/name/'compose.yaml'
        if not path.exists(): raise SystemExit(f'{name}: missing configuration; run init first.')
        content=path.read_bytes();new=(INFRA/'compose'/kind/'compose.yaml').read_bytes()
        if content==new: continue
        if not (managed_kol(content) if kind=='kol' else hashlib.sha256(content).hexdigest() in legacy[kind]):
            raise SystemExit(f'{name}: customized Compose configuration; refusing to overwrite. No templates changed.')
        changes.append((name,path,content,new))
    for name,path,old,new in changes:
        from datetime import datetime,timezone
        backup=path.with_name('compose.before-refresh-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.yaml')
        backup.write_bytes(old);os.chmod(backup,0o600)
        try:
            path.write_bytes(new)
            compose(name,'--profile','setup','config','--quiet')
        except BaseException:
            path.write_bytes(old);raise
        print(f'{name}: updated managed template; credentials and volumes preserved; no containers restarted')
    if not changes: print('All managed templates already current.')

def build(tag):
    if not re.fullmatch(r'[a-z0-9][a-z0-9_.-]{0,63}',tag): raise SystemExit('Use a simple versioned release tag.')
    run(DOCKER+['build','-f',str(INFRA/'container/Dockerfile'),'-t',f'kol-realms:{tag}',str(INFRA.parent)])
def read_database_name(name):
    values=dict(line.split('=',1) for line in (BASE/name/'.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
    value=values.get('DB_NAME','realms_dev')
    if not re.fullmatch(r'(kol_production|kol_staging|realms_dev)',value): raise SystemExit('Invalid database name.')
    return value

def read_database_volume(name):
    if name not in ('kol-production','kol-staging'):raise ValueError('Unknown database project')
    values=dict(line.split('=',1) for line in (BASE/name/'.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
    value=values.get('DB_VOLUME_NAME',name+'_database')
    if value not in (name+'_database','realms_'+name.replace('-','_')+'_database'):raise ValueError('Unexpected database volume identity')
    return value

def operations(args):
    name=args.project
    if args.action=='config': compose(name,'--profile','setup','config','--quiet')
    elif args.action=='prepare':
        if PROJECTS[name][0]!='kol': raise SystemExit('Prepare applies only to KoL database schema/roles.')
        compose(name,'up','-d','--wait','--wait-timeout','180','db')
        compose(name,'--profile','setup','run','--rm','bootstrap')
        compose(name,'--profile','setup','run','--rm','setup')
    elif args.action=='up': compose(name,'up','-d','--wait','--wait-timeout','180')
    elif args.action=='stop': compose(name,'stop')
    elif args.action=='start': compose(name,'start','--wait','--wait-timeout','180')
    elif args.action=='restart': compose(name,'restart');compose(name,'up','-d','--wait','--wait-timeout','180')
    elif args.action=='down': compose(name,'down')  # Deliberately retains volumes.
    elif args.action=='status': compose(name,'ps')
    elif args.action=='logs': compose(name,'logs','--tail','80')
    elif args.action=='backup':
        if PROJECTS[name][0]!='kol': raise SystemExit('Database backup is only for KoL projects.')
        from datetime import datetime,timezone
        path=BASE/name/'backups'/f"realms-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.dump"
        with path.open('xb') as out:
            os.chmod(path,0o600)
            try: compose(name,'exec','-T','db','pg_dump','-U','postgres','-Fc',read_database_name(name),stdout=out)
            except BaseException: path.unlink(missing_ok=True);raise
        with path.open('rb') as source:
            compose(name,'exec','-T','db','pg_restore','--list',stdin=source,stdout=subprocess.DEVNULL)
        print(f'Archive verified (full restore test still required): {path}')
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    subs=parser.add_subparsers(dest='command',required=True)
    subs.add_parser('init')
    subs.add_parser('refresh-templates')
    b=subs.add_parser('build');b.add_argument('tag')
    p=subs.add_parser('project');p.add_argument('project',choices=PROJECTS);p.add_argument('action',choices=['config','prepare','up','stop','start','restart','down','status','logs','backup'])
    args=parser.parse_args()
    if os.geteuid()!=0: parser.error('Run with sudo; Docker access is an administrative privilege.')
    os.environ.pop('DOCKER_HOST',None);os.environ.pop('DOCKER_CONTEXT',None)
    lockdir=Path('/run/lock/kol-docker');lockdir.mkdir(exist_ok=True,mode=0o700)
    with (lockdir/'operations.lock').open('a') as lock:
        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise SystemExit('Another Docker infrastructure operation is running.')
        if args.command=='init': init()
        elif args.command=='refresh-templates': refresh_templates()
        elif args.command=='build': build(args.tag)
        else: operations(args)
if __name__=='__main__':
    try: main()
    except subprocess.CalledProcessError as e: raise SystemExit(f'Command failed (exit {e.returncode}); inspect local output. No automatic data rollback attempted.')
