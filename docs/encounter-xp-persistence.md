# Encounter XP persistence

Migration 014 adds `run_xp_baselines`, `encounter_xp_plans` and `run_xp_awards`. It preserves all existing XP as an immutable `MIGRATION_014` opening balance; it does not invent past awards. Newly inserted progression starts at zero with a `NEW_RUN` baseline. Existing migrations remain frozen.

## Authored opt-in contract

A TUNING entity can declare `mechanics.xpCurve`:

```json
{"version":1,"thresholds":["0","100","250"]}
```

This shortened illustration is not a publishable curve: publication requires 25–999 strictly increasing cumulative thresholds, beginning at zero for level 1. XP values are canonical decimal strings bounded by PostgreSQL signed bigint. Coefficients are authored data; no production balance curve is selected in this pass.

An ENCOUNTER with a valid ordinary `mechanics.encounter` may declare:

```json
{"resolutionXP":{"version":1,"amount":"250","curveId":"curve.core"}}
```

The named TUNING entity must be an explicit dependency in the same content package and contain a valid curve. The run's pinned release selects both encounter and curve revisions. Its first opted-in encounter pins that run to one curve identity/revision; subsequent encounters cannot switch it. A legacy committed level incompatible with the curve is rejected rather than rewritten. Other content keeps its current no-XP behavior.

## Transaction and authority

Encounter journal insertion automatically records the authored budget at the SQL boundary. Budget history is immutable. Successful `VICTORY` resolution automatically appends the exact award and increases the XP projection inside the same transaction as outcome, domain settlement, receipt, inventory, Gold and campaign proof. A failure anywhere rolls back all of them; signed-bigint overflow leaves the encounter unresolved.

The encounter occurrence ID is the unique award identity. Retrying a request returns its prior receipt. A second request or alternate resolution attempt on that same encounter cannot pay it again. Distinct authorized repeatable encounters receive distinct budgets. This supports internal noncombat handlers that use the same successful-resolution journal; it does not create playable diplomacy/stealth handlers or cross-encounter quest/objective deduplication. Those owning domains must identify their shared obstacles before they ship.

Defeat, retreat, surrender and failed-forward award no XP under this contract and do not subtract earned XP. SQL rejects projection divergence, mismatched/open-encounter awards, rewritten history and nonzero starting XP. The immutable opening balance plus award sum must equal current XP at commit. Audit and restored-backup checks use the same reconciliation view.

Only server gameplay handlers decide successful outcomes. There is no public XP amount, resolution assertion or award-write API. Runtime may append the trigger-owned history but cannot update or delete it. SQL functions use caller privileges; they introduce no administration capability.

## Readiness and Ascension

`GET /api/v1/progression` returns the authenticated account's current run, revision, campaign state, XP, committed level, pinned curve identity/revision and readiness. Before an XP curve is pinned, curve/readiness fields are null. XP totals remain strings; readiness reports `readyThroughLevel`, `pendingLevels` and the next unearned threshold. The response excludes award payloads, hidden encounter state and content definitions. Scoped read-only sessions may read it.

Readiness does not select classes/feats/attributes, raise committed level, change equipment eligibility or complete the campaign. Level 25 does not trigger Ascension. XP above an authored curve's cap remains recorded without extrapolating levels. Ascension retains the old run's baseline and awards and opens zero XP in the new run, which pins its own curve when its first XP-bearing encounter starts.

## Remaining progression release work

Authored starting rules including Luck; class allocation and class-level sums; safe level decisions and milestone choices; subclasses, feats and proficiencies; challenge-path starting rules; mastery, Legacy and respecs; non-encounter reward identities; a visible Ascension plan; production curves and balance simulations. See [progression persistence plan](progression-persistence-plan.md). Existing level fields still belong to the initial foundation; this pass does not implement a level-commitment ledger.
