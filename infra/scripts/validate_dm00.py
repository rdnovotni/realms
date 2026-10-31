#!/usr/bin/env python3
"""Validate a approved DM00 design contract; never approve or generate game content."""
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
    for name in ('README.md', 'contract.json', 'scenarios.json', 'approval.json'):
        digest.update(name.encode() + b'\0' + (directory / name).read_bytes() + b'\0')
    return digest.hexdigest()


def validate(contract=None, fixtures=None, decision=None):
    policy = contract if contract is not None else json.loads((DIRECTORY / 'contract.json').read_text())
    examples = fixtures if fixtures is not None else json.loads((DIRECTORY / 'scenarios.json').read_text())
    catalog_bytes = gzip.decompress((ROOT / 'realms/design/source-catalog.json.gz').read_bytes())
    catalog = json.loads(catalog_bytes)
    require(policy['version'] == examples['version'] == '1.0.0', 'Approved version mismatch')
    require(policy['status'] == 'PERSONA_APPROVED_IMPLEMENTATION_PENDING', 'Design/runtime status drift')
    require(policy['name'] is None and policy['working_label'] == 'Dungeon Master', 'Name remains undecided')
    require(policy['pronouns'] == ['he', 'him'], 'Presentation drift')
    approval = decision if decision is not None else json.loads((DIRECTORY / 'approval.json').read_text())
    reviewed = 'ed4ff1a6ef605dfe3d95f2d7d501b491d5eb0f5796008c508766e35a4150dfbb'
    require(approval['status'] == 'APPROVED' and approval['approved_persona_version'] == policy['version']
            and approval['reviewed_candidate_version'] == '0.1.0'
            and approval['reviewed_candidate_fingerprint_sha256'] == reviewed
            and approval['reviewed_remote_commit'] == '233b2bbbd7a57036de4f341f146ca4fdb94a97b0'
            and approval['reviewed_tree'] == '4f811baef28abd6b2c69d87291fe51170fb33f94',
            'Invalid approval provenance')
    require(approval['exact_response'] == 'Yes, just make sure he’s entertaining and funny, but make it actually clever.'
            and approval['approver'] == 'Project owner in this chat'
            and approval['local_date'] == '2026-10-30 America/Chicago', 'Invalid approval evidence')
    require(policy['approval'] == {'status': 'APPROVED', 'approved_by': approval['approver'],
            'approved_on': approval['local_date'], 'approved_fingerprint': reviewed,
            'template_adoption_allowed': True, 'decision_record': 'approval.json'}, 'Invalid approval binding')
    require(policy['approved_defaults'] == approval['defaults'] == {
            'wit': 'dry', 'sarcasm': 'pointed', 'density': 'standard', 'banter': 'occasional'},
            'Approved default drift')
    require(policy['quality_standard'] == ['scene_specific_observation', 'surprising_but_legible_connection',
            'concise_comic_timing', 'respect_and_gravity', 'human_editorial_review'], 'Editorial standard drift')
    require(set(approval['adopted_document_sha256']) == {'README.md', 'contract.json', 'scenarios.json'},
            'Incomplete approved document binding')
    for name, expected_hash in approval['adopted_document_sha256'].items():
        require(hashlib.sha256((DIRECTORY / name).read_bytes()).hexdigest() == expected_hash,
                'Approved document changed without a reviewed decision: ' + name)
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
        require(row['status'] == ('PERSONA_SIGNOFF_RECORDED' if key == 'DM-010' else 'APPROVED_DESIGN_CONTRACT'),
                'Coverage incorrectly claims acceptance')
        require(row['evidence'].startswith('README.md#'), 'Unknown evidence document')
        heading = row['evidence'].split('#')[1]
        require('\n## ' + heading.capitalize() + '\n' in readme, 'Missing evidence heading')
    require(policy['precedence'] == ['server_truth_and_visibility', 'mechanical_clarity', 'gravity_and_consent',
                                     'player_preferences', 'atmosphere', 'comedy'], 'Clarity/authority precedence drift')
    domains = {'wit': ['off', 'dry', 'theatrical'], 'sarcasm': ['off', 'gentle', 'pointed'],
               'density': ['compact', 'standard', 'rich'], 'banter': ['off', 'rare', 'occasional']}
    require(policy['preferences'] == domains, 'Preference domain drift')
    require(set(policy['approved_defaults']) == set(domains), 'Missing approved default')
    require(all(v in domains[k] for k, v in policy['approved_defaults'].items()), 'Invalid approved default')
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
    print(f'DM00 approved design 1.0.0: {count} scenarios / {count * 3} variants validated. Persona sign-off recorded; runtime integration pending.')
    print('Review fingerprint SHA-256: ' + fingerprint())
