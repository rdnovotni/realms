# Tactical status immunity

## Design grounding and scope

The uploaded core design bible and Design Documents.zip remain authoritative. System 24 §§15–16 separate damage resistance from status resistance, primarily type status defenses by family/tag, require deliberate fiction-driven immunities, and let each effect choose its application method. System 04 §11 likewise separates fundamental damage types from status tags. This batch implements only explicit tag immunity for encounter-local effects applied by existing valid hit/heal triggers. It does not create universal boss immunity, partial resistance or an extra save on every attack.

Existing EFFECT/content/release entities, immutable character snapshots and tactical origin/step/receipt journals persist this contract. No migration, new table or runtime privilege is required. Migrations 001–023 remain unchanged; the live database is not deployed by this batch. Fixtures demonstrate mechanics, not final launch balance.

## Authoring

An encounter with round effects opts in separately through `tacticalCombat.rules.statusDefense`:

```json
{"version": 1, "tags": ["poison", "disease", "fear"]}
```

The vocabulary has 1–32 unique lowercase tags in the existing tag format. It identifies defense keys, not a hierarchy or list of every possible effect tag. No tag, damage type or effect family implicitly inherits another. `statusDefense` requires an existing `roundEffects` opt-in (version 1, 2 or 3); its presence does not upgrade those effect contracts.

An eligible entity supplies `mechanics.tacticalStatusTraits`:

```json
{"version": 1, "minimumNativeLevel": 0, "immuneTags": ["poison"]}
```

Traits require 1–32 unique tags. Native classes, selected feats/subclasses and active equipment require existing combatModifiers; creature templates require tacticalUnit. Class gates require a reachable native level of at least one; non-class gates require zero. Borrowed levels, unselected abilities, carried gear and inactive prepared sets do not contribute.

Immunity tags union deterministically across eligible source revisions, without magnitude stacking. Unknown defense tags reject creature encounter publication or owned encounter initialization atomically, including currently locked source traits. Pinned sources select the profile at encounter start; later publication or equipment projections cannot alter that fight. An opted-in unit without traits has an explicit empty profile. Unopted encounters ignore optional traits and retain their exact original state/evidence shape.

## Application semantics

After a valid connected attack resolves damage and leaves the target Active, matching HARMFUL or MIXED effects are blocked before application, replacement or refresh. The same check runs for effects granted by an accepted heal. Any exact intersection between effect tags and target immune tags blocks the whole instance; tags are not accumulated resistance percentages. Beneficial and neutral effects remain eligible. Unmatched tags retain their existing Replace/Refresh rules, duration and source snapshots.

Blocking does not undo damage, prevent healing, change action/mana costs, advance a clock or add random draws. Fire damage immunity does not stop a poison status or Burning tag; poison status immunity does not prevent fire damage. An already active effect is not retroactively removed. Immunity bypass, conversions, reduced forms, conditional defenses and saves require future explicit authoring contracts.

## Persistence, replay and visibility

Only opted-in steps gain `statusEvents`. Each IMMUNE event retains owner, source unit, sorted matched tags and the complete blocked grant (effect/source IDs and revisions, equipment identity when applicable, authored definition). The step and receipt supply action/revision context. No blocked effect is inserted into active state or emitted as an application event.

Independent replay reconstructs the status profile from immutable selected character/template revisions and reproduces blocked application and complete evidence. Existing journal constraints still enforce immutability and consecutive steps. Late failure rolls back attack draws, blocked evidence, action budgets, pools and receipt together. Retries replay the original receipt; reads and reconnect do not apply effects or reroll immunity.

Owner views disclose party `statusImmunities`, without enemy profiles or private source/equipment/journal fields. Learned enemy-defense disclosure and qualitative codex labels remain future work. API commands accept actor/action/target choices only; injected profiles, tags and fabricated event evidence reject.

## Validation and remaining gaps

Rule scenarios cover exact tag matching, harmful/mixed versus benign polarity, native gates, union/deduplication, strict schemas, healing, separate damage immunity and unopted history. Database scenarios cover real active gear and creature traits, pinned publication, concurrent retry/reconnect, source selection/inactive sets, periodic application, rollback, tampered-history detection, strict publication/start/API rejection and restricted-role recovery.

Pass 1 remains open for partial status resistance/vulnerability, attribute/proficiency saves, buildup and hard-control conversions/diminishing returns, immunity bypass and conditional changes, broader abilities, injury/recovery and owned/shared participants. Final authored catalogs, progression/quests/items/shared systems and operational release gates also remain incomplete.
