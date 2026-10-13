# Authored tactical damage traits

The next Pass 1 batch connects the existing damage evaluator to pinned tactical content. An encounter explicitly opts in to typed attacks, armor penetration and damage resistance. Existing untyped tactical origins and steps keep exactly the same state/evidence shape and zero penetration/resistance; BASIC_DUEL_V1 is unchanged. Migrations 001–022 remain frozen. Existing immutable JSON origins/steps and character source revision pins retain all required evidence, so this batch needs no schema migration.

## Design basis and scope

The supplied core bible §12, System 04 §10–11, and System 24 §15 specify armor penetration separately from typed damage resistance, an expandable mechanically useful vocabulary, and separate damage/status resistance. The master feature index corroborates those requirements. The reviewed HTML mirrors match the uploaded Design Documents ZIP byte for byte; the standalone core upload also matches. These references are kept outside the repository.

The bibles defer final numbers and stacking formulas. This implementation provides an explicit opt-in `SUM_CAPPED` authoring policy, not a production balance decision. Damage and status resistance remain distinct; fire damage immunity never implies immunity to Burning. No launch damage catalog or status rules are invented.

## Authored contracts

An encounter's `tacticalCombat.rules.typedDamage` contains:

```json
{
  "version": 1,
  "types": ["slashing", "fire", "cold"],
  "defaultType": "slashing",
  "resistanceStacking": "SUM_CAPPED"
}
```

Types are bounded identifiers, with 1–32 unique types per encounter profile. The default must be declared. This is a per-profile bound rather than a global catalog limit.

Native CLASS, selected feat/subclass ABILITY and equipped ITEM sources may declare `mechanics.tacticalDamageTraits`. They must also declare `combatModifiers` so the existing independently verified character snapshot includes the source identity/revision and distinct active item instance. Class gates use committed native levels; selected abilities/items must use zero. Prepared inactive items never contribute.

```json
{
  "version": 1,
  "minimumNativeLevel": 0,
  "attackType": "fire",
  "penetration": 2,
  "resistances": { "fire": 5000, "cold": -2500 }
}
```

At least one trait is required. Penetration is an integer 0–1,000,000; each resistance is an integer basis-point value from −10,000 to 10,000. Templates may use the same traits under `tacticalUnit.damageTraits`, with a zero native-level gate. Creature vocabularies are checked against encounters at publication. Owned source vocabularies are checked against the selected encounter at start, including locked traits; unknown types reject the whole start transaction.

Contributions sum penetration and per-type resistance. Resistance sums are capped once, after all eligible contributions, to the evaluator's existing vulnerability/immunity bounds. Excessive total penetration rejects. Attack type replaces the encounter default only when eligible sources agree on one replacement. Conflicting replacements reject atomically instead of choosing by source order. These are fixed encounter-start traits; conditional abilities and midfight equipment swaps require later contracts.

## Execution, persistence and visibility

The loader derives the hero's profile from immutable character-source revisions and native-level evidence, and derives allies/enemies from the run's sealed release. Profiles enter the immutable origin and checkpoint. Attacks use the actor's type/penetration and the target's matching resistance. Guard armor enters before penetration, followed by resistance, floor rounding and the existing connected-damage policy. Immunity overrides chip damage; misses still deal zero. Enemy turns use the same pipeline.

Attack steps record their damage type alongside existing roll/mitigation evidence. The independent audit reconstructs profiles from pinned content and replays every step, detecting modified profiles or damage-type evidence. Later content publication cannot change saved profiles. Duplicate requests, reward/failure settlement and rollback use existing transaction boundaries.

Owner views expose party damage profiles. Enemy numeric defense, source definitions, seeds, random draws and internal evidence remain hidden. Learned enemy resistance labels and advanced codex views require their own discovery contract.

## Validation and remaining work

Type checking, build and all 38 unit tests passed. Database coverage verifies all 233 integration scenarios: 216 other scenarios passed in the full regression run, and all 17 tactical scenarios passed after correcting the new enemy-target test fixture. The published GitHub workflow repeats the full suite. An independent comparison against merged main also passed 539 exact untyped state/evidence comparisons. New tests cover pinned-source traits, duplicate actions, enemy damage, replay corruption, native gates and atomic conflicting-type rejection.

Pass 1 remains open for broader authored abilities/check integration, conditions/stacking/expiration, damage-family inheritance, resistance reduction/immunity bypass, surprise/opportunity reactions, stabilization/resurrection, injury/failure contracts and owned/shared participants. The vocabulary and trait fixtures are development examples, not final release tuning or content.

Authored [tactical campaign proofs](tactical-campaign-proofs.md) subsequently close the final-victory-to-Aftercore boundary.
