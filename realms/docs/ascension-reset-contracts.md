# Field lifetimes and the small Ascension loop

[Documentation map](README.md) · [Current status](implementation-status.md) · [Migration map](migration-guide.md)

This pass makes the current reset boundary explicit and executable. It uses the existing two-encounter fixture campaign, not a production campaign catalog. The server proves victory, grants persistent campaign knowledge, enters Aftercore, provides a retained/lost preview, confirms the transition once, and starts a fresh build using the same sealed rules release. The next life cannot borrow old campaign victories.

## Field contracts

[`lifetime-fields.ts`](../src/domains/lifetime-fields.ts) names 463 fields across 61 native owned-state tables. It documents the current domain handlers and checks the owned-state schema against that manifest. Every direct run-owned table and the listed identity/shared/custody roots are included. Adding a table with `run_id`, adding/removing a column in this boundary, or changing a field's lifetime requires a reviewed manifest update. This is the initial native-state boundary; new modules with indirect ownership must add their roots explicitly. It is not an automatic rewrite engine for arbitrary SQL tables.

[`state.ts`](../src/domains/state.ts) executes the immutable lifetime of generic scoped fields. Rollover and Ascension are separate policies. Carried/default values are revalidated before inserting next-run fields; invalid legacy state rolls back custody, archival and receipts together. Field keys are versioned; changing an existing schema, default, owner, scope or policy fails.

| Owner | Ascension policy | Rollover |
|---|---|---|
| ACCOUNT / CHARACTER / GUILD / EVENT / WORLD | KEEP independent owner | KEEP unless explicitly declared daily/scheduled |
| RUN + CARRY | Copy value (or declared default if never written) into the next run; retain old history | RESET_AT_ROLLOVER clears only at an actual due epoch |
| RUN + RESET | New-run field receives its declared default; old field remains archived | Its separately declared policy |
| RUN + ARCHIVE | Old field stays inaccessible; no new-run row is created | Its separately declared policy |
| INSTANCE | ARCHIVE at terminal instance lifecycle; active participation blocks Ascension | Its declared instance/effect clock |

Every RUN field with `RESET_AT_ROLLOVER` must use CARRY. Daily uses cannot be refreshed by Ascending. Registration without an explicit Ascension policy keeps backward-compatible defaults: daily RUN → CARRY, other RUN/INSTANCE → ARCHIVE, independent scopes → KEEP. New ordinary run flags should explicitly choose RESET or ARCHIVE.

Native exceptions are explicit: remaining Turns and fullness/drunkenness/tolerance carry unchanged; progression/build/earned choices start fresh. Ordinary physical units retain identity, quantity, binding, locks, protection and provenance as custody moves to Home or Material Vault. Run-bound/quest objects remain in archived custody. Run Gold moves through the conserved transfer ledger into account wealth. Account discoveries retain first-run provenance. Shared owners, jobs, event claims and historical journals are not reset by changing lives.

## Preview and confirmation

`GET /api/v1/ascend/preview` authenticates the account, locks a coherent account/run snapshot, and returns current readiness, retained counts/consumption and plain-language reset rules. It does not return arbitrary state keys/values, seeds, private content definitions or other owners' data. The confirmation token is keyed with a process-private random key. A process restart requires a fresh preview; an already committed request still replays its immutable receipt before preview validation.

`POST /api/v1/ascend` requires `previewToken` for every new transition, alongside the usual request ID, Action type and expected revision. Older committed tokenless requests can still retrieve their matching receipts; fresh tokenless requests fail before any transition. A changed snapshot returns `ASCENSION_PREVIEW_CHANGED` without transitioning. Parser/automation/admin intents cannot choose Ascension; manual UI or explicit API intent is required. All active instances block it. The browser's Aftercore panel shows retained/reset/archived state and asks for explicit confirmation. After transition it directs the player to fresh class/build setup. Lost replies retry the exact original request and token, rather than creating another life.

The public coordinator is `confirmAscension`; internal domain callers retain the optional-token `ascend` transition interface for trusted coordinators/fixtures. They must use the authenticated Action envelope and the same eligibility/lifetime checks. No HTTP route exposes that bypass.

Campaign victory learns the canonical campaign ID through `discoveries` in the same completion transaction. Existing Advanced knowledge never downgrades. This is the one persistent knowledge reward used by the test loop; numerical Mastery, Legacy selection, full Tavern gameplay, configurable new-run modes and release adoption remain separate features.

## Migration, verification and rollback

Migration `030_state_ascension_contracts.sql` adds Ascension policy metadata to existing state contracts, without rewriting their values or past receipts. It derives backward-compatible policies, requires daily RUN fields to carry, freezes generic writes/deletes under archived owners, prevents changing a field identity, and archives terminal instance field scopes. Terminal instances cannot reopen, and deferred owner/scope checks reject inconsistent lifetimes for all instance kinds. Pre-existing active instances with archived scopes stop the migration for explicit repair rather than silently changing player state. Scope locks serialize generic field writes against archival. A registry advisory lock serializes preview/transition against administrative registration before account/run/scope locks, preventing new contracts from appearing midway through the copy. Register contracts in administration/startup transactions, not inside player Actions. Old contracts remain immutable after the transactional metadata backfill.

The restricted runtime already has the scoped-state and discovery permissions this feature uses; no new administrative privilege is granted. The campaign restricted-role regression includes the existing discovery-write capability. Verification uses disposable schemas/database only. Production and staging databases have not been migrated by this implementation task.

```sh
cd realms
npm run typecheck
npm test
# Use a separate realms_test database; never a player database.
node --env-file=.env --import tsx --test test/ascension-contract.test.ts
npm run test:integration
npm run test:workers
npm run test:runtime
npm run build
npm run content:check
npm run features:check
```

The fixture proves seven scope families, declared CARRY/RESET/ARCHIVE fields, stale previews, explicit authorization, concurrent request replay, app recreation, fresh build/replay, persistent campaign knowledge, daily rollover, migration preservation, immutable field identity, and detection of an undeclared column. The established inventory/currency/campaign suites continue to cover custody and provenance.

Before any live rollout, follow the staging/manual-play/promotion/rollback workflow in the [development baseline](../../infra/docs/development-baseline.md), with approval for live migration. Reverting source alone after applying migration 030 does not restore schema parity: prefer a reviewed forward fix, or restore the pre-migration backup in the isolated environment and rebuild the matching old checkpoint. No destructive down migration is provided.
