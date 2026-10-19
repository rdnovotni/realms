# Follybound implementation status

Reconciled October 19, 2026 through CHAR-05, migrations 001–036, and the VIS-03–07 integration with mobile-header and visual-contract corrections. This is a repository inventory. Runtime activation and the current state of installed services require separate operator evidence. Dated audit/restore/deployment records remain historical.

## Verified foundations and their limits

| Area | Implemented evidence | Remaining boundary |
|---|---|---|
| Authority and persistence | `src/foundation/action.ts`, domain services, checksummed migrations, receipts, journals, restricted SQL role; [database foundation](database-foundation.md) | Complete launch-domain coverage and production-scale/recovery evidence |
| Accounts and browser | Enrolled passwords, sessions, offline recovery and throttling; [sessions](account-sessions.md), [client](game-client.md) | Public enrollment, emailed reset, staff MFA/granular authority, export/redaction and verified contact |
| Character growth | XP, Character advancement UI for class/subclass/feat/attribute/proficiency choices and a pinned milestone timeline; Character Statistics and an assessed owned-source Ability Book; paginated current-run advancement history; [progression](progression-persistence-plan.md), [character derivation](character-mechanics.md) | Training/practice, respec, special starts, Mastery, Legacy and full catalogs |
| Combat | Saved solo/shared tactical encounters, legal actions/reactions, typed mitigation, effects, owned companions, resource pools, failures and replay; [engine](tactical-engine.md), [expansion](tactical-first-pass-expansion.md) | Fixtures prove mechanics, not production balance; guild/raid/market/social systems remain separate |
| Campaign and Ascension | Victory proof → Aftercore → keyed preview → confirmed new life → fresh build; generic field lifetimes and history; [contract](ascension-reset-contracts.md) | Full campaigns, later progression domains, mode/path rules and breaking release transitions |
| Items | Paged grid/search/filter/sort/grouping, carrying weight/bulk, personal storage, stack actions/history, optional loot routing, locks, binding, two-set equipment, saved loadouts, protected item use/opening, priced repair and routine batches; [grid and carrying](inventory-grid.md); [inventory](inventory-accounting.md), [crafting](routine-crafting.md) | Advanced production, stations, quality, commissions, upgrades and complete durability lifecycle |
| Folio client | Character’s five chapters, unified Pack/equipment ledger, Adventure/combat/Journal presentation, shared icons/dialogs and tab-local texture preference; [visual QA](visual-qa.md) | Parchment is the only theme; native zoom, screen-reader speech and physical touch still need device verification |
| Shared rules | `src/rules/`, migration 031; combat and interaction adapters reuse checks, prerequisites, effects and settlement; [contract](shared-rules.md) | `shared.rules` disabled by default; adapters are not a full quest/dialogue/travel engine; top-level ABILITY prerequisites rejected until enforced |
| Clocks and controls | Typed clock/effect/retry policies, audited flags, emergency disable/drain, reviewed sealed-release adoption | Real-time only for explicitly permitted nonmechanical windows; full daily/Home systems, breaking hotfix/multiple engines remain separate |
| Operations | Immutable build/release workflow, staging isolation, console/studio, supervised worker/scheduler, encrypted USB backups and protected monitoring; [operations](../../infra/docs/README.md) | Independent-machine recovery, PITR, verified alert delivery, load/failure/migration rehearsals and current live verification |
| Public pages | Follybound identity, factual information pages and funding/privacy development notices; [pages](branding-and-pages.md) | Source copy is not a hosted rollout; signup/newsletter/payments/community channels remain closed |

The small fixtures are deliberately synthetic. Storage tables for quests, guilds, events or effects are not proof of complete gameplay. Shared services expose bounded primitives; each owning domain must integrate authority, UI, rewards and failure handling before its feature is complete.

## Design alignment

The [design registry](../design/README.md) contains the Core Bible and Systems 01–46 snapshot, approved-correction precedence, dependency order and requirement-level evidence. Systems 23/24/29/45/46 share a cross-domain foundation, but no whole system is declared complete from that slice. The [field manifest](../design/feature-registry.json) accounts for native lifetimes, not every table or every planned field. `features:check` verifies registry consistency; it cannot certify unassessed requirements or a live deployment.

## Evidence baseline

Historical PR #39 repository CI and frozen release checks passed: 132 unit, 353 integration, 7 worker and 3 runtime tests (495 game tests; no skips). Infrastructure counts vary by host dependencies; historical runs include environment-dependent skips. These counts describe that checkpoint, not a guaranteed current count. Run the [contributor checks](../../CONTRIBUTING.md) for the changed checkpoint and retain CI evidence with its commit.

The integrated visual source passes 219 unit/client tests, 188 freshly captured responsive/preference contracts, 55 source contrast pairs, and local infrastructure validation (175 cases, 10 conditional skips). Complete database and frozen-image verification must be read from the exact integration commit’s CI receipt; local presentation checks are not a deployment claim.

Do not infer runtime migration 030–036 or flag activation from merge. Read the recorded deployed image, its source commit, migration checksums and readiness before claiming a particular feature is available. The [release checklist](release-readiness.md) remains open for public launch.

Inventory P2 source pass (migration 036): exact future-grant Keep-N routing, collection identity protection, account saved filter/sort views, structured inspection and owned-item comparison, known capability summaries, slot condition indicators and uncapped capacity visualization. See [inventory grid](inventory-grid.md). Item modification/affix journals remain future domain work; no production deployment is implied.
