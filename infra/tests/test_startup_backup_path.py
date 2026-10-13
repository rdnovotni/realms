#!/usr/bin/env python3
"""Test the installer backup-path guard from an unrelated invocation directory."""
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).parents[1] / 'scripts/enable-realms-startup.sh'

class BackupPathTest(unittest.TestCase):
    def test_relative_absolute_and_missing(self):
        text = SCRIPT.read_text()
        guard = text[text.index('backup=${backup_message#Backup created: }'):text.index('runuser -u "$owner"', text.index('backup=${backup_message#Backup created: }'))]
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / 'project with spaces'
            archive = project / '.state/backups/example.dump'
            archive.parent.mkdir(parents=True); archive.write_bytes(b'archive fixture')
            invocation = Path(tmp) / 'infra'; invocation.mkdir()
            for reported in ('.state/backups/example.dump', str(archive)):
                result = subprocess.run(['bash', '-ec', 'project=$1; backup_message="Backup created: $2"; '+guard+'\nprintf "%s" "$backup"', '_', str(project), reported], cwd=invocation, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, str(archive))
            result = subprocess.run(['bash', '-ec', 'project=$1; backup_message="Backup created: .state/backups/missing.dump"; '+guard, '_', str(project)], cwd=invocation, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('No completed backup found', result.stderr)

if __name__ == '__main__': unittest.main()
