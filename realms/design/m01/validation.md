# M01 v1.0.0 validation record

Executed 2026-10-24 against this design artifact and the unchanged M00 gameplay tree. These results validate planning data and documentation; they do not pass the future A-01–A-12 gameplay/playtest gates.

| Check | Observed result |
|---|---|
| Re-import supplied `kol2_master_feature_index_bundle.zip` with existing importer into a new `/tmp/` output | Passed: document size/hash verification; catalog SHA-256 `bbb101b37b74f0e85668e18233bd256c18546b14f662c790e574bfba5ba3b18b` |
| Compare imported gzip with repository `source-catalog.json.gz` | Byte-for-byte identical; no replacement or source modification |
| `python3 infra/scripts/validate_m01.py` | Passed: 47 matrix rows, six overrides, ten acyclic issue briefs, 23 sole mutation owners, source/stable-ID and local-link checks |
| `python3 infra/scripts/feature_registry.py` | Passed: 47 documents, 13,187 entries, 11,607 rules and 2,096 sections; statuses unchanged: 37 historical, 61 partial, 1,998 unassessed |
| `python3 infra/scripts/documentation-check.py` | Passed: both documentation indexes, local links and literal/generated API routes; 88 Markdown files in its scope |
| `python3 -m unittest discover -s infra/tests -p test_feature_registry.py` | Passed: 23 tests |
| In-memory negative validation probes | Rejected dependency cycle, ownerless mutation, PROVISIONAL→LOCKED slice promotion and correction-register drift; no artifact was mutated by these probes |
| `git diff --check` | Passed |

The M01 validator is an explicit command listed in this deliverable, not a newly installed CI gate. Existing CI still runs the registry/documentation suite; read its actual result for the PR, not this local record. No game code, content definitions, migrations, feature flags, services or production state changed. Full game CI from M00 remains evidence for its exact checkpoint only, not a new M01 gameplay test run.

PR #69 and main were read through the GitHub connection during this pass: PR69 was open with head `54518a881f74ae5a432d85f56a24ba64a168675e`; main was `cdfd2ce16432c6ad1c7b6670dddaa46eb16ef0e5`. The tested PR merge source is `8b7d8f7f23f46644ac26079fa262f483980abdfa`, retained by the M00 checkpoint branch. M01 is separately stacked for design review; that does not make either PR merged. FB-006 remains unresolved.
