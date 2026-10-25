#!/usr/bin/env python3
"""Validate the M01 planning artifact without changing canon, status or runtime state."""
from __future__ import annotations
import gzip
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[2]
DESIGN = ROOT / 'realms/design'
M01 = DESIGN / 'm01'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def unique(rows, key):
    result = {row[key]: row for row in rows}
    require(len(result) == len(rows), 'Duplicate ' + key)
    return result


def validate():
    raw = gzip.decompress((DESIGN / 'source-catalog.json.gz').read_bytes())
    catalog = json.loads(raw)
    registry = json.loads((DESIGN / 'feature-registry.json').read_text())
    lock = json.loads((M01 / 'canon-lock.json').read_text())
    matrix = json.loads((M01 / 'status-matrix.json').read_text())
    board = json.loads((M01 / 'issue-tree.json').read_text())
    correction_bytes = (json.dumps(catalog['supersessions'], ensure_ascii=False,
                                  sort_keys=True, separators=(',', ':')) + '\n').encode()
    snapshot = {
        'archive_sha256': catalog['archive_sha256'],
        'catalog_sha256': hashlib.sha256(raw).hexdigest(),
        'corrections_sha256': hashlib.sha256(correction_bytes).hexdigest(),
        'documents': len(catalog['documents']),
        'systems': len(catalog['documents']) - 1,
        'sections': len(catalog['sections']),
        'entries': len(catalog['entries']),
        'corrections': len(catalog['supersessions']),
    }
    require(lock['version'] == matrix['version'] == board['version'] == '1.0.0',
            'Version drift; review and update validator with a deliberate version bump')
    require(lock['snapshot'] == matrix['snapshot'] == board['basis'] == snapshot,
            'Design snapshot changed; reconcile M01 instead of silently refreshing hashes')
    expected_docs = [{'system': d['system_label'], 'file': d['source_file'],
                      'sha256': d['sha256'], 'tier': d['launch_tier'], 'origin': d['source_origin']}
                     for d in catalog['documents']]
    require(lock['documents'] == expected_docs, 'Document fingerprint/tier/provenance mismatch')
    require(lock['approved_corrections'] == catalog['supersessions'], 'Correction register mismatch')
    overrides = [e['detail'] for e in catalog['entries'] if e['system_label'] == '46'
                 and e['section_id'] == 's10-subfeature-tier-overrides']
    require(lock['subfeature_overrides'] == overrides and len(overrides) == 6,
            'Subfeature overrides changed or incomplete')
    require(all(d['status'] == 'PROVISIONAL' and d['scope'] == 'slice only'
                for d in lock['slice_decisions']), 'A slice proposal was promoted to canon')
    unique(lock['slice_decisions'], 'id')
    rows = unique(matrix['rows'], 'system')
    require(set(rows) == {d['system_label'] for d in catalog['documents']},
            'Matrix must cover Core and all 46 systems')
    axes = ('design', 'foundation', 'integrated', 'player_usable', 'content_ready',
            'verified', 'deployable', 'activated')
    for doc in catalog['documents']:
        row = rows[doc['system_label']]
        require(row['tier'] == doc['launch_tier'] and row['title'] == doc['system_title'],
                'Silent system reclassification: ' + doc['system_label'])
        require(all(isinstance(row.get(k), str) and row[k].strip() for k in axes),
                'Missing independent status axis: ' + doc['system_label'])
        require(row['deployable'] == 'Not established' and row['activated'] == 'Unverified',
                'M01 has no operational evidence; review any deployment promotion separately')
        require(row['content_ready'] == 'Not established', 'No content-ready proof supplied in M01')
        require(row['boundary'], 'A matrix row must state its scope boundary')
        for path in row['evidence']:
            require((ROOT / path).is_file(), 'Missing baseline evidence: ' + path)
    require(matrix['basis_commit'] == '8b7d8f7f23f46644ac26079fa262f483980abdfa'
            and matrix['basis_tree'] == 'c2207fbc44b2493bc88540bc0718f829378ba3dc',
            'Matrix basis changed; reassess status against exact checkpoint')
    require(matrix['m00_pr_state_at_review'] == 'open; not merged', 'Refresh M00 observation explicitly')
    sections = {(s['system_label'], s['section_id']): s['stable_id'] for s in catalog['sections']}
    issues = unique(board['issues'], 'id')
    require(set(issues) == {f'SL-{n:02}' for n in range(1, 11)}, 'Expected ten issue briefs')
    require(board['execution_gate'] in board['external_gates'], 'Missing source execution gate')
    require(board['status'] == 'PROVISIONAL_IMPLEMENTATION_PLAN', 'Planning status was promoted')
    allowed_owners = {s['owner'] for s in registry['systems']} | {'content-knowledge', 'telemetry'}
    ownership = board['mutation_owners']
    require(ownership and all(v in allowed_owners for v in ownership.values()), 'Unknown field owner')
    covered = set()
    for issue in issues.values():
        require(issue['primary_domain'] in allowed_owners, 'Unknown primary domain')
        require(issue['parent'] == board['parent']['id'], 'Orphan issue')
        require(issue['status'] == 'planned' and issue['decision_status'] == board['status'],
                'Future issue incorrectly marked complete/approved')
        deps = issue['depends_on']
        require(len(set(deps)) == len(deps) and set(deps) <= set(issues), 'Unknown/duplicate dependency')
        require(set(issue['soft_dependencies']) <= set(issues), 'Unknown soft dependency')
        require(issue['source_refs'] and issue['acceptance'] and issue['player_ui']
                and issue['integration_risk'], 'Incomplete issue acceptance contract')
        for ref in issue['source_refs']:
            require(sections.get((ref['system'], ref['section'])) == ref['stable_id'],
                    'Source section/stable ID mismatch: ' + issue['id'])
        require(len(set(issue['mutation_keys'])) == len(issue['mutation_keys']), 'Duplicate mutation group')
        for key in issue['mutation_keys']:
            require(key in ownership, 'Mutation without a sole owner: ' + key)
            covered.add(key)
    require(covered == set(ownership), 'Unscheduled mutation ownership contract')
    visiting, visited = set(), set()

    def visit(identifier):
        require(identifier not in visiting, 'Dependency cycle: ' + identifier)
        if identifier in visited:
            return
        visiting.add(identifier)
        for dependency in issues[identifier]['depends_on']:
            visit(dependency)
        visiting.remove(identifier)
        visited.add(identifier)

    for identifier in issues:
        visit(identifier)
    milestones = unique(board['milestones'], 'id')
    require({i for m in milestones.values() for i in m['requires']} == set(issues),
            'Milestones omit or invent issues')
    for milestone in milestones.values():
        require(milestone['gate'] and set(milestone['requires']) <= set(issues), 'Invalid milestone')
    # Check links in design artifacts too; the general docs checker covers docs/ and infra/docs/.
    for path in M01.glob('*.md'):
        text = re.sub(r'```[\s\S]*?```', '', path.read_text())
        for target in re.findall(r'\[[^\]\n]*\]\(([^)\n]+)\)', text):
            if target.startswith(('#', 'https:', 'http:')):
                continue
            destination = (path.parent / unquote(target.split('#', 1)[0])).resolve()
            require(destination.is_relative_to(ROOT) and destination.is_file(),
                    f'{path.name}: missing/outside link {target}')
    # Keep displayed row identities and issue references in sync with the structured artifacts.
    tiers = (M01 / 'canon-and-scope.md').read_text()
    table = (M01 / 'status-matrix.md').read_text()
    human_board = (M01 / 'dependency-board.md').read_text()
    for doc in catalog['documents']:
        require(f"| {doc['system_label']} | {doc['system_title']} | {doc['launch_tier']} |" in tiers,
                'Human tier table is stale')
        row = rows[doc['system_label']]
        values = [row['system'], 'Historical' if row['system'] == 'Core' else 'Foundation approved']
        values += [row[k] for k in axes[1:]]
        require('| ' + ' | '.join(values) + ' |' in table, 'Human status table is stale')
    for issue in issues.values():
        require('### ' + issue['id'] + ' — ' + issue['title'] in human_board, 'Human issue board is stale')
        for ref in issue['source_refs']:
            require(ref['stable_id'] in human_board, 'Human board omits canonical reference')
    print(f'M01 v1.0.0 verified: {len(rows)} matrix rows, {len(overrides)} overrides, '
          f'{len(issues)} acyclic issue briefs, {len(ownership)} sole mutation owners; '
          'no runtime or activation claim.')


if __name__ == '__main__':
    try:
        validate()
    except (ValueError, KeyError, TypeError) as error:
        raise SystemExit(str(error))
