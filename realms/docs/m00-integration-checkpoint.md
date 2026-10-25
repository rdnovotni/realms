# M00 — integration and migration checkpoint

[Documentation map](README.md) · [Implementation status](implementation-status.md) · [Migration map](migration-guide.md) · [Combat boundaries](combat-completion.md)

This is an integration/recovery gate, not permission to deploy or adopt gameplay content. The exact final commit, tree, workflow run and verification-image digest are recorded in the integration PR and its CI receipts. A later main change invalidates the combined-candidate assumption and requires a fresh merge and rerun.

## Verified ancestry and contents

| Object | Exact identity and finding |
|---|---|
| Observed main | `cdfd2ce16432c6ad1c7b6670dddaa46eb16ef0e5`, parents `470b8ae9e6c1cb06c2d49d0e6aed6dc52fc29a7e` and `a1ff65db78454b9e9c252348906ecd6eedeacf3a`; tree `c88dd9a45c97855314c24153d17e8880d7821a0d` |
| PR #67 | Merged into **main**, head `a1ff65db78454b9e9c252348906ecd6eedeacf3a`; its merge is the observed main |
| PR #68 | Merged into **feature/consumption-completion**, head `a842b7d5d2ef2dc0260cf197af0b40a189dded65`; merge `e430eeb4a1e2ce339f427cbc3b64df5afc699a90` has parents #67 head and #68 head |
| Integration | A genuine two-parent merge from observed main and #68 head; clean gameplay tree `710522daf54db7a6ff6e0799d7f4cd575c82ac25`, before adding M00 evidence/gates |
| File comparison | Main contains 001–042. Integration adds only migrations 043–048; existing 001–042 and the dependency lockfile are byte-identical. A merged PR flag alone did not establish these facts. |

## Repeatable Gate A evidence

The checked-in [local rehearsal receipt](m00-local-rehearsal.json) is a synthetic-data rehearsal on the integrated gameplay tree, not a claim of a deployed build. The `checkpoint-rehearsal` CI job repeats it on the final candidate and uploads its exact-tree receipt as `m00-checkpoint-rehearsal`. The packaged-release job requires both the ordinary server gates and this rehearsal to pass.

The rehearsal starts with an **empty, dedicated** loopback database named `realms_test` on PostgreSQL 18.6. It verifies a baseline archive against immutable Git blobs; applies 001–041; uses the actual pre-consumption binary at `470b8ae9e6c1cb06c2d49d0e6aed6dc52fc29a7e` to create ongoing BASIC_DUEL_V1 and unopted tactical encounter journals; takes and restores a custom-format backup; upgrades through 042 and 043–048; compares the historical journal hashes; runs immutable replay/invariant audits; and exercises new formation and consumption commands. It then verifies restricted runtime grants, takes/restores another custom-format backup, checks restored migration/journal parity, and proves migration checksum drift is rejected. No migration file is rewritten. Both restores have independent database identities.

Repeat from `realms/`, with Node 24, dependencies installed, a disposable PostgreSQL cluster and matching PostgreSQL client tools:

```bash
# Archive the exact baseline into a fresh temporary directory; do not use a live checkout.
baseline=$(mktemp -d)
git archive 470b8ae9e6c1cb06c2d49d0e6aed6dc52fc29a7e | tar -x -C "$baseline"
ln -s "$PWD/node_modules" "$baseline/realms/node_modules"
# TEST_DATABASE_URL must identify an EMPTY realms_test database at 127.0.0.1.
# PG_BINDIR optionally selects matching pg_dump/pg_restore executables.
node --import tsx scripts/checkpoint-rehearsal.mjs \
  --baseline "$baseline/realms" --receipt /tmp/m00-rehearsal.json --confirm-disposable
```

For CI, the PostgreSQL client bridge uses only the explicit job service-container ID. It does not use a production container, external network, operator credential or production dump. Review also identified an information-exposure defect in the inherited battlefield projection. The integration removes raw interaction/Stagger/unit profiles and projects only public terrain/hazard fields; solo/shared-context and saved-view regressions enforce that boundary without changing journals or client sources. The ordinary full integration, worker, runtime, infrastructure, content, documentation, registry, visual, type/build and packaged-release gates remain required. A synthetic restore is not proof of actual production backup freshness, independent-machine disaster recovery, real user login or load acceptance.

## Deployment observations — kept separate

Observed locally during M00; readiness is only liveness/dependency evidence. It does not identify a build, schema or flag set.

| Environment | Running image / source identity | Installed migrations | Controls / content | Observed readiness |
|---|---|---|---|---|
| Production, port 13000 | **Unverified**: Docker socket and root-private release records inaccessible in this session | **Unverified** | **Unverified** | HTTP 200, database/cache ready |
| Staging, port 13001 | **Unverified**, same access limitation | **Unverified** | **Unverified** | HTTP 200, database/cache ready |
| Native, port 3000 | Runtime image/source unverified. Separately, `/srv/Realms/source` checkout HEAD is `71373e84bc81d3468d751a0c373cc4b6b13071c6`; this does not establish the running binary. | Read-only query: **27**, ending `027_shared_tactical_combat.sql` | `feature_controls` unavailable at this schema; no activation inferred | HTTP 200 ready |
| M00 disposable rehearsal | Integrated gameplay tree above; final candidate/build identity comes from CI | 001–048, exact recorded hashes | Synthetic fixture releases only; no production adoption | Both restore invariant audits pass |

An operator with existing read access must complete the production/staging image digest → OCI source label → release record → migration-name/checksum → feature-control/sealed-release comparison before activation. Do not change permissions merely to fill this table. No service, host configuration, native/production/staging database, feature flag or release adoption was changed by M00.

## Forward fix and recovery boundary

Before first production adoption, separately authorize staging/production migration and adoption; capture actual environment identities and an actual pre-migration backup; restore that backup in isolation with its roles, matching binary/image and exact migration manifest; and check readiness, invariant audits and representative player flows. Preserve spent rest pools, active encounters, pending cooperative claims, protected stock and consumption/rollover histories.

Prefer a compatible forward fix after any 042/new combat histories exist. A code-only rollback to 041 or an older combat reader is incompatible: the rehearsal proves the old binary refuses the upgraded schema and old rules reject new battlefield rules. The old backup can be restored to a separate environment with the old reader; it must not silently overwrite later live player actions. Restore/recovery requires an explicit cutover plan and authorization. Migration 048 replaces the existing exact personal-projection function while retaining its grants and historical unopted behavior; do not reverse it by editing migration 027 or deleting journals.

## Milestone disposition

FB-001: ancestry/files verified. FB-002: integration branch/PR and exact-candidate gates. FB-003/004/005: repeatable disposable upgrade, two backup/restores, checksums/grants and old/new reader evidence. FB-006: the factual matrix above is published; production/staging identity reconciliation remains **unverified**, so activation is blocked. FB-007: status/API/migration/evidence documentation refreshed without promoting whole design systems to complete. FB-008: the final CI-tested commit/tree/build receipt is the immutable source checkpoint for the next milestone; it conveys no production activation authority.
