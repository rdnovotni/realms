# Follybound feature registry

[Documentation map](../docs/README.md) · [Implementation status](../docs/implementation-status.md) · [Feature-first roadmap](../docs/feature-roadmap.md). Original source names below are preserved provenance; Follybound is the current product name.

This is the second P1 deliverable: an implementation overlay over the supplied master design index. It is a framework roadmap and review contract. It does not activate gameplay, migrate player state, publish game content, or declare the design implemented.

Start with [the work plan](WORK_PLAN.md). Finish reusable feature frameworks with a few synthetic fixtures before producing substantial ordinary content. Each work package includes its server, typed Studio controls, player workflow, integration tests and reset/reconnect behavior. Canonical launch tiers remain visible; a framework can be tested before a restricted feature is eligible for activation.

The [M01 canon and vertical-slice contract](m01/README.md) confirms the source fingerprints and launch tiers, separates eight implementation/readiness axes, and specifies a provisional two-life region with a dependency board and ten PR briefs. It does not promote proposed catalogs or activate content.

The [DM00 Dungeon Master persona contract](dm00/README.md) defines his voice, restraint, presentation preferences and 14 scenario comparisons. His name remains undecided; the owner approved the pointed voice and scenario balance, with cleverness an explicit editorial requirement. This is a review artifact, not a runtime narrator.

## Files and source authority

- `source-catalog.json.gz`: immutable, losslessly compressed snapshot of the supplied Core + Systems 01–46 index. It retains all 13,187 indexed entries, including 11,607 rules, exact source wording/status, 2,096 section anchors, document fingerprints and 12 recorded corrections. It is reference data, excluded from runtime container copies and player assets.
- `feature-registry.json`: editable engineering contracts for 47 systems, their 2,096 owned section checklists, baseline subset evidence, reset/permission/authoring/client/acceptance contracts, decisions and eight work packages.
- `WORK_PLAN.md`: derived human-readable contracts and roadmap; generated from the two files above.
- [Source manifest](SOURCE_MANIFEST.md): readable document filenames, hashes and counts for tracing the compressed snapshot back to the supplied bundle.

The snapshot came from `kol2_master_feature_index_bundle.zip` in the KoL 2.0 project references. It is not a fresh crawl of later discussions. Explicit approved corrections outrank the owning system bibles; those outrank the historical Core and example/prototype content. The overlay is proposed engineering implementation detail, not new design canon. Apply the correction register before turning old source text into a test assertion.

Source stable IDs identify extraction rows; engineering IDs identify owned checklists (`SYS-10`, `CAP-01-rollover`). A section can contain several features and cross-system rules. These are review/checklist units, not 2,096 automatically sized development tickets. Split an implementation ticket around a coherent player workflow while preserving its source IDs. Source wording hashes can change on re-import; retain reviewed history and explicitly reconcile mappings.

## Inspect and validate

From the repository root (Python 3 standard library only):

```sh
python3 infra/scripts/feature_registry.py
python3 infra/scripts/feature_registry.py --show SYS-10
python3 infra/scripts/feature_registry.py --show CAP-01-rollover
python3 infra/scripts/feature_registry.py --search 'bankable'
python3 -m unittest discover -s infra/tests -p test_feature_registry.py
```

From `realms/`, `npm run features:check` performs the same validation. GitHub CI and the local `scripts/verify.sh` include it. The registry validator checks structure, source coverage, fingerprints, dependencies, evidence paths, promotion prerequisites and report freshness. It does **not** execute the referenced game tests, establish legal/platform eligibility, prove a test's semantics, or attest a live deployment. Those require the concrete acceptance runs and operator gates.

`--show` expands the inherited system contract and prints the source rules for the chosen section. `--search` returns extraction IDs, wording and owning checklist IDs. The source section contains the original bundled HTML link; the manifest supplies the filename and fingerprint. Synced project references remain read-only.

## Update implementation status honestly

System baseline status is `partial` when a specifically inspected subset of code/tests exists. Section status starts `unassessed` because those rules have not individually been mapped to executable assertions. Neither means the code is broken; neither proves framework completion. A `planned` contract has been reviewed but is not a completion claim.

Before implementing a section, review the exact source statements and corrections, declare concrete field-specific state ownership/reset rules, Action permissions, typed schemas/editor controls and the client workflow. Use inherited system defaults only where they genuinely apply. Document exceptions and non-applicable fields in the section's `contract_review`; migrate/version state contracts explicitly rather than silently changing their lifetime.

For every applicable `FEATURE / RULE` and `SCHEMA / DATA` row, record a `rule_assertions` entry. An active row needs a rationale and named executable tests; a superseded row needs a recorded correction topic, rationale and an explicit `supersession_bindings` association to its affected stable ID and canonical replacement. Historical status is reserved for Core; active-system rules cannot be hidden by relabeling a section. Examples, outlines and metadata remain reference material. Deferred rules remain open work and cannot count toward an implemented section. The validator deliberately refuses to dismiss a rule/schema row as mere reference material.

Example shape for a section overlay (replace the illustrative values with actual source IDs, existing tests and concrete field declarations):

```json
{
  "implementation_status": "partial",
  "contract_review": {
    "state": "Declare each field's scope, rollover and Ascension behavior, including non-applicable fields.",
    "actions": "Declare exact mutation/query names, authenticated roles, revisions, costs and replay semantics.",
    "authoring": "Declare typed definition schemas, validation and Studio controls.",
    "client": "Declare the complete permitted player workflow and resume behavior."
  },
  "evidence": [
    {"path": "realms/src/domains/lifecycle.ts", "finding": "Specific implemented subset and remaining limitations."}
  ],
  "rule_assertions": {
    "FEAT-actual-source-id": {
      "disposition": "active",
      "reason": "Explain how this assertion proves this rule.",
      "assertions": [
        {"test": "realms/test/foundation.test.ts", "name": "Exact existing executable assertion name"}
      ]
    }
  }
}
```

`implemented` requires every applicable rule/schema assertion or explicit supersession, implementation evidence and section-specific contract review. `integrated` additionally requires concrete client, Studio and cross-system integration evidence. `verified` additionally records an immutable source commit, command, passing result and repository-contained proof artifact. Commit the evidence first, execute acceptance at that frozen checkpoint, then record its commit in a later metadata commit. A whole-system status cannot outrun its least complete section. Verification is a recorded engineering assertion, not a substitute for reviewing the proof artifact.

The initial `supersession_bindings` list is empty: known correction topics are reference canon, not blanket exemptions. To apply one, add an explicitly reviewed mapping:

```json
{
  "topic": "Culture selection",
  "affected_entries": ["FEAT-actual-older-rule-id"],
  "replacement_entry": "FEAT-actual-approved-system-37-rule-id",
  "reason": "Explain exactly why this approved replacement corrects each older statement."
}
```

The replacement must be an approved rule/schema entry owned by the correction's recorded system. Every affected source ID must be real, unique and different from its replacement. Bind directly to the current approved replacement; it cannot itself be superseded, preventing circular exemptions. The disposition's correction topic must match this explicit binding. Cross-system older wording is allowed only through this reviewed association; source membership alone never exempts a rule from tests.

Use the shared `framework-done` acceptance profile **and** the system-specific scenarios **and** individual source-rule assertions. Inspect permission failures, concurrent/repeated actions, restart/reconnect, rollover/Ascension, secret filtering and invalid content. A single happy-path fixture or existing SQL table is insufficient.

Regenerate the work plan and source manifest after overlay/source changes:

```sh
python3 infra/scripts/feature_registry.py --write-report
python3 infra/scripts/feature_registry.py
```

No percentage of design coverage is reported as gameplay completion. Source approval, code presence, integration, automated verification and live activation are different claims.

## Import a changed design bundle

The importer reads and fingerprints the supplied archive and its HTML documents. It creates a **new** snapshot and refuses to overwrite files or write under synced `sources/`.

```sh
python3 infra/scripts/import_design_catalog.py \
  --archive /absolute/path/to/kol2_master_feature_index_bundle.zip \
  --output /tmp/reviewed-source-catalog.json.gz
```

Compare the new document/entry IDs and corrections, explicitly reconcile renamed/added/removed sections and rule mappings, retain disposition history, then replace the repository snapshot and its uncompressed `catalog_sha256` in the overlay together. Run `--write-report` to regenerate the manifest/work plan and validate. The importer never regenerates or clears implementation status, assertions, evidence or decisions.

## Deployment and rollback

These files are developer planning data. No production database, server configuration, networking, credentials or authored `content/game.json` changes are part of this deliverable. Live acceptance from P1 item 1 remains recorded as `DEC-004`, not silently closed by CI. Wagering/payment/event activation remains separately gated.

Rollback is a Git revert of this PR; it has no player-data migration or live-service rollback step. To verify a future runtime checkpoint, use the existing disposable verification path and staging manual-test/promotion/rollback workflow described in [the development baseline](../../infra/docs/development-baseline.md).
