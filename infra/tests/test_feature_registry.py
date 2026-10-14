import copy
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]

def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'infra/scripts' / file)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded

registry = module('feature_registry_tests', 'feature_registry.py')
importer = module('design_import_tests', 'import_design_catalog.py')

class FeatureRegistryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source, cls.baseline = registry.load(ROOT)

    def setUp(self):
        self.overlay = copy.deepcopy(self.baseline)

    def invalid(self, pattern):
        with self.assertRaisesRegex(registry.RegistryError, pattern):
            registry.validate(self.source, self.overlay, ROOT)

    def test_complete_source_coverage_and_report_are_current(self):
        counts = registry.validate(self.source, self.overlay, ROOT)
        self.assertEqual((counts['documents'], counts['sections'], counts['entries'], counts['rules']), (47, 2096, 13187, 11607))
        self.assertEqual(registry.report(self.source, self.overlay), (ROOT / registry.DESIGN / 'WORK_PLAN.md').read_text())
        self.assertNotIn('verified', counts['statuses'])

    def test_source_manifest_is_reproducible_and_stale_reports_fail(self):
        self.assertEqual(registry.manifest(self.source), (ROOT / registry.DESIGN / 'SOURCE_MANIFEST.md').read_text())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / registry.DESIGN).mkdir(parents=True)
            registry.check_reports(self.source, self.overlay, root, write=True)
            registry.check_reports(self.source, self.overlay, root)
            (root / registry.DESIGN / 'SOURCE_MANIFEST.md').write_text('stale')
            with self.assertRaisesRegex(registry.RegistryError, 'SOURCE_MANIFEST.md is stale'):
                registry.check_reports(self.source, self.overlay, root)
            registry.check_reports(self.source, self.overlay, root, write=True)
            registry.check_reports(self.source, self.overlay, root)

    def test_missing_section_fails_even_when_system_contract_exists(self):
        self.overlay['capabilities'].pop()
        self.invalid('Missing or multiply assigned source')

    def test_missing_rule_cannot_disappear_from_coverage(self):
        self.overlay['capabilities'][0]['source_entries'].pop()
        self.invalid('Missing or multiply assigned source requirements')

    def test_wrong_owner_or_duplicate_source_cannot_pass(self):
        self.overlay['capabilities'][0]['system'] = 'SYS-01'
        self.invalid('wrong owner')
        self.overlay = copy.deepcopy(self.baseline)
        self.overlay['capabilities'][0]['source_entries'].append(self.overlay['capabilities'][0]['source_entries'][0])
        self.invalid('duplicate section entries')

    def test_unknown_and_cyclic_prerequisites_fail(self):
        system = next(s for s in self.overlay['systems'] if s['id'] == 'SYS-23')
        system['depends_on'] = ['SYS-46']
        self.invalid('dependency cycle')
        system['depends_on'] = ['SYS-99']
        self.invalid('Unknown system dependency')

    def test_bad_scope_and_omitted_reset_rule_fail(self):
        self.overlay['systems'][1]['state'][0]['scope'] = 'PLAYER'
        self.invalid('Unknown state scope')
        self.overlay = copy.deepcopy(self.baseline)
        self.overlay['systems'][1]['state'][0]['ascension'] = ''
        self.invalid('missing state ascension')

    def test_source_tier_and_design_status_are_not_implementation_proof(self):
        self.overlay['systems'][1]['launch_tier'] = 'Post-Launch Ready'
        self.invalid('tier changed silently')
        self.overlay = copy.deepcopy(self.baseline)
        self.overlay['capabilities'][37]['implementation_status'] = 'verified'
        self.invalid('completion requires every rule')

    def test_aggregate_cannot_claim_implementation_over_unassessed_sections(self):
        self.overlay['systems'][1]['implementation_status'] = 'implemented'
        self.invalid('Aggregate status cannot exceed')

    def test_evidence_must_exist_and_stay_within_repository(self):
        self.overlay['systems'][1]['baseline_evidence'][0]['test'] = '../outside'
        self.invalid('escapes repository')
        self.overlay['systems'][1]['baseline_evidence'][0]['test'] = 'realms/test/nonexistent.ts'
        self.invalid('path missing')

    def test_rule_assertions_need_real_tests_and_correction_reference(self):
        cap = self.overlay['capabilities'][37]
        entry = cap['source_entries'][0]
        cap['rule_assertions'][entry] = {'disposition': 'active', 'reason': 'Test case', 'assertions': []}
        self.invalid('concrete assertions')
        cap['rule_assertions'][entry] = {'disposition': 'superseded', 'reason': 'Older proposal', 'correction': 'invented canon'}
        self.invalid('recorded correction')

    def prepared_capability(self):
        cap = self.overlay['capabilities'][37]
        entries = {e['stable_id']: e for e in self.source['entries']}
        cap['implementation_status'] = 'implemented'
        cap['evidence'] = [{'path': 'realms/src/domains/lifecycle.ts', 'finding': 'Validator fixture, not a real completion claim.'}]
        cap['contract_review'] = {k: 'Explicit validator fixture review' for k in ('state', 'actions', 'authoring', 'client')}
        cap['rule_assertions'] = {e: {'disposition': 'active', 'reason': 'Validator fixture only', 'assertions': [{'test': 'realms/test/foundation.test.ts', 'name': 'Fixture assertion'}]} for e in cap['source_entries'] if entries[e]['entry_group'] in {'FEATURE / RULE', 'SCHEMA / DATA'}}
        return cap

    def test_promoted_status_requires_section_review_and_full_workflow_proof(self):
        cap = self.prepared_capability()
        registry.validate(self.source, self.overlay, ROOT)
        del cap['contract_review']['state']
        self.invalid('section-specific contract review')
        cap['contract_review']['state'] = 'Explicit fixture fields'
        cap['implementation_status'] = 'integrated'
        cap['workflow_evidence'] = {'integration': ['realms/test/foundation.test.ts']}
        self.invalid('cover client, Studio and integration')

    def test_verified_status_requires_immutable_commit_and_passing_artifact(self):
        cap = self.prepared_capability()
        cap['implementation_status'] = 'verified'
        cap['workflow_evidence'] = {k: ['realms/test/foundation.test.ts'] for k in ('client', 'studio', 'integration')}
        cap['verification'] = {'source_commit': 'main', 'command': 'fixture only', 'result': 'passed', 'artifact': 'realms/test/foundation.test.ts'}
        self.invalid('exact commit')
        cap['verification']['source_commit'] = 'a' * 40
        cap['verification']['result'] = 'failed'
        self.invalid('passing result')

    def test_active_system_and_section_cannot_hide_as_historical(self):
        self.overlay['capabilities'][37]['implementation_status'] = 'historical'
        self.invalid('Historical capability status is reserved for Core')
        self.overlay = copy.deepcopy(self.baseline)
        self.overlay['systems'][1]['implementation_status'] = 'historical'
        self.invalid('Historical system status is reserved for Core')

    def test_unrelated_known_correction_cannot_exempt_an_active_rule(self):
        cap = self.overlay['capabilities'][37]
        entry = cap['source_entries'][0]
        cap['rule_assertions'][entry] = {'disposition': 'superseded', 'reason': 'Incorrect global topic reuse', 'correction': 'Culture selection'}
        self.invalid('explicit affected-entry binding')

    def test_supersession_binding_requires_approved_owner_replacement_and_unique_ids(self):
        cap = next(c for c in self.overlay['capabilities'] if c['system'] == 'SYS-37')
        entries = [e for e in self.source['entries'] if e['system_label'] == '37' and e['status_class'] == 'APPROVED' and e['entry_group'] == 'FEATURE / RULE']
        old, replacement = entries[0]['stable_id'], entries[1]['stable_id']
        binding = {'topic': 'Culture selection', 'affected_entries': [old], 'replacement_entry': replacement, 'reason': 'Validator fixture only; semantic association still requires human review.'}
        self.overlay['supersession_bindings'] = [binding]
        cap = next(c for c in self.overlay['capabilities'] if old in c['source_entries'])
        cap['rule_assertions'][old] = {'disposition': 'superseded', 'reason': 'Explicit validator fixture binding', 'correction': 'Culture selection'}
        registry.validate(self.source, self.overlay, ROOT)
        binding['replacement_entry'] = self.overlay['capabilities'][37]['source_entries'][0]
        self.invalid('correction owner')
        binding['replacement_entry'] = replacement
        binding['affected_entries'].append(old)
        self.invalid('duplicate/conflicting correction bindings')

    def test_supersession_cycles_cannot_exempt_both_rules(self):
        entries = [e['stable_id'] for e in self.source['entries'] if e['system_label'] == '37' and e['status_class'] == 'APPROVED' and e['entry_group'] == 'FEATURE / RULE']
        self.overlay['supersession_bindings'] = [
            {'topic': 'Culture selection', 'affected_entries': [entries[0]], 'replacement_entry': entries[1], 'reason': 'Fixture'},
            {'topic': 'Culture selection', 'affected_entries': [entries[1]], 'replacement_entry': entries[0], 'reason': 'Fixture'}]
        self.invalid('cannot itself be superseded')

    def test_roadmap_covers_all_systems_and_has_no_cycles(self):
        self.overlay['work_packages'][0]['after'] = ['WP-08']
        self.invalid('dependency cycle')
        self.overlay = copy.deepcopy(self.baseline)
        for p in self.overlay['work_packages']:
            p['systems'] = [s for s in p['systems'] if s != 'SYS-40']
        self.invalid('Roadmap does not cover')

    def test_effective_contract_preserves_wording_owner_and_reset_profiles(self):
        cap = next(c for c in self.overlay['capabilities'] if c['id'] == 'CAP-01-rollover')
        result = registry.effective(self.source, self.overlay, cap['id'])
        self.assertEqual(result['contract']['owner'], 'turn-economy')
        self.assertTrue(any(s['scope'] == 'ACCOUNT' and 'never reset' in s['rollover'] for s in result['contract']['state']))
        self.assertEqual(len(result['requirements']), len(cap['source_entries']))
        self.assertTrue(all(r['detail'] for r in result['requirements']))

    def test_source_catalog_tampering_fails_before_registry_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            design = root / registry.DESIGN
            design.mkdir(parents=True)
            (design / 'source-catalog.json.gz').write_bytes(gzip.compress(b'{}'))
            (design / 'feature-registry.json').write_text(json.dumps(self.overlay))
            with self.assertRaisesRegex(registry.RegistryError, 'fingerprint changed'):
                registry.load(root)

class DesignImportTests(unittest.TestCase):
    def archive(self, path, bad_hash=False):
        data = b'<html>Test fixture only</html>'
        doc = {'source_file': 'test.html', 'size_bytes': len(data), 'sha256': '0' * 64 if bad_hash else hashlib.sha256(data).hexdigest()}
        with zipfile.ZipFile(path, 'w') as bundle:
            for name, value in [('documents.json', [doc]), ('sections.json', []), ('features.json', []), ('supersessions.json', [])]:
                bundle.writestr(importer.PREFIX + name, json.dumps(value))
            bundle.writestr(importer.PREFIX + 'docs/test.html', data)

    def test_import_is_deterministic_and_preserves_fingerprints(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'fixture.zip'
            self.archive(path)
            data, compressed = importer.import_catalog(path)
            self.assertEqual(importer.import_catalog(path), (data, compressed))
            self.assertEqual(gzip.decompress(compressed), data)
            self.assertEqual(json.loads(data)['archive_sha256'], hashlib.sha256(path.read_bytes()).hexdigest())

    def test_import_rejects_mismatched_document_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'fixture.zip'
            self.archive(path, True)
            with self.assertRaisesRegex(ValueError, 'fingerprint mismatch'):
                importer.import_catalog(path)

    def test_cli_refuses_overwrite_and_synced_source_output(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'fixture.zip'
            self.archive(path)
            existing = Path(directory) / 'existing.json.gz'
            existing.write_bytes(b'preserve')
            command = ['python3', str(ROOT / 'infra/scripts/import_design_catalog.py'), '--archive', str(path), '--output']
            result = subprocess.run(command + [str(existing)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(existing.read_bytes(), b'preserve')
            result = subprocess.run(command + [str(Path(directory) / 'sources/test.json.gz')], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('read-only', result.stderr)

if __name__ == '__main__':
    unittest.main()
