# M01 — canon and vertical-slice contract v1.0.0

Dated 2026-10-24. This deliverable covers FB-009–FB-018 as a versioned design/production artifact. It adds no runtime systems or activated content. Existing approved canon is confirmed; new slice content is **PROVISIONAL**. M00's source checkpoint passed; PR #69 is open and FB-006 operational identity evidence remains outstanding. M01 does not close that gate.

- [Canon, source fingerprints, launch tiers and decision ledgers](canon-and-scope.md) / [machine-readable canon lock](canon-lock.json)
- [Eight-axis status matrix](status-matrix.md) / [status data](status-matrix.json)
- [The Bell Below Brackenford: complete first/second-life brief](vertical-slice-brief.md)
- [Dependency board, ownership and ten PR briefs](dependency-board.md) / [issue tree](issue-tree.json)
- [Executed validation and evidence boundaries](validation.md)

| Work item | Delivered artifact and acceptance boundary |
|---|---|
| FB-009 | Exact S46 authority order and reproducible import/fingerprint procedure; actual supplied archive re-import matched byte-for-byte; all 47 document fingerprints and correction digest in canon lock |
| FB-010 | All 46 canonical tiers, Core historical status and six S46 subfeature overrides confirmed; no system reclassified by a slice exclusion |
| FB-011 | Independent design/foundation/integrated/player-usable/content-ready/verified/deployable/activated columns for Core + 46 systems, scoped to exact M00 candidate; no whole-system promotion |
| FB-012 | Original obligations, twelve existing approved corrections, unresolved decisions and M01 recommendations separated; no new approved correction inferred |
| FB-013 | Town, marsh, compact dungeon, map sketch, two-mechanic boss, premise/tone and real local campaign resolution; names and final narrative are provisional |
| FB-014 | Fighter/Rogue/Wizard and human/goblin slice selections; native-engine proof required; subclass/full species catalogs remain open |
| FB-015 | Four connected quests with combat/peaceful approaches, concrete clue, optional class affordances, alternate evidence and fail-forward recovery |
| FB-016 | Tangible persistent Sluice Survey knowledge reward plus culvert/accord second-life route; no invented numerical Mastery economy |
| FB-017 | Ten planned PR briefs, acyclic hard dependencies, three exit milestones and sole writer per semantic mutation; repository-local issue tree, not created GitHub tickets |
| FB-018 | A-01–A-12 usability, second-run, authority, accessibility, telemetry/privacy and authoring gates before catalog/system expansion; criteria defined, not yet passed |

## Reproduce the document checks

From repository root:

```sh
python3 infra/scripts/validate_m01.py
python3 infra/scripts/feature_registry.py
python3 infra/scripts/documentation-check.py
python3 -m unittest discover -s infra/tests -p test_feature_registry.py
```

The M01 validator checks snapshot/HTML-manifest fingerprints, corrections, canonical tiers, independent matrix fields, source/stable section references, ownership coverage, issue/milestone dependencies, local links and provisional decision disposition. It does not execute future gameplay acceptance or attest a deployment. Source-catalog changes must be reviewed and deliberately reconciled rather than automatically refreshing these locks.

## Change and rollback

Bump the brief version and reconcile JSON, references, decisions and human-readable board together. Preserve approved source wording and history; do not change the original design archive or generated registry status to fit the proposal. Gameplay issue PRs add concrete field mappings, tests and UI evidence before any status promotion. M01 rollback is a Git revert of these design files/navigation links; no migration, configuration or production adoption is involved.
