# Feature framework work plan

Generated from `feature-registry.json` and the fingerprinted `source-catalog.json.gz`. Update the overlay, then run `python3 infra/scripts/feature_registry.py --write-report` from the repository root.

47 documents, 2096 section checklists, 13,187 source entries including 11,607 rules. Coverage is a mapping count, **not a feature completion percentage**.

Current section assessments: historical: 37, partial: 61, unassessed: 1998.

Finish reusable feature frameworks with minimal test fixtures before substantial authored content. Keep canonical launch tiers and post-launch/deployment gates visible; do not treat examples as locked catalogs.

The system contract supplies owner, prerequisites, field scopes/reset rules, Action/permission families, authoring/editor work, client workflow and acceptance scenarios to every section. Individual section implementation is initially **unassessed**. Baseline subset evidence is listed separately; no whole system is verified. Field-level exceptions and per-rule executable assertions are required before implementation status can be promoted.

## Next work packages

### WP-01: Scope/reset contract and fixture Ascension loop

Prerequisites: registry contract

Systems: SYS-23, SYS-01, SYS-07, SYS-10

Declare concrete field-level persistence/reset contracts and retained-state policy; tiny campaign completion → Aftercore → preview/Tavern → next-life setup → Ascend → replay, with one persistent knowledge/Mastery reward and no daily reset exploit.

### WP-02: Central effective-rules and configurable mechanics

Prerequisites: WP-01

Systems: SYS-45, SYS-26, SYS-24, SYS-03, SYS-43

Versioned precedence resolver, typed modifiers/curves/costs, choice and resource-pool definitions; reproduce rule explanations from pinned snapshots.

### WP-03: World/check/quest/dialogue interaction slice

Prerequisites: WP-01, WP-02

Systems: SYS-18, SYS-29, SYS-06, SYS-34, SYS-05, SYS-44

A reusable known-world resolver, committed noncombat checks, quest graph/Journal and dialogue intents; two fixture routes and one real campaign conclusion.

### WP-04: Complete daily economy and ordinary custody workflows

Prerequisites: WP-02

Systems: SYS-01, SYS-02, SYS-07, SYS-08, SYS-11, SYS-19

Daily charges/reserve/consumption, paged inventory/storage, vendors and one sink/faucet; full crafting/gathering and protection rules with editor/UI fixtures.

### WP-05: Combat, party and dungeon frameworks

Prerequisites: WP-02, WP-03, WP-04

Systems: SYS-04, SYS-09, SYS-24, SYS-25, SYS-27, SYS-28, SYS-31, SYS-32, SYS-35, SYS-36, SYS-42

Finish tactical interaction/targeting, recovery, party/familiar policy, monster/loot, magic/martial, traps/locks and seeded dungeon/checkpoints; one boss fixture with restart proof.

### WP-06: Long-term identity, world consequences and mastery

Prerequisites: WP-03, WP-05

Systems: SYS-10, SYS-13, SYS-14, SYS-20, SYS-21, SYS-30, SYS-33, SYS-37, SYS-38, SYS-41

Complete persistent inheritance/Legacy/Mastery/Chronicle, species, factions, collections, optional wilderness/investigation and taming; one replay and expedition fixture, no rejected culture/camp/detective subsystems.

### WP-07: Social and later-feature contracts with safe gates

Prerequisites: WP-04, WP-05, WP-06

Systems: SYS-12, SYS-15, SYS-17, SYS-22, SYS-39, SYS-40

Complete Guild permissions/treasury, event contributions/claims, recreational game rules, entitlement/refund contracts, consenting PvP with rating/async-defense rules, and card/deck/match/tournament frameworks using synthetic fixtures. Keep restricted activation disabled; prove conservation, consent, anti-abuse and interrupted settlement/recovery before real catalogs or providers.

### WP-08: Workflow/tooling completion and framework acceptance

Prerequisites: WP-01, WP-02, WP-03, WP-04, WP-05, WP-06, WP-07

Systems: SYS-16, SYS-23, SYS-46, SYS-45

Client and typed Studio work are part of every package, not postponed here. Final pass covers automation/parser/accessibility, simulations/property tests, secrets/performance, release flags and staging/rollback/restore rehearsal; only then expand ordinary content.

## Decisions and activation gates

### DEC-001: State ownership and reset semantics (resolved-contract)

Use the seven existing scopes. Account-level daily receipts survive Ascension; run build/quests archive; active instances block transition; shared scopes persist. Domain field mappings above are the baseline engineering contract. Add a field-specific exception before implementation; do not invent a generic lifetime.

Blocks: Schema work lacking a field-specific state/reset declaration.

### DEC-002: Actions, clients and authoring authority (resolved-contract)

Reuse the authenticated Action transaction/receipt pipeline and permitted Query projections. Studio authors typed versioned definitions, never arbitrary player-state writes. Client/AI submit approved intents. Planned Action families in this registry are contracts, not claims that endpoints exist.

Blocks: New mutation routes or arbitrary AI/admin mutation paths outside the authority contract.

### DEC-003: Numerical tuning versus canon (resolved-contract)

Keep coefficients, curves, budgets and provisional values in versioned typed rules/content. Pin them in runs/instances; label prototype tuning and test boundaries. Do not hardcode new production numbers or convert example subclass/species catalogs into approved content.

Blocks: A framework that relies on an unexplained hardcoded production constant.

### DEC-004: Live operational acceptance from P1 baseline (open-gate)

Protected helper refresh, root-only live inventory and staging/manual play/promotion/rollback rehearsal still require an interactive operator session. CI and code inspection are not live deployment proof.

Blocks: Live promotion; does not block fixture-only feature work.

### DEC-005: Wagering, payments, competitive modes and large live events (open-gate)

Keep restricted features disabled until eligibility/platform policy, anti-abuse, reconciliation/refunds and operational readiness have concrete proof. Baseline contracts can be implemented and tested without activation.

Blocks: Activation of gated features, not ordinary recreation or boss fixtures.

### DEC-006: Per-requirement canon and scope review (open-gate)

The section checklist is initially unassessed. Before implementing/promoting a section, explicitly map its individual rules to field contracts and assertions; adjudicate conflicting historical text against the supersession register. Do not turn aggregate coverage into a false completion percentage.

Blocks: Promoting an unassessed requirement to implemented/integrated/verified.

## Canon corrections

Apply these resolutions before building assertions from older source wording. They do not silently mark earlier rows implemented or superseded.

- **PvP / gambling** (owner 39 / 40): System 39 authorizes eligible Gold wagering including player-versus-player wagering with a mandatory humorous risk tutorial, escrow and heavy anti-laundering/collusion controls. System 40 additionally permits explicit card-for-card stakes for eligible tradable cards. Legal/platform eligibility still gates deployment.
- **Culture selection** (owner 37): System 37 removes a separate culture-selection subsystem. Cultures exist in the world and can be reflected narratively, but players do not manage a culture build layer.
- **Backgrounds / origins** (owner 37): System 37 confirms optional narrative origins/backstory only, with no standardized mechanical progression package.
- **Languages** (owner 37): System 37 simplifies language handling. Languages can matter contextually without becoming a complex character-management subsystem.
- **Wilderness Trek / camps** (owner 33): Rejected. Travel remains quick-to-instant; wilderness exploration is optional play in the existing world. No dedicated temporary field-camp system.
- **Investigation depth** (owner 38): Simplified. Investigation is normal RPG/quest gameplay with optional deeper mysteries, not a detective simulator; no dedicated multiplayer investigation subsystem.
- **Subclass roster** (owner 43): Only the 12 base classes are locked for now. Subclass roster, names and exact packages remain future content design.
- **Ascension lore** (owner 44): System 44 makes the connection loose and mysterious. Most people do not know or understand Ascension; rare entities may perceive echoes. It can remain a long-term mystery indefinitely.
- **Campaign ending** (owner 44): System 44 locks a real conclusion to the launch campaign’s immediate central crisis while leaving wider mysteries and future expansion hooks open.
- **Procedural dungeon rooms** (owner 32): System 32 additionally requires themed random filler rooms for immersion, pacing, believable architecture and surprises.
- **Long-tail scaling** (owner 45): System 45 clarifies that damage/survivability can continue increasing every level through 999, but on controlled diminishing curves; declared challenge systems scale appropriately without hidden universal enemy mirroring.
- **Gear power** (owner 45): System 45 clarifies gear is also a major power source and exceptional gear can substantially outperform ordinary gear while build coherence still matters.

## System contracts

### SYS-Core: Core Design Bible

Owner: `canon` · Design tier: Foundation / historical context · Implementation: **historical**

Prerequisites: SYS-46

| Scope / fields | Ascension | Rollover |
|---|---|---|
| ACCOUNT: historical context only | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |

**Action families:** Read source hierarchy.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** No gameplay schema; historical design reference.

**Client:** Explain current canon with source attribution.

**Acceptance scenarios:**

- An older Core statement cannot override an explicit approved owning-system correction.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

No complete implementation evidence mapped; planned work remains.

### SYS-01: Turns, Rollover & Daily Economy

Owner: `turn-economy` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: SYS-23

| Scope / fields | Ascension | Rollover |
|---|---|---|
| RUN: Turns and spend ledger | Carry remaining Turns and protected reserve into the next run; archive old ledger and retain account/epoch receipts. Never regrant daily budgets on Ascension. | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| ACCOUNT: protected reserve, rollover receipt and banked daily entitlement | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |

**Action families:** Commit sealed encounter/activity cost, apply rollover, configure reserve, use daily charges, configure autocollection and execute bounded repeat plans.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Turn-cost policy, grant/cap policy, banked charge rules and scheduler preview.

**Client:** Turn ledger, forecast, reserve controls and daily planner.

**Acceptance scenarios:**

- Rollover during an open encounter defers then applies once.
- Ascend at rollover never grants a second daily entitlement.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/lifecycle.ts](../../realms/src/domains/lifecycle.ts), [realms/test/scheduler.test.ts](../../realms/test/scheduler.test.ts). Turn debit and rollover receipts exist; daily planner, bankable charges and configured live policy remain open.

### SYS-02: Food, Booze, Tolerance & Consumables

Owner: `consumption` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: SYS-01, SYS-07

| Scope / fields | Ascension | Rollover |
|---|---|---|
| RUN: fullness drunkenness tolerance | Carry current-epoch fullness/drunkenness/tolerance and consumed daily allowances into the next run. Reset only at the declared rollover, never to refill consumption by Ascending. | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| ACCOUNT: daily receipt | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |

**Action families:** Consume item, recover consumption, inspect limits.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Consumable effects, capacity and incompatibility rules with preview.

**Client:** Food/booze preview, remaining capacity, Turn gain and consent.

**Acceptance scenarios:**

- A repeated consume request grants once.
- overcapacity or forbidden consumption costs no item or Turns.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/consumption.ts](../../realms/src/domains/consumption.ts), [realms/test/consumption.test.ts](../../realms/test/consumption.test.ts). Capacity/yield settlement, immediate onboarding undo, rollover carry, observations and safe meal-plan framework; production catalogs, Studio, feasts, restaurants and class/Path integrations remain open. See realms/docs/consumption.md.

### SYS-03: Character Progression, Attributes, Classes & Mastery

Owner: `progression` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: SYS-23

| Scope / fields | Ascension | Rollover |
|---|---|---|
| RUN: XP level attributes and native class | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| ACCOUNT: Mastery | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |

**Action families:** Start build, level up, allocate growth, earn Mastery.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Progression curves, attribute milestones and Mastery sources.

**Client:** Build choices, XP explanation and Mastery history.

**Acceptance scenarios:**

- Level and choice history reconcile after restart.
- Ascend resets run growth while retained Mastery cannot be farmed by replay.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/progression.ts](../../realms/src/domains/progression.ts), [realms/test/progression.test.ts](../../realms/test/progression.test.ts). XP and earned choices exist; Mastery and a complete progression workflow remain open.

### SYS-04: Tactical Combat, Actions, Positioning, Damage & Conditions

Owner: `combat` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: SYS-03, SYS-07, SYS-24, SYS-26, SYS-29

| Scope / fields | Ascension | Rollover |
|---|---|---|
| INSTANCE: combat board rounds initiative actions | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |
| RUN: retained pools | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |

**Action families:** Start combat, choose action, move, react, resolve.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Combat objectives, targeting, terrain, action budgets and threat rules.

**Client:** Board, legal targets, intent preview, effect and damage explanation.

**Acceptance scenarios:**

- Concurrent or stale commands cannot spend an action twice.
- reconnect preserves initiative board RNG and reward commitment.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/tactical-engine.ts](../../realms/src/domains/tactical-engine.ts), [realms/test/tactical-combat.test.ts](../../realms/test/tactical-combat.test.ts). Persisted tactical combat exists; full positioning/UI and all design mechanisms need requirement-level assessment.

### SYS-05: Encounters, Manipulation, Wanderers & Zone State

Owner: `encounters` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: SYS-01, SYS-04, SYS-28

| Scope / fields | Ascension | Rollover |
|---|---|---|
| RUN: zone queues banishes tracking | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| INSTANCE: committed encounter | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |

**Action families:** Explore, commit encounter, manipulate encounter queue.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Weighted encounters, wanderer cadence, banish and tracking rules.

**Client:** Zone actions, commitment warning, visible manipulation timers.

**Acceptance scenarios:**

- Restart cannot reroll a committed encounter.
- banish tracking and wanderer precedence remain deterministic across rollover.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/encounters.ts](../../realms/src/domains/encounters.ts), [realms/test/encounters.test.ts](../../realms/test/encounters.test.ts). Ordinary encounter commitment/draw history exists; manipulation queues and a complete zone workflow remain open.

### SYS-06: Quests, Journal, Rumors, Contracts, Bounties & Consequences

Owner: `quests` · Design tier: Launch Core · Implementation: **planned**

Prerequisites: SYS-05, SYS-29

| Scope / fields | Ascension | Rollover |
|---|---|---|
| RUN: objectives branches consequences | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| ACCOUNT: persistent quest knowledge | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |

**Action families:** Accept objective, resolve route, claim reward, abandon.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Quest graph, conditions, fail-forward paths, reward and mutation budgets.

**Client:** Journal, objectives, rumors, contracts, alternate routes and consequence feedback.

**Acceptance scenarios:**

- Two solution routes converge without duplicate rewards.
- quest facts survive reconnect and reset only according to declared scope.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

No complete implementation evidence mapped; planned work remains.

### SYS-07: Items, Equipment, Inventory, Rarity, Quality & Durability

Owner: `items` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: SYS-23

| Scope / fields | Ascension | Rollover |
|---|---|---|
| ACCOUNT: storage and provenance | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |
| RUN: equipped custody | Clear equipped projections; move eligible ordinary possessions to account Home/Material Vault custody, retain binding/protection/provenance, and archive inaccessible run-bound/quest objects. Do not delete item units. | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| INSTANCE: temporary loot custody | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |

**Action families:** Move, equip, lock, split, merge, bind and inspect item.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Item metadata, quality, rarity, slots, durability and custody constraints.

**Client:** Inventory with paging, compare tooltips, equipment and protection controls.

**Acceptance scenarios:**

- Every unit has one custodian.
- locked or bound items cannot bypass protection through crafting trade or Ascension.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/equipment.ts](../../realms/src/domains/equipment.ts), [realms/test/inventory.test.ts](../../realms/test/inventory.test.ts). Custody, equipment, locks, binding and loadouts exist; durability, broader metadata and paging remain open.

### SYS-08: Crafting, Gathering, Professions, Quality & Maker Economy

Owner: `crafting` · Design tier: Launch Supporting · Implementation: **partial**

Prerequisites: SYS-07, SYS-28, SYS-29

| Scope / fields | Ascension | Rollover |
|---|---|---|
| RUN: profession progress and active craft | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| ACCOUNT: recipe knowledge | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |

**Action families:** Gather, craft, salvage, learn recipe, fulfill commission.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Recipes, skill/quality formula, inputs, maker identity and work orders.

**Client:** Recipe discovery, input selection, output preview and maker history.

**Acceptance scenarios:**

- Craft retry produces one output.
- forbidden inputs or stale custody roll back all consumption and costs.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/crafting.ts](../../realms/src/domains/crafting.ts), [realms/test/crafting.test.ts](../../realms/test/crafting.test.ts). Routine crafting exists; professions, gathering, maker commissions and full workflow remain open.

### SYS-09: Familiars, Companions, Hirelings, Summons & Party AI

Owner: `companions` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: SYS-04, SYS-07

| Scope / fields | Ascension | Rollover |
|---|---|---|
| RUN: recruits party roster and familiar mode | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| INSTANCE: party AI choices | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |
| ACCOUNT: permanent unlocks | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |

**Action families:** Recruit, dismiss, assign, summon and configure AI.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Companion/familiar chassis, contracts, AI policies and ownership.

**Client:** Party roster, behavior policies, costs and dismissal confirmation.

**Acceptance scenarios:**

- Companion ownership and command authority hold in shared combat.
- retry cannot multiply summons or unlocks.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/tactical-companions.ts](../../realms/src/domains/tactical-companions.ts), [realms/test/tactical-shared-integration.test.ts](../../realms/test/tactical-shared-integration.test.ts). Tactical recruit/shared-party primitives exist; Familiar/hireling/AI-policy completeness remains open.

### SYS-10: Ascension, Run Modes, Legacy, DM Tavern & Run History

Owner: `ascension` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: SYS-01, SYS-03, SYS-07

| Scope / fields | Ascension | Rollover |
|---|---|---|
| ACCOUNT: Legacy Mastery storage Chronicle | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |
| CHARACTER: identity | KEEP stable identity; run-selected identity mechanics belong to RUN | KEEP |
| RUN: life build and campaign | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |

**Action families:** Preview transition, confirm Ascend, select mode and next-life setup.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Reset matrix, modes, eligibility proofs, inheritance and Legacy budgets.

**Client:** Between-lives Tavern, retained/lost preview, history and next-run choices.

**Acceptance scenarios:**

- A tiny test campaign reaches Aftercore then Ascends once.
- all declared scopes preserve/reset exactly and daily charges cannot be refreshed by changing lives.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/lifecycle.ts](../../realms/src/domains/lifecycle.ts), [realms/test/foundation.test.ts](../../realms/test/foundation.test.ts). Aftercore/archive/reset/storage primitive exists; Legacy, Mastery, Tavern, Chronicle and transition UI remain open.

### SYS-11: Economy, Markets, Trade, Gold, Services & Inflation Control

Owner: `economy` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: SYS-07

| Scope / fields | Ascension | Rollover |
|---|---|---|
| ACCOUNT: persistent wealth | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |
| RUN: mode-restricted Gold | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| INSTANCE: trade escrow | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |

**Action families:** Buy, sell, trade, list, cancel, settle service.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Vendor stock, fees, sinks/faucets, trade eligibility and escrow policies.

**Client:** Vendor comparison, market paging, trade confirmation and receipts.

**Acceptance scenarios:**

- Double settlement cannot duplicate Gold/items.
- canceled or interrupted escrow releases exactly once and obeys binding/mode limits.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/ledger.ts](../../realms/src/domains/ledger.ts), [realms/test/foundation.test.ts](../../realms/test/foundation.test.ts). Integer conserved ledger and restricted transfer primitive exist; vendors, market, escrow/services remain open.

### SYS-12: Guilds, Social Systems, Guild Halls, Campaigns & Community

Owner: `guilds` · Design tier: Launch Supporting · Implementation: **planned**

Prerequisites: SYS-11

| Scope / fields | Ascension | Rollover |
|---|---|---|
| GUILD: membership treasury hall and permissions | KEEP independent shared lifetime | KEEP except declared Guild schedules |
| INSTANCE: campaign participation | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |

**Action families:** Invite, join, manage role, contribute, withdraw, start campaign.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Guild roles, hall upgrades, contributions and campaign policies.

**Client:** Roster, hall, treasury ledger, permission preview and campaign lobby.

**Acceptance scenarios:**

- Revoked officers cannot spend treasury.
- concurrent withdrawal and membership changes preserve provenance and recoverable campaign state.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

No complete implementation evidence mapped; planned work remains.

### SYS-13: Aftercore, Endgame, Raids, Expeditions & Long-Term Progression

Owner: `aftercore` · Design tier: Launch Core · Implementation: **planned**

Prerequisites: SYS-10, SYS-32

| Scope / fields | Ascension | Rollover |
|---|---|---|
| RUN: Aftercore progression | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| ACCOUNT: long-term unlocks | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |
| INSTANCE: expedition checkpoint | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |

**Action families:** Enter expedition, continue, retire, claim milestone.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Endgame loops, depth/scaling, milestone rewards and retirement.

**Client:** Aftercore hub, challenge disclosure, checkpoint resume and retirement preview.

**Acceptance scenarios:**

- An expedition resumes its seed and checkpoint after restart.
- retirement and Ascension cannot claim the same milestone twice.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

No complete implementation evidence mapped; planned work remains.

### SYS-14: Collections, Codex, Museums, Discovery & Rare Finds

Owner: `collections` · Design tier: Launch Supporting · Implementation: **partial**

Prerequisites: SYS-07, SYS-28

| Scope / fields | Ascension | Rollover |
|---|---|---|
| ACCOUNT: discovery Codex and collection ownership | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |
| RUN: temporary discovery flags | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |

**Action families:** Discover, register specimen, exhibit, inspect codex.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Discovery taxonomy, exhibit rules, completion and rare-find triggers.

**Client:** Codex, museum, collection search and knowledge-safe tooltips.

**Acceptance scenarios:**

- Discovery persists through Ascension.
- counts/search/results do not leak unrevealed rare entries or secret mechanics.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/content.ts](../../realms/src/domains/content.ts), [realms/test/foundation.test.ts](../../realms/test/foundation.test.ts). Discovery-filtered content projection exists; collection/Codex/museum player workflows remain open.

### SYS-15: Events, Holidays, Seasonal Content, World Events & FOMO Control

Owner: `events` · Design tier: Post-Launch Ready · Implementation: **planned**

Prerequisites: SYS-23, SYS-28

| Scope / fields | Ascension | Rollover |
|---|---|---|
| EVENT: schedule contributions and claims | KEEP independent eligibility/contributions; claims bind account/event | KEEP until explicit event schedule/expiry |
| WORLD: shared progress | KEEP independent shared lifetime | KEEP; apply explicit world schedules once |
| ACCOUNT: claim receipts | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |

**Action families:** Contribute, inspect progress, claim, activate or stop event.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Pinned event schedules, eligibility, catch-up and expiry policies.

**Client:** Calendar, eligibility, shared progress and claim history.

**Acceptance scenarios:**

- Missed schedule ticks catch up idempotently.
- stopping/expiring an event settles contributions without duplicate or lost rewards.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

No complete implementation evidence mapped; planned work remains.

### SYS-16: Automation, UI, Parser, Information Architecture & Accessibility

Owner: `player-client` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: SYS-23

| Scope / fields | Ascension | Rollover |
|---|---|---|
| ACCOUNT: preferences automation budgets | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |
| RUN: automation goals | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| INSTANCE: pending intent | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |

**Action families:** Query permitted view, submit approved intent, start/stop automation.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Intent grammar, approved commands, automation policies and accessibility metadata.

**Client:** Keyboard and responsive workflows, structured freeform confirmation, safe resume and rule explanations.

**Acceptance scenarios:**

- Automation honors reserve and pauses on uncertainty.
- hostile parser/AI text cannot fabricate a privileged Action or hidden-state query.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/client/app.ts](../../realms/client/app.ts), [realms/test/client.test.ts](../../realms/test/client.test.ts). Login/build/basic combat/equipment client exists; parser, safe automation and broad workflows remain open.

### SYS-17: Monetization, Supporter Tokens, IOTM Content & Pay-to-Win Boundaries

Owner: `entitlements` · Design tier: Launch Supporting · Implementation: **planned**

Prerequisites: SYS-11

| Scope / fields | Ascension | Rollover |
|---|---|---|
| ACCOUNT: entitlements supporter units and receipts | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |

**Action families:** Redeem, gift, refund, purchase eligible cosmetic.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Entitlement catalogs, eligibility, refund and pay-to-win boundaries.

**Client:** Purchase disclosure, entitlement history, gifting and refund state.

**Acceptance scenarios:**

- Provider replay/refund preserves conservation and entitlement history.
- purchases cannot directly grant forbidden competitive power.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

No complete implementation evidence mapped; planned work remains.

### SYS-18: World Structure, Regions, Travel, Maps, Time, Weather & World State

Owner: `world` · Design tier: Launch Core · Implementation: **planned**

Prerequisites: SYS-05

| Scope / fields | Ascension | Rollover |
|---|---|---|
| WORLD: regions clocks weather and shared facts | KEEP independent shared lifetime | KEEP; apply explicit world schedules once |
| RUN: local world overlays | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |

**Action families:** Travel, explore, inspect route, resolve world overlay.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Regions, links, weather, clocks and layered world rules.

**Client:** Map, known routes, current-world explanation and travel preview.

**Acceptance scenarios:**

- Personal quest state cannot overwrite another player's world.
- travel costs and world precedence are explicit and replay-safe.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

No complete implementation evidence mapped; planned work remains.

### SYS-19: Home, Campground, Housing, Rest, Storage & Personal Infrastructure

Owner: `home` · Design tier: Launch Supporting · Implementation: **partial**

Prerequisites: SYS-01, SYS-07

| Scope / fields | Ascension | Rollover |
|---|---|---|
| ACCOUNT: Home storage upgrades | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |
| RUN: rest benefits and house state | Archive run-local benefits; carry daily rest-use/charge restrictions through Ascension until their declared rollover. Account Home/storage/upgrades persist. | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |

**Action families:** Store, retrieve, rest, upgrade, configure Home.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Storage categories, rest policy, facilities and upgrade costs.

**Client:** Home/storage paging, rest preview and upgrade history.

**Acceptance scenarios:**

- Rest cannot duplicate daily benefits.
- Ascension custody preserves ordinary items while run-bound objects remain archived.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/lifecycle.ts](../../realms/src/domains/lifecycle.ts), [realms/test/foundation.test.ts](../../realms/test/foundation.test.ts). Ascension storage and Home-recovery primitives exist; Home upgrades/rest/storage UI remain open.

### SYS-20: Deities, Religion, Patrons, Omens, Constellations, Luck & Cosmology

Owner: `cosmology` · Design tier: Launch Supporting · Implementation: **planned**

Prerequisites: SYS-06, SYS-24

| Scope / fields | Ascension | Rollover |
|---|---|---|
| ACCOUNT: patron knowledge | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |
| RUN: devotion omens constellation modifiers | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |

**Action families:** Dedicate, pray, inspect omen, invoke eligible power.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Patrons, devotional triggers, omen tables and scoped modifiers.

**Client:** Devotion choices, blessings explanation and prayer response history.

**Acceptance scenarios:**

- An omen is committed before reveal.
- Luck modifies only declared rules and never creates an unrestricted universal reroll currency.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

No complete implementation evidence mapped; planned work remains.

### SYS-21: Factions, Standing, Politics, Law, Crime & Regional Allegiance

Owner: `factions` · Design tier: Launch Core · Implementation: **planned**

Prerequisites: SYS-06, SYS-34

| Scope / fields | Ascension | Rollover |
|---|---|---|
| RUN: standing law crime regional allegiance | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| WORLD: political state | KEEP independent shared lifetime | KEEP; apply explicit world schedules once |

**Action families:** Join faction, earn standing, trespass, pay penalty, reconcile consequence.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Standing thresholds, crime evidence, jurisdiction and consequence rules.

**Client:** Faction ledger, crime warnings, regional allegiance and consequence explanation.

**Acceptance scenarios:**

- Crime/standing witnesses commit once.
- a run-local consequence cannot silently mutate global politics or another run.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

No complete implementation evidence mapped; planned work remains.

### SYS-22: PvP, Duels, Arenas, Async Defense & Competitive Formats

Owner: `pvp` · Design tier: Post-Launch Ready · Implementation: **planned**

Prerequisites: SYS-04, SYS-11

| Scope / fields | Ascension | Rollover |
|---|---|---|
| INSTANCE: match snapshot and async defense | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |
| ACCOUNT: rating eligibility and history | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |

**Action families:** Consent duel, queue, submit defense, settle result.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Formats, eligibility, matchmaking and reward budgets.

**Client:** Opt-in lobby, declared rules, replay and result appeals.

**Acceptance scenarios:**

- Attack/defense snapshots cannot change mid-match.
- settlement resists collusion replay and rank farming, with unavailable formats disabled.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

No complete implementation evidence mapped; planned work remains.

### SYS-23: Server Authority, Game State, Actions, Persistence, Content Runtime & Technical Foundation

Owner: `authority` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: none

| Scope / fields | Ascension | Rollover |
|---|---|---|
| ACCOUNT: auth receipts | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |
| CHARACTER: identity | KEEP stable identity; run-selected identity mechanics belong to RUN | KEEP |
| RUN: pinned rules | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| INSTANCE: seed | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |
| GUILD: shared custody | KEEP independent shared lifetime | KEEP except declared Guild schedules |
| EVENT: claims | KEEP independent eligibility/contributions; claims bind account/event | KEEP until explicit event schedule/expiry |
| WORLD: shared clocks | KEEP independent shared lifetime | KEEP; apply explicit world schedules once |

**Action families:** Authenticated Query/Action, role-checked admin operation and durable job.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Stable typed definitions, sealed releases, migration and audit policies.

**Client:** Reconnect-safe permitted projections and explicit failed/stale Action feedback.

**Acceptance scenarios:**

- Same request returns the committed result after restart.
- privilege checks, conservation, migrations, backup restore and secret filtering hold under concurrent Actions.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/foundation/action.ts](../../realms/src/foundation/action.ts), [realms/test/hardening.test.ts](../../realms/test/hardening.test.ts). Authenticated idempotent Actions, scoped storage, sealed releases, audits and durable jobs exist; complete authority/runtime contract and live acceptance remain open.

### SYS-24: Status Effects, Buffs, Debuffs, Diseases, Curses, Resistance, Cleansing & Effect Engine

Owner: `effects` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: SYS-23

| Scope / fields | Ascension | Rollover |
|---|---|---|
| INSTANCE: round/effect clocks | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |
| RUN: retained conditions | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| ACCOUNT: permanent effect unlocks | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |

**Action families:** Apply, tick, expire, resist, cleanse and explain effect.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Stacking families, clocks, triggers, resist/cleanse tags and modifiers.

**Client:** Effect icons, durations, source and counterplay explanations.

**Acceptance scenarios:**

- Effect clock advances once per declared event.
- cleanse and resistance obey tags without resetting unrelated effects or replaying damage.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/tactical-effects.ts](../../realms/src/domains/tactical-effects.ts), [realms/test/tactical-effects-integration.test.ts](../../realms/test/tactical-effects-integration.test.ts). Typed tactical effects/cleansing/resistance exist; wider world/long-lived clocks and workflow remain open.

### SYS-25: Death, Defeat, Downed States, Resurrection, Retreat, Surrender & Recovery

Owner: `recovery` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: SYS-04

| Scope / fields | Ascension | Rollover |
|---|---|---|
| INSTANCE: downed retreat surrender defeat | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |
| RUN: injuries and recovery pools | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |

**Action families:** Stabilize, revive, retreat, surrender, recover.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Failure transitions, cost/penalty contracts and recovery conditions.

**Client:** Downed decisions, retreat confirmation, recovery choices and loss preview.

**Acceptance scenarios:**

- Defeat resolves once with no victory reward.
- disconnect cannot avoid declared losses and recovery cannot erase unrelated run state.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/tactical-failure.ts](../../realms/src/domains/tactical-failure.ts), [realms/test/tactical-combat.test.ts](../../realms/test/tactical-combat.test.ts). Tactical defeat/retreat/recovery contracts exist; all downed/resurrection/surrender workflows remain open.

### SYS-26: Creature Level, Difficulty, Scaling, Enemy Progression & Encounter Challenge

Owner: `difficulty` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: SYS-45

| Scope / fields | Ascension | Rollover |
|---|---|---|
| INSTANCE: committed Creature Level and challenge budget | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |

**Action families:** Compute disclosed challenge, inspect difficulty.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Scaling modes, level curves, challenge budgets and allowed overrides.

**Client:** Challenge label, scaling disclosure and encounter difficulty explanation.

**Acceptance scenarios:**

- Declared challenge scales through supported levels without hidden universal mirroring.
- pinned combat snapshots cannot retune during play.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/tactical-content.ts](../../realms/src/domains/tactical-content.ts), [realms/test/tactical-engine.test.ts](../../realms/test/tactical-engine.test.ts). Validated encounter stats exist; full disclosed Creature-Level/scaling engine remains open.

### SYS-27: Monsters, Enemy Archetypes, Combat AI, Ecology, Variants & Monster Manual

Owner: `monsters` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: SYS-04, SYS-26

| Scope / fields | Ascension | Rollover |
|---|---|---|
| INSTANCE: AI state and creature variants | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |
| WORLD: ecology | KEEP independent shared lifetime | KEEP; apply explicit world schedules once |
| ACCOUNT: bestiary knowledge | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |

**Action families:** Resolve AI intent, observe creature, discover variant.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Monster chassis, AI profiles, senses, ecology and variant budgets.

**Client:** Telegraphed enemy actions, bestiary discovery and knowledge-safe inspection.

**Acceptance scenarios:**

- An AI replay uses the same seed/observations.
- unknown monster information remains hidden and variants obey authored budgets.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/tactical-engine.ts](../../realms/src/domains/tactical-engine.ts), [realms/test/tactical-engine.test.ts](../../realms/test/tactical-engine.test.ts). Fixture enemy intent resolution exists; monster chassis/ecology/variants/knowledge workflows remain open.

### SYS-28: Loot Tables, Drops, Harvesting, Treasure Generation, Rarity & Reward Distribution

Owner: `rewards` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: SYS-07, SYS-27

| Scope / fields | Ascension | Rollover |
|---|---|---|
| INSTANCE: committed reward plan | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |
| RUN: eligibility | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| ACCOUNT: claim provenance | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |

**Action families:** Commit loot, claim, distribute, harvest.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Loot groups, rarity, reward budgets, shared distribution and harvesting.

**Client:** Reward preview where allowed, loot receipts, distribution consent and harvest choices.

**Acceptance scenarios:**

- Reconnect cannot reroll rewards.
- shared claims and harvesting cannot duplicate physical units or bypass reward budgets.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/loot.ts](../../realms/src/domains/loot.ts), [realms/test/loot.test.ts](../../realms/test/loot.test.ts). Pinned authored solo item loot exists; harvesting, broader generation and all shared distribution rules remain open.

### SYS-29: Skills, Proficiencies, Checks, DCs, Contests & Noncombat Resolution

Owner: `checks` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: SYS-03

| Scope / fields | Ascension | Rollover |
|---|---|---|
| RUN: proficiency ranks | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| INSTANCE: committed check and contest evidence | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |

**Action families:** Train, practice, attempt check, contest and inspect explanation.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Skills, DCs, contests, assistance and training limits.

**Client:** Skill sheet, allowed approaches, chance explanation and immutable result.

**Acceptance scenarios:**

- Retry cannot reroll a committed check.
- assistance/contests use declared ownership, costs and failure consequences.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/proficiencies.ts](../../realms/src/domains/proficiencies.ts), [realms/test/proficiencies.test.ts](../../realms/test/proficiencies.test.ts). Earned ranks and combat checks exist; noncombat checks/contests/training/practice remain open.

### SYS-30: Stealth, Detection, Suspicion, Infiltration, Disguises, Trespassing & Heists

Owner: `stealth` · Design tier: Launch Supporting · Implementation: **planned**

Prerequisites: SYS-18, SYS-29, SYS-34

| Scope / fields | Ascension | Rollover |
|---|---|---|
| INSTANCE: detection suspicion and infiltration | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |
| RUN: crime/disguise consequences | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |

**Action families:** Hide, sneak, disguise, infiltrate, trespass, resolve detection.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Senses, suspicion thresholds, disguise evidence and heist hooks.

**Client:** Visibility/suspicion indicators, restricted-area warnings and escape choices.

**Acceptance scenarios:**

- Stealth resolution observes legitimate senses without revealing hidden actors.
- saved suspicion survives reconnect and ties to law/quest consequences.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

No complete implementation evidence mapped; planned work remains.

### SYS-31: Traps, Locks, Environmental Hazards, Puzzles & Dungeon Interaction

Owner: `interactions` · Design tier: Launch Supporting · Implementation: **planned**

Prerequisites: SYS-24, SYS-29

| Scope / fields | Ascension | Rollover |
|---|---|---|
| INSTANCE: trap lock hazard and puzzle state | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |
| RUN: lasting changes | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |

**Action families:** Detect, disarm, unlock, interact, solve.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Interaction predicates, check/cost/effect contracts and fail-forward routes.

**Client:** Inspectable objects, multiple approaches, hazard warnings and solved-state feedback.

**Acceptance scenarios:**

- Concurrent disarm/loot cannot trigger or award twice.
- failed interaction preserves committed evidence and declared consequences.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

No complete implementation evidence mapped; planned work remains.

### SYS-32: Dungeons, Expeditions, Instances, Checkpoints, Procedural Generation & Exploration Rewards

Owner: `dungeons` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: SYS-05, SYS-18, SYS-31

| Scope / fields | Ascension | Rollover |
|---|---|---|
| INSTANCE: seed rooms checkpoints party and objectives | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |
| RUN: eligibility | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| ACCOUNT: milestone claims | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |

**Action families:** Enter, traverse, checkpoint, leave, resume, finish.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Room pools including themed fillers, topology, objectives and expedition budgets.

**Client:** Dungeon map, party readiness, checkpoint resume and exit preview.

**Acceptance scenarios:**

- Seed/topology/checkpoints survive restart.
- all generated paths satisfy reachability and reward bounds with no checkpoint farming.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/instances.ts](../../realms/src/domains/instances.ts), [realms/test/tactical-campaign.test.ts](../../realms/test/tactical-campaign.test.ts). Instance persistence and fixture campaign proofs exist; dungeon graph/generator/checkpoint UI and expedition engine remain open.

### SYS-33: Travel, Wilderness Exploration, Navigation, Survival & Overland Encounters

Owner: `wilderness` · Design tier: Launch Supporting · Implementation: **planned**

Prerequisites: SYS-18, SYS-29

| Scope / fields | Ascension | Rollover |
|---|---|---|
| RUN: route knowledge and survival consequences | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| INSTANCE: optional exploration | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |

**Action families:** Navigate, explore, forage, resolve survival.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Quick travel links, optional wilderness encounters and survival costs.

**Client:** Route preview and optional exploration, with no dedicated field-camp subsystem.

**Acceptance scenarios:**

- Travel remains quick-to-instant according to canon.
- optional survival resolves once and never requires a rejected Trek/camp mechanic.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

No complete implementation evidence mapped; planned work remains.

### SYS-34: NPCs, Dialogue, Relationships, Memory, Schedules & Social Interaction

Owner: `npcs` · Design tier: Launch Core · Implementation: **planned**

Prerequisites: SYS-06, SYS-29

| Scope / fields | Ascension | Rollover |
|---|---|---|
| RUN: relationships memory and dialogue facts | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| WORLD: NPC schedules | KEEP independent shared lifetime | KEEP; apply explicit world schedules once |
| ACCOUNT: persistent knowledge | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |

**Action families:** Talk, choose approved intent, remember consequence, barter.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Dialogue graphs, schedules, relationship writes and AI context allowlists.

**Client:** Dialogue choices, structured freeform confirmation, relationship feedback and Journal links.

**Acceptance scenarios:**

- An NPC cannot reveal secrets via AI or grant arbitrary rewards.
- dialogue retry writes memory/quest consequences once with a deterministic fallback.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

No complete implementation evidence mapped; planned work remains.

### SYS-35: Magic, Spellcasting, Rituals, Spell Research & Magical World Interaction

Owner: `magic` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: SYS-04, SYS-24, SYS-29

| Scope / fields | Ascension | Rollover |
|---|---|---|
| RUN: known/prepared magic research and resource pools | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| INSTANCE: cast ritual and concentration | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |

**Action families:** Prepare, cast, ritual, research, interact magically.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Spell tags, costs, targeting, concentration, rituals and research.

**Client:** Spell preparation, target/resource preview and research notebook.

**Acceptance scenarios:**

- Invalid cast spends nothing.
- interruption/concentration and ritual retries preserve committed costs/results with permitted world interaction.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/tactical-healing-abilities.ts](../../realms/src/domains/tactical-healing-abilities.ts), [realms/test/tactical-abilities-integration.test.ts](../../realms/test/tactical-abilities-integration.test.ts). Tactical ability costs/targets/concentration exist; full spell preparation/ritual/research/world interaction remain open.

### SYS-36: Martial Techniques, Weapon Styles, Combat Maneuvers & Nonmagical Ability Mastery

Owner: `martial` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: SYS-04, SYS-29

| Scope / fields | Ascension | Rollover |
|---|---|---|
| RUN: learned styles and prepared techniques | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| INSTANCE: stance reaction and maneuver | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |

**Action families:** Prepare technique, adopt stance, maneuver, react, learn observation.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Technique costs, weapon/source eligibility and adaptation registry.

**Client:** Technique preparation, legal maneuvers and style/observation progress.

**Acceptance scenarios:**

- Freeform cannot invent a mechanical move.
- learned adaptation and reactions use declared eligibility and consume each resource once.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/tactical-techniques.ts](../../realms/src/domains/tactical-techniques.ts), [realms/test/tactical-techniques-integration.test.ts](../../realms/test/tactical-techniques-integration.test.ts). Typed tactical techniques and checks exist; observation/style/adaptation and preparation workflows remain open.

### SYS-37: Playable Species, Heritage, Origins & Character Identity

Owner: `identity` · Design tier: Launch Core · Implementation: **planned**

Prerequisites: SYS-03

| Scope / fields | Ascension | Rollover |
|---|---|---|
| CHARACTER: stable identity | KEEP stable identity; run-selected identity mechanics belong to RUN | KEEP |
| RUN: chosen species/heritage rules | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| ACCOUNT: identity unlocks | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |

**Action families:** Select species/heritage, record optional narrative origin.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Species and heritage packages, contextual language and cosmetic metadata.

**Client:** Identity setup and narrative backstory without mechanical Background/culture build layers.

**Acceptance scenarios:**

- Species mechanics follow declared run setup/reset.
- narrative origins cannot secretly grant progression packages.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

No complete implementation evidence mapped; planned work remains.

### SYS-38: Investigation, Evidence, Secrets, Rumors & Mystery Solving

Owner: `investigation` · Design tier: Launch Supporting · Implementation: **planned**

Prerequisites: SYS-06, SYS-29, SYS-34

| Scope / fields | Ascension | Rollover |
|---|---|---|
| RUN: evidence secret and rumor facts | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| ACCOUNT: persistent knowledge | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |

**Action families:** Observe, connect clue, reveal secret, resolve mystery.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Quest-integrated clues, knowledge gating and optional mystery depth.

**Client:** Journal evidence and contextual choices with no required detective-simulator interface.

**Acceptance scenarios:**

- Evidence remains knowledge-gated and replay-safe.
- mystery resolution uses normal quest consequences without a separate multiplayer investigation subsystem.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

No complete implementation evidence mapped; planned work remains.

### SYS-39: Taverns, Games, Festivals, Minigames & Social Activities

Owner: `activities` · Design tier: Launch Supporting · Implementation: **planned**

Prerequisites: SYS-11, SYS-34

| Scope / fields | Ascension | Rollover |
|---|---|---|
| INSTANCE: game state escrow | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |
| ACCOUNT: eligibility and receipts | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |
| EVENT: festival contributions | KEEP independent eligibility/contributions; claims bind account/event | KEEP until explicit event schedule/expiry |

**Action families:** Join activity, consent eligible stakes, play, settle, withdraw.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Game rules, recreational rewards, wagering eligibility and risk tutorial.

**Client:** Tavern games, consent disclosure, receipts and safe exit.

**Acceptance scenarios:**

- Interrupted games settle or refund once.
- wagering stays disabled until eligibility tutorial escrow anti-collusion and operational gates are proven.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

No complete implementation evidence mapped; planned work remains.

### SYS-40: Collectible Card Game, Deckbuilding, Card Acquisition & Tournaments

Owner: `cards` · Design tier: Post-Launch Ready · Implementation: **planned**

Prerequisites: SYS-11, SYS-39

| Scope / fields | Ascension | Rollover |
|---|---|---|
| ACCOUNT: card ownership decks | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |
| INSTANCE: match and stake escrow | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |

**Action families:** Acquire, build deck, consent match, play, trade eligible card.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Cards, decks, tournament eligibility and explicit tradable stake rules.

**Client:** Collection/deck builder, match view, tournament and stake consent.

**Acceptance scenarios:**

- Deck/stake snapshots are immutable during a match.
- settlement cannot duplicate cards or stake nontradable cards.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

No complete implementation evidence mapped; planned work remains.

### SYS-41: Monster Taming, Capturing, Training & Creature Companionship

Owner: `taming` · Design tier: Launch Supporting · Implementation: **planned**

Prerequisites: SYS-09, SYS-27, SYS-29

| Scope / fields | Ascension | Rollover |
|---|---|---|
| RUN: active tame and training | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| ACCOUNT: creature unlock/ownership | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |
| INSTANCE: capture attempt | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |

**Action families:** Attempt capture, train, assign, release.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Tame eligibility, capture budgets, temperament and training.

**Client:** Capture chances, creature roster, training history and release confirmation.

**Acceptance scenarios:**

- Capture cannot claim a creature twice.
- taming ownership composes with party limits and retained/archived state at Ascension.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

No complete implementation evidence mapped; planned work remains.

### SYS-42: Boss Encounters, Raid Mechanics, World Bosses & Group Challenges

Owner: `bosses` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: SYS-04, SYS-28, SYS-32

| Scope / fields | Ascension | Rollover |
|---|---|---|
| INSTANCE: boss phases mechanics and contribution | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |
| WORLD: world-boss lifecycle | KEEP independent shared lifetime | KEEP; apply explicit world schedules once |
| ACCOUNT: claim receipts | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |

**Action families:** Join, resolve mechanic, advance phase, claim result.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Boss telegraphs, phase triggers, shared credit and world-event gates.

**Client:** Boss objectives, consent, telegraphs, group contribution and result.

**Acceptance scenarios:**

- Phase transitions and reward claims survive restart once.
- absent/late participants cannot receive invalid credit, and large world bosses remain gated.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/tactical-campaign.ts](../../realms/src/domains/tactical-campaign.ts), [realms/test/tactical-campaign.test.ts](../../realms/test/tactical-campaign.test.ts). Fixture final-combat evidence exists; boss mechanics/phase/raid/world-boss frameworks remain open.

### SYS-43: Classes, Subclasses, Feats & Signature Abilities

Owner: `classes` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: SYS-03, SYS-29

| Scope / fields | Ascension | Rollover |
|---|---|---|
| RUN: class levels subclasses feats signature abilities | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| ACCOUNT: permanent access | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |

**Action families:** Choose class, multiclass, subclass, feat and signature.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Locked 12 base-class identities, configurable subclass/feat packages and prerequisites.

**Client:** Class and choice panels, eligibility explanation and build preview.

**Acceptance scenarios:**

- A choice consumes an earned milestone once.
- native/subclass prerequisites reconcile to history and example subclass names never become canon by import.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/subclasses.ts](../../realms/src/domains/subclasses.ts), [realms/test/feats.test.ts](../../realms/test/feats.test.ts). Class/subclass/feat eligibility and immutable choices exist; complete 12-class engine/UI and all signature mechanics remain open.

### SYS-44: Worldbuilding, Lore, Main Campaign & Narrative Structure

Owner: `campaign` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: SYS-06, SYS-18, SYS-34, SYS-42

| Scope / fields | Ascension | Rollover |
|---|---|---|
| RUN: campaign graph crisis resolution | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| ACCOUNT: Chronicle and world knowledge | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |

**Action families:** Advance campaign, resolve alternate route, prove conclusion.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Campaign facts, route graphs, ending proofs and lore governance.

**Client:** Campaign Journal, alternative routes, real crisis conclusion and future hooks.

**Acceptance scenarios:**

- Two small fixture routes reach a real campaign conclusion.
- Ascension eligibility requires persisted proof without forcing explicit reincarnation lore.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/tactical-campaign.ts](../../realms/src/domains/tactical-campaign.ts), [realms/test/tactical-campaign.test.ts](../../realms/test/tactical-campaign.test.ts). Fixture campaign completion evidence exists; quest/world/dialogue campaign graph and narrative framework remain open.

### SYS-45: Game Balance, Progression Curves & Numerical Tuning

Owner: `balance` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: SYS-23

| Scope / fields | Ascension | Rollover |
|---|---|---|
| RUN: pinned rules package | ARCHIVE_WITH_OWNER; create fresh state from versioned next-run setup, with explicit custody/inheritance exceptions | KEEP except explicitly registered RESET_AT_ROLLOVER fields; defer during active encounters |
| INSTANCE: derived snapshots | BLOCK while active; terminal instances remain archived evidence | KEEP committed seed/release/checkpoints; use declared effect/instance clocks |
| WORLD: tuning release | KEEP independent shared lifetime | KEEP; apply explicit world schedules once |

**Action families:** Publish tuning package, simulate and inspect rule explanation.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Versioned curves budgets and modifier precedence; prototype values marked tunable.

**Client:** Explain progression/difficulty/gear contribution without secret personalized tuning.

**Acceptance scenarios:**

- Levels through 999 use finite diminishing curves.
- old snapshots stay pinned while new tuning preserves economy budgets and major gear contribution.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [realms/src/domains/character-mechanics.ts](../../realms/src/domains/character-mechanics.ts), [realms/test/character-mechanics.test.ts](../../realms/test/character-mechanics.test.ts). Attribute/equipment passive stat snapshots exist; centralized curves, budgets, long-tail scaling and simulation remain open.

### SYS-46: Final Integration, Contradiction Audit, Content Production & Development Roadmap

Owner: `production-tools` · Design tier: Launch Core · Implementation: **partial**

Prerequisites: SYS-23

| Scope / fields | Ascension | Rollover |
|---|---|---|
| ACCOUNT: author/admin roles | KEEP | KEEP except explicitly registered daily contracts; account/epoch receipt is never reset |
| WORLD: release metadata audit flags and telemetry | KEEP independent shared lifetime | KEEP; apply explicit world schedules once |

**Action families:** Draft, validate, simulate, review, publish, stage, promote, rollback.

**Permissions:** Authenticated owner intent; active-run/revision checks; INSTANCE participant or explicit shared consent; GUILD role and EVENT eligibility where applicable. Author/admin writes require separate least-privilege roles and audit. Queries filter secrets before projection/counting.

**Schemas and Studio:** Typed editors, dependencies, canon/feature registry, validation and migration/rollback manifests.

**Client:** Studio search, previews, change diff, review queue and audited release workflow.

**Acceptance scenarios:**

- Broken content is blocked before publish.
- exact-source verified staging promotes/rolls back with history, role separation and no secret/live-player edits.

Apply the shared `framework-done` profile as well as every applicable source-rule assertion.

Baseline subset: [infra/development_client/model.py](../../infra/development_client/model.py), [infra/tests/test_development_studio.py](../../infra/tests/test_development_studio.py). Studio/content checks and frozen-checkpoint publication exist; all typed editors and live rehearsal remain open.
