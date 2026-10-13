#!/usr/bin/env python3
"""Exercise apply/rollback using temporary files and simulated system commands."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
import sys
sys.dont_write_bytecode = True
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('profile', Path(__file__).parents[1] / 'scripts/server-profile.py')
profile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profile)

class ProfileTest(unittest.TestCase):
    def exercise(self, fail=False):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            base = root / 'state' / 'infra-002'
            masks = root / 'masks'; masks.mkdir()
            config = root / 'config'; config.write_text('original\n'); config.chmod(0o640)
            absent = root / 'new-config'
            (masks / 'sleep.target').symlink_to('/dev/null')
            units = {u: {'enabled': 'disabled', 'active': 'inactive'} for u in profile.TIMERS}
            time = ['UTC']
            def show(unit, prop):
                if prop == 'LoadState':
                    return 'masked' if (masks / unit).is_symlink() else 'loaded'
                if prop == 'UnitFileState': return units[unit]['enabled']
                if prop == 'ActiveState': return units.get(unit, {}).get('active', 'inactive')
                raise AssertionError(prop)
            def run(*args, capture=False):
                if args[0] == 'logrotate' and fail: raise RuntimeError('simulated validation failure')
                if args[:2] == ('apt-config', 'dump'):
                    return 'Unattended-Upgrade::Automatic-Reboot "false";\nUnattended-Upgrade::Automatic-Reboot-WithUsers "false";'
                if args[:2] == ('timedatectl', 'show'): return time[0]
                if args[:2] == ('timedatectl', 'set-timezone'): time[0] = args[2]
                if args[:2] == ('systemctl', 'mask'):
                    for t in args[2:]:
                        p = masks / t
                        if not p.is_symlink(): p.symlink_to('/dev/null')
                if args[0] == 'systemctl' and args[1] in ('enable', 'disable'):
                    units[args[-1]]['enabled'] = 'enabled' if args[1] == 'enable' else 'disabled'
                    if '--now' in args: units[args[-1]]['active'] = 'active'
                if args[0] == 'systemctl' and args[1] in ('start', 'stop'):
                    units[args[-1]]['active'] = 'active' if args[1] == 'start' else 'inactive'
                return ''
            with patch.object(profile, 'BASE', base), patch.object(profile, 'MASK_DIRECTORY', masks), \
                 patch.object(profile, 'FILES', {str(config): 'new\n', str(absent): 'created\n'}), \
                 patch.object(profile, 'run', run), patch.object(profile, 'show', show), \
                 patch.object(profile.os, 'chown'), contextlib.redirect_stdout(io.StringIO()), \
                 contextlib.redirect_stderr(io.StringIO()):
                if fail:
                    with self.assertRaisesRegex(RuntimeError, 'simulated'): profile.apply('America/Chicago')
                else:
                    profile.apply('America/Chicago')
                    self.assertEqual(config.read_text(), 'new\n')
                    self.assertTrue(absent.is_file())
                    self.assertEqual(time[0], 'America/Chicago')
                    profile.rollback(next(base.iterdir()))
                self.assertEqual(config.read_text(), 'original\n')
                self.assertEqual(config.stat().st_mode & 0o777, 0o640)
                self.assertFalse(absent.exists())
                self.assertEqual(os.readlink(masks / 'sleep.target'), '/dev/null')
                self.assertFalse((masks / 'suspend.target').is_symlink())
                self.assertEqual(time[0], 'UTC')
                self.assertTrue(all(v == {'enabled': 'disabled', 'active': 'inactive'} for v in units.values()))
                snapshot = next(base.iterdir()) / 'state.json'
                self.assertEqual(snapshot.stat().st_mode & 0o777, 0o600)
    def test_apply_and_rollback(self): self.exercise()
    def test_failure_automatically_rolls_back(self): self.exercise(fail=True)
    def test_rollback_rejects_external_snapshot(self):
        with self.assertRaisesRegex(RuntimeError, 'directly under'): profile.rollback('/tmp/not-a-profile-snapshot')

if __name__ == '__main__': unittest.main()
