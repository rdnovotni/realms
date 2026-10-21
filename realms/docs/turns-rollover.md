# Turns, rollover and daily planning

This source slice implements the reusable System 01 economy and player workflows in migrations 037–041. It does not activate a production schedule or publish a production activity catalog. The immutable source design remains in the [design registry](../design/README.md); the section assessments remain partial where other domains or authoring workflows are still required.

## Player workflow

Open **Turns** from any authenticated screen. The header always shows the current balance and announces waiting rollover. The planner provides:

- Current Turns, protected reserve and spendable balance; a server-checked reserve editor.
- The next global rollover in browser-local time, the schedule timezone, effective grant/cap, special run policy and active event additions.
- Pending catch-up, encounter deferral, overcap explanation, and fullness/drunkenness/tolerance reset information.
- Discovered daily sources, banked/current/maximum charges, next refresh, finite free-encounter sources and optional automatic collection after manual use.
- Known activities and Quick/Full Rest, full cost review, recovery preview and explicit commitment. Read-only sessions can inspect but cannot commit.
- Saved repeat plans with maximum Turns/actions, an optional HP floor and carried-item quantity target, start/stop controls and a persisted stop reason.
- Current-life gain/spend totals by category and paginated account Turn history, including earlier lives. Starting/carried Turns are not counted as new grants.

A reserve rejection rolls the entire attempted action back. The UI retains that one intent and offers **Confirm use of protected Turns** or **Keep my reserve**. Confirmation is part of the action fingerprint; it cannot be added to a previously committed request. Ambiguous replies retain one exact retry request and stop local repeating. Refresh, revoked sessions, stale revisions and a different run invalidate incompatible reads. Repeat drafts are local and never cross accounts.

## Accomplished and remaining matrix

| Design boundary | Implemented contract and evidence | Remaining owner/content work |
|---|---|---|
| Finite Turn commitment, §§5–6 | v1/v2 encounters retain exactly 1 Turn; opt-in v3 permits 0–10, charges entry once, retains failure cost and sealed loot proofs | Travel, extended jobs and other domain-specific choices must use the same commitment services |
| Baseline banking, §7 | `min(grant, max(0, cap-current))`; 280→380, 365→400, 427→427 under 100/400; bonus Turns survive above cap | Explicit production schedule selection and activation |
| Synchronized rollover, §§7/14 | Civil-time/DST scheduler; chronological account/epoch receipts; bounded catch-up; account then run locking; open encounters defer | Operational downtime/load rehearsal on staging |
| Banked dailies, §8 | Release-defined BANK/RESET refresh/cap; durable account balances, immutable events, charge exhaustion and SQL projection reconciliation | Actual prayer/training/Home/garden effects and catalogs belong to their systems; test sources are synthetic |
| Automatic collection, §8 | Discovery and prior manual use required; opt-in only; deterministic Turn-bonus sources only; reward/content disables retain charges | Item production requires its own capacity/custody settlement; no arbitrary checks or scripts run in the scheduler |
| Limited free sources, §9 | A discovered source charge is mandatory for 0-Turn v3 encounters and daily interactions/rests; sealed IDs/caps, observed uses and stored/refresh ceilings | Production global balance tuning and competitive tags across future systems |
| Planner/reserve, §§10/20 | Always-visible Turn button, local-time forecast, paginated ledger, preferences, charge balances, review and confirmation UI | Authoring Studio policy editor and cross-domain planner entries |
| Automation, §11 | Durable per-run budgets, max action count, reserve/HP/quantity stops, known-check requirement, failure/unavailability stops, exact retries | Automated encounter play intentionally stops for manual attention; future encounter/wanderer automation needs an owning visibility/stop contract |
| Quick/Full/free Rest, §12 | Paid rest is 1 Turn; free rest consumes a banked charge; authored recovery ratios, full-rest completeness, shared rest clocks, immutable HP/MP provenance and independent next-encounter replay | Housing bonuses, companion recovery and legacy duel rest integration remain with their owners |
| Events and run rules, §§13/16 | Release-pinned TUNING policy for grant/cap/weekdays/daily refresh; date-window EVENT baseline bonuses, included within soft cap; immutable effective-policy receipts | Active Path selection, borrowing future Turns and weekly-upfront entitlements require Path/weekly contracts; illustrative design Paths are not production catalogs |
| Ascension and edge cases, §14 | Remaining Turns, reserve, current-day consumption, daily charges/manual-use/autocollect state carry; old grants cannot be claimed again; stale/duplicate concurrent actions covered | New daily domains must register their own lifetimes and evidence |
| Group play, §15 | Existing consented shared encounter entry charges each participant through the same primitives; companions do not own a run Turn budget | Guild/Raid pooled budgets and their UI are separate domain work |
| Statistics, §17 | Auditable gains/spends by category, per-life free-source use counts, source ceilings and historical Turn changes | Leaderboards, full analytics export and run-completion aggregation belong to their owning services |
| Monetization, §18 | No purchase, exchange, premium-collection or player-selected grant endpoint is introduced | Continue the existing policy review as commerce is built |
| Authoring/interfaces, §§19/23 | Typed validation, immutable releases, cost previews, authority, scoped preferences, reset clocks, append-only ledgers and least-privilege grants | Studio forms and actual Food/Booze/Alchemical Load, Home, training, crafting, Guild and Path integrations |

The focused integration suite is `test/turn-planner.test.ts`; scheduler/DST, Ascension, encounter, loot, tactical/shared and historical-upgrade suites remain regression gates. Browser fixtures include planner normal, deferred rollover, confirmation, loading, error and read-only states in addition to existing screens. All 234 cases in the complete current-source matrix passed on October 21; see [visual QA](visual-qa.md) for its status and device limits.

## Authoring contracts

All definitions are immutable release entries. Clients submit an entity ID and current revision, never a cost, cap, healing amount, charge count or reward.

### Daily allowance

An ACTIVITY may define:

```json
{"dailyAllowance":{"version":1,"refresh":1,"capacity":3,"banking":"BANK","turnBonus":5,"autoCollect":true}}
```

`BANK` adds up to capacity; `RESET` replaces with the daily refresh. At most 128 daily sources per release; refresh/cap are 1–1000, refresh cannot exceed cap, and a bonus is 0–10000 per charge. Every source is independently measurable. First manual use can open its current-day starting allowance once; subsequent uses and Ascension cannot reopen it. Existing due rollover must be settled before a charge can be consumed. Source discovery after an epoch does not retroactively accrue that epoch.

A daily `sharedAction` must be INTERACTION, cost 0 Turns, have no direct `turnBonus`, and cannot opt into scheduler collection. The charge itself makes a `PAID` retry finite; ordinary uncharged free retry rejection remains intact. Existing checks, prerequisites, effects, resources and rewards still run through shared services. Manual-use unlocking is based on the recorded authorization source, not automated plan use.

A source with `freeEncounterSource: true` has no shared action, bonus or automatic collection. A v3 encounter refers to it with `freeSource`, declares it in dependencies and costs 0. One charge commits atomically with the encounter and its zero-delta Turn entry. Failure may still incur the displayed recovery cost. Removing or exhausting the source never silently converts the fight to paid entry.

### Rest

A rest ACTIVITY combines an automatic-success shared action with `costs.rest` equal to `REST` or `FULL_REST` and `turnRest: {"version":1,"healthBps":2500,"manaBps":2500}`. Paid rest costs exactly 1 Turn; a daily rest costs 0 plus a charge. Full Rest requires both ratios to be 10000. Recovery uses the last settled tactical encounter's pinned maximums, is capped at those maximums and cannot occur inside an active instance. No available health pool or already-full pools reject without a charge, Turn or clock change.

The rest journal pins prior recovery/rest, source/release/revision, action, before/after values and maximums. The next solo/shared encounter pins the intervening rest ID. SQL checks and independent replay reject unattested healing. Rest clocks advance through existing shared-rule events. Housing/companion/legacy duel healing is not inferred from this contract.

### Rollover policy and events

One TUNING entry per release may define:

```json
{"turnPolicy":{"version":1,"baselineTurns":100,"softCap":400,"baselineWeekdays":[0,1,2,3,4,5,6],"dailyRefresh":true}}
```

Weekdays use the global schedule's civil date (Sunday 0). An empty weekday list suspends baseline grants. `dailyRefresh` separately controls banked-source refresh; ordinary consumption/effect rollover still uses the global boundary. Without this opt-in, existing runs retain the explicit scheduler grant/cap. No release is silently given a new policy.

An EVENT can add `rolloverBonus: {"version":1,"starts":"2026-10-23","ends":"2026-10-25","baselineTurns":20}`. Dates are inclusive civil dates; the additional baseline remains subject to the effective soft cap. At most 128 such definitions exist per release. Every new rollover with a sealed release records its effective policy and active event pins. This supports special run variants without inventing an active Path selection system or rewriting historical receipts.

## API and permissions

All endpoints require account authentication. GET `/api/v1/turns?expectedRevision=N&historyBefore=ID` is read-only, discovery-filtered, no-store and bounded. `expectedRevision` prevents mixed views; the optional ledger cursor returns older account-owned history only. Activities/targets are bounded to 100, plans to 20 with all active plans prioritized, and history to 50 rows per page.

POST endpoints use the existing `{requestId,actionType,expectedRevision}` envelope:

| Endpoint | Action and parameters |
|---|---|
| `/api/v1/turns/reserve` | `SET_TURN_RESERVE`, `reserve` (0–1000000) |
| `/api/v1/turns/rollover` | `APPLY_ROLLOVER`; up to 32 due epochs, no open-encounter refill |
| `/api/v1/turns/daily/use` | `USE_DAILY_ALLOWANCE`, `entityId`; deterministic bonus sources only |
| `/api/v1/turns/daily/auto-collect` | `SET_DAILY_AUTO_COLLECT`, `entityId`, `enabled` |
| `/api/v1/turns/plans` | `CREATE_TURN_PLAN`, `entityId`, `maxTurns` (0–1000), `maxActions` (1–1000), `minHealth`, optional paired `targetItemId`/`targetQuantity` |
| `/api/v1/turns/plans/step` | `STEP_TURN_PLAN`, `planId`; server forces AUTOMATION authorization |
| `/api/v1/turns/plans/stop` | `STOP_TURN_PLAN`, `planId` |

Shared activities/rests continue through `/api/v1/rules/:entityId` preview and `/api/v1/rules/interaction`. A manual `confirmReserve: true` is accepted by normal domain envelopes and bound to that request fingerprint. Automated spending needs an internal persisted-plan authorization and cannot use manual confirmation. No API permits the caller to choose permanent economic results.

The scheduler gets read access to sealed definitions/discoveries, allowance projection writes and immutable grant events. A parsed SQL SECURITY DEFINER function can lock an account in action lock order; the role receives no account UPDATE, wallet, session or credential privileges. New allowance/grant views reconcile ownership, source pins, manual-use counts, automatic-collection preferences and bonus ledger legs. Runtime readiness includes these mismatches in the existing integrity report.

## Validation and safe rollout

Run the contributor type, unit, integration, worker/runtime, content, registry, documentation and visual checks. `preview:turns` requires `TEST_DATABASE_URL` naming exactly `realms_test`; it creates/drops an isolated random schema and listens only on 127.0.0.1:3013 with an explicitly synthetic token. It is not a production enrollment or migration tool.

Release adoption remains separate from source changes. Before deployment: back up and restore-rehearse the database, test migrations 037–041 and role grants on staging, review a small policy/activity package, exercise catch-up/Ascension/rest/replay with a restricted scheduler and verify the exact image/source receipt. Configure the chosen global schedule explicitly; migrations do not enable one or publish content. Do not rewrite old migration checksums.

Rollback is a reviewed compatible binary or a rehearsed database restore, not deletion of journals or an in-place down migration. Once rest evidence exists, an older binary that cannot pin rest IDs will fail closed on affected encounter starts. Emergency action/content controls can stop new work while preserving inspection and exact receipt replay; preserve immutable evidence and use a compatible roll-forward fix. Production activation and restoration require operator approval under repository instructions.
