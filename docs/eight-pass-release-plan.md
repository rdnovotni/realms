# Eight passes to release readiness

Complete these eight passes in order. Each pass includes implementation, acceptance checks and review, and may require multiple migrations. Keep the current pass open until its acceptance criteria are implemented and verified before moving to the next. Optional launch systems must be explicitly included or deferred; deferrals remain visible.

## 1. Combat and character mechanics — in progress

Complete an authoritative, versioned tactical ruleset alongside the frozen BASIC_DUEL_V1 prototype. Derive stats from pinned run attributes, owned native class levels, selected subclasses/feats, and active equipment. Preserve a source breakdown and encounter-start snapshot. Execute authored abilities and checks with journaled random draws. Support initiative, Main/Quick/Reaction budgets, legal range/zone movement, typed damage, defensive reactions, conditions, party Downed/Defeated states, revival, retreat and disclosed failure contracts. Server-controlled opponents obey the same legality rules.

Acceptance: a playable party encounter demonstrates these mechanics, reconnect resumes exactly, duplicate/stale requests cannot advance twice, invalid intents roll back, victory/failure settle once, and replay reconciles immutable combat evidence. Historical basic duels retain their original formulas and rewards. At least one class, subclass, feat, weapon and defensive item have actual executed effects, not merely selection eligibility.

Current implementation: strict publication contracts for additive class/feat/subclass/equipment modifiers, authored attribute scaling, deterministic derived-stat source breakdowns, d20 check resolution, exact hit-chance displays, and connection/critical/armor/penetration/resistance damage evaluation. Opted-in encounter starts now capture SQL-verified immutable snapshots from configured run builds and worn/active equipment, with historical evidence and independent replay auditing. These mechanics are not yet executed through a playable tactical API. No production balance is implied by test fixtures. Action execution, active/reactive effects, party rescue, resistance families and stacking remain work inside this pass.

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
