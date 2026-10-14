# Shared rules, clocks and prerequisite services

The reusable services live in `src/rules/`. New authored actions use immutable `mechanics.sharedAction` version 1 and check version 2. Existing D20_CHECK_V1, basic/tactical combat versions and their historical journals keep their exact math. The existing combat import now delegates its unchanged v1 check implementation to `rules/legacy-checks.ts`; its round countdown delegates to the common clock primitive. Native class choice, equipment, recipe and encounter boundaries also enforce the same structured prerequisite service.

The concrete integration proof is `shared-rules-integration.test.ts`: a noncombat ACTIVITY pays resource/Turn/world-time costs, receives a sourced item/Gold/knowledge reward and applies Focus. An ENCOUNTER then uses the same prerequisite/check/effect/cost/reward services and receives Focus's check modifier. Both use the existing Action transaction, receipt, inventory and conserved transfer infrastructure. Parallel identical requests settle once; failed costs roll back the encounter, clocks and rewards together. These are small engineering fixtures, not a campaign/content catalog. The opted-in combat adapter is an atomic check encounter, not a replacement for the tactical UI or old tactical engine.

## Checks and capabilities

Check v2 declares attribute/skill, rank gates, six rank bonuses, difficulty, partial/exceptional/critical-failure margins, natural shifts, automatic/impossible outcomes, active/passive mode and visibility. Advantage/disadvantage uses exactly two d20s or cancellation to one. Probability enumerates the same resolver (20 or 400 outcomes). Impossible/ineligible actions receive no fake natural-20 rescue. Luck is used only when explicitly selected as the check attribute. Contests favor the defender on ties by default; group primitives provide Best, Leader+bounded Assist, Majority, Cumulative and Weakest modes. Group/companion selection UI remains with the owning domains.

Inputs come from owned progression, earned skill/class rows, knowledge, carried items, quests and server controls. HTTP accepts entity ID and the normal authenticated Action envelope, never stats, rolls, rewards or arbitrary effect state. The shared engine persists server seed and exact check inputs privately; the test independently reproduces rolls/results. Capability disables beat enables. Unknown facts remain unknown even under NOT, so missing gates cannot accidentally authorize an action.

Prerequisites are bounded ALL/ANY/NOT trees with typed FACT comparisons EQ/GTE/LTE. Validation limits depth, node count and references. The same `mechanics.prerequisite` can gate CLASS, ITEM, RECIPE, NPC dialogue, ROUTE travel, QUEST, ACTIVITY, ENCOUNTER and ABILITY definitions. NPC/ROUTE/QUEST definitions can use the shared interaction adapter; this does not invent a complete dialogue graph, travel engine or quest journal. Referenced class/skill/item/quest/knowledge IDs must be declared dependencies. Unknown flag/capability values fail closed.

Retry contracts are NEVER, STATE_CHANGED, AFTER_TIME and PAID. Changed-state fingerprints include only authored prerequisite and check inputs; unrelated discovery, free navigation and a new request ID do not earn a reroll. AFTER_TIME uses in-game world minutes. PAID requires a positive Turn, Gold or resource cost. The new request still validates eligibility/resources and commits failed mechanical outcomes with their costs. Technical failure rolls everything back. Exact receipt replay precedes all new flag, revision and eligibility checks.

## Typed rules and explanation

`modifiers.ts` supplies BASE → GLOBAL → RUN_MODE → PATH → INSTANCE → EXPLICIT precedence with ADD, MULTIPLY (basis points), OVERRIDE, CAP, FLOOR, ENABLE and DISABLE operations. Conflicting equal-priority overrides and unsafe numeric results are rejected. Checks use this resolver for contributions. Domains must explicitly declare new modifier keys and conversions; there are no arbitrary callbacks or implicit universal Luck/gear bonuses.

GET `/api/v1/rules/:entityId` provides a coherent, read-only, discovered-action preview: current eligibility/retry reason, cost breakdown, known difficulty/chance/contributions and replacement/stacking events. Unidentified effect sources are masked. Hidden checks omit their numeric breakdown. POST `/api/v1/rules/combat` or `/api/v1/rules/interaction` commits the corresponding discovered authored intent. It repeats validation under locks; preview availability is not authorization. Both mutation routes are server authenticated and support standard uncertain-response retries. No new production definitions are added to the game catalog, so the ordinary tactical client remains unchanged.

## Complete clock vocabulary

| Clock | Authoritative advancement | Logout/free administration |
|---|---|---|
| ROUNDS | Affected actor's round-end event; the atomic combat adapter contributes one round | Never advances |
| ENCOUNTERS | Terminal encounter journal, including failed-forward/retreat completion | Never advances |
| ADVENTURE_TURNS | Actual negative Turn-ledger deltas, including paid costs | Never advances |
| WORLD_TIME | Authored in-game minute costs in canonical progression | Never follows wall time |
| REST | Authored rest completion; Full Rest also advances Rest | Never advances |
| FULL_REST | Explicit full-rest completion | Never advances |
| ROLLOVER | Applied due rollover receipt, not a client date | Epoch processing is separate |
| UNTIL_CLEANSED | Matching authorized removal | No passive decay |
| CONDITIONAL | Typed authoritative prerequisite stops holding | Reconciled before dependent checks |
| RUN | Owner lifetime/Ascension; state/history archives and next life starts fresh | No passive decay |
| REAL_TIME | Explicit server timestamp, only SHARED_INSTANCE or LIVE_EVENT_WINDOW deadline markers | May expire; cannot carry numeric/capability modifiers or triggers |

Persistent shared effects store absolute clock boundaries with pinned definitions/source/application. Ledger/rollover/world-time advancement is read from authority; expiration reconciles before dependent checks. Expiration-trigger children on finite clocks must use the same clock, so delayed reconciliation starts them at the original boundary and cannot extend a buff by avoiding the shared action UI. Round conditions terminate with their encounter. Pure clock/effect services accept owner-specific counters for tactical/other domain adapters; historical tactical versions are not retroactively reinterpreted.

## Effects and rewards

The shared effect layer supports Replace, Refresh, Extend, Intensity, Stacks, Strongest, Independent and Exclusive families. Authored maximum duration, magnitude, stacks and active-instance limits are enforced. Refresh preserves original source; Replace records removal/application; Strongest/Exclusive can block application. Current family contributions have explicit provenance; immutable base facts are never overwritten.

CLEANSE, DISPEL, CURE and REMOVE_CURSE remain distinct and require sufficient power plus matching tags. Conditional, timed and explicit removal emit events. APPLY/EXPIRE/REMOVE triggers can apply pinned effect definitions only, with cycle/depth validation, per-root deduplication, active-instance and event budgets. They cannot directly mint items/currency, call arbitrary code or mutate another owner's state. Existing tactical damage/heal/status/buildup/cleanse rules remain in their pinned adapters rather than getting a changed historical interpretation.

Shared cost plans declare Turns, world minutes, Gold, resource-pool amounts and explicit rest completion. Reward plans declare bounded ITEM/GOLD/KNOWLEDGE grants after successful resolution. Items use quantity-operation provenance, Gold uses conserved transfers from the uniquely configured world faucet, and knowledge retains first-run attribution without downgrading Advanced knowledge. Missing/ambiguous faucets fail closed. Failed checks still pay declared costs; partial success grants no success reward unless a future version explicitly defines a partial plan. Existing encounter XP/loot plans remain authoritative, including authored `resolutionXP`; the shared combat adapter uses the ordinary encounter journal and therefore inherits those XP checks. No unjournaled generic XP/Mastery faucet is introduced.

## Release compatibility and controls

`release_adoptions` is administration-only. It requires a sealed supported engine (`foundation-1`) and a review reason; changes are audited. `initialRunRelease` validates reviewed first-life selection. Ascension optionally accepts `nextReleaseId`; GET Ascension preview binds that choice into its keyed confirmation token. Existing runs, instances, source revisions and manifests remain pinned in SQL. PIN_EXISTING approves new first lives only; RETAIN_IDENTICAL permits a new life with retained custody only when the target includes every old release entry at the identical revision. This conservative superset rule rejects mechanical reinterpretation or removed dependencies. New definitions may be added. Breaking changes, forced hotfix migrations, broader mode selection and bounded multi-engine support require a separate reviewed migration.

Flags use RELEASE, CONTENT, SAFETY, EXPERIMENT, ELIGIBILITY and CHALLENGE taxonomies. Cohorts are deterministic per account/key and allowed only for Release/Experiment entry rollout. Eligibility/challenge expressions refer to server facts; they do not silently change a resolved roll. Runtime can inspect controls but cannot update them. Parsed SECURITY DEFINER read-lock functions let Actions hold coherent control/policy reads without granting runtime UPDATE on those tables. Operator changes record role, reason and before/after state; removal of audit history is denied.

`actions.global` and `action.ACTION_TYPE` gate new Actions. DRAIN permits existing basic/tactical combat settlement and shared-session claims/cancellation, but blocks new starts. DISABLED blocks all new mutations; queries and matching committed receipts remain available. `shared.rules` starts DISABLED until reviewed activation. `content.entity.id` gates encounters/shared interactions and `rewards.global` / `reward.source.id` gate the shared faucet. The same global reward gate also protects existing item mints, faucet currency legs and victorious encounter settlement; source-specific shared gates do not reinterpret old reward plans. These checks use the database authority, not cache. A running synchronous transaction may finish before a disable acquires its control lock; after the control change commits, subsequent checked Actions observe it. No automatic refunds, rewinds, deletions or historical re-execution occur.

## Operations and verification

Migration 031 and corresponding runtime grants are source-only in this task. Test/schema migration is disposable; no staging/production migration or service activation is authorized by a source merge. Follow the staging/manual-play/approval workflow before a live rollout. Runtime grants add shared event/state writes only; feature controls/adoption policies stay administration-only.

```sh
cd realms
npm run typecheck
npm test
# TEST_DATABASE_URL must point at the separate realms_test database.
node --env-file=.env --import tsx --test test/shared-rules.test.ts test/shared-rules-integration.test.ts
npm run test:integration
npm run test:workers
npm run test:runtime
npm run content:check
npm run features:check
npm run build
```

In an administration transaction, use `setFeatureControl(client, 'shared.rules', 'RELEASE', 'ENABLED', 'review/ticket reason')` to activate reviewed fixtures/content, or DISABLED to stop entry. Use `approveNewRunRelease` for reviewed adoption; setting `new_runs=false` withdraws adoption without changing existing runs. The normal application role cannot invoke an administrative write successfully. No public admin endpoint is exposed.

Before applying 031, retain the pre-migration backup and matching source checkpoint. To withdraw this feature, disable `shared.rules` (or the affected source/action/reward control), preserve history and roll forward with a reviewed fix. A source revert after migration does not restore schema/checkpoint parity; restore the reviewed pre-migration backup only in the isolated rollback workflow. The native lifetime manifest now enumerates 463 fields across 61 owned/control/history tables. This foundation completion is not a claim that Systems 23/24/29/45/46 or their complete game/Studio workflows are finished.
