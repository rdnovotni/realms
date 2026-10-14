#!/usr/bin/env python3
"""Check maintained documentation navigation and API-route coverage without network access."""
from __future__ import annotations
import re
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[2]
DOC_ROOTS = (ROOT / 'realms/docs', ROOT / 'infra/docs')
errors: list[str] = []
files = [ROOT / 'README.md', ROOT / 'CONTRIBUTING.md', ROOT / 'AGENTS.md',
         ROOT / 'realms/README.md', ROOT / 'realms/design/README.md',
         ROOT / 'infra/templates/README.md', ROOT / 'realms/client/art/README.md']
for directory in DOC_ROOTS:
    files.extend(sorted(directory.glob('*.md')))
    index = directory / 'README.md'
    if not index.exists():
        errors.append(f'{directory.relative_to(ROOT)}: missing documentation index')
        continue
    linked = set(re.findall(r'\]\(([^)#]+\.md)(?:#[^)]*)?\)', index.read_text()))
    for guide in directory.glob('*.md'):
        if guide.name != 'README.md' and guide.name not in linked:
            errors.append(f'{guide.relative_to(ROOT)}: missing index entry')
for path in files:
    if not path.exists():
        errors.append(f'{path.relative_to(ROOT)}: missing guide')
        continue
    # Fenced code is not rendered Markdown navigation; original source snapshots are excluded.
    text = re.sub(r'```[\s\S]*?```', '', path.read_text())
    for target in re.findall(r'\[[^\]\n]*\]\(([^)\n]+)\)', text):
        target = target.split()[0].strip('<>')
        if target.startswith(('#', 'http:', 'https:', 'mailto:', 'codex:', 'chatgpt-')):
            continue
        local = unquote(target.split('#', 1)[0])
        if not local:
            continue
        resolved = (path.parent / local).resolve()
        if not resolved.is_relative_to(ROOT.resolve()) or not resolved.exists():
            errors.append(f'{path.relative_to(ROOT)}: missing/outside local link {target}')
# Verify the inventory lists each literal implemented endpoint, including client configuration.
api_text = (ROOT / 'realms/docs/api-reference.md').read_text()
documented_routes = set(re.findall(r'`((?:GET|POST|DELETE|PUT) /[^`\s]+)`', api_text))
for source in ('realms/src/app.ts', 'realms/src/client-assets.ts'):
    text = (ROOT / source).read_text()
    routes = re.findall(r"(?:protectedApp|app)\.(get|post|delete|put)(?:<[^\n]*?>)?\(\s*['\"]([^'\"]+)", text)
    for method, route in routes:
        if route.startswith(('/api/', '/health/')) and f'{method.upper()} {route}' not in documented_routes:
            errors.append(f'{source}: undocumented {method.upper()} {route}')
if errors:
    print('\n'.join(errors))
    raise SystemExit(1)
print(f'Documentation links, both guide indexes and literal API routes verified ({len(files)} Markdown files).')
