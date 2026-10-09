# Tactical round conditions

## Design grounding and scope

The uploaded core design bible and **Design Documents.zip** remain the design authority. System 04 §9 places secondary effects after attack connection; System 24 §5 separates authored Effect definitions from source-bearing runtime instances, §7 normally ticks round effects at the affected creature's turn end, and §8 requires explicit stacking and readable behavior. This batch implements that numeric tactical slice using existing `EFFECT` entities and immutable encounter journals.

Version-one supported effects modify **accuracy, evasion or armor**, apply on a connected attack to an active opposing target, and last for an authored number of that target's turn endings. A connected zero-damage hit still fires the on-hit trigger, including damage immunity. Damage resistance does not imply condition immunity. Misses, hits that incapacitate a target, healing and non-attack actions do not apply these effects. No additional action budget or random roll is introduced.

Version two adds [damage/healing over time](tactical-periodic-effects.md). Version three adds [typed cleansing counterplay](tactical-cleansing.md). This is not the universal effect engine: buildup/hard control, effect resistance, Remove Curse/persistent cleansing, auras, cross-encounter or Adventure-Turn clocks and other hooks remain open. Fixture amounts demonstrate execution and are not a balanced launch catalog.

## Authoring contract

An encounter opts in with `tacticalCombat.rules.roundEffects: {version: 1}`. Unopted encounters retain their original state/evidence shape and mechanics, even when source entities have optional effect grants. Existing BASIC_DUEL_V1 rules remain frozen.

An `EFFECT` entity supplies `mechanics.tacticalRoundEffect`:

```json
{
  "version": 1,
  "clock": "ROUNDS",
  "tick": "OWNER_END",
  "family": "exposed",
  "stacking": "REFRESH",
  "rounds": 2,
  "polarity": "HARMFUL",
  "tags": ["condition", "physical"],
  "modifiers": [{"stat": "armor", "amount": -4}]
}
```

Definitions require 1–100 rounds, 1–16 unique tags and one nonzero modifier per supported stat (maximum three). Modifier amounts are integers between -1000 and 1000. Polarity and tags are authored metadata; they do not silently grant extra rules. Unknown hooks, clocks and policies reject publication.

An owned native class, selected feat/subclass or active equipment source supplies `mechanics.tacticalOnHitEffects` alongside its existing `combatModifiers`:

```json
{"version": 1, "minimumNativeLevel": 1, "effectIds": ["effect.exposed"]}
```

NPC/monster templates with `tacticalUnit` can use the same grant, with minimumNativeLevel zero. Every referenced effect must be an `EFFECT` with a valid definition and an explicit dependency of the granting entity. Non-class sources require level zero; class gates must be reachable native levels. Borrowed levels, discovered-but-unselected abilities, carried/inactive gear and unowned sources do not qualify.

A grant has 1–8 unique effect IDs and no repeated family. A unit can receive at most 32 granted families; ambiguous selected sources granting the same family reject encounter start atomically, rather than depending on source iteration. All definitions within a release sharing a family must agree on its stacking policy.

## Lifetime, stacking and bounds

One active instance per family prevents repeated hits from accumulating hidden numeric stacks. **Replace** swaps the instance to the incoming definition, magnitude, duration and source. **Refresh** preserves the existing definition, magnitude and original source, and raises remaining duration to the larger of its current duration and the incoming authored duration. The latest refresh transition revision is retained. Differently named effects in a Refresh family therefore retain the first active instance's identity and strength; use separate families or Replace when that behavior is inappropriate.

Application snapshots retain the effect ID/revision, granting source ID/revision, equipment instance when applicable, source unit, original application transition revision, remaining duration, and definition. Ordered step evidence records application/replacement/refresh and tick/expiration events; the step's action receipt provides the owning action. Refresh events retain the original instance's provenance; the replayed attacking unit's pinned grants determine the incoming application.

Only an accepted `END` for the affected active creature decrements remaining rounds. Attacks, movement, guarding, healing, reconnect, retries and free reads do not advance the clock. Downed/Defeated creatures have no active turn; their conditions pause until a supported revival restores turns. Expired instances are removed at turn end. Conditions in terminal checkpoints remain immutable historical evidence, but the next encounter begins without them; only the existing health/mana recovery pools carry forward.

Effective stats sum each active family's modifiers once, then saturate accuracy/evasion to [-1000000,1000000] and armor to [0,1000000]. Base character/template stats remain unchanged. Armor modifiers apply before guard armor, penetration and typed resistance. Accuracy affects attack and retreat checks; evasion affects attacks against the creature. This batch does not alter initiative, action budgets, health/mana maxima or random damage bounds.

## Persistence, authority and visibility

Pinned release entries load effect definitions; immutable character source snapshots and pinned creature definitions select grants. Encounter initialization snapshots the resolved grants, and later publication cannot change an existing fight. The existing `tactical_encounter_origins`, `tactical_steps`, `encounter_records`, receipts and random-draw journals store every transition atomically. No migration or new runtime permissions are needed; migrations 001–023 remain unchanged.

The public API still accepts only actor/command/target choices. It rejects effect, magnitude, duration, source and roll injection. Owner views disclose active effect identity, tags/polarity, clock, stacking, remaining duration, modifiers and source unit, plus the party's available on-hit effects. Enemy grant lists, immutable source revisions, equipment identities and internal snapshots stay private.

Independent tactical replay rebuilds grants from pinned sources, reproduces applications and durations, and compares immutable effect events and complete states. Existing SQL constraints enforce consecutive immutable journals and coherent settlement; effect semantics are independently reconciled by replay. A privileged operator who bypasses immutability can corrupt data, and the audit reports the mismatch. Duplicate/stale requests, invalid intents and late failures retain existing transaction rollback and receipt replay behavior.

## Validation and remaining work

Focused scenarios exercise actual owned class/feat/gear and creature effects, effective attack changes, both stacking policies, owner-turn ticking, expiry, zero-damage connection, pinned publication, reconnect, concurrent retries, stale/illegal intents, late rollback, immutable-history corruption detection, source gates, inactive gear, ambiguity rejection, authenticated API boundaries, restricted runtime settlement and fresh encounters. The full regression also covers earlier unopted tactical history and basic campaign behavior.

Pass 1 remains open for broader authored abilities/checks, damage-family inheritance/conditional resistance, condition resistance, buildup/control, Remove Curse/persistent cleansing and other clocks, surprise/opportunity reactions, stabilization/resurrection, full failure/injury contracts and owned/shared participants. The remaining seven release passes and operational certification are unchanged.
