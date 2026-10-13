# Selectable tactical attack abilities

## Design grounding and scope

The uploaded core design bible and Design Documents.zip remain authoritative. System 04 §5 assigns primary attacks, major spells and strong abilities to Main; §§9–11 resolve attack connection, armor/penetration and typed resistance. System 43 §§31–35 preserves distinct class resource identities, the existing action economy and explicit ability/loadout selection. This batch implements a bounded mana-powered offensive attack contract using those existing rules. It does not impose mana on all martial classes or claim to implement their distinct resource engines.

Existing content versions/releases, immutable owned-character snapshots and tactical journals persist abilities and results. No migration, new table or runtime privilege is required. Migrations 001–023 stay unchanged and the live database is not deployed. Fixtures demonstrate execution, not final spell/class catalogs or launch balance.

## Authoring and ownership

An encounter opts in with `tacticalCombat.rules.abilities: {version: 1}` and must also author its existing `typedDamage` vocabulary. Each eligible source can supply one `mechanics.tacticalAttackAbility`:

```json
{
  "version": 1,
  "minimumNativeLevel": 1,
  "range": 1,
  "manaCost": 2,
  "accuracyModifier": 1,
  "damage": {"type": "fire", "min": 12, "max": 12, "penetration": 2}
}
```

Range is 0–31 graph edges; mana cost 1–1000000; accuracy modifier -1000–1000. Damage min/max are integers 1–1000000 with max at least min, and penetration is 0–1000000. Damage type must belong to the encounter vocabulary. Unknown fields, free casts, inverted ranges and unsupported resource/cooldown rules reject.

Native classes, selected feats/subclasses and active equipment require existing combatModifiers; NPC/monster templates require tacticalUnit. Class gates must be reachable native levels of at least one; non-class sources require zero. Borrowed levels, unselected abilities, unowned sources and carried/inactive gear do not grant choices. Unknown damage types reject creature encounter publication or owned encounter initialization, including locked owned contributions.

Abilities resolve from pinned immutable source revisions at encounter start, with at most 32 distinct choices. Duplicate copies of an equipped definition grant one identical choice with every sorted instance identity retained, without stacking damage or reducing costs. Conflicting revisions/specifications reject rather than depending on source iteration. Unopted encounters ignore optional ability definitions and retain their original state/evidence shape.

## Actions, damage and enemy turns

The authenticated command supplies choices only:

```json
{"actorId":"hero","kind":"USE_ABILITY","targetId":"enemy","abilityId":"class.one"}
```

The active controlled actor needs Main, an owned ability, sufficient mana, an opposing non-Defeated target and legal range. A legal attempt spends one Main and authored mana even on a miss. The server journals one hit roll and one raw-damage draw from the ability's min/max (including a bound-one draw for fixed damage); client rolls, costs and magnitudes are rejected.

Resolution uses the existing accuracy-versus-evasion check and natural-roll/critical policy. Ability accuracy adds to current effective actor accuracy and saturates to the existing +/-1000000 check bounds. The ability's range, damage type and penetration replace the corresponding basic attack values; passive weapon penetration does not implicitly add to the authored ability penetration. Guard/reaction armor and target effect modifiers still apply before penetration, then matching typed resistance/vulnerability/immunity. Attacks against Downed opposing party creatures retain existing strike rules; no revival or alternate casualty rules are added.

Existing generic on-hit grants fire on a connected attack that leaves its target Active, including connected zero damage. Status immunity can block matching harmful grants; periodic and cleansing rules remain independently opted in. No spell-specific, weapon-specific or conditional trigger filters are inferred.

Server opponents first retain any eligible self-cleansing priority. With Main available they select the first normalized affordable ability already in range of the existing chosen target, otherwise use the existing basic attack/move/end behavior. This bounded policy is independently replayed. Advanced spell selection, positioning for particular abilities and resource strategy remain future AI work.

## Persistence, replay and visibility

Only opted-in unit states gain attackAbilities and steps gain abilityEvents. Origins retain the complete ability definitions and source revisions/instances; each usage event records actor, target, source ability/revision, instances and mana cost. Attack evidence supplies type, check and mitigation; intent and journal draws retain actual roll/raw damage. Later publications cannot alter an existing fight.

Independent replay reconstructs abilities from pinned sources, verifies source-bound random-draw bounds/values and enemy decisions, then compares state and usage evidence. Late failure rolls back mana, Main, random draws, transitions and settlement together. Duplicate/stale requests, free reads and reconnect cannot cast or settle again. Ability victories/failures use existing exact-once loot/XP, campaign proof and health/mana recovery contracts; subsequent encounters retain spent mana.

Owner projections expose party ability choices, costs, range, accuracy modifier and damage definition. Enemy ability lists and private revisions, equipment identities and internal usage evidence remain hidden. Existing ownership/write-scope rules protect the API.

## Validation and remaining work

Rule scenarios cover authored range/type/penetration, Main/mana, misses, guard/immunity/criticals, duplicate gear provenance, strict contracts, rejected-action immutability and legacy shapes. Database scenarios execute class/selected-feat/weapon and enemy abilities; verify source gates, pinned publication, concurrent victory/reconnect, retained pools, generic on-hit/status counterplay, late rollback, altered-history detection, publication/start/API rejection and restricted-role recovery.

Pass 1 remains open for attribute/proficiency-driven ability checks and saves, standalone learned/prepared spell libraries, multi-ability grants per source, support/AoE/concentration/cooldowns, distinct martial resource engines, broader AI, buildup/control, immunity bypass, damage inheritance, injury/recovery and owned/shared participants. Final catalogs and the later progression/quest/item/shared/operational release passes remain unfinished.
