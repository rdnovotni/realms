# Character mechanics evaluation contracts

Release pass 1 introduces versioned numerical evaluators and immutable character snapshots validated at content publication and encounter start. Migration 021 adds one snapshot table with indexed references to pinned content, build, attribute and equipment evidence. Historical encounters receive no fabricated snapshots. BASIC_DUEL_V1 retains its behavior. Migration 022 now connects these snapshots to the [saved tactical loop](tactical-engine.md); broader Pass 1 mechanics remain open.

## Passive contributions

`mechanics.combatModifiers` may appear on a typed native CLASS, selected feat/subclass ABILITY, or equippable ITEM. Version 1 has 1–32 additive entries containing `stat`, integer `amount`, and `minimumNativeLevel`. Supported stats are maxHealth, maxMana, accuracy, evasion, armor, initiative, attackMin and attackMax. Class gates must be reachable within native-level limits; item and selected-ability gates must be zero.

`deriveCharacterStats` returns totals and entity/revision/instance attribution for each applied contribution. Distinct item instances contribute separately; duplicate source identities reject, preventing a two-handed item from counting once per occupied hand. Invalid final totals reject without hidden clamping. Input objects are preserved.

Authority boundary: the pure evaluator accepts internal inputs. The transactional snapshot loader selects the owned native classes, selected feats/subclasses and distinct worn/active-set item instances from the run's pinned release. Inactive prepared weapons do not contribute. Base stats and source lists never come from a client payload. Owned healing and guard capabilities now execute through tacticalKit source pins. [Typed damage traits](tactical-typed-damage.md) now derive owned encounter-start offense and resistance with an explicitly authored sum-and-cap policy. Conditional passives and the broader ability library remain work.

## Authored profiles and encounter snapshots

TUNING `mechanics.characterProfile` declares CHARACTER_STATS_V1, matching `buildRulesId`, a complete base stat block and up to 32 attribute scaling terms. Each term adds floor((current attribute − baseline) / divisor) × amount to its target stat. Current attributes include committed milestone growth. Each contribution records the rule, score and computed amount.

An ENCOUNTER opts in with `mechanics.characterProfileId` and a declared dependency. It cannot combine that profile with the basic duel declaration. Normal configured STANDARD/CASUAL builds are required; legacy and unconfigured runs remain on ordinary encounter behavior.

`beginEncounter` automatically captures an opted-in snapshot inside its owning Action transaction. SQL independently selects the same current inputs and recomputes the integer totals before accepting the record. The profile's build policy must match the committed build. Foreign-run, late, unrequested, forged-input and forged-total snapshot inserts reject. A deferred constraint prevents an opted-in encounter from committing without a snapshot. The run's ordinary receipt and revision rules make duplicate starts replay exactly once.

Snapshot history is immutable. Indexed foreign keys retain the profile revision and the contributing build/attribute/equipment events. Checkpoint updates and later class choices, subclasses, equipment changes or newer publications cannot alter old snapshots. Internal reads recompute the saved evidence and reject disagreement. Restore/read-only audits independently replay derived totals in bounded batches and reconcile pinned definitions, profile/run ownership and historical selection evidence. Raw snapshot inputs and mechanics are internal server data, with no new public endpoint.

## Checks

TUNING `mechanics.checkRules` declares D20_CHECK_V1. Attribute contribution is floor((score − authored baseline) / authored divisor). Proficiency contributes rank × authored per-rank bonus. Total is roll + attribute + proficiency + server-derived situational modifier. The ordinary result succeeds at or above DC. Natural-20 success and natural-1 failure are independently authored exceptions; natural 1 is not universally an automatic miss.

Results expose the roll, contributions, total, DC, margin and override. `checkSuccessChance` enumerates all twenty rolls with identical rules and returns an exact rational chance. Numeric ranks 0–5 match UNTRAINED through LEGENDARY. This evaluator does not award training or practice.

## Attack resolution

TUNING `mechanics.damageRules` declares TACTICAL_DAMAGE_V1 with nested check rules, an explicit natural-20 critical policy, a critical multiplier in basis points, and minimum connected damage of zero or one.

Resolution checks connection, applies any critical multiplier to raw damage, subtracts armor after penetration, then applies typed resistance/vulnerability. Resistance ranges from −10000 (double damage) to 10000 (immunity). Full immunity overrides minimum damage. Misses deal zero. Intermediate integer rounding uses floor. The caller selects the resistance for the authored damage type; this evaluator does not infer types, execute statuses or consume actions.

These are configurable contracts, not production balance. Rolls and raw damage must come from the existing encounter journal with stable draw keys. Evaluators do not generate randomness. Pinned start snapshots and immutable action evidence are required before live integration.

## Remaining acceptance work

The tactical loop now implements replayable history, actors, initiative, action budgets, zones, basic healing/guard, Downed/Defeated/revival and reward/recovery settlement through authenticated intent-only APIs. Complete the broader authored ability/check, resistance/condition and failure/injury systems. Prepared-set changes during tactical combat need a versioned snapshot policy for both sets and their Quick-action costs. Current snapshots freeze the starting active set.

See [the eight-pass plan](eight-pass-release-plan.md). These supporting evaluators alone do not complete pass 1.

## Validation of this increment

At the migration 021 snapshot milestone, the suite passed 26 unit and 215 database integration tests (241 total), including 15 focused evaluator tests and 12 focused snapshot tests. Type checks, build and whitespace checks passed. Snapshot cases cover current attribute growth, selected class/feat/subclass sources, worn versus active/prepared equipment, duplicate starts, immutable history, forged evidence, foreign-run access, rollback, pinned publications, least-privilege runtime writes, migration preservation, missing snapshots and invalid scaled totals.

The verified snapshot foundation is applied to the private loopback server. Full hashes confirmed that every pre-existing game table was preserved exactly, and no historical snapshots were fabricated. Runtime privileges, authenticated reads, unauthenticated denial, all integrity checks and foreign-key index coverage passed. The post-upgrade backup restored successfully with 81 tables and matching migration checksums. Migration 021 is now applied and must remain unchanged; subsequent schema fixes or extensions require a new migration. The subsequent tactical milestone and remaining Pass 1 gates are documented in [saved tactical combat](tactical-engine.md). This snapshot evidence alone does not certify tactical execution or public release.
