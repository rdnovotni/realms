"""Mutation checks for review artifacts, not a semantic humor or runtime AI test."""
import copy
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('validate_dm00', ROOT / 'infra/scripts/validate_dm00.py')
dm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dm)


class DM00ContractTests(unittest.TestCase):
    def setUp(self):
        self.policy = json.loads((dm.DIRECTORY / 'contract.json').read_text())
        self.fixtures = json.loads((dm.DIRECTORY / 'scenarios.json').read_text())

    def test_review_candidate_is_complete_but_unapproved(self):
        self.assertEqual(dm.validate(self.policy, self.fixtures), 14)
        self.assertEqual(len(dm.fingerprint()), 64)

    def test_source_drift_is_rejected(self):
        self.policy['catalog_sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'Source catalog drift'):
            dm.validate(self.policy, self.fixtures)

    def test_invalid_reference_is_rejected(self):
        self.policy['source_refs'][0]['stable_id'] = 'unknown'
        with self.assertRaisesRegex(ValueError, 'Source section mismatch'):
            dm.validate(self.policy, self.fixtures)

    def test_template_adoption_cannot_be_silently_enabled(self):
        self.policy['approval']['template_adoption_allowed'] = True
        with self.assertRaisesRegex(ValueError, 'approval'):
            dm.validate(self.policy, self.fixtures)

    def test_unapproved_name_is_rejected(self):
        self.policy['name'] = 'An invented name'
        with self.assertRaisesRegex(ValueError, 'undecided'):
            dm.validate(self.policy, self.fixtures)

    def test_comedy_cannot_take_precedence_over_clarity(self):
        self.policy['precedence'].reverse()
        with self.assertRaisesRegex(ValueError, 'precedence'):
            dm.validate(self.policy, self.fixtures)

    def test_each_variant_must_preserve_every_fact(self):
        for style in ('gentle', 'pointed', 'straightforward'):
            with self.subTest(style=style):
                fixtures = copy.deepcopy(self.fixtures)
                fixtures['scenarios'][0]['variants'][style]['facts'].pop()
                with self.assertRaisesRegex(ValueError, 'mechanical facts'):
                    dm.validate(self.policy, fixtures)

    def test_each_protected_context_rejects_a_joke(self):
        for i, scenario in enumerate(self.fixtures['scenarios']):
            if scenario['context'] == 'ordinary':
                continue
            with self.subTest(context=scenario['context']):
                fixtures = copy.deepcopy(self.fixtures)
                variant = fixtures['scenarios'][i]['variants']['pointed']
                variant.update(comic_asides=1, target='circumstance')
                with self.assertRaisesRegex(ValueError, 'protected'):
                    dm.validate(self.policy, fixtures)

    def test_protected_fourth_wall_joke_is_rejected(self):
        self.fixtures['scenarios'][4]['variants']['pointed']['fourth_wall'] = True
        with self.assertRaisesRegex(ValueError, 'protected'):
            dm.validate(self.policy, self.fixtures)

    def test_straightforward_cannot_mock(self):
        self.fixtures['scenarios'][0]['variants']['straightforward'].update(comic_asides=1, target='player_choice')
        with self.assertRaisesRegex(ValueError, 'straightforward'):
            dm.validate(self.policy, self.fixtures)

    def test_all_forbidden_comedy_targets_are_rejected(self):
        for target in self.policy['forbidden_targets']:
            with self.subTest(target=target):
                fixtures = copy.deepcopy(self.fixtures)
                fixtures['scenarios'][0]['variants']['pointed']['target'] = target
                with self.assertRaisesRegex(ValueError, 'Forbidden comedy target'):
                    dm.validate(self.policy, fixtures)

    def test_missing_gravity_scenario_is_rejected(self):
        self.fixtures['scenarios'] = self.fixtures['scenarios'][:-1]
        with self.assertRaises(ValueError):
            dm.validate(self.policy, self.fixtures)

    def test_preference_that_changes_rules_is_rejected(self):
        self.policy['preferences']['difficulty'] = ['easy']
        with self.assertRaisesRegex(ValueError, 'Preference domain'):
            dm.validate(self.policy, self.fixtures)

    def test_increased_banter_budget_requires_review(self):
        self.policy['banter_budget']['occasional'] = 10
        with self.assertRaisesRegex(ValueError, 'budget'):
            dm.validate(self.policy, self.fixtures)

    def test_runtime_authority_cannot_be_relaxed(self):
        self.policy['authority_denied'].remove('rewards')
        with self.assertRaisesRegex(ValueError, 'Authority boundary'):
            dm.validate(self.policy, self.fixtures)


if __name__ == '__main__':
    unittest.main()
