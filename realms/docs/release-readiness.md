# Database release readiness

Work is organized into [eight release passes](eight-pass-release-plan.md). Pass 1 implementation now includes the [character mechanics evaluators](character-mechanics.md), [saved tactical loop](tactical-engine.md) and [first-pass expansion](tactical-first-pass-expansion.md), including owned companions and consenting human cooperative fights. Pass 1 is complete: 105 unit tests, 319 integration tests, typecheck and build pass in both GitHub server checks. The later release passes remain open.

Migration 021 adds SQL-verified immutable character stat snapshots to explicitly opted-in encounter starts. Authored attribute scaling, selected passive class/feat/subclass effects and worn/active equipment contributions are captured from the pinned run release. Migration 022 connects authored party actions, public intent/resume routes, guard/healing, retained pools, atomic settlement and independently replayed action history. The versioned extensions add typed/conditional defense, authored support/area abilities and checks, controls and buildup, concentration and reactions. Migrations 024–027 seal persistent conditions, disclosed injury/Gold/wear recovery, recruited NPC retention and shared human combat with personal reward claims. Historical solo/basic formulas remain versioned. Final catalogs, balance and the remaining progression/world/daily/shared-operation gates stay tracked in the eight-pass plan.

The database is a tested private development foundation. Public release requires the remaining gates below; passing the foundation suite alone is not sufficient.

## Integrity pass

Migration 003 adds named currency transfer legs, unique within each Action. Historical transfers retain their identifiers, amounts, timestamps and balances with the default `primary` leg. The internal batch service validates the complete ordered plan, locks all wallets in UUID order, holds scopes stable, checks currency/funds/int64 bounds, and commits through the normal Action transaction. Escrow funding must precede its payouts. Each owning domain must authorize its plan; arbitrary legs and faucet/sink access are not exposed to clients.

Worker leases require both fields for Running jobs and neither field otherwise. Work identity and retry budgets cannot change; terminal jobs cannot reopen. Renewal requires the current token and an unexpired lease. Outbox dispatch accepts a duplicate only when the existing job has exactly the same work. A collision raises an error and leaves the event undelivered. Resolving malformed work requires an audited administrative procedure, not silent replacement.

Character/account and container/scope ownership are immutable. Content must move through explicit custody operations. Terminal runs cannot reopen, and Aftercore cannot revert to Active. Terminal transitions archive their scopes automatically. Deferred constraints require run and scope lifetimes to agree at commit, allowing the multi-step Ascension transition in one transaction.

The read-only audit checks each wallet against its transfer history, run/scope lifetimes, item bindings, outbox/job agreement, complete leases, validated constraints and full leading-key index coverage for every foreign key. Counts and catalog names are printed; player payloads and credentials are excluded. Structural index coverage does not prove throughput. Representative load tests must establish performance and whether overlapping indexes should be consolidated.

The restore check also runs domain reconciliation. Balanced but incorrect wallet projections therefore fail even when their global currency sum is zero.

```bash
bash scripts/runtime.sh npm run db:audit
bash scripts/verify.sh
bash scripts/runtime.sh npm run db:permissions
bash scripts/database.sh backup
bash scripts/database.sh restore-check .state/backups/NAME.dump
```

## Launch gates

| Gate | Current state | Required evidence |
|---|---|---|
| Launch feature coverage | Design-to-foundation map exists | Every launch feature mapped to schema, authority, lifetime, transaction and acceptance tests |
| Integrity and currency batches | Migration 003 and services implemented | Replay, concurrency, rollback, ownership, upgrade, runtime permissions and live audit checks pass |
| Real accounts and sessions | Enrolled passwords, scoped sessions, offline recovery and throttling | Public onboarding/contact policy, compromised-password filtering, stronger staff authentication and granular staff authority |
| Production/staging separation | Private runtime excludes administration/test secrets and verifies SQL privileges | Separate deployment settings/data/OS identities/credentials; production excludes dev seeding |
| Automated independent backups | Manual local dumps | Encryption, independent storage, retention, alerts and recovery objectives |
| Point-in-time recovery | Not configured | Base backups and archived transaction logs; verified recovery to the intended transaction |
| Recovery on another machine | Not exercised | Configuration/role recovery and application/gameplay/history verification |
| Safe production migrations | Checksummed transactional migrations | Representative-data rehearsal, lock/downtime limits and server-version compatibility |
| Typed content mechanics | Shared envelope, inventory declarations, encounter costs and ordinary item loot | Detailed schemas and semantic validators for every shipped content type |
| Complete gameplay persistence | Basic solo combat-to-item/Gold-to-campaign-to-Ascension loop; Home recovery and safe intent/resume API | Full tactical/party/defeat mechanics, live content, complete progression/Legacy/setup and replay/crash drills |
| Inventory/crafting | Custody, quantity ledger, split/merge, trivial recipe batches, durable item locks, equipment snapshots, opt-in account binding and protected saved loadouts | Full profession/station/quality recipes, broader automation protection and capacity rules, derived equipment stats, remaining binding policies, durability, upgrades and commissions |
| Progression/Ascension | Reconciled XP history, pinned budgets, authored starting presets including Luck, explicit native class allocation, level-five subclass selection, authored feat/attribute milestones, run proficiency ranks, skill-rank feat/equipment gates and lifetime transition | Full class/subclass/feat gameplay, training/practice/check resolution, broader capability prerequisites, derived statistics, respec, special starts, mastery/Legacy, initiation eligibility, rewards and visible transition plan |
| Quest/world consequences | Identity, lifecycle and scope primitives | Validated graphs, NPC memory, faction/world consequences and campaign records |
| Dailies/effects | Rollover and worker primitives | Supervised scheduler/workers, banking, production and complete effect clocks |
| Shared launch systems | Guild/event/instance primitives | Permissions, markets, claims and the social/game modules included at launch |
| Supporter settlement | Currency definition | Verified receipts, idempotent grants, entitlements, reversals and reconciliation if purchases launch |
| Administration/retention | Audits and permission probes | Compensating repairs, account export/redaction and safe receipt/history/job retention |
| Availability/monitoring | Manually started local services | Reboot/restart supervision, patching, disk/lock/job/backup alerts and incident runbooks |
| Performance/failure drills | Focused invariant tests | Representative data volumes, query plans, connection budgets, crash/restart and restore drills |

## Execution order

The prerequisite pass (migration 020) enforces optional skill-rank gates on feats and all equipment sets, records immutable supporting rank evidence, and validates eventual prerequisite-family reachability. See [proficiency prerequisites](proficiency-requirements.md). Weapon/armor training tags, general capability expressions and rank-lowering respec remain future contracts.

The proficiency pass (migration 019) records explicit discovered skill advancements at authored committed-level milestones, reconciles the six-rank ladder to immutable history and resets run ranks at Ascension. See [proficiency persistence](proficiency-persistence.md). Starting packages, training/practice, checks, capability prerequisites, mastery and respec remain authored gameplay work.

The attribute pass (migration 018) journals earned point allocations independently from feats and starting presets, preserves growth at later native level-ups, and validates budgets, caps and capacity for remaining milestones. See [attribute milestones](attribute-milestones.md). Derived statistics, special-source bonuses, respec and path-specific growth remain authored gameplay work.

The feat pass (migration 017) persists discovered choices at authored committed-level milestones, checks native class and prior-feat prerequisites, limits short chains, and pins one feat schedule per run. See [feat persistence](feat-persistence.md). Effects, capability expressions, special sources, respec and the production catalog remain authored gameplay work.

The subclass pass (migration 016) records one discovered specialization per native class after level five, validates owner receipts and build-event evidence, and preserves history across Ascension. See [subclass persistence](subclass-persistence.md). The subclass catalog, initiation quests, feature grants and respec remain future authored work.

The class progression pass (migration 015) persists explicit authored starting presets and earned native class allocations, pins build and XP rules, and reconciles choices to immutable history. Existing builds remain LEGACY snapshots with unknown Luck; new runs start UNCONFIGURED. See [class progression](run-class-progression.md) for its deliberately limited gameplay contract and remaining launch work.

The XP pass (migration 014) preserves opening balances, commits authored encounter XP budgets, awards successful resolutions exactly once, and reconciles totals to immutable history. It exposes pending level readiness without committing classes/build choices or changing campaign state. See [encounter XP persistence](encounter-xp-persistence.md). Class allocation and starting Luck are implemented in migration 015. Non-encounter objective identities and mastery/Legacy remain launch work.

The loadout pass (migration 013) captures named current equipment setups, applies them through ordinary equipment legality, and protects referenced item identities until an explicit override or deletion. Templates and protection persist through storage and Ascension. See [saved equipment loadouts](saved-loadouts.md). Build/disguise templates and broader inventory automation remain launch work.

The binding pass (migration 012) makes selected version 2 gear account-bound when worn or placed in the active weapon set, with immutable history and original-loot reconciliation. Existing gear policies are preserved. See [permanent item binding](item-binding.md). Acquisition grants already support explicit account binding; challenge-path rules and combat-use binding remain future work.

The equipment pass (migration 011) adds immutable setup snapshots, worn slots and two prepared weapon sets. Equipped items require explicit unequipping before movement or consumption; Ascension clears the setup in its transaction. See [equipment persistence](equipment-persistence.md). Derived combat statistics, combat weapon-swap actions and additional binding policies remain separate release work.

The item protection pass (migration 010) adds explicit, auditable locks that block consumption, crafting and stack transfers at both service and SQL boundaries. Locks persist through storage and Ascension. See [item locks](item-locks.md). Saved equipment loadout protection is implemented in migration 013; broader automation protection and other destructive domains remain release work.

The routine crafting pass (migration 009) adds explicitly trivial zero-Turn processing with discovered, pinned recipes, player-selected current-run materials, binding inheritance and exact ledger-linked history. See [routine crafting](routine-crafting.md). It does not implement profession skills, stations, quality formulas or commissions.

The basic combat pass (migration 008) connects an explicit prototype duel ruleset to item/Gold rewards, capped Home recovery, campaign victory proof, authenticated intent/resume routes and Ascension. See [basic combat](basic-combat-loop.md). This exercises the complete persistence loop; it does not complete the final tactical engine or production balancing.

The authored item loot pass (migration 007) validates typed loot tables, commits hidden reward plans at encounter start and settles exact inventory grants with victory. See [authored item loot](authored-item-loot.md); combat still must establish victory before calling this internal service.

The encounter journal pass (migration 006) commits an ordinary solo encounter and its Turn cost together, stores server-only checkpoints and named RNG draws, and settles an outcome with domain rewards in one Action transaction. See [encounter persistence](encounter-persistence.md) for authority boundaries and the gameplay work still required.

The account/session pass (migration 005) adds credential storage, scope-checked sessions, password/recovery rotation, revocation race protection, suspension, security history and persistent throttles. The HTTP process uses allowlisted configuration and refuses administration/test secrets or an administrative SQL role. See [accounts and sessions](account-sessions.md) for private enrollment and the remaining identity requirements.

The inventory accounting pass (migration 004) adds immutable quantity operations, exact-snapshot typed grants, atomic consumption and conserving stack transfers. Opening balances preserve existing items; consumed identities retain history. Audit and restore checks now reconcile each item's quantity. See [inventory accounting](inventory-accounting.md) for evidence and the item rules still required at launch.

Deploy the integrity pass, then separate production runtime administration and implement real authentication. Establish independent automatic backups and recovery targets before inviting testers whose progress must be preserved. Build one complete encounter-to-reward-to-victory-to-Ascension loop, then add the remaining launch modules. Performance and disaster-recovery evidence are required before declaring the database release-ready.
