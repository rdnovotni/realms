# Database release readiness

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
| Typed content mechanics | Shared envelope only | Detailed schemas and semantic validators for every shipped content type |
| Complete gameplay persistence | Ordinary solo encounter journal, durable RNG, costs and atomic settlement | Authored combat/loot/defeat handlers, public projections and complete victory-to-Ascension loop |
| Inventory/crafting | Custody, ledger grants/consumption and split/merge | Authored recipes, protection/capacity rules, equipment, binding transitions, durability, upgrades and commissions |
| Progression/Ascension | Fields and lifetime transition | Builds, mastery/Legacy, eligibility, rewards, setup and visible transition plan |
| Quest/world consequences | Identity, lifecycle and scope primitives | Validated graphs, NPC memory, faction/world consequences and campaign records |
| Dailies/effects | Rollover and worker primitives | Supervised scheduler/workers, banking, production and complete effect clocks |
| Shared launch systems | Guild/event/instance primitives | Permissions, markets, claims and the social/game modules included at launch |
| Supporter settlement | Currency definition | Verified receipts, idempotent grants, entitlements, reversals and reconciliation if purchases launch |
| Administration/retention | Audits and permission probes | Compensating repairs, account export/redaction and safe receipt/history/job retention |
| Availability/monitoring | Manually started local services | Reboot/restart supervision, patching, disk/lock/job/backup alerts and incident runbooks |
| Performance/failure drills | Focused invariant tests | Representative data volumes, query plans, connection budgets, crash/restart and restore drills |

## Execution order

The encounter journal pass (migration 006) commits an ordinary solo encounter and its Turn cost together, stores server-only checkpoints and named RNG draws, and settles an outcome with domain rewards in one Action transaction. See [encounter persistence](encounter-persistence.md) for authority boundaries and the gameplay work still required.

The account/session pass (migration 005) adds credential storage, scope-checked sessions, password/recovery rotation, revocation race protection, suspension, security history and persistent throttles. The HTTP process uses allowlisted configuration and refuses administration/test secrets or an administrative SQL role. See [accounts and sessions](account-sessions.md) for private enrollment and the remaining identity requirements.

The inventory accounting pass (migration 004) adds immutable quantity operations, exact-snapshot typed grants, atomic consumption and conserving stack transfers. Opening balances preserve existing items; consumed identities retain history. Audit and restore checks now reconcile each item's quantity. See [inventory accounting](inventory-accounting.md) for evidence and the item rules still required at launch.

Deploy the integrity pass, then separate production runtime administration and implement real authentication. Establish independent automatic backups and recovery targets before inviting testers whose progress must be preserved. Build one complete encounter-to-reward-to-victory-to-Ascension loop, then add the remaining launch modules. Performance and disaster-recovery evidence are required before declaring the database release-ready.
