#!/usr/bin/env python3
"""Verify systemd syntax including project paths with spaces and % specifiers."""
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).parents[1]

@unittest.skipIf(os.geteuid() == 0 or not shutil.which('systemd-analyze') or Path('/proc/1/comm').read_text().strip() == 'codex', 'Requires a non-root account and host systemd-analyze; sandbox verification is blocked')
class UnitRenderingTest(unittest.TestCase):
    def test_render_special_path_and_verify(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            project = base / 'runtime with space %'
            for relative in ['.local/node/bin/node', '.local/postgresql/usr/lib/postgresql/18/bin/postgres', '.local/postgresql/usr/lib/postgresql/18/bin/pg_isready', '.state/postgres/PG_VERSION', '.state/runtime.env', 'dist/main.js']:
                path = project / relative; path.parent.mkdir(parents=True, exist_ok=True); path.write_text('test fixture\n'); path.chmod(0o600)
            stage = base / 'stage'
            subprocess.run([sys.executable, str(ROOT / 'scripts/prepare-realms-services.py'), '--project-dir', str(project), '--user', pwd.getpwuid(os.geteuid()).pw_name, '--output-dir', str(stage)], check=True, capture_output=True, text=True)
            wrapper = stage / 'run-existing-realms.sh'; wrapper.write_text('#!/bin/sh\nexit 0\n'); wrapper.chmod(0o700)
            for path in stage.glob('*.service'):
                text = path.read_text()
                self.assertIn('WorkingDirectory=' + str(project).replace('%', '%%') + '\n', text)
                self.assertNotIn('@PROJECT', text)
                path.write_text(text.replace('/usr/local/lib/kol-infra/run-existing-realms.sh', str(wrapper)))
            result = subprocess.run(['systemd-analyze', 'verify', str(stage / 'kol-postgresql.service'), str(stage / 'kol-realms.service')], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

if __name__ == '__main__': unittest.main()
