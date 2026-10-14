"""Build a selected Follybound source snapshot and deploy it with data preserved."""
from __future__ import annotations
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
import backend

ARTIFACTS = ('src','client','migrations','scripts','test','dist','node_modules','package.json','package-lock.json','tsconfig.json','tsconfig.test.json')
SOURCE = ('src','client','migrations','scripts','test','package.json','package-lock.json','tsconfig.json','tsconfig.test.json')
IGNORED = {'.git','.state','.local','.env','node_modules','dist','coverage','__pycache__'}

@contextmanager
def operation_lock(runtime):
    root=runtime/'.state/control-panel'; root.mkdir(mode=0o700,parents=True,exist_ok=True)
    fd=os.open(root/'operation.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'a') as lock:
        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise backend.OperationError('Another console action is already running.')
        yield

def copy_source(source, stage):
    package=json.loads((source/'package.json').read_text())
    if package.get('name')!='realms-server': raise backend.OperationError('Select a Follybound project folder containing package.json.')
    def ignore(directory,names):
        return [n for n in names if n in IGNORED or n.startswith('.env')]
    for name in SOURCE:
        path=source/name
        if not path.exists(): raise backend.OperationError('Required source artifact missing: '+name)
        if path.is_symlink(): raise backend.OperationError('Source artifacts must not be symbolic links: '+name)
        if path.is_dir():
            for root,dirs,files in os.walk(path):
                dirs[:]=[n for n in dirs if n not in IGNORED]
                for child in dirs+files:
                    if child not in IGNORED and (Path(root)/child).is_symlink():
                        raise backend.OperationError('Source contains a symbolic link; select a normal checkout.')
            shutil.copytree(path,stage/name,ignore=ignore)
        else: shutil.copy2(path,stage/name)

def save_manifest(previous, manifest):
    tmp=previous/'manifest.tmp'
    tmp.write_text(json.dumps(manifest,indent=2));tmp.chmod(0o600);tmp.replace(previous/'manifest.json')

def swap_artifacts(stage,runtime,previous,manifest):
    for name in ARTIFACTS:
        incoming=stage/name
        if not incoming.exists(): raise backend.OperationError('Built release is incomplete: '+name)
        current=runtime/name
        existed=current.exists() or current.is_symlink()
        # Record intent before moving either half. Recovery examines actual filesystem state.
        manifest['files'].append({'name':name,'existed':existed})
        save_manifest(previous,manifest)
        if existed: os.replace(current,previous/name)
        os.replace(incoming,current)

def restore_artifacts(runtime,previous,manifest):
    for entry in reversed(manifest['files']):
        name=entry['name']
        if name not in ARTIFACTS: raise backend.OperationError('Invalid rollback manifest')
        current=runtime/name; saved=previous/name
        # A saved original means replacement began. Missing saved originals are untouched.
        if saved.exists() or saved.is_symlink() or not entry['existed']:
            if current.is_symlink() or current.is_file(): current.unlink()
            elif current.is_dir(): shutil.rmtree(current)
            if saved.exists() or saved.is_symlink(): os.replace(saved,current)


def deploy(source,runtime,allow_migrations,emit):
    info=backend.units()
    owner=info.get('kol-realms.service',{}).get('User','')
    import pwd
    if owner!=pwd.getpwuid(os.getuid()).pw_name:
        raise backend.OperationError('Launch the console as the existing service owner, not root.')
    if info.get('kol-postgresql.service',{}).get('ActiveState')!='active':
        raise backend.OperationError('Start the database before deploying.')
    source=Path(source).resolve()
    if shutil.disk_usage(runtime).free < 1024**3: raise backend.OperationError('Less than 1 GiB free: make space before building a release.')
    base=runtime/'.state/control-panel/releases';base.mkdir(mode=0o700,parents=True,exist_ok=True)
    release_id=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:6]
    stage=Path(tempfile.mkdtemp(prefix='build-',dir=base))
    previous=base/release_id; previous.mkdir(mode=0o700)
    manifest={'id':release_id,'created':datetime.now(timezone.utc).isoformat(),'status':'building','files':[], 'migrations_applied':False,'source':str(source),'build_folder':str(stage)}
    save_manifest(previous,manifest)
    stopped=False; schema_changed=False; installed=False
    was_active=info.get('kol-realms.service',{}).get('ActiveState')=='active'
    try:
        emit('1/7  Snapshotting selected source (credentials and database files excluded)…')
        copy_source(source,stage)
        (stage/'.local').symlink_to(runtime/'.local',target_is_directory=True)
        env=backend.runtime_env(stage)
        emit('2/7  Installing locked project dependencies into the build folder…')
        backend.command(['/bin/bash','scripts/runtime.sh','npm','ci'],cwd=stage,env=env,timeout=600)
        for label,task in [('Type checking','typecheck'),('Unit tests','test'),('Production build','build')]:
            emit('3/7  '+label+'…')
            output=backend.command(['/bin/bash','scripts/runtime.sh','npm','run',task],cwd=stage,env=env,timeout=600)
            emit(backend.redact(output[-12000:]))
        probe=backend.database(runtime,stage/'migrations')
        if not probe.get('ok'): raise backend.OperationError('Cannot verify database schema: '+probe.get('error','unknown'))
        if probe['changed'] or probe['extra']:
            raise backend.OperationError('Selected source changes/removes applied migrations. Deployment refused; database left unchanged.')
        if probe['pending'] and not allow_migrations:
            raise backend.OperationError('Pending migrations: '+', '.join(probe['pending'])+'. Enable the migration option after reviewing them.')
        emit('4/7  Backing up the database before handoff…')
        archive=backend.backup(runtime,emit);manifest['backup']=str(archive);save_manifest(previous,manifest)
        emit('5/7  Stopping the game API (database remains running)…')
        backend.service_action('stop_api');stopped=True
        if probe['pending']:
            emit('Applying explicitly approved forward migrations…')
            # Existing administration file is consumed by Node, never displayed/copied.
            node=runtime/'.local/node/bin/node'
            backend.command([node,f'--env-file={runtime}/.env','--import','tsx','src/migrate.ts'],cwd=stage,env=env,timeout=180)
            schema_changed=True;manifest['migrations_applied']=True;save_manifest(previous,manifest)
        # New schema's role privileges are provisioned before the new API starts.
        backend.command([runtime/'.local/node/bin/node',f'--env-file={runtime}/.env','--import','tsx','src/provision.ts'],cwd=stage,env=env,timeout=180)
        emit('6/7  Installing built code; existing state, runtime and credentials stay in place…')
        swap_artifacts(stage,runtime,previous,manifest);installed=True
        emit('7/7  Starting game API and waiting for readiness…')
        backend.service_action('start_api')
        if not backend.health()['ok']: raise backend.OperationError('New release started but readiness did not pass.')
        manifest['status']='deployed';save_manifest(previous,manifest)
        emit('Deployment complete. Database backup and previous code are retained locally.')
        return release_id
    except BaseException as error:
        manifest['status']='failed';manifest['error']=backend.redact(str(error));save_manifest(previous,manifest)
        if stopped and not schema_changed:
            emit('Deployment failed; restoring previous code…')
            try:
                backend.service_action('stop_api')
                restore_artifacts(runtime,previous,manifest)
                if was_active: backend.service_action('start_api')
                manifest['status']='rolled-back';save_manifest(previous,manifest)
                emit('Previous code restored. Check readiness and the action log.')
            except Exception as restore_error:
                emit('Recovery requires attention: '+backend.redact(str(restore_error)))
        elif schema_changed:
            # Old code may be incompatible with the new database. Never restore data automatically.
            emit('Forward migrations were applied. Automatic code rollback was withheld; database backup is retained. Review release history and logs before recovery.')
            try: backend.service_action('stop_api')
            except Exception: pass
        raise error
    finally:
        if stage.exists() and not (schema_changed and manifest['status']=='failed'): shutil.rmtree(stage)

def history(runtime):
    rows=[]
    for path in (runtime/'.state/control-panel/releases').glob('*/manifest.json'):
        try: rows.append(json.loads(path.read_text()))
        except (OSError,ValueError): continue
    return sorted(rows,key=lambda r:r.get('created',''),reverse=True)

def rollback(runtime,emit):
    candidates=[row for row in history(runtime) if row['status']=='deployed']
    if not candidates: raise backend.OperationError('No retained successful deployment to roll back.')
    manifest=candidates[0]
    if manifest.get('migrations_applied'):
        raise backend.OperationError('This release applied database migrations. Automatic rollback is unavailable; use its backup for a planned recovery.')
    if not re_safe_id(manifest['id']): raise backend.OperationError('Invalid release identifier')
    previous=runtime/'.state/control-panel/releases'/manifest['id']
    for entry in manifest['files']:
        if entry['name'] not in ARTIFACTS or (entry['existed'] and not (previous/entry['name']).exists()):
            raise backend.OperationError('Previous release is incomplete; refusing rollback.')
    emit('Stopping API and restoring the retained previous code…')
    backend.service_action('stop_api')
    restore_artifacts(runtime,previous,manifest)
    backend.service_action('start_api')
    if not backend.health()['ok']: raise backend.OperationError('Rollback code installed; readiness failed. Inspect logs.')
    manifest['status']='rolled-back';save_manifest(previous,manifest)
    emit('Previous code restored and ready. Database was not restored or removed.')

def re_safe_id(value):
    import re
    return bool(re.fullmatch(r'[0-9]{8}T[0-9]{6}Z-[a-f0-9]{6}',value))
