# The Bell Below Brackenford — vertical-slice brief v1.0.0

**Disposition: PROVISIONAL content and production plan.** M01 defines the work; it does not implement or publish this region. Names, exact traits, budgets and tuning remain subject to owning-domain review. No example subclass/species catalog is promoted to LOCKED. Existing canon stays intact: [canon and decisions](canon-and-scope.md), [status matrix](status-matrix.md), [dependency board](dependency-board.md).

Source basis: fingerprinted Core + Systems 01–46 in [the source manifest](../SOURCE_MANIFEST.md). References below use `system#section` from that immutable snapshot; `feature_registry.py --show CAP-44-region-identity` expands the exact statements. The [issue tree](issue-tree.json) also records stable section IDs. A section reference is traceability, not proof that every rule in it is implemented.

## Purpose and bounded content

Prove explore → encounter → choose/resolve → loot → improve → quest → boss/crisis conclusion → optional Aftercore → Ascend → replay differently. This is a tiny test campaign, not the entire launch campaign and not permission to cut launch obligations. S46 §11–14, §63; Core `pillars`, `ascension`, `tone`; S44 `ending`.

A small river town depends on an old flood-control bell. It has begun ringing beneath the earth, diverting water from the mill and waking the dead maintenance crew. The town council blames marsh raiders; a surviving works apprentice thinks the bell is obeying a lawful but obsolete evacuation order. The player follows the missing water, decides whom to trust, then ends the immediate crisis by force or by completing the interrupted release procedure.

Sincere high fantasy with comedy in institutions and consequences: a flood warning can be filed correctly and still flood a home. People fear losing crops and relatives; the climax allows grief and relief without a compulsory joke. The town's assistant registrar insists that forms damaged by water require a second, waterproof form. This is an original tone example, not an imported franchise character or setting. Ascension remains mysterious; no townsfolk deliver a definitive reincarnation lecture. S44 `opening`, `tone`, `tone-guardrails`, `ascension`, `ascension-awareness`.

| Regional identity | Provisional answer |
|---|---|
| Landscape | Reed marsh, raised road and abandoned drainage works beneath a low ridge; readable local travel, no trek/camp subsystem |
| People | Mill families, reedcutters, works apprentices and ferrymen; humans and goblins are ordinary neighbors, not moral categories |
| Authority | A river reeve claims jurisdiction; a maintenance compact predates the town charter; neither has all the facts |
| Economy | Grain milling and reed paper; needs dry roads and replacement ironwork; provisioning/repair is a small repeatable Gold sink |
| History | A past flood sealed the works while workers were still below; the bell's mandate was never properly discharged |
| Adventurers | Hired for dangerous work, paid for verifiable outcomes, tolerated with receipts; no singular chosen-one premise |
| Adventure identity | Misidentified enemies, practical mechanisms, a remembered passage and a boss with a comprehensible duty |
| Emotional promise | Solve a local material problem, understand an old loss, choose a method that matters and find a new approach in life two |

Source: S44 `region-identity`, `adventurer-culture`, `adventurer-economy`, `antagonists`, `class-species`; S37 `social-lore`.

## Map sketch and location contract

```text
BRACKENFORD (hub)
  Copper Kettle: quest contacts, food/booze, companion, authored intent scene
  Mill Yard: vendor, repair, storage, routine recipe, flood gauge
  Records Desk: testimony and public works plan
       |
       | known raised road; declared Turn cost, safe return
       v
REEDWAKE MARSH (one optional wilderness/adventure area)
  Cart crossing --- Silt camp (fight OR negotiation)
       |                    |
  Survey cairn ---------- Old Sluice entrance
       |                    |
  [learned culvert route] --+
                            v
THE DROWNED WORKS (one compact dungeon)
  1 Entry gallery -- 2 Pressure room -- 3 Seal archive
        |                |                  |
  themed filler alcove   +-- checkpoint -----+
        |                                   |
  culvert entry ---------------------- 4 Bell chamber
                                             |
                                      5 Outflow / resolution
```

The sketch is connectivity, not a final coordinate map. Graph edges declare visibility, eligibility, cost, safety/return and scope. Travel is quick; wilderness exploration is optional play. The culvert is a second route, not an obligatory long-distance travel system. Known route list and graphical map must offer equivalent controls. S18 `summary`; S33 `summary`; S32 `topology`, `fog`, `legend`, `branches`; S46 §11.

Five landmark rooms are authored. One or two small themed filler alcoves vary in a pinned instance seed; their purpose is believable architecture and a small surprise, not a procedural-generation expansion. Reconnect restores the exact graph, discovered edges, puzzle state and committed treasure. Pressure-room valves have distinct safe/unsafe states; a failed adjustment vents a side drain, opening a salvage path at a declared resource cost. No puzzle rolls or boss loot reroll on re-entry. S32 `landmarks`, `filler`, `seed`, `resume`, `puzzle_validation`, `rewards`; S31 `summary`.

The bell chamber checkpoint offers a known safe return and explicit re-entry policy. It does not erase encounter costs, restore arbitrary resources or reset committed phase/loot facts. The Bellwarden uses two readable mechanics: a committed bell-wave windup with a positional response, and pressure conduits that can be disabled through legal interactions. The peaceful route discharges its mandate using the release seal and repaired pressure sequence; a boss fight remains a complete available experience. No class, species, consumable or companion is mandatory. Exact damage, timing and encounter budgets belong to reviewed content. S42 `signature-budget`, `phase-model`; S04 `summary`; S25 `summary`; S45 `boss-budget`.

## Character scope

Use three base classes already in the approved twelve-class roster. Implement a deliberately narrow low-level native loop for each; the existing class-choice database is not itself a class engine. No subclasses are required for this small test campaign. If test growth reaches class level 5, add a reviewed specialization decision or adjust the **test campaign's** progression budget explicitly; do not invent an auto-approved subclass. Full launch level/progression and class roster obligations remain unchanged.

| Slice class | Distinct combat decisions to prove | World-facing affordance to author | Parity guard |
|---|---|---|---|
| Fighter | Weapon stance/guard and resource-limited control; choose when to protect a companion versus interrupt a conduit | Brace the damaged pressure gate while another actor works it | A tool/assistance route achieves the same objective; no Fighter-only mandatory door |
| Rogue | Setup, positional precision and mobility; choose an opening versus controlling exposure | Reach the inspection latch from a known side passage without forcing the main gate | Investigation/tools or peaceful access provide equivalent principal reward |
| Wizard | Prepared arcane choice and bounded resource recovery; choose control versus spending a scarce cast | Analyze the bell's repeating command and reveal a lawful counter-phrase | Archive testimony reveals the same fact; spellcasting cannot fabricate evidence |

These native loop details are **M01 proposals**, not claims that all mechanics are in M00. SL-04 must demonstrate actual native engine behavior and world actions, with typed costs, eligibility, UI and bounded effects. Examples of names, stances or spells remain tunable content. Sources: S03 `classes`, `abilities`, `guardrails`; S43 `roster`, `class-engine`, `world-facing`, `no-trinity`, `subclass-deferred`; S35/S36 `summary`.

Provisional minimal species choice: **human or goblin**. All three classes work with either. Traits are small contextual capabilities within a reviewed budget; do not define universal stat superiority or free extra traits here. Appearance and names are supported independently. No separate culture selection, no mechanical Background package and no mixed-heritage stacking. This pair is not the final launch species roster; the substantial curated target and mixed-heritage framework remain later obligations. S37 `locked`, `roster`, `traits`, `species-class`, `no-culture`, `no-background`, `ui`.

One companion: **Nell, a retired sluice tender**, recruited by resolving the missing-cart objective through either approach. She can assist with mechanisms and provide a stable tactical partner without replacing the player or demanding a tank/healer/DPS trio. Recruitment and approval reset with the run; any persistent companion history is a separately declared account field, not permission to retain current recruitment. Consider an inexpensive Familiar path (a marsh lantern-moth observing hidden markings); SL-04 records inclusion or a justified cost-based deferral before the slice gate. S09 `summary`; S43 `companions`; S46 §11.

## Quest graph and outcomes

Four quests form a complete, small campaign. An obstacle has one principal reward identity across every resolution; fighting after negotiation does not re-earn its XP/loot. Minor incidental rewards need explicit separate budgets. Quests own outcomes and claims; combat/checks/dialogue supply lawful evidence. Sources: S06 `objectives`, `outcomes`, `graph`, `solutions`, `rewards`; S45 `objective-xp`.

| Quest / graph node | Combat route | Noncombat route / clue | Class shortcut / fail-forward | Outcome and consequence |
|---|---|---|---|---|
| Q1 The Missing Cart | Defeat marsh scavengers guarding the stranded cart | Negotiate the return after recognizing the cart sank at a flood surge; rescue the trapped driver | Fighter braces the cart, Rogue frees the axle, Wizard identifies pressure marks; failed check loses supplies but driver directs player to the camp | Recover witness/tool access; recruit Nell by either route; `cart-resolved` reward once; debt/attitude is run-scoped |
| Q2 The Wrong Warning | Fight hostile drowned sentries at the survey cairn and recover a stamped plate | Compare the public works plan, gauge marks and apprentice testimony; the pattern is an old evacuation instruction, not a raider signal | Wizard decodes the repetition; Rogue gets a rub of the plate; Fighter recognizes emergency bracing marks. Missing/hostile witness is replaced by readable evidence at the cairn | Learn that a release seal exists. Claim `warning-understood` once; clue knowledge is not automatic proof of current NPC guilt |
| Q3 Under the Waterline | Clear a sentry from the main entrance and force the pressure mechanism legally | Repair the vent with a routine recipe/tool and carry out the posted safe sequence | Three optional class affordances above. A bad valve attempt floods an alcove but opens the costed salvage route; retreat remains available | Enter bell chamber; checkpoint and seal proof committed. `works-access` reward once; no endless retries or trapped critical item |
| Q4 Discharge of Duty | Defeat the Bellwarden using committed telegraph/counterplay | Present the release seal and restore the pressure sequence; explain the displaced obligation through authored dialogue | Earlier clues shorten the sequence; no class-specific win button. Retreat preserves facts; failed bargaining transitions into declared combat or safe withdrawal, never destroys the only ending | `bell-crisis-resolved` campaign proof; water returns, missing crew can rest. Record force/accord and compensation consequences in the ending; award once |

Clue **C1: the stamped plate's date predates the current reeve's charter** links the old works plan to the bell order. It provides a concrete inference without a detective simulator. The Journal records observed fact, source and available leads; it never asserts undiscovered theories as truth. NPC beliefs may differ from canonical facts. S38 `summary`; S34 `truth_belief`; S06 `evidence`, `journal`.

Q1 and Q2 may be completed in either order after the opening. Q3 requires **either** restored main access **or** the discovered culvert, plus a solvable mechanism route. Q4 peaceful resolution requires current-run seal/pressure proof; combat is always a viable alternative. No single missable check, permanently lost NPC or consumed quest item blocks all endings. Necessary clue discovery has at least two lawful sources. Validator checks reachability for every authored failure branch, including abandon/re-entry and a player arriving without Nell. No repeated check grants free information beyond its retry contract. S29 `retry`, `persistent`; S06 `validation`; S44 `campaign-flow`.

## Economy, daily play and a real ending

Keep production deliberately small: one vendor, a repair service, personal storage, one routine recipe to make a vent brace, three reviewed food/booze entries and a repeatable salvage contract. Salvage is the bounded Gold faucet; repairs/provisioning are the repeatable sinks. None pays a principal quest reward again. Food and banked Turns must affect a real decision about preparation, route or rest; show remaining capacity, reserve and rollover consequences in the existing planning UI. Protect locked/bound items and explain prices, carrying and failures. No player market, wagering or payments. S01/02/07/08/11 `summary`; S45 `turn-economy`, `economy-balance`; S46 §11.

The final scene resolves the bell crisis in either route. The town's water supply is visibly restored in **this run**, NPC reactions acknowledge the method, and the player receives a campaign-completion summary. A distant missing signature on the order can remain a mystery; it does not reveal that the local victory was worthless. The full launch campaign still needs its own real conclusion and expanded regions. Offer stay-in-Aftercore or begin Ascension; never force reset at a level or because the boss died. Slice Aftercore offers continued salvage/alternate challenge testing, not a claim to have finished Launch Core Expedition/endgame scope. S44 `ending`, `ending-variants`, `aftercore`; S10 `eligibility`, `aftercore`; S46 §10.

## First Ascension reward and second-life route

Choose a **knowledge reward**, not a new numerical Mastery grant: **Sluice Survey** (`proposal.knowledge.sluice-survey`). Completing the first campaign records that the old inspection culvert can exist and that a release seal can be found. Persistent account discovery survives the explicit Ascension transition; local puzzle completion, quest outcomes, NPC relationships, class build and current-run recruitment reset. Pin the knowledge definition/release. Owner: content-knowledge, coordinating with existing discovery persistence and the Ascension transaction. Knowledge is a permitted useful reward; it does not imply the full Mastery Library is implemented. S10 `persistent`, `worldstate`; S29 `persistent`; S03 `mastery`; S44 `echoes`.

In life one a new player is likely to take the raised road, investigate the camp, enter the main works and defeat or appease the Bellwarden. In life two they can choose a different class, recognize the survey cairn, discover the culvert early, then obtain the **new run's** release seal and resolve Q4 by accord. The route skips repeated exposition and provides an alternate approach, not free current-run rewards or an automatically completed puzzle. Necessary tools remain obtainable without solving Q1 first. A fresh account can also discover this route through exploration; account knowledge is convenience and interpretation, not a mandatory power gate.

The player can say what actually changed: a new route, a different native capability, a changed preparation decision and a different crisis outcome. The ordinary reeve does not remember a prior run's crime as personal memory. Account abuse/accountability data and shared/live state keep their explicit scopes. Avoid revealing the ultimate truth of Ascension. New-life preview explains preservation/reset/archive and the retained knowledge. S10 `transition`, `worldstate`; S37 `account-run`; S44 `ascension`, `live-world`; S46 §65.

## Usability and production acceptance

These are **proposed slice gates**, to be versioned with playtest findings; numerical thresholds are not canonical balance constants. An automated pass cannot replace observed usability. Archive exact source/build, content manifest, schema/configuration, test persona, route and result. Record pass/fail separately for each criterion; no overall green checkbox until all applicable criteria pass.

| ID | Scenario and measurable acceptance | Evidence / owner |
|---|---|---|
| A-01 First-session comprehension | At least 4 of 5 new testers, without external documentation, locate current goal, spend a Turn knowingly, improve/equip a character, resolve Q1 and find recovery after an authored failure; observer prompts count as misses | Observation script and anonymized task results; player-client; S46 §12 / S16 `tutorials` |
| A-02 Complete first life | Each class, with each slice species, completes the crisis through combat and at least one peaceful route; no required party trinity, missing quest item or single failed check creates a hard lock | Seeded route/eligibility matrix; quests/campaign; S44 `solutions` / S37 `species-class` |
| A-03 Recovery and history | Duplicate, stale, concurrent and post-restart actions cannot reroll checks/seeds/loot, double-charge Turns or double-grant an objective; exact room/phase/Journal resume | Disposable integration/replay receipts; authority/domain owners; S23 `idempotency`, S32 `resume` |
| A-04 Second-run enjoyment | The same five testers play twice; at least 4 intentionally use a different route or class affordance and can explain Sluice Survey's effect; at least 3 rate life two enjoyable and wish to try another approach. Report raw small-sample results, not statistical proof | Two-run route log, short interview, rated friction/enjoyment and abandonment reason; campaign/balance; S46 §12 |
| A-05 Compositional solution | An ordinary capability/check/effect and an authored context tag combine to solve one obstacle through existing contracts; no bespoke class-name win button or freeform reward invention | Trace from legal intent through shared rules to one outcome/claim; checks/quests; S46 §12 |
| A-06 Daily and Ascension boundaries | Rollover simulation, banked-turn use, food/nightcap, rest, disconnect and transition preserve their field-specific budgets; new life retains only declared knowledge and account state | Before/after scope manifest and receipts; turn-economy/ascension; S46 §11/65 |
| A-07 Authoring without source edits | Designer changes one monster, item, quest, encounter and loot table in typed Studio controls, previews, validates and exports a versioned candidate without editing game code | Screen/operation record, content diff and diagnostics; production-tools; S46 §12/16 |
| A-08 Reject broken content | Reference error, unreachable ending/fail-forward, duplicate principal reward, hidden fact exposure, invalid class/trait and budget error each stop validation before seal/publish | Invalid-package fixtures and named validator output; production-tools; S46 §23 |
| A-09 Telemetry fidelity and privacy | Every defined event below correlates to one committed outcome; retries do not count twice, a collector outage does not affect settlement, and players cannot read secret fields | Reconciliation query, redaction test, outage/retry simulation; telemetry/authority; S23 `telemetry`, S45 `no-personal-scaling` |
| A-10 Accessibility and error recovery | Full loop by keyboard at desktop and narrow-phone layouts, 200% zoom and reduced motion; focus/dialog/disabled reasons understandable; device screen-reader and touch checks recorded separately | Browser captures plus device checklist; player-client; S46 §60 / S16 `access` |
| A-11 Balance and authorability review | Compare representative builds, class routes, recovery costs and first/second life resource use; no unexplained order-of-magnitude effort gap or mandatory single item. Values are editable pinned content; class-native restrictions respected | Budget/simulation/playtest report with content revisions; balance; S45 `build-viability`, `simulations` |
| A-12 Readiness boundary | Refresh eight-axis matrix and exact candidate CI; confirm M00 operational identities before claiming deployable/activated. No prototype content reaches production through an implied design signoff | Release checklist and operator evidence; production-tools/operator; S46 §43–45/70 |

Do not use a Turn-count speed target to pressure first-run discovery. Record observed duration/Turns, then tune a budget; a second run is better because choices differ, not merely because text is skipped. Capped objective budgets and no secret personalized difficulty remain invariant. No new launch promise is created by a proposed playtest threshold.

## Telemetry contract before implementation

Use versioned server events derived from committed receipts, not untrusted click counts. Shared envelope: schema version, event ID, server time, pseudonymous account/run IDs, content release, objective/encounter/route definition revisions, action receipt and outcome code. Use bounded coded enums, not raw free text. Event identity is unique per committed receipt/event-kind; retries replay the same event identity. Collection is an outbox/projection with its own retention and restricted staff access; it cannot decide rewards or modify encounter difficulty.

| Event family | Bounded payload / purpose | Secret boundary |
|---|---|---|
| Turn/daily | debit/credit reason, amount, banked/rest/rollover outcome; compare actual route cost and recovery | No credentials, inventory dump or private narration |
| Encounter | start/end, disclosed enemy/content IDs, class archetype, rounds, damage/healing totals, defeat/retreat and item debit totals | No seeds, hidden formulas, undiscovered loot or private shared-player facts |
| Objective/quest | known objective ID, resolved route enum, outcome degree, principal claim ID and failure/retry reason | No unrevealed alternate routes in player-facing logs |
| Drops/economy | committed reward source, versioned budget reference, quantity/value bands, sink/faucet code | Raw precise audit records remain privileged; player views show only their grants |
| Ascension | eligible/preview/confirm/outcome, mode, knowledge carry code and second-route usage | No full prior-life personal narrative or internal preview digest |
| Usability/authoring | opt-in test cohort, task completion, abandon reason; validation rule ID/content kind/severity | No chat text, passwords, staff tokens or secret content in player analytics |

Dashboards: first/second-run funnel, route/class/species completion and defeat distribution, Turns/rest/consumption per objective, Gold sources/sinks, principal claim duplication (must be zero), return/reconnect failure, validation failures and content-author task completion. Separate mechanical events from playtest ratings. S46 §28–29; S45 `telemetry`, `no-personal-scaling`; S23 `telemetry`, `retention`.

Retention proposal: use a short-lived access-controlled raw playtest event window (suggest 30 days), then aggregate; pseudonymous identifiers can still be personal data. Operator/privacy review must approve exact retention/access/deletion and support diagnosis needs before collection outside an opt-in test. This is an unresolved operational setting, not deployed policy. No analytics collection is added by this brief.

## Exclusions and change control

No new world regions, full subclass/species catalog, market/Guild/PvP/card/taming system, world-boss raid, full live-event cadence, wagering/payments, full endgame Expedition, numerical Mastery economy or definitive Ascension cosmology in this slice. These exclusions do not erase their canonical launch tiers. No content/framework may skip its server, Studio, player workflow, lifecycle and evidence obligations because it is small.

Review sequence: domain owners resolve D-M01 decisions → implement issues in dependency order with small fixtures → prove the two-life loop and typed authoring → review content/tuning → seal an isolated candidate → pass recorded gates → request any production activation separately. A source/correction/brief change bumps version, explains compatibility impact and revalidates links and issue dependencies. Rollback of M01 is a documentation revert; no player-data conversion is part of M01.
