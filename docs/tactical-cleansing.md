# Tactical cleansing counterplay

## Design grounding and scope

The uploaded core design bible and **Design Documents.zip** remain authoritative. System 24 §17 distinguishes Cleanse (harmful/bodily effects), Dispel (magical/supernatural effects, including enemy buffs), Cure (disease/poison) and Remove Curse. It permits tag-driven deterministic strength comparisons and limited player-selected removal. §§5–8 preserve authored definitions, source-bearing instances and explicit clocks.

This batch implements encounter-local Cleanse, Dispel and Cure through the existing EFFECT content and immutable tactical journals. It adds no migration or runtime permission. Migrations 001–023 remain frozen. Fixture abilities demonstrate execution; their numbers are not a balanced launch catalog.

## Authoring contract

An encounter opts in with `tacticalCombat.rules.roundEffects: {version: 3}`. Version three supports existing numeric and periodic hooks and explicitly typed removal. Versions one and two retain their original behavior and state/evidence shape. Their definitions cannot acquire removal metadata implicitly; even in a version-three encounter, older effects remain protected.

A version-three `mechanics.tacticalRoundEffect` retains the existing family, Replace/Refresh, duration, polarity, tags, modifiers and optional periodic hook, and requires:

```json
"removal": {"method": "CURE", "difficulty": 4}
```

Methods are CLEANSE, DISPEL, CURE or NONE. Removable effects require difficulty 1–1000. NONE requires difficulty zero and cannot be removed. A definition requires a nonempty numeric modifier list or a periodic hook; an empty status marker is unsupported. Version-three effects require encounter opt-in three. Duration/stacking/pulse behavior remains as documented for [round conditions](tactical-round-effects.md) and [periodic effects](tactical-periodic-effects.md).

An eligible source supplies `mechanics.tacticalCleansing`:

```json
{
  "version": 1,
  "minimumNativeLevel": 1,
  "method": "CURE",
  "tags": ["poison", "disease"],
  "strength": 4,
  "manaCost": 2,
  "range": 0,
  "targetSide": "ALLY"
}
```

Native classes, selected feats/subclasses and active equipment must have existing combatModifiers; NPC/monster templates must have tacticalUnit. Class gates must be reachable native levels; other sources require level zero. Borrowed levels, unselected abilities, carried/inactive gear and unowned sources cannot grant removal. Strength is 1–1000, mana cost 1–1000000 and range 0–31 graph edges between authored zones. Tags are 1–16 unique existing-format tags. CLEANSE and CURE require ALLY; DISPEL can explicitly select ALLY or ENEMY.

Sources resolve from pinned immutable revisions at encounter initialization. At most 32 distinct abilities are allowed. Duplicate equipped copies grant one identical ability with every equipment instance retained in provenance, without stacking strength or discounting cost. Conflicting definitions/revisions reject initialization.

## Actions and counterplay

The authenticated tactical action accepts only:

```json
{"actorId":"hero","kind":"CLEANSE","targetId":"hero","abilityId":"class.one","effectId":"effect.poisoned"}
```

The action requires version-three rules, the active actor, one available Main, enough mana, the ability's declared target side and range, and a selected active effect on an Active or Downed target. The method must match exactly, at least one accepted tag must intersect the effect's tags, and strength must meet or exceed difficulty. CLEANSE/CURE also require HARMFUL or MIXED polarity; DISPEL permits beneficial effects. This is authored eligibility, without inferred universal disease/curse rules.

A successful action spends one Main and the authored mana cost, removes exactly one selected instance/family and stops its future pulses/modifiers. It does not heal, revive, advance duration or roll randomness. A removed effect may be reapplied by a later eligible trigger. Downed targets stay Downed; Defeated targets cannot be selected. Insufficient strength/mana, protected effects, stale choices and forged capability parameters fail atomically.

Version-three enemy turns prioritize an eligible affordable ALLY ability on themselves before the existing attack/move/end behavior. Consuming Main prevents a second Main action. Independent replay reconstructs and verifies that same bounded choice. Enemy dispels and cleansing other allies remain future AI work.

## Persistence and visibility

Existing origin/step/receipt journals retain the resolved abilities and full removed instance, including definition/source revisions, application revision, remaining duration and equipment provenance. Each cleansing event also records actor, owner, method, strength, difficulty and mana cost. Later publication cannot change an existing fight. Reconnect and duplicate requests replay the retained result; a late failure rolls back removal, mana, budget and receipt together.

Owner projections expose active removal eligibility and the party's ability choices, tags, strength, mana cost, range and side. Internal journal events, source revisions and equipment identities remain private. Independent replay reconstructs capabilities from pinned character/template sources and detects altered removal evidence. Existing immutable journal constraints and restricted runtime grants remain sufficient.

## Validation and remaining work

Rule tests cover strength boundaries, channels/tags, protected and older effects, exact removal, costs, range/side, Downed state, duplicate gear provenance and rejected-action immutability. Database/API scenarios cover real owned class/gear removal, stopped pulses and reapplication, pinned publication, enemy self-cleansing, concurrent retries, reconnect, source gates/inactive gear, late rollback, corruption detection, strict authoring and restricted-role terminal recovery.

Pass 1 remains open. Remove Curse and curse consequences, persistent diseases/poisons, cross-encounter/Adventure-Turn clocks, resistance/buildup/hard control, broader ability/check integration, additional stacking policies, auras, reactions and complete injury/recovery remain unsupported. Later progression, quest, item, shared/scheduled and operational release passes also remain incomplete. No final content catalog, deployment or release certification is claimed.
