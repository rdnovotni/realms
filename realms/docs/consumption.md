# Food, booze, Tolerance and safe meal planning

[Documentation map](README.md) · [Turns and rollover](turns-rollover.md) · [Inventory services](inventory-services.md) · [Design coverage](../design/WORK_PLAN.md)

This slice implements the playable consumption framework from System 02. It does not publish a production food catalog. The design bible and immutable feature-index source remain the authority; the registry deliberately records partial coverage.

## Accomplished and remaining

| Design area | Implemented | Remaining boundary |
|---|---|---|
| Three daily tracks | Default Fullness 20, Drunkenness 15, Tolerance 10; server-owned item costs and Turn grants; no hunger decay | Reviewed production balance and catalog |
| Quality | Continuous diminishing Turn bonus, capped at 25%; Q200 cannot double Q100 | Crafting quality production, economic tuning and quality-specific authored side effects |
| Constitution | Release-pinned, monotonic capacity breakpoints, at most four additional capacity points in total | Constitution-based resistance to authored side effects; class/species derivation hooks |
| Food and preparations | Owned carried stock, exact one-item debit, bounded fullness/tolerance, shared-rule effects, no normal-rest tolerance reset | Special cleanses, addiction/withdrawal and content-specific incompatibilities |
| Booze and nightcaps | Explicit overdrink consent; ordinary positive-Turn adventures blocked; free management and bounded free encounters remain available; no generic pre-cap drunken penalty | Special Path/class exceptions and production nightcap balance |
| Onboarding reversal | One account-wide immediate reversal; restores one drink and previous shared status state, withdraws its Turn grant; retries return the original receipt | Extended grace periods are intentionally unsupported; any later committed action closes the offer |
| Rollover and Ascension | Immutable reset facts, per-track reset policy, encounter deferral, current counters carried across Ascension; account observations/presets/used reversal persist | Special Path rules require their owning release policy and workflow |
| Planning | Saved account presets, projected capacities/yields, reserved final manual nightcap; explicit preparation then bounded one-item steps; pause/stop and recorded stop reason | Studio editing and offline/background meal scheduling |
| Protection and discovery | Favorites, locks, collections, equipment/loadout protection and reservations checked again before every automatic debit; unknown, rare and manual-only items require attention; observed effects remembered | Full identification/crafting recipe unlock workflow belongs to discovery/crafting |
| Party/economy/events | Existing shared statuses and immutable inventory accounting are reused | Party feasts, tavern/restaurant services, trading, seasonal collections, supporter entitlements and monetization balance validation |

## Authoring and limits

`ITEM.definition.mechanics.itemUse` version 2 is a `USE` with no ordinary reward list and a required `consumption` object. Its shared-action effect list may be empty or reference validated shared effects. Version 1 remains unchanged. A consumption profile requires all of:

```json
{"version":1,"family":"FOOD","costs":{"fullness":5,"drunkenness":0,"tolerance":0},"turns":11,"quality":{"reference":100,"softness":100,"maximumBonusBps":2000},"automatic":true,"rare":false}
```

Families are FOOD, BOOZE, TOLERANCE and MEDICINE. The first three must charge their corresponding track. MEDICINE charges no capacity and grants no Turns, preventing disguised unlimited Turn generation. Costs and base yields are integers from zero through 1000. Final yield is `floor(base × (10000 + floor(maxBonusBps × extra / (softness + extra))) / 10000)`, where `extra=max(quality-reference,0)`. The bonus is at most 2500 basis points. This formula is mirrored in database validation.

At most one sealed `TUNING` entity may define `mechanics.consumptionPolicy`. Required version-1 fields are `capacities`, `constitutionBonuses`, `forbiddenFamilies`, `reset` and `allowNightcaps`. Defaults are 20/15/10, no bonus, no forbidden family, all tracks resetting and nightcaps allowed. Each configured breakpoint has `minimum`, `fullness`, `drunkenness`, `tolerance`; thresholds increase and bonuses cannot decrease. The highest qualifying breakpoint applies once, with total bonus at most four. Constitution comes from the run's core progression attributes; this is not a gear-derived side-effect resistance implementation. Runs retain their sealed release policy.

Use a shared status for buffs/debuffs; consumption does not invent a second clock. ADVENTURE_TURNS effects can survive rollover. Rollover-expiring effects follow existing shared rules. The undo ledger withdrawal is not adventure time and cannot advance those clocks. A reversal restores the pre-drink shared state immediately; discovery observations remain remembered.

## Player workflow and authority

Open **Turns → Food, drink & Tolerance** to inspect all capacities, reset/carry rules and carried consumables. Item review shows before/after costs and known Turn yield; unknown yields remain hidden until observed. Overdrinking requires an unchecked warning checkbox. The adventure list and global status explain when paid entry is blocked. An available immediate onboarding reversal has its own explicit confirmation.

Meal plans contain up to 20 distinct definitions and 100 total uses, with each quantity at most 20. A reserved BOOZE line must be last and quantity one. Preview excludes that nightcap from automatic totals and binds exact stock, protection, quality, effective policy and run/preset revision to a server token. Prepare does not consume anything. Run safe steps commits one item per idempotent Action, rechecking eligibility each time. A changed/deleted preset, protected item, missing stock, forbidden family, unknown/rare/manual-only item, capacity limit, encounter or rollover stops execution before the next debit. Nightcaps are always manual. Leaving the screen, pause, logout or an uncertain network result stops local repetition. Pending requests use the existing exact retry receipt; the client never guesses whether consumption occurred.

All write routes require GAME_WRITE, authenticated account ownership, current run/revision and the Action receipt pipeline. Read-only sessions can inspect permitted projections. Clients cannot supply authoritative yields, capacities, balances, effects or another owner's item. A pending rollover blocks consumption until catch-up. App and scheduler roles receive only the required append/select/projection privileges.

`consumption_events` is append-only: initial BASELINE, CONSUME, RESET and UNDO. Deferred checks reconcile the current projection, exact source inventory operation, signed Turn ledger leg and receipt. Existing balances receive an imported baseline during migration. New-life baselines must equal the parent's carried counters, including zero values. One UNDO per account and one RESET per run/epoch are enforced by unique indexes. `consumption_issues` feeds the integrity audit. Saved presets and preferences are account state; execution queues belong to a run and archive at Ascension. Normal rest never clears Tolerance.

## API

| Route | Purpose |
|---|---|
| GET `/api/v1/consumption` | Owner's capacities, policy, carried stock, saved plans, execution states and undo availability |
| Existing item-use preview/use routes | Quote and consume one item; optional `confirmOverdrink` is bound into commitment |
| POST `/api/v1/consumption/undo` | Reverse the immediately preceding eligible overdrink by `eventId` |
| POST `/api/v1/consumption/preferences` | Set owned `itemId`, `neverAuto` and `nightcap` |
| POST `/api/v1/consumption/meals/save` | Save by name with typed lines |
| POST `/api/v1/consumption/meals/delete` | Soft-delete owned `planId` |
| GET `/api/v1/consumption/meals/preview` | Read quote for `planId` and `expectedRevision` |
| POST `/api/v1/consumption/meals/start` | Prepare `planId` with preview `token` |
| POST `/api/v1/consumption/meals/step` | Commit at most one item for owned `executionId` |
| POST `/api/v1/consumption/meals/stop` | Stop owned `executionId` |

Write payloads also carry the common request ID, action type and expected revision envelope. Edge routes are explicitly allowlisted; unknown consumption subpaths remain private/unavailable.

## Validation and safe rollout

Migration 042 adds consumption evidence, saved plans, execution queues and item preferences. It preserves 001–041 checksums and existing counter values. No production schedule, game content, account credential or installed service is changed by this source work.

Run typecheck/build, unit and disposable-database integration suites, worker/runtime checks, integrity and foreign-key indexing checks, content/style/registry/docs gates, infrastructure tests and the packaged release checkpoint. Consumption tests cover duplicate receipts, invalid publication, quality, limits, unknown yield, effect observation, overdrink consent and rollback, account-wide undo across Ascension, shared status restoration, paid/free entry, runtime ownership, read-only devices, automation/protection and rollover. The synthetic `npm run preview:consumption` requires a disposable `realms_test` database and binds loopback port 3014; it never activates production content. Close it to remove its isolated schema.

Before approved staging adoption: retain a verified backup and image identity, rehearse 042 on representative retained/over-cap balances, apply the reviewed app/scheduler grants, check readiness/checksums and zero integrity issues, then test an owned consume/retry, waiting rollover and next-life carry. Separately review and publish actual consumable definitions/policies. Keep existing runs pinned; authoring/publication does not silently upgrade them. Production migration and deployment require operator approval under AGENTS.md.

Rollback is not a blind code revert: an old binary directly updates consumption during rollover and is incompatible with 042 evidence guards. Keep a compatible image or fix forward; use the reviewed isolated restore procedure if recovery is necessary, preserving later player actions. Do not drop evidence, disable guards or rewrite deployed migration checksums. Disable affected consumption/automation through reviewed controls while retaining records and investigating. Never run integration fixtures against a live database.
