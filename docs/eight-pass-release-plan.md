# Eight passes to release readiness

Complete these eight passes in order. Each pass includes implementation, acceptance checks and review, and may require multiple migrations. Keep the current pass open until its acceptance criteria are implemented and verified before moving to the next. Optional launch systems must be explicitly included or deferred; deferrals remain visible.

## 1. Combat and character mechanics — in progress

Complete an authoritative, versioned tactical ruleset alongside the frozen BASIC_DUEL_V1 prototype. Derive stats from pinned run attributes, owned native class levels, selected subclasses/feats, and active equipment. Preserve a source breakdown and encounter-start snapshot. Execute authored abilities and checks with journaled random draws. Support initiative, Main/Quick/Reaction budgets, legal range/zone movement, typed damage, defensive reactions, conditions, party Downed/Defeated states, revival, retreat and disclosed failure contracts. Server-controlled opponents obey the same legality rules.

Acceptance: a playable party encounter demonstrates these mechanics, reconnect resumes exactly, duplicate/stale requests cannot advance twice, invalid intents roll back, victory/failure settle once, and replay reconciles immutable combat evidence. Historical basic duels retain their original formulas and rewards. At least one class, subclass, feat, weapon and defensive item have actual executed effects, not merely selection eligibility.

Current implementation: strict publication contracts and deterministic character derivation; SQL-verified immutable source snapshots; and a playable [saved tactical combat loop](tactical-engine.md) with authenticated actions/resume, individual initiative, Main/Quick/Reaction budgets, zones/range, server-journaled attacks, owned healing/guard capabilities, mana costs, Downed/Defeated/revival, bounded enemy turns, retreat and exact-once loot/XP/recovery. Immutable origins/steps/recovery and an independent history replay audit reconcile the fight and retained health/mana. Tests demonstrate executed class, subclass, feat, weapon and defensive-item effects. Production balance is not implied by fixtures. Opt-in [typed damage traits](tactical-typed-damage.md) now execute pinned attack types, armor penetration and matching damage resistance with history replay. Authored [tactical campaign proofs](tactical-campaign-proofs.md) now verify earlier victories, settle the finale atomically, enter Aftercore and allow voluntary Ascension. Opt-in [round conditions](tactical-round-effects.md) now execute pinned on-hit accuracy/evasion/armor modifiers with explicit Replace/Refresh families, owner-turn durations and history replay. Opt-in [periodic effects](tactical-periodic-effects.md) now execute snapshotted damage at owner-turn end and healing at turn start, reconcile mitigation/source evidence, and settle periodic victories/failures through the existing atomic loop. Opt-in [cleansing counterplay](tactical-cleansing.md) now removes one selected typed effect using pinned owned Cleanse/Dispel/Cure abilities, deterministic tag/strength eligibility, Main/mana costs and full removal replay. Opt-in [status immunity](tactical-status-immunity.md) now blocks matching harmful/mixed effect tags using pinned owned/template defenses and independently replayed blocked-source evidence, separate from damage resistance. Opt-in [selectable attack abilities](tactical-attack-abilities.md) now execute pinned owned/template mana-powered attacks with authored range/type/damage/penetration, journaled rolls, Main/mana costs and independent usage replay. Opt-in [selectable healing abilities](tactical-healing-abilities.md) now execute pinned owned/template single-ally healing with authored range/amount, Main/mana costs, journaled healing draws and Downed revival evidence. Opt-in [damage-family resistance](tactical-damage-families.md) now expands authored concrete family membership into encounter-start defenses, combining direct and family contributions before capping for basic/selected attacks and periodic damage. Broader support kinds, distinct resources and attribute/proficiency check integration, conditional resistance rules, resistance reduction and immunity bypass, partial condition resistance/saves and immunity bypass, buildup/control, Remove Curse/persistent cleansing and other effect clocks, surprise/opportunity reactions, stabilization/resurrection, full failure/injury contracts and owned companion/shared participants remain work inside this pass.

## 2. Complete progression

Training and practice/check evidence, respec, special starts, Mastery, Legacy, and remaining Ascension rules. Acceptance: a complete new life can progress, finish, preview Ascension and begin another life with the exact designed account/run carryover, costs and reward history.

## 3. Quests and world state

Validated quest graphs, objectives, rewards, NPC memory, factions and lasting consequences. Acceptance: fail-forward and branching quests reconcile rewards and scope correctly across retries, campaign completion and Ascension.

## 4. Items and crafting

Advanced recipes, durability, upgrades, commissions and production capacity. Acceptance: items retain conservation and custody through every shipped lifecycle; interrupted crafting, repairs and commissions recover without duplicate outputs or lost inputs.

## 5. Daily and scheduled systems

Supervised rollover, banking, Home production and effect expiration. Acceptance: scheduler downtime, retries, clock boundaries and accumulated work cannot double-grant or lose entitlement; clocks follow their authored scope.

## 6. Shared launch systems

Companions, guild permissions, markets, events, multiplayer and claims that are included at launch. Acceptance: each included system has a working loop, ownership checks, contention tests and exactly-once settlement. PvP, raids and purchases need explicit launch decisions before being treated as required or deferred.

## 7. Production operations

Independent encrypted automatic backups, retention, point-in-time recovery, environment isolation, stronger staff authentication, service supervision, alerts, administrative repair and account export/redaction. Acceptance: documented monitoring and restore drills demonstrate the agreed recovery objectives on a separate machine, using production-equivalent configuration.

## 8. Release verification

Representative data volumes, query plans, connection limits, load/failure tests, migration rehearsal and independent recovery. Acceptance: all launch features have traced design requirements and tested authority/lifetime contracts; the release checklist records evidence, unresolved limits and an explicit release decision.

The existing release-readiness checklist remains authoritative for operational gates. A successful private test run is not public-release certification.
