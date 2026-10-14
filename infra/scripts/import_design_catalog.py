#!/usr/bin/env python3
"""Create a new immutable source snapshot; never rewrites the implementation overlay."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import zipfile

PREFIX = 'kol2_master_feature_index_bundle/'

def import_catalog(archive):
    with zipfile.ZipFile(archive) as bundle:
        def read(name):
            return json.loads(bundle.read(PREFIX + name))
        documents = read('documents.json')
        for document in documents:
            data = bundle.read(PREFIX + 'docs/' + document['source_file'])
            if hashlib.sha256(data).hexdigest() != document['sha256'] or len(data) != document['size_bytes']:
                raise ValueError('Source document fingerprint mismatch: ' + document['source_file'])
        fields = ('stable_id', 'system_label', 'section_id', 'entry_group', 'entry_type', 'status_class', 'source_status', 'canonical_scope', 'detail')
        source = {'format_version': 1, 'archive_sha256': hashlib.sha256(Path(archive).read_bytes()).hexdigest(),
                  'documents': documents, 'sections': read('sections.json'),
                  'entries': [{k: row[k] for k in fields} for row in read('features.json')],
                  'supersessions': read('supersessions.json')}
    data = (json.dumps(source, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
    compressed = bytearray(gzip.compress(data, compresslevel=9, mtime=0))
    # Normalize the OS byte across supported Python versions for reproducible imports.
    compressed[9] = 255
    return data, bytes(compressed)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True, help='New .json.gz file, outside synced sources/')
    args = parser.parse_args()
    if 'sources' in args.output.resolve().parts:
        parser.error('Synced sources/ is read-only')
    if args.output.exists():
        parser.error('Choose a new output; review source changes before replacing any snapshot')
    if not args.output.name.endswith('.json.gz'):
        parser.error('Output must end in .json.gz')
    data, compressed = import_catalog(args.archive)
    with args.output.open('xb') as stream:
        stream.write(compressed)
    print(json.dumps({'catalog_sha256': hashlib.sha256(data).hexdigest(), 'compressed_bytes': len(compressed)}))

if __name__ == '__main__':
    main()
