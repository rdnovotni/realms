# M02 — content production Studio v0

[Documentation map](README.md) · [Author guide](../../infra/docs/development-studio-v0.md) · [M01 slice contract](../design/m01/README.md)

M02 adds a guided local production workspace to Development Studio: searchable definitions, typed forms, reference/quest inspection, deterministic encounter testing, discovery-filtered previews, immutable candidate review, isolated publication and approved-package export. It does not add a quest execution engine or deploy/activate the slice. No SQL migrations or game HTTP routes are introduced.

| Work item | Implemented surface / evidence |
|---|---|
| FB-019 | Search/filter table: stable ID, type, revision/source version, tags, dependencies, author, status and last change; `infra/development_client/workspace.py` and `web/` |
| FB-020 | Typed item, ability/effect, monster, encounter, loot and quest-objective forms over the existing backend contracts; no TypeScript required for ordinary edits |
| FB-021 | DRAFT → immutable CANDIDATE → passing disposable STAGING → noted/confirmed APPROVED; real publisher refuses modified released versions/revisions |
| FB-022 | Dependency graph/lint, reviewed new-ID rename plus local tombstone, changed inbound revisions, referenced tombstone refusal and reserved identity history |
| FB-023 | Any authored encounter selectable; actual tactical transition engine or legacy duel mitigation, synthetic profiles, seeded HMAC draws, bounded trace/replay hash and explicit noncombat preview |
| FB-024 | Typed quest graph diagnostics for bad edges, dead ends, duplicate node/principal reward IDs, cross-quest reward ownership and unreachable/no-success routes; gate shared with `validateContent` |
| FB-025 | Shared content-projection whitelist; novice/advanced synthetic knowledge with unknown entities absent and server mechanics/secrets omitted |
| FB-026 | Previous-approved diff, notes, immutable manifest/pin preview, local emergency publication disable, new-draft rollback and compatibility guidance |
| FB-027 | `studio-fixture.py` creates its own empty loopback database, verifies server identity, applies 001–048, seals through `publishContent`, proves immutability/replay and stops its cluster; no DB URL accepted |
| FB-028 | [Recorded browser authoring proof](m02-authoring-proof.json): five definitions changed, 289 TypeScript files unchanged during authoring; malformed quest blocked, repaired graph tested, exact candidate sealed/approved locally |

Canonical traceability: System 46 §16/19–27/43–45/60/65/70, System 23 `definitions`/`versions`/`queryaction`/`transactions`/`security`/`testing`, System 16 `knowledge`/`access`, System 45 `objective-xp`/`simulations`/`balance-tools`. Source fingerprints and interpretation follow the [M01 canon lock](../design/m01/canon-and-scope.md). No speculative catalog is promoted to LOCKED and no whole-system completion is claimed.

## Browser proof

The synthetic author changed:

- `monster.tactical`: name and maximum health (12 → 18).
- `item.ore`: name and player-facing description.
- `encounter.tactical`: name and round limit (5 → 7).
- `loot.tactical`: name and fixed drop quantity (2 → 3).
- `quest.studio_cart`: title/route text, with an intentionally broken connection saved as a repairable draft and rejected by the candidate gate, then repaired.

The repaired candidate was tested in the sandbox and published by the real backend in a disposable PostgreSQL 18 cluster. Its actual release/manifest, migration checksums, idempotency/immutability checks and stopped-cluster result are in the proof. Approval attribution is the synthetic “Studio proof” actor, not an assertion of independent staff approval. [Screenshots and captions](screenshots/m02/README.md) record the visible result.

The local proof includes its base source commit, dirty-worktree flag and implementation fingerprint. It proves the recorded working-tree exercise, not a released build. The exact-commit CI authoring artifact is separate final-candidate evidence; read that run's actual result. Old M00/M01 status matrices remain historical snapshots.

## Safety and remaining scope

Local STAGING/APPROVED states are authoring states. Existing protected staging/live deployment, staff permissions, content adoption and feature flags are separate operator contracts. FB-006 remains open. No live system state was inspected or changed by M02. Framework schemas, Studio authoring workflows, fixture verification, production catalogs, complete gameplay and activation remain different claims.

Quest objectives are validated data only; their runtime coordinator, claim settlement and Journal progression belong to the next owning quest slice. Synthetic build perturbations and a fixed simulation policy do not implement native class engines, production AI or exhaustive balance. Broader typed editors, multi-user staff authority and launch-scale authoring remain open System 46 work.

Rollback of this code is a reviewed source revert; it needs no database down-migration. Preserve workspace/snapshot backups. Do not edit historical released definitions or automatically enroll real player runs. Use [the author guide](../../infra/docs/development-studio-v0.md) for operation, export and forward recovery.
