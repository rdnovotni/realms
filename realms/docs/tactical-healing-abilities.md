# Selectable tactical healing abilities

## Design grounding and scope

The uploaded core design bible and Design Documents.zip remain authoritative. System 04 §5 assigns major spells/abilities to Main. System 43 §§31–35 preserves resource identity and explicit ability selection. System 35's spell function taxonomy includes HEALING; System 25 §§6–7 and §18 distinguish Downed revival from stronger resurrection: ordinary positive healing revives Downed characters, while Defeated characters require a separate resurrection contract.

This batch adds a bounded mana-powered, single-ally healing ability path alongside existing generic HEAL and selectable offensive abilities. It uses existing content versions/releases, immutable source snapshots and tactical journals. No migration, new table or runtime privilege is required. Migrations 001–023 remain unchanged, and the live database is not deployed. Fixtures are execution examples, not a final balanced healing/spell catalog.

## Authoring and eligibility

An encounter opts in with `tacticalCombat.rules.healingAbilities: {version: 1}`. It does not require typed damage or upgrade existing round-effect contracts. An eligible source supplies `mechanics.tacticalHealingAbility`:

```json
{
  "version": 1,
  "minimumNativeLevel": 1,
  "range": 1,
  "manaCost": 2,
  "min": 10,
  "max": 12
}
```

Range is 0–31 authored graph edges; mana cost is 1–1000000; healing min/max are integers 1–1000000 with max at least min. Unknown properties, free casts, inverted ranges and unsupported resurrection/resource rules reject.

Native classes, selected feats/subclasses and active equipment require existing combatModifiers; NPC/monster templates require tacticalUnit. Class gates require reachable native levels of at least one; non-class gates require zero. Borrowed levels, unselected abilities, unowned sources and carried/inactive gear do not grant choices. Generic canHeal kit eligibility remains separate from a selected owned healing ability.

At most 32 distinct source choices resolve from pinned immutable revisions at encounter initialization. Duplicate equipped copies grant one identical choice with all sorted item-instance identities retained, without stacking healing or reducing cost. Conflicting revisions/specifications reject atomically. A source can independently author offensive and healing choices; their command kinds distinguish them. This does not provide a multi-spell learned/prepared library.

## Actions and target states

The authenticated command accepts choices only:

```json
{"actorId":"hero","kind":"USE_HEALING_ABILITY","targetId":"ally","abilityId":"class.one"}
```

The active controlled actor must have Main, the selected ability, sufficient mana and a same-side non-Defeated target within ability range. The server journals one healing draw between authored min/max, including a bound-one draw for fixed healing. There is no hit check, critical roll or client-authored magnitude.

A legal attempt spends one Main and authored mana, then caps the target's resulting health at its maximum. Full-health targets remain legal and still consume the disclosed resources. Positive healing above zero immediately revives Downed allies and clears their existing strike counter, making their normal turns available again. Defeated targets reject; no stabilization, resurrection, injury cure or altered terminal-wipe contract is inferred. A resolved encounter cannot be reopened by healing.

Accepted casts trigger the existing generic on-heal grants when periodic rules are enabled. Applying a HoT does not pulse it immediately; its first pulse remains the affected unit's next actual turn start. Status immunity and existing Replace/Refresh clocks remain independently authored. Healing does not cleanse effects, restore mana, fire on-hit grants or cost an extra Adventure Turn.

## Enemy behavior

Opted-in opponents retain eligible self-cleansing priority. With Main available and health below maximum, they select the first normalized affordable healing ability on themselves; otherwise they continue the existing offensive ability/basic attack/move/end policy. They cannot heal and attack with the same Main, and exhausted mana causes fallback. Independent replay verifies that bounded decision. Ally-targeted support AI, resource strategy and advanced spell selection remain open.

## Persistence, replay and visibility

Only opted-in units gain healingAbilities and steps gain healingAbilityEvents. Origins retain complete source-bound definitions. Usage evidence records actor/target, source ID/revision/instances, mana cost, rolled amount, before/after health, state and strikes. Intent and draw journals retain the exact healing result and its source-bound draw range. Later publication cannot alter a fight's amount, range or cost.

Independent replay rebuilds eligible abilities from pinned character/template sources, validates draws and enemy decisions and compares full transition evidence. Late failure rolls back health, mana, Main, draws, effect application, journals and receipt together. Concurrent duplicates replay one result; stale/illegal actions and reconnect/free reads cannot heal again. Existing terminal settlement preserves health/mana for subsequent encounters and retains victory/failure reward authority.

Owner projections expose party choices, range, mana cost and min/max. Enemy ability lists, private source revisions, equipment identities and internal usage events stay hidden. API ownership and write scope remain mandatory; injected amount, cost or resurrection flags reject.

## Validation and remaining work

Rule scenarios cover caps, costs, authored range, Downed revival/strike clearing, Defeated rejection, duplicate-copy provenance, malformed contracts and legacy generic healing. Database scenarios execute owned class/selected-feat/active-gear healing, pinned publication, concurrent replay/reconnect, an actual Downed ally and resumed HoT turn, server self-healing/resource exhaustion, source gates, rollback/corruption detection, strict publication/API boundaries, restricted-role recovery and retained pools in a subsequent encounter.

Pass 1 remains open for support buffs/AoE, attribute/proficiency-driven checks and saves, learned/prepared spell libraries, multi-ability source grants, concentration/cooldowns, distinct resources, stabilization/resurrection, advanced support AI, injury/recovery, buildup/control and owned/shared participants. Final balanced catalogs and later progression/quest/item/shared/operational release passes also remain incomplete.
