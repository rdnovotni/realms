# Ordinary solo encounter persistence

Migration 006 adds `encounter_records` and append-only `encounter_draws`. Existing instances, player state and content are preserved; existing generic instances are not converted or given invented costs/outcomes.

These are internal transaction primitives, not a playable combat engine or public endpoint. An owning handler runs inside `executeAction`, authorizes the encounter/choice, and advances the run revision once. Never accept checkpoint, outcome, reward plan, seed, random stream/key or settlement callback from a client. Each handler must derive these from validated choices and the pinned rules.

## Start and resume

`beginEncounter` requires an ENCOUNTER in the run's sealed release and mechanics `encounter: { version: 1, turnCost: 1 }`. It creates the instance/participant/journal, spends one Turn and records the cost in the same Action. A second active ordinary encounter or combat blocks another start. Free encounters are deliberately rejected until their authored budget exists. Shared, dungeon and expedition instances need their own participation/settlement policies.

The account and run locks serialize Actions. Receipt replay returns the original instance without another cost. A new request cannot replace an open encounter. Reconnecting only reads existing state. An owning handler uses `encounterCheckpoint` to resume; its checkpoint is private server data. The existing instance view exposes no seeds, draws, checkpoints or settlement.

## Randomness and checkpoints

`drawEncounter` uses the existing versioned HMAC RNG and the instance's immutable seed. Each named stream has a consecutive semantic counter; cosmetic draws do not advance loot/combat streams. Each stream/key stores its bound and result once. Reusing the same key returns that result; changing its bound is rejected. Keys must distinguish semantic operations, such as round and actor. Reusing a key for a different purpose with the same bound is a handler bug.

A successful Action persists draws with its receipt. Failed Actions persist neither draws nor rewards; retrying the same semantic operation from the same committed state yields the same draw. Content defines whether loot commits at encounter creation or completion. A handler must call/store creation-time draws at creation when that is the authored commitment point. Seeds alone do not decide reward eligibility or tables.

`saveEncounterCheckpoint` checks encounter revision, saves state and advances the journal/instance revisions together. Gameplay handlers own validation of legal transitions, resources, effect clocks and combat decisions. The foundation does not interpret arbitrary checkpoint fields.

## Resolution

`finishEncounter` accepts a server-derived VICTORY, DEFEAT, RETREAT, SURRENDER or FAILED_FORWARD. Its settlement callback uses the same Action context/client to issue ledger-backed inventory/currency rewards and quest/recovery changes. It must not open another transaction or perform network side effects; use the Action outbox for later notifications. SQL errors or callback failure roll back all settlement writes, RNG draws, outcome and receipt. The start cost remains committed.

Success stores the private settlement, resolves the instance and archives its scope. The same request replays its receipt; a different request cannot settle again. Resolved history cannot be edited, deleted or reopened. There is no additional retreat Turn charge here. Authored handlers still decide whether retreat succeeds and what defeat/recovery consequences apply. They must construct discovery-safe public results, rather than returning private settlement or raw checkpoint data.

Deferred constraints reconcile participant/content pins, start/finish account authority, start cost, journal/instance revisions and lifetimes. Audit and restore checks repeat these checks. Draw history cannot be rewritten; SQL enforces consecutive counters and bounded results. This does not replace a gameplay replay verifier or a full Turn balance reconciliation system.

## Authored item loot

Migration 007 extends encounter mechanics with version 2 and a pinned `lootTableId`. These encounters must use `beginAuthoredEncounter` to commit their item reward plan and `settleAuthoredVictory` after the owning combat handler establishes victory. Deferred constraints reject a missing plan or incomplete victory claim. Version 1 remains available for the generic foundation. See [authored item loot](authored-item-loot.md).

## Verification and remaining release work

Tests exercise concurrent receipt replay, reconnect locks, stream isolation, named draw reuse, stale checkpoints, foreign access, failed reward settlement, double settlement, retreat cost, direct SQL tampering and invalid content/costs. Runtime permits journal writes and draw insertion but cannot delete journal history or rewrite draws.

Next: typed combat/loot/failure contracts; authored eligibility and reward budgets; safe resume/choice HTTP projections; loss/recovery/quest effects; victory eligibility and Ascension; representative crash/load/recovery drills. This pass provides the durable boundary those handlers must use, not evidence that every launch gameplay system is finished.
