#!/usr/bin/env python3
"""INFRA-002: reversible host profile; plan is read-only, apply/rollback require root."""
import argparse
import base64
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

BASE = Path('/srv/Realms/state/infra-002') if Path('/srv/Realms/state').is_dir() and not Path('/srv/Realms/state').is_symlink() else Path('/var/lib/kol-infra/infra-002')
MASK_DIRECTORY = Path('/etc/systemd/system')
TARGETS = ['sleep.target', 'suspend.target', 'hibernate.target', 'hybrid-sleep.target', 'suspend-then-hibernate.target']
TIMERS = ['chrony.service', 'apt-daily.timer', 'apt-daily-upgrade.timer']
FILES = {
'/etc/systemd/sleep.conf.d/90-kol-server.conf': '''[Sleep]
AllowSuspend=no
AllowHibernation=no
AllowHybridSleep=no
AllowSuspendThenHibernate=no
''',
'/etc/systemd/logind.conf.d/90-kol-server.conf': '''[Login]
IdleAction=ignore
HandleSuspendKey=ignore
HandleHibernateKey=ignore
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
''',
'/etc/apt/apt.conf.d/zz-kol-server': '''// INFRA-002: reboot only in an operator-approved maintenance window.
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Automatic-Reboot-WithUsers "false";
#clear Unattended-Upgrade::Allowed-Origins;
#clear Unattended-Upgrade::Origins-Pattern;
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}";
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
''',
'/etc/systemd/journald.conf.d/90-kol-server.conf': '''[Journal]
Storage=persistent
SystemMaxUse=1G
SystemKeepFree=2G
RuntimeMaxUse=256M
RuntimeKeepFree=256M
MaxRetentionSec=14day
MaxFileSec=1day
''',
'/etc/logrotate.d/rsyslog': '''/var/log/syslog
/var/log/mail.log
/var/log/kern.log
/var/log/auth.log
/var/log/user.log
/var/log/cron.log
{
    daily
    rotate 14
    maxsize 50M
    missingok
    notifempty
    compress
    delaycompress
    sharedscripts
    postrotate
        /usr/lib/rsyslog/rsyslog-rotate
    endscript
}
''',
}

def run(*args, capture=False):
    return subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE if capture else None, timeout=45).stdout

def show(unit, prop):
    return run('systemctl', 'show', unit, '-p', prop, '--value', capture=True).strip()

def snapshot_file(name):
    p = Path(name)
    if p.is_symlink():
        return {'kind': 'link', 'target': os.readlink(p)}
    if not p.exists():
        return {'kind': 'absent'}
    if not p.is_file():
        raise RuntimeError(f'Refusing non-file config: {name}')
    st = p.stat()
    return {'kind': 'file', 'data': base64.b64encode(p.read_bytes()).decode(), 'mode': st.st_mode & 0o777, 'uid': st.st_uid, 'gid': st.st_gid}

def atomic_write(name, data, mode=0o644, uid=0, gid=0):
    p = Path(name)
    p.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.kol-infra-', dir=p.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(data); f.flush(); os.fsync(f.fileno())
        os.chmod(tmp, mode); os.chown(tmp, uid, gid)
        os.replace(tmp, p)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

def restore_file(name, old):
    p = Path(name)
    if old['kind'] == 'file':
        atomic_write(name, base64.b64decode(old['data']), old['mode'], old['uid'], old['gid'])
    else:
        if p.exists() or p.is_symlink(): p.unlink()
        if old['kind'] == 'link':
            p.parent.mkdir(parents=True, exist_ok=True); p.symlink_to(old['target'])

def save(directory, state):
    atomic_write(str(directory / 'state.json'), json.dumps(state, indent=2).encode(), 0o600)

def rollback(directory):
    # Only private, root-owned snapshots created by this tool are accepted.
    directory = Path(directory).resolve()
    if directory.parent != BASE.resolve(): raise RuntimeError('Snapshot must be directly under ' + str(BASE))
    state_path = directory / 'state.json'
    for p in (directory, state_path):
        st = p.stat()
        if p.is_symlink() or st.st_uid != os.geteuid() or st.st_mode & 0o077: raise RuntimeError('Snapshot must be root-owned and private')
    state = json.loads(state_path.read_text())
    expected = set(FILES) | {str(MASK_DIRECTORY / t) for t in TARGETS}
    if set(state['files']) != expected or set(state['units']) != set(TIMERS):
        raise RuntimeError('Unexpected snapshot schema')
    for name, old in state['files'].items(): restore_file(name, old)
    run('systemctl', 'daemon-reload')
    run('timedatectl', 'set-timezone', state['timezone'])
    for unit, old in state['units'].items():
        if old['enabled'] in ('disabled', 'enabled'):
            run('systemctl', 'enable' if old['enabled'] == 'enabled' else 'disable', unit)
        if old['active'] == 'active': run('systemctl', 'start', unit)
        elif old['active'] == 'inactive': run('systemctl', 'stop', unit)
    run('systemctl', 'restart', 'systemd-journald.service')
    state['status'] = 'rolled-back'; save(directory, state)
    print('Restored previous files, timezone and selected enable/active states. Logind settings take effect at next boot.')

def apply(timezone):
    if not Path('/usr/share/zoneinfo', timezone).is_file() or '..' in Path(timezone).parts or Path(timezone).is_absolute():
        raise RuntimeError('Invalid timezone')
    for unit in TIMERS + ['systemd-journald.service', 'logrotate.timer']:
        if show(unit, 'LoadState') != 'loaded': raise RuntimeError(f'Required installed unit unavailable: {unit}; no packages are installed by this script')
    for unit in ['systemd-timesyncd.service', 'ntp.service', 'ntpsec.service']:
        if show(unit, 'ActiveState') == 'active': raise RuntimeError(f'Conflicting time provider {unit}; review manually')
    units = {u: {'enabled': show(u, 'UnitFileState'), 'active': show(u, 'ActiveState')} for u in TIMERS}
    for u, old in units.items():
        if old['enabled'] not in ('enabled', 'disabled') or old['active'] not in ('active', 'inactive'):
            raise RuntimeError(f'Unexpected state for {u}; review before applying')
    if not Path('/etc/logrotate.d/rsyslog').is_file() or not Path('/usr/lib/rsyslog/rsyslog-rotate').is_file():
        raise RuntimeError('Expected Ubuntu rsyslog rotation unavailable; review manually')
    # Reject aliases/symlinks for owned drop-ins; target masks are recorded as links.
    for name in FILES:
        if Path(name).is_symlink(): raise RuntimeError(f'Refusing config symlink: {name}')
    paths = list(FILES) + [str(MASK_DIRECTORY / t) for t in TARGETS]
    state = {'version': 1, 'status': 'prepared', 'timezone': run('timedatectl', 'show', '-p', 'Timezone', '--value', capture=True).strip(),
             'units': units, 'files': {p: snapshot_file(p) for p in paths}}
    for private_dir in (BASE.parent, BASE):
        private_dir.mkdir(exist_ok=True, mode=0o700)
        st = private_dir.stat()
        if private_dir.is_symlink() or st.st_uid != os.geteuid() or st.st_mode & 0o077:
            raise RuntimeError('Snapshot parent must be owned by root and private: ' + str(private_dir))
    directory = Path(tempfile.mkdtemp(prefix='snapshot-', dir=BASE)); os.chmod(directory, 0o700)
    save(directory, state)
    print('Rollback snapshot: ' + str(directory), flush=True)
    try:
        for name, content in FILES.items(): atomic_write(name, content.encode())
        run('logrotate', '--debug', '/etc/logrotate.conf')
        effective = run('apt-config', 'dump', capture=True)
        for key in ['Unattended-Upgrade::Automatic-Reboot', 'Unattended-Upgrade::Automatic-Reboot-WithUsers']:
            if f'{key} "false";' not in effective: raise RuntimeError('APT reboot override failed: ' + key)
        run('systemctl', 'mask', *TARGETS)
        run('systemctl', 'daemon-reload')
        run('timedatectl', 'set-timezone', timezone)
        for unit in TIMERS: run('systemctl', 'enable', '--now', unit)
        run('systemctl', 'restart', 'systemd-journald.service')
        for target in TARGETS:
            if show(target, 'LoadState') != 'masked': raise RuntimeError('Sleep mask verification failed: ' + target)
        state['status'] = 'applied'; save(directory, state)
        print('Applied. No reboot or graphical target change. Validate synchronization and workloads separately.')
    except BaseException:
        print('Apply failed; attempting rollback.', file=sys.stderr)
        try: rollback(directory)
        except BaseException as error: print(f'Rollback incomplete: {error}. Snapshot: {directory}', file=sys.stderr)
        raise

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['plan', 'apply', 'rollback'])
    parser.add_argument('--timezone', default='America/Chicago')
    parser.add_argument('--snapshot')
    args = parser.parse_args()
    if args.action == 'plan':
        print('Timezone:', args.timezone)
        for name, content in FILES.items(): print('\n' + name + '\n' + content)
        print('Mask:', ', '.join(TARGETS))
        print('Enable/start existing chrony and APT timers; restart journald only. Logind drop-in applies at next boot.')
        print('Private rollback snapshots:', BASE)
        return
    if os.geteuid() != 0: parser.error('apply/rollback requires sudo on the actual host')
    if Path('/proc/1/comm').read_text().strip() != 'systemd': parser.error('Refusing changes outside a booted systemd host')
    for command in ['systemctl', 'timedatectl', 'logrotate', 'apt-config']:
        if not shutil.which(command): parser.error('Missing required tool: ' + command)
    lock_fd = os.open('/run/lock/kol-infra-002.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    if os.fstat(lock_fd).st_uid != 0:
        os.close(lock_fd); parser.error('Lock must be owned by root')
    with os.fdopen(lock_fd, 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'apply': apply(args.timezone)
        else:
            if not args.snapshot: parser.error('rollback requires --snapshot')
            rollback(args.snapshot)

if __name__ == '__main__':
    try: main()
    except (RuntimeError, subprocess.SubprocessError, OSError, ValueError) as error:
        print(f'ERROR: {error}', file=sys.stderr); sys.exit(1)
