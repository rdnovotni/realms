# Database migration map and rollout boundary

Migrations are ordered, append-only SQL with recorded checksums. `src/migrate.ts` applies them; readiness compares the exact expected version/checksums. Never rename or rewrite a deployed migration to rebrand the game. Runtime uses restricted `realms_app`; administration and migration credentials are private and separate. See [database foundation](database-foundation.md) and [backend deployment](../../infra/docs/backend-deployment.md).

## Source migrations through 032

| Migration | Purpose and guide |
|---|---|
| 001–003 | Action/Turn foundation, domain ownership and integrity hardening; [foundation](database-foundation.md) |
| 004 | [Inventory accounting](inventory-accounting.md) |
| 005 | [Accounts and sessions](account-sessions.md) |
| 006 | [Encounter journal](encounter-persistence.md) |
| 007–008 | [Authored loot](authored-item-loot.md), [basic combat/campaign](basic-combat-loop.md) |
| 009–010 | [Routine crafting](routine-crafting.md), [item locks](item-locks.md) |
| 011–013 | [Equipment](equipment-persistence.md), [binding](item-binding.md), [loadouts](saved-loadouts.md) |
| 014–015 | [XP](encounter-xp-persistence.md), [class builds](run-class-progression.md) |
| 016–018 | [Subclass](subclass-persistence.md), [feat](feat-persistence.md), [attribute](attribute-milestones.md) choices |
| 019–020 | [Proficiencies](proficiency-persistence.md), [qualification evidence](proficiency-requirements.md) |
| 021–023 | [Character snapshots](character-mechanics.md), [tactical journal](tactical-engine.md), [campaign proofs](tactical-campaign-proofs.md) |
| 024–027 | Pinned checks, failure contracts, owned companions and shared tactical encounters; [expansion](tactical-first-pass-expansion.md) |
| 028–029 | Worker delivery receipts and scheduler; [workers](../../infra/docs/cache-worker-operations.md), [scheduling](../../infra/docs/scheduling.md) |
| 030 | Generic Ascension lifetime policies and terminal-scope freezing; [reset contracts](ascension-reset-contracts.md) |
| 032 | Inventory preference contract, protected quantity ordering, carrying policy/entry guards and immutable load evidence; [inventory grid](inventory-grid.md) |
| 031 | Shared-rule state/events, feature-control history and reviewed release adoption; [shared rules](shared-rules.md) |

Use `migrations/` for exact filenames and SQL. Historical per-feature table counts describe their migration checkpoint; the 465-field/62-table native lifetime manifest is a selected ownership inventory, not the total schema count. Do not infer the installed schema from this map.

## Verification and rollout

For a disposable `realms_test` database, run typecheck, unit, integration, worker and runtime checks plus the frozen checkpoint workflow. Integration suites create/remove isolated schemas, rehearse upgrades, preserve earlier rows and verify restricted runtime authority. Follow [contributing](../../CONTRIBUTING.md) for configuration; do not run test suites against production.

For an approved staging/live update, use the [game update guide](../../infra/docs/game-update-guide.md), [development baseline](../../infra/docs/development-baseline.md) and [rollback policy](../../infra/docs/rollback.md). Record source/image identity, pre-migration backup and restoration proof, the migration plan, runtime grants and exact readiness/audit evidence. Rehearse representative data and downtime before a live schema change.

A source merge does not apply 030/031/032. Applying 031 does not enable `shared.rules`; administration must review content/controls separately. Existing runs and instances stay pinned. New-run adoption requires a reviewed sealed release; retained-custody compatibility is conservative and rejects changed/removed old entries.

## Recovery

Disable the affected feature through its reviewed control and preserve evidence while fixing forward. Do not automatically restore an old live database over later player actions. Code-only rollback is valid only with exact unchanged-schema compatibility and a retained image. After a schema change, follow the reviewed isolated recovery/forward-fix process; a Git revert does not undo SQL or restore readiness parity.

## Turns slice: migrations 037–041

037 adds account reserves, banked daily allowances/evidence and per-run repeat plans; 038 adds immutable rest recovery and next-encounter pins; 039 permits explicitly bounded v3 free/extended encounter costs; 040 records effective release-pinned rollover policies; 041 reconciles daily projections and bonus ledger legs. Older migration checksums are unchanged. See [Turns and rollover](turns-rollover.md#validation-and-safe-rollout) for source contracts, restricted grants, staging proof and the compatible rollback boundary. No production schedule or content is enabled by these migrations.

## Consumption migration 042

See [the consumption contract](consumption.md) for implemented routes, player workflows, migration/grants, lifecycle guarantees, remaining ownership boundaries and safe rollout/rollback. Production content adoption remains separate.
