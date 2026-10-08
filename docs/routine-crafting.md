# Routine processing foundation

Migration 009 adds two append-only tables, `craft_records` and `craft_inputs`; the database now has 59 tables including migration bookkeeping. Migrations 001–008 are unchanged. Existing player state is not rewritten.

This pass implements only explicitly authored `TRIVIAL_PROCESSING_V1` recipes. System 8 permits zero-Turn trivial processing and batching; meaningful crafts, professions, tools/stations, material variants, experimentation, quality formulas, mastery and commissions remain separate release work. Declaring meaningful crafting as trivial would bypass its progression rules and must be rejected during content review. These APIs do not manufacture arbitrary items or implement timers.

## Recipe contract

A RECIPE declares `mechanics.routineRecipe` with version 1, ruleset TRIVIAL_PROCESSING_V1, access DISCOVERED_CURRENT_RUN, turnCost 0, maxBatch 1–100, one to sixteen ordered inputs and one output. Each input/output names a typed MATERIAL STACK item and a quantity 1–10,000; every item is an explicit dependency. Input IDs are unique and cannot name the output. Publication rejects unknown fields, missing dependencies, other kinds and invalid bounds. All mechanics resolve from the current run's sealed release, never the latest published version.

Only already-discovered recipes are available. Discovery remains account knowledge across Ascension, but materials must belong to the current run in active CARRIED, MATERIAL_VAULT or HOME custody. Account storage is excluded in every mode for this first policy. Each ordered ingredient uses one player-selected stack; automatic selection, substitutions and multi-stack ingredient allocation remain work.

## Atomic execution and binding

The client supplies recipe ID, batch count and input item IDs. It cannot supply output identity, quantities, quality, binding, costs, ownership or provenance. Source stacks lock in UUID order under the existing account/run Action locks. Crafting is unavailable during any active instance. The service preflights all input quantities and output custody before consuming anything.

This first recipe family accepts quality-one, unmodified ordinary materials only. System-untradeable materials and metadata beyond empty ordinary material data or this module's exact craft provenance keys are excluded; this prevents silently discarding variants or unrecognized protection metadata. Higher quality and protected/variant material handling require explicit policies. Output quality is exactly one, never a client value or substitute for the final quality formula.

Output binding preserves the strongest input: any Run-Bound input produces Run-Bound output; otherwise any Account-Bound input produces Account-Bound output; otherwise Tradeable. Run/account binding ownership is inherited through the existing grant service. Crafting cannot wash binding away. Output grants record maker character, recipe ID, batch count and Action ID. No practice XP or skill advancement is issued for mass processing.

All input quantity operations, the new output identity/grant, craft history, revision, receipt, audit and outbox commit together. A failure rolls back everything. Duplicate requests replay one result; concurrent different requests use the normal stale revision protection. Trivial processing spends zero Turns and advances the run revision once. Items can subsequently move or be consumed without altering craft provenance; Ascension stores ordinary outputs and archives run-bound ones through existing custody rules.

## Database enforcement and operations

SQL checks exact input/output quantities, ordered lines, typed recipe/release pins, receipt account/type, immutable provenance, quality and inherited binding. Initial input/output custody and recipe knowledge are checked at insert, while historical reconciliation avoids treating later legal storage movements or archived scopes as corruption. Reserved `craft.*` ledger operations require matching craft history; extra/missing links fail deferred checks. This is structural reconciliation of recorded recipes, not a replacement for restricted application authority or content review.

Runtime may append craft history but cannot rewrite or delete it. The read-only audit and restore check include both craft records and orphan crafting operations. FK leading-key indexes are covered. No live recipes are seeded by this upgrade; fixture numbers are test content.

Authenticated endpoints:

- GET `/api/v1/crafting/recipes/:id`: known recipe's explicit trivial-processing contract, costs, batch limit, quality and custody/binding policies; other hidden content is excluded.
- POST `/api/v1/crafting/routine`: CRAFT_ROUTINE requestId/expectedRevision, recipeId, batches and ordered itemIds. GAME_WRITE is rechecked inside the Action; read-only sessions cannot craft.

Future passes must add inventory selection/availability views, protection controls, profession/station prerequisites, flexible ingredient families, quality previews/formulas, nontrivial Turn costs, uncertain outcomes, skills/mastery and commission escrow before describing crafting as complete.
