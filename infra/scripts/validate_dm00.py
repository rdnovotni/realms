#!/usr/bin/env python3
"""Validate a review-only DM00 candidate; never approve or generate game content."""
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = ROOT / 'realms/design/dm00'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def fingerprint(directory=DIRECTORY):
    digest = hashlib.sha256()
    for name in ('README.md', 'contract.json', 'scenarios.json'):
        digest.update(name.encode() + b'\0' + (directory / name).read_bytes() + b'\0')
    return digest.hexdigest()


def validate(contract=None, fixtures=None):
    policy = contract if contract is not None else json.loads((DIRECTORY / 'contract.json').read_text())
    examples = fixtures if fixtures is not None else json.loads((DIRECTORY / 'scenarios.json').read_text())
    catalog_bytes = gzip.decompress((ROOT / 'realms/design/source-catalog.json.gz').read_bytes())
    catalog = json.loads(catalog_bytes)
    require(policy['version'] == examples['version'] == '0.1.0', 'Candidate version mismatch')
    require(policy['status'] == 'CANDIDATE_AWAITING_PERSONA_SIGNOFF', 'Candidate silently approved')
    require(policy['name'] is None and policy['working_label'] == 'Dungeon Master', 'Name remains undecided')
    require(policy['pronouns'] == ['he', 'him'], 'Presentation drift')
    require(policy['approval'] == {'status': 'PENDING', 'approved_by': None, 'approved_on': None,
                                  'approved_fingerprint': None, 'template_adoption_allowed': False},
            'Explicit persona approval needs a new reviewed decision record')
    require(policy['catalog_sha256'] == hashlib.sha256(catalog_bytes).hexdigest(), 'Source catalog drift')
    sections = {(s['system_label'], s['section_id']): s['stable_id'] for s in catalog['sections']}
    refs = policy['source_refs']
    keys = [(r['system'], r['section']) for r in refs]
    require(len(keys) == len(set(keys)), 'Duplicate source section')
    require({'Core', '16', '23', '34', '44', '46'} == {k[0] for k in keys}, 'Missing source system')
    require({('Core', s) for s in ('pillars', 'ai', 'automation', 'tone')} <= set(keys), 'Missing Core section')
    for ref in refs:
        require(sections.get((ref['system'], ref['section'])) == ref['stable_id'], 'Source section mismatch')
    coverage = policy['coverage']
    require(set(coverage) == {f'DM-{n:03}' for n in range(1, 11)}, 'Incomplete DM00 coverage')
    readme = (DIRECTORY / 'README.md').read_text()
    for key, row in coverage.items():
        require(row['status'] == ('PENDING_HUMAN_SIGNOFF' if key == 'DM-010' else 'DRAFTED_FOR_REVIEW'),
                'Coverage incorrectly claims acceptance')
        require(row['evidence'].startswith('README.md#'), 'Unknown evidence document')
        heading = row['evidence'].split('#')[1]
        require('\n## ' + heading.capitalize() + '\n' in readme, 'Missing evidence heading')
    require(policy['precedence'] == ['server_truth_and_visibility', 'mechanical_clarity', 'gravity_and_consent',
                                     'player_preferences', 'atmosphere', 'comedy'], 'Clarity/authority precedence drift')
    domains = {'wit': ['off', 'dry', 'theatrical'], 'sarcasm': ['off', 'gentle', 'pointed'],
               'density': ['compact', 'standard', 'rich'], 'banter': ['off', 'rare', 'occasional']}
    require(policy['preferences'] == domains, 'Preference domain drift')
    require(set(policy['proposed_defaults']) == set(domains), 'Missing proposed default')
    require(all(v in domains[k] for k, v in policy['proposed_defaults'].items()), 'Invalid proposed default')
    require(policy['straightforward'] == {'wit': 'off', 'sarcasm': 'off', 'banter': 'off'}, 'Straightforward must disable jabs')
    protected = {'grief', 'tragedy', 'horror_reveal', 'key_revelation', 'player_conflict', 'accessibility_help',
                 'high_stakes_transaction', 'ascension_confirmation', 'genuine_distress'}
    require(set(policy['gravity_contexts']) == protected, 'Missing gravity protection')
    require(set(policy['comedy_targets']) == {'player_choice', 'monster', 'bureaucracy', 'circumstance', 'self'},
            'Comedy target drift')
    require(set(policy['forbidden_targets']) == {'player_identity', 'disability', 'vulnerability', 'genuine_distress'},
            'Missing prohibited target')
    require(policy['banter_budget'] == {'off': 0, 'rare': 1, 'occasional': 2,
            'window': '10 eligible completed action results; maximum one aside per result; no backlog'},
            'Banter budget drift')
    require(set(policy['required_surfaces']) == {'GUI', 'MUD console', 'menus', 'action results', 'quests', 'Ascension'},
            'Missing presentation surface')
    require(set(policy['authority_denied']) == {'RNG', 'costs', 'rewards', 'inventory', 'quest state', 'consent',
            'private knowledge', 'hidden facts', 'NPC beliefs', 'Ascension cosmology', 'personal profiling'},
            'Authority boundary drift')
    scenarios = examples['scenarios']
    require(len(scenarios) >= 14 and len({s['id'] for s in scenarios}) == len(scenarios), 'Missing/duplicate scenario')
    require(protected <= {s['context'] for s in scenarios}, 'Gravity context lacks a scenario')
    require(any(s['context'] == 'ordinary' for s in scenarios), 'Missing ordinary comedy comparison')
    for scenario in scenarios:
        require(scenario['context'] in protected | {'ordinary'}, 'Unknown scenario context')
        facts = scenario['server_facts']
        require(isinstance(facts, list) and facts and all(isinstance(f, str) and f.strip() for f in facts), 'Empty mechanical facts')
        require(set(scenario['variants']) == {'gentle', 'pointed', 'straightforward'}, 'Missing style comparison')
        for style, variant in scenario['variants'].items():
            require(variant['facts'] == facts, 'Presentation changes mechanical facts')
            require(isinstance(variant['prose'], str) and variant['prose'].strip(), 'Missing narration example')
            require(type(variant['comic_asides']) is int and variant['comic_asides'] in (0, 1), 'Invalid aside count')
            require(type(variant['fourth_wall']) is bool, 'Invalid fourth-wall marker')
            require(variant['target'] is None or variant['target'] in policy['comedy_targets'], 'Forbidden comedy target')
            require(bool(variant['comic_asides']) == (variant['target'] is not None), 'Unclassified commentary')
            if scenario['context'] in protected or style == 'straightforward':
                require(variant['comic_asides'] == 0 and not variant['fourth_wall'], 'Banter on protected/straightforward beat')
    return len(scenarios)


if __name__ == '__main__':
    count = validate()
    print(f'DM00 candidate 0.1.0: {count} scenarios / {count * 3} variants validated. Human sign-off PENDING.')
    print('Review fingerprint SHA-256: ' + fingerprint())
