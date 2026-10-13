# Authored ordinary item loot

Migration 007 adds immutable encounter reward plans, claims and links to inventory grant operations. Existing content, instances, draws, items and player state are preserved. There are now 50 tables including migration bookkeeping. This implements ordinary personal item loot; currency rewards, modifier/pity systems, shared loot, extraction budgets, chests, procedural budgets and production balancing remain separate work.

## Content contract

LOOT_TABLE mechanics declare `loot: { version: 1, commitment: "ENCOUNTER_START", groups: [...] }`. Each group has a unique short key, a rational chance (`numerator` / `denominator`), and weighted entries. A successful group selects one entry. Groups roll independently; zero chance awards nothing, and equal numerator/denominator guarantees an entry. Each entry declares `itemId`, positive `weight`, positive `min`/`max` quantity, `binding` and positive decimal-text `quality`.

The validator bounds tables to 16 groups, 32 entries per group, one million per weight/quantity/chance component and existing inventory quality precision. These are engine safety ceilings, not evidence of economy balance. Every referenced item must be a typed ITEM in the same package and an explicit dependency. Equipment/instance items must have quantity one. Missing references, invalid odds/ranges, unknown properties and invalid bindings fail publication.

An ENCOUNTER opts in with mechanics `encounter: { version: 2, turnCost: 1, lootTableId: "loot.example" }`. Its loot table must be in the package and an explicit dependency. Existing version 1 encounter declarations retain their foundation behavior. Content versions and release pins remain immutable; later publication cannot change an existing encounter's committed plan.

## Server authority and commitment

The owning location/quest/combat handler authorizes encounter eligibility, then calls `beginAuthoredEncounter` inside the normal Action transaction. The helper creates the encounter, commits its Turn cost, rolls the loot through named durable RNG draws and inserts the exact item plan. No item is issued yet. A failed start leaves no cost, draws, instance, plan or receipt. Receipt replay returns the same instance and cannot reroll the plan.

Chance, selection and quantity use distinct named draws in the loot stream. Other random streams do not advance it. Draws exist even for deterministic bounds of one, preserving the semantic operation history. A skipped group records its chance draw only. Draw keys include the authored group key. Hidden weights, quantities, seeds, draws and unclaimed rewards are never exposed through the instance view.

The client never supplies a reward table, plan, item definition, quantity, quality, binding, destination or victory assertion. These helpers are internal; no generic claim or win HTTP endpoint is added. This pass does not decide whether a player won a fight. The future combat handler must validate the terminal combat state before invoking settlement.

## Awarding items

After validating victory, the owning handler calls `settleAuthoredVictory`. This reads the existing plan, issues its exact items into the current run's default CARRIED container, records provenance and ledger links, and resolves the encounter through the same Action transaction. Missing carried custody aborts settlement; it does not mark the encounter won or partially grant items. A late failure rolls back every item, ledger operation, claim, outcome and receipt while preserving the previously committed plan.

An empty plan still records a victory claim. Retries replay the Action receipt. Another request cannot reopen or settle the encounter. Retreat, defeat, surrender and failed-forward preserve the plan without granting victory loot. Authored consolation/quest/failure rewards need their own explicit policies and operation keys; they are not fabricated from this victory plan.

Each grant records the encounter, loot table and group as provenance. Quality, binding, item definition and release remain subject to the inventory foundation's immutable provenance rules. Items can later move or be consumed legitimately; reconciliation compares the original grant operation, rather than requiring the current stack quantity to remain unchanged.

## Database checks and operations

Deferred constraints require version 2 encounters to have their creation-time plan, the table/release/start Action to match the encounter, and victory to have a claim from the finishing Action. Each claimed group must link to one exact GRANT operation with the intended item, quantity, quality, binding, release, source and provenance. Missing/extra grant links or a claim on another outcome fail commit. Reward history cannot be edited or deleted. Runtime grants are append-only for all three new tables.

The read-only audit and disposable restore check query the same reconciliation view. SQL validates committed reward shape and reconciles issuance; it does not cryptographically recompute the RNG or prove that authored weights/economy budgets are balanced. A complete replay verifier and representative balancing simulations remain release requirements.

Tests cover no-reroll start replay, exact grants, concurrent settlement, late rollback, retreat/defeat without victory loot, foreign access, missing custody, invalid content, forbidden history changes, required commitment/claim, corruption detection and restricted runtime permissions. Existing upgrade tests exercise the complete latest migration chain and preserve generic historical encounters.

Next: authored combat and failure contracts, safe resume/choice projections, currency rewards and reward modifiers, victory eligibility/Ascension, and full replay/crash/load/recovery drills.
