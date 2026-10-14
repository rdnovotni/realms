#!/usr/bin/env python3
"""Validate and inspect the design-to-implementation contract without touching game state."""
import argparse
import gzip
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DESIGN = Path('realms/design')
STATUSES = {'unassessed', 'planned', 'partial', 'implemented', 'integrated', 'verified', 'deferred', 'historical'}
PROMOTED = {'implemented', 'integrated', 'verified'}
SCOPES = {'ACCOUNT', 'CHARACTER', 'RUN', 'INSTANCE', 'GUILD', 'EVENT', 'WORLD'}
GROUPS = {'FEATURE / RULE', 'SCHEMA / DATA', 'OUTLINE', 'EXAMPLE', 'METADATA'}

class RegistryError(ValueError):
    pass

def require(condition, message):
    if not condition:
        raise RegistryError(message)

def unique(rows, key, label):
    result = {}
    for row in rows:
        require(row.get(key) and row[key] not in result, f'Duplicate/missing {label} {row.get(key)}')
        result[row[key]] = row
    return result

def dag(rows, label, edge='depends_on'):
    visiting, done = set(), set()
    def visit(identifier):
        require(identifier in rows, f'Unknown {label} dependency: {identifier}')
        require(identifier not in visiting, f'{label} dependency cycle at {identifier}')
        if identifier in done:
            return
        visiting.add(identifier)
        deps = rows[identifier][edge]
        require(len(deps) == len(set(deps)), f'Duplicate {label} dependency: {identifier}')
        for dep in deps:
            visit(dep)
        visiting.remove(identifier)
        done.add(identifier)
    for identifier in rows:
        visit(identifier)

def evidence_path(root, path):
    require(isinstance(path, str) and path, 'Missing evidence path')
    relative = Path(path)
    target = (root / relative).resolve()
    require(not relative.is_absolute() and root.resolve() in target.parents, f'Evidence escapes repository: {path}')
    require(target.is_file(), f'Evidence path missing: {path}')
    require(not any(p.startswith('.') for p in relative.parts) and 'sources' not in relative.parts, f'Private/reference evidence path: {path}')

def load(root=ROOT):
    data = gzip.decompress((root / DESIGN / 'source-catalog.json.gz').read_bytes())
    registry = json.loads((root / DESIGN / 'feature-registry.json').read_text())
    require(hashlib.sha256(data).hexdigest() == registry['catalog_sha256'], 'Source catalog fingerprint changed; review the import and mapping together')
    return json.loads(data), registry

def validate(source, registry, root=ROOT):
    require(source['format_version'] == registry['format_version'] == 1, 'Unsupported registry format')
    require(re.fullmatch(r'[0-9a-f]{64}', source['archive_sha256']), 'Missing source archive fingerprint')
    require(re.fullmatch(r'[0-9a-f]{40}', registry['assessment_commit']), 'Missing baseline commit')
    docs = unique(source['documents'], 'system_label', 'document')
    require(set(docs) == {'Core'} | {f'{n:02}' for n in range(1, 47)}, 'Expected Core and Systems 01–46')
    for doc in docs.values():
        require(re.fullmatch(r'[0-9a-f]{64}', doc['sha256']), 'Invalid design document fingerprint')
    sections = unique(source['sections'], 'stable_id', 'source section')
    section_keys = {(s['system_label'], s['section_id']): s for s in sections.values()}
    require(len(section_keys) == len(sections), 'Ambiguous source section anchor')
    entries = unique(source['entries'], 'stable_id', 'source entry')
    bysection = Counter()
    bydocument = Counter()
    for entry in entries.values():
        require((entry['system_label'], entry['section_id']) in section_keys, f'Unknown source section: {entry["stable_id"]}')
        require(entry['entry_group'] in GROUPS and entry['detail'].strip(), 'Missing source requirement/group')
        bysection[(entry['system_label'], entry['section_id'])] += 1
        bydocument[entry['system_label']] += 1
    for key, section in section_keys.items():
        require(bysection[key] == section['entry_count'], f'Source section count mismatch: {key}')
    for label, doc in docs.items():
        require(bydocument[label] == doc['indexed_entries'], f'Document entry count mismatch: {label}')
        require(sum(s['system_label'] == label for s in sections.values()) == doc['source_units'], f'Document section count mismatch: {label}')
    decisions = unique(registry['decisions'], 'id', 'decision')
    for decision in decisions.values():
        require(decision['status'] in {'resolved-contract', 'open-gate'}, 'Unknown decision status')
        require(decision['topic'] and decision['resolution'] and decision['blocks'], 'Incomplete decision')
        require(set(decision['source_systems']) <= set(docs), 'Decision has unknown design owner')
    systems = unique(registry['systems'], 'id', 'system contract')
    require(set(systems) == {'SYS-' + label for label in docs}, 'System contract coverage incomplete')
    require(set(registry['state_profiles']) == SCOPES, 'Reset profiles must cover seven scopes')
    for identifier, contract in systems.items():
        doc = docs[contract['design_system']]
        require(identifier == 'SYS-' + contract['design_system'], 'System identity mismatch')
        require(contract['title'] == doc['system_title'] and contract['launch_tier'] == doc['launch_tier'], 'Design title/tier changed silently')
        for field in ('owner', 'actions', 'permissions', 'client_workflow', 'state', 'acceptance'):
            require(contract.get(field), f'{identifier}: missing {field}')
        require(contract['authoring']['schemas_and_studio_controls'] and contract['authoring']['publication'], f'{identifier}: authoring contract missing')
        require(contract['acceptance_profile'] in registry['acceptance_profiles'], 'Unknown acceptance profile')
        require(contract['implementation_status'] in STATUSES, 'Unknown implementation status')
        require(set(contract['decisions']) <= set(decisions), 'Unknown decision dependency')
        require(contract['state'] and len({s['scope'] for s in contract['state']}) == len(contract['state']), 'Missing/duplicate state scopes')
        for state in contract['state']:
            require(state['scope'] in SCOPES, 'Unknown state scope')
            for field in ('fields', 'ascension', 'rollover'):
                require(state.get(field), f'{identifier}: missing state {field}')
        for evidence in contract['baseline_evidence']:
            evidence_path(root, evidence['implementation'])
            evidence_path(root, evidence['test'])
            require(evidence['finding'] and evidence['verification'], 'Evidence must declare limits')
            require(evidence['assessment_commit'] == registry['assessment_commit'], 'Baseline commit mismatch')
        require(contract['implementation_status'] != 'partial' or contract['baseline_evidence'], 'Partial status requires subset evidence')
    dag(systems, 'system')
    capabilities = unique(registry['capabilities'], 'id', 'capability')
    coverage, section_coverage = Counter(), Counter()
    for identifier, cap in capabilities.items():
        require(cap['system'] in systems and cap['source_section'] in sections, f'{identifier}: unknown owner/source')
        section = sections[cap['source_section']]
        require(cap['system'] == 'SYS-' + section['system_label'], f'{identifier}: source mapped to wrong owner')
        require(identifier == 'CAP-' + section['system_label'] + '-' + section['section_id'], 'Capability identity/source anchor mismatch')
        require(cap['title'] == section['section_heading'], 'Capability title changed without source mapping')
        require(cap['contract'] == 'inherit-system', 'Unknown contract inheritance mode')
        section_coverage[cap['source_section']] += 1
        require(cap['source_entries'] and len(set(cap['source_entries'])) == len(cap['source_entries']), 'Empty/duplicate section entries')
        for entry_id in cap['source_entries']:
            require(entry_id in entries, f'{identifier}: unknown source entry {entry_id}')
            entry = entries[entry_id]
            require((entry['system_label'], entry['section_id']) == (section['system_label'], section['section_id']), f'{identifier}: misplaced source entry')
            coverage[entry_id] += 1
        require(cap['implementation_status'] in STATUSES, f'{identifier}: invalid status')
        if section['system_label'] == 'Core':
            require(cap['implementation_status'] == 'historical', 'Core must be historical; map active requirements to owning system instead')
        require(set(cap['rule_assertions']) <= set(cap['source_entries']), 'Assertion references another section')
        for entry_id, disposition in cap['rule_assertions'].items():
            require(disposition['disposition'] in {'active', 'superseded', 'reference', 'deferred'}, 'Unknown rule disposition')
            require(disposition.get('reason'), 'Rule disposition needs rationale')
            if disposition['disposition'] == 'active':
                require(disposition.get('assertions'), 'Active rule needs concrete assertions')
                for assertion in disposition['assertions']:
                    evidence_path(root, assertion['test'])
                    require(assertion.get('name'), 'Missing executable assertion name')
            if disposition['disposition'] == 'superseded':
                require(disposition.get('correction') in {s['topic'] for s in source['supersessions']}, 'Superseded rule needs a recorded correction')
        for evidence in cap['evidence']:
            evidence_path(root, evidence['path'])
            require(evidence.get('finding'), 'Capability evidence needs a finding')
        if cap['implementation_status'] == 'partial':
            require(cap['evidence'], 'Partial capability requires specific evidence')
        if cap['implementation_status'] in PROMOTED:
            needed = {e for e in cap['source_entries'] if entries[e]['entry_group'] in {'FEATURE / RULE', 'SCHEMA / DATA'}}
            require(needed <= set(cap['rule_assertions']), f'{identifier}: completion requires every rule/schema assertion or disposition')
            for entry_id in needed:
                disposition = cap['rule_assertions'][entry_id]
                require(disposition['disposition'] != 'deferred', 'A deferred requirement cannot count as implemented')
                require(disposition['disposition'] != 'reference', 'Rule/schema cannot be dismissed as reference material')
            require(cap['evidence'], 'Promoted capability requires implementation evidence')
            review = cap.get('contract_review', {})
            require(all(isinstance(review.get(k), str) and review[k].strip() for k in ('state', 'actions', 'authoring', 'client')), 'Promoted capability requires section-specific contract review')
        if cap['implementation_status'] in {'integrated', 'verified'}:
            require(cap.get('workflow_evidence'), 'Integrated status needs client/Studio/cross-system workflow evidence')
            workflows = cap['workflow_evidence']
            require(isinstance(workflows, dict) and all(workflows.get(k) for k in ('client', 'studio', 'integration')), 'Workflow evidence must cover client, Studio and integration')
            for paths in workflows.values():
                require(isinstance(paths, list), 'Workflow evidence must contain path lists')
                for path in paths:
                    evidence_path(root, path)
        if cap['implementation_status'] == 'verified':
            proof = cap['verification'] or {}
            require(re.fullmatch(r'[0-9a-f]{40}', proof.get('source_commit', '')), 'Verification needs exact commit')
            require(proof.get('command') and proof.get('result') == 'passed' and proof.get('artifact'), 'Verification requires command, passing result and artifact')
            evidence_path(root, proof['artifact'])
    require(set(coverage) == set(entries) and all(n == 1 for n in coverage.values()), 'Missing or multiply assigned source requirements')
    require(set(section_coverage) == set(sections) and all(n == 1 for n in section_coverage.values()), 'Missing or multiply assigned source sections')
    rank = {'implemented': 1, 'integrated': 2, 'verified': 3}
    for identifier, system in systems.items():
        if system['implementation_status'] in PROMOTED:
            children = [c for c in capabilities.values() if c['system'] == identifier]
            require(all(rank.get(c['implementation_status'], 0) >= rank[system['implementation_status']] for c in children), 'Aggregate status cannot exceed any section status')
    packages = unique(registry['work_packages'], 'id', 'work package')
    for package in packages.values():
        require(package['title'] and package['deliverable'] and package['systems'], 'Incomplete work package')
        require(set(package['systems']) <= set(systems), 'Work package has unknown system')
    require(set().union(*(set(p['systems']) for p in packages.values())) == set(systems) - {'SYS-Core'}, 'Roadmap does not cover all active systems')
    dag(packages, 'work package', 'after')
    return {'documents': len(docs), 'sections': len(sections), 'entries': len(entries),
            'rules': sum(e['entry_group'] == 'FEATURE / RULE' for e in entries.values()),
            'systems': len(systems), 'statuses': dict(Counter(c['implementation_status'] for c in capabilities.values()))}

def effective(source, registry, identifier):
    systems = {s['id']: s for s in registry['systems']}
    caps = {c['id']: c for c in registry['capabilities']}
    entries = {e['stable_id']: e for e in source['entries']}
    if identifier in systems:
        return {'contract': systems[identifier], 'sections': [c['id'] for c in caps.values() if c['system'] == identifier],
                'shared_acceptance': registry['acceptance_profiles'][systems[identifier]['acceptance_profile']]}
    if identifier in entries:
        entry = entries[identifier]
        identifier = 'CAP-' + entry['system_label'] + '-' + entry['section_id']
    require(identifier in caps, f'Unknown system/capability: {identifier}')
    cap = caps[identifier]
    section = next(s for s in source['sections'] if s['stable_id'] == cap['source_section'])
    return {'capability': cap, 'source_section': section, 'contract': systems[cap['system']],
            'shared_acceptance': registry['acceptance_profiles'][systems[cap['system']]['acceptance_profile']],
            'requirements': [entries[e] for e in cap['source_entries']]}

def report(source, registry):
    counts = Counter(e['entry_group'] for e in source['entries'])
    lines = ['# Feature framework work plan', '',
        'Generated from `feature-registry.json` and the fingerprinted `source-catalog.json.gz`. Update the overlay, then run `python3 infra/scripts/feature_registry.py --write-report` from the repository root.', '',
        f'{len(source["documents"])} documents, {len(source["sections"])} section checklists, {len(source["entries"]):,} source entries including {counts["FEATURE / RULE"]:,} rules. Coverage is a mapping count, **not a feature completion percentage**.', '',
        registry['policy']['content_strategy'], '',
        'The system contract supplies owner, prerequisites, field scopes/reset rules, Action/permission families, authoring/editor work, client workflow and acceptance scenarios to every section. Individual section implementation is initially **unassessed**. Baseline subset evidence is listed separately; no whole system is verified. Field-level exceptions and per-rule executable assertions are required before implementation status can be promoted.', '',
        '## Next work packages', '']
    for package in registry['work_packages']:
        lines += [f'### {package["id"]}: {package["title"]}', '',
            'Prerequisites: ' + (', '.join(package['after']) or 'registry contract'), '',
            'Systems: ' + ', '.join(package['systems']), '', package['deliverable'], '']
    lines += ['## Decisions and activation gates', '']
    for decision in registry['decisions']:
        lines += [f'### {decision["id"]}: {decision["topic"]} ({decision["status"]})', '', decision['resolution'], '', 'Blocks: ' + decision['blocks'], '']
    lines += ['## Canon corrections', '', 'Apply these resolutions before building assertions from older source wording. They do not silently mark earlier rows implemented or superseded.', '']
    for correction in source['supersessions']:
        lines += ['- **' + correction['topic'] + '** (owner ' + correction['owner'] + '): ' + correction['canonical_resolution']]
    lines += ['', '## System contracts', '']
    for system in registry['systems']:
        lines += [f'### {system["id"]}: {system["title"]}', '',
            f'Owner: `{system["owner"]}` · Design tier: {system["launch_tier"]} · Implementation: **{system["implementation_status"]}**', '',
            'Prerequisites: ' + (', '.join(system['depends_on']) or 'none'), '',
            '| Scope / fields | Ascension | Rollover |', '|---|---|---|']
        for state in system['state']:
            lines += [f'| {state["scope"]}: {state["fields"]} | {state["ascension"]} | {state["rollover"]} |']
        lines += ['', '**Action families:** ' + system['actions'] + '.', '',
            '**Permissions:** ' + system['permissions'], '',
            '**Schemas and Studio:** ' + system['authoring']['schemas_and_studio_controls'] + '.', '',
            '**Client:** ' + system['client_workflow'] + '.', '', '**Acceptance scenarios:**', '']
        lines += ['- ' + a + '.' for a in system['acceptance']]
        lines += ['', 'Apply the shared `framework-done` profile as well as every applicable source-rule assertion.', '']
        if system['baseline_evidence']:
            for evidence in system['baseline_evidence']:
                # report lives under realms/design; paths are repository relative.
                lines += [f'Baseline subset: [{evidence["implementation"]}](../../{evidence["implementation"]}), [{evidence["test"]}](../../{evidence["test"]}). {evidence["finding"]}', '']
        else:
            lines += ['No complete implementation evidence mapped; planned work remains.', '']
    return '\n'.join(lines).rstrip() + '\n'

def manifest(source):
    data = (json.dumps(source, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
    lines = ['# Imported design source manifest', '',
        'Source archive: `kol2_master_feature_index_bundle.zip`.', '',
        'Archive SHA-256: `' + source['archive_sha256'] + '`.', '',
        'Uncompressed catalog SHA-256: `' + hashlib.sha256(data).hexdigest() + '`.', '',
        'Original HTML lives under `kol2_master_feature_index_bundle/docs/` inside the supplied archive. Section anchors and exact indexed wording are available through the registry inspector.', '',
        '| System | Source file | SHA-256 | Sections | Entries |', '|---|---|---|---:|---:|']
    for doc in source['documents']:
        lines.append(f"| {doc['system_label']} | {doc['source_file']} | `{doc['sha256']}` | {doc['source_units']} | {doc['indexed_entries']} |")
    return '\n'.join(lines) + '\n'

def check_reports(source, registry, root=ROOT, write=False):
    for name, expected in [('WORK_PLAN.md', report(source, registry)), ('SOURCE_MANIFEST.md', manifest(source))]:
        target = root / DESIGN / name
        if write:
            target.write_text(expected)
        else:
            require(target.is_file() and target.read_text() == expected, name + ' is stale; regenerate the derived reports')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--show', metavar='ID', help='Show effective contract and source rules')
    group.add_argument('--search', metavar='TEXT', help='Search source wording; return owning checklist IDs')
    group.add_argument('--write-report', action='store_true', help='Regenerate the derived work plan and source manifest')
    args = parser.parse_args()
    try:
        source, registry = load()
        result = validate(source, registry)
        check_reports(source, registry, write=args.write_report)
        if args.write_report:
            print('Wrote work plan and source manifest under ' + str(ROOT / DESIGN))
        else:
            if args.show:
                print(json.dumps(effective(source, registry, args.show), ensure_ascii=False, indent=2))
            elif args.search:
                matches = [e for e in source['entries'] if args.search.casefold() in e['detail'].casefold()]
                print(json.dumps([{'id': e['stable_id'], 'capability': 'CAP-' + e['system_label'] + '-' + e['section_id'], 'requirement': e['detail']} for e in matches], ensure_ascii=False, indent=2))
            else:
                print(json.dumps(result, sort_keys=True))
        return 0
    except (RegistryError, KeyError, TypeError, json.JSONDecodeError, OSError) as error:
        print('Feature registry invalid: ' + str(error), file=sys.stderr)
        return 1

if __name__ == '__main__':
    sys.exit(main())
