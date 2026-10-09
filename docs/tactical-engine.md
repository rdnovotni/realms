# Saved tactical combat

TACTICAL_ENCOUNTER_V1 is an opt-in authored party combat loop alongside the frozen BASIC_DUEL_V1 prototype. Existing basic fights, their formulas, campaign proofs and rewards are unchanged. This is tested development functionality; production balancing and the remaining Pass 1 systems are still open.

## Content and authority

An ENCOUNTER declares version 2 committed item loot, a characterProfileId, and strict tacticalCombat tuning. Tuning defines a bounded zone graph, ranges, round limit, healing amount/mana cost, guard armor, retreat difficulty, encounter allies/enemies and a disclosed Home failure contract. Allies reference typed NPC tacticalUnit templates; enemies reference typed MONSTER templates. Dependencies must be declared, IDs cannot collide, unknown tuning fields reject, and party size is bounded at sixteen.

The player uses the immutable verified character snapshot: current authored attributes, native class levels, selected subclasses/feats and worn/active gear. A versioned tacticalKit on an eligible snapshot source grants healing or guard, with native class level gates. Kit sources must also declare combatModifiers so their ownership/source revision is part of the snapshot. Templates describe encounter-provided allies; they do not implement owned companion progression or multiplayer membership.

Health and mana carry between tactical fights. New runs initialize from derived maxima. Changed maxima cap retained pools; entering another fight does not refill them. An immutable predecessor chain connects encounters to their previous recovery record. Persistent health/mana update only on authored settlement. This tactical pool is separate from the historical basic-duel pool.

## Executed actions

Initiative sorts highest first, with an ASCII ID tie break. Each round supplies Main, Quick and Reaction budgets. Moving to an adjacent authored zone costs Quick. Attack costs Main and uses journaled d20/weapon damage, derived accuracy/evasion and armor. Healing requires an owned capability and sufficient mana, costs Main, and can revive a Downed ally. Guard requires the capability granted by equipped/selected content, consumes Quick to prepare, and consumes one Reaction when attacked to add authored armor. Downed/Defeated units cannot defend reactively.

At zero HP party units become Downed and lose their turn. Each later connected damaging attack contributes one Downed strike; two strikes cause Defeated. Healing above zero restores Downed participation and resets strikes; ordinary healing cannot restore Defeated units. Enemies at zero HP become Defeated. No active enemy means victory; no active party member means defeat. A bounded round limit causes FAILED_FORWARD. Retreat consumes Main and a journaled check; success extracts the party without victory rewards.

Enemy turns use the same transition function and budgets. They choose the lowest-health active party target with a deterministic ID tie break, move along a legal shortening path when necessary, attack if in range, and end their turn. They do not gain free movement, damage or extra actions. Enemy segments are bounded and execute atomically after a party action ends its turn. An enemy-first fight starts with its visible enemy timeline; a separate CONTINUE request advances it, preserving distinct encounter-start and recovery Turn-ledger requests.

## API

All routes require existing account authentication. Writes require GAME_WRITE and the normal requestId/run expectedRevision envelope. Request bodies reject extra fields, rolls, raw damage, stats and server-control flags.

- POST `/api/v1/tactical/start`: START_TACTICAL with definitionId. Requires encounter discovery and a configured character build; commits one Adventure Turn, item/XP plans, verified snapshot and immutable origin.
- POST `/api/v1/tactical/actions`: TACTICAL_ACTION with instanceId, expectedEncounterRevision, expectedTacticalRevision and command. Commands contain actorId and END/GUARD/RETREAT/CONTINUE, MOVE plus zone, or ATTACK/HEAL plus targetId. Only the owner can command the hero and authored party allies; CONTINUE only advances an enemy turn.
- GET `/api/v1/tactical/:id`: owned timeline, health/mana, visible state, budgets, party capabilities, action costs/ranges, battlefield, disclosed failure contract and recovery. Hidden enemy stat definitions, source specs, seeds, draws, initial proofs and loot plans are excluded.

Duplicate matching request IDs return their original receipt. Stale run/encounter/tactical revisions reject. An invalid action or a late loot failure rolls back all associated draws, steps, checkpoints, rewards, pools and receipts. Reconnect reads the saved projection without advancing randomness.

Victory claims the creation-time item loot and resolution XP once. Defeat/FAILED_FORWARD apply the disclosed recovery cost, capped at remaining Turns, and return Home with positive player health. Retreat grants no victory reward. Downed player rescue after victory/retreat uses capped authored recovery health. Every terminal fight has one immutable recovery record; its live combat checkpoint retains the original terminal evidence.

## Database evidence and checks

Migration 022 adds four tables: tactical_encounter_origins, tactical_steps, tactical_recoveries and tactical_run_state. It invents no historical fights or pools. Origin, step and recovery records are append-only, with deferred ownership/lifetime/settlement constraints and indexed foreign keys. The runtime can append journals and update its persistent pool; it cannot edit/delete journal history.

The integrity report reconstructs the initial party from pinned content, the independently verified character snapshot and predecessor recovery. It replays immutable intents, verifies each roll against the stored seed/counter/bound/action, checks enemy decisions, compares every transition/evidence record, reconciles current checkpoints and persistent pools, and verifies recovery/Turn-ledger/settlement evidence. Origins and step histories are read in cursor batches. Backup restore checks include this audit.

Acceptance tests cover a playable party fight; class, feat, subclass, weapon and defensive-item effects; mana costs and defensive reactions; saved reconnect; simultaneous duplicate requests; stale/illegal intents; foreign/read-only access; hidden-data boundaries; enemy-first defeat; legal enemy movement; victory/defeat/retreat/round-limit settlement; late action/reward rollback; immutable history and corruption detection. Legacy database suites remain required.

## Remaining Pass 1 work

Broader class/subclass support kinds and distinct resources, explicit proficiency/check-driven abilities, damage-family inheritance, conditional resistance changes and immunity bypass, partial condition resistance/saves and immunity bypass, buildup/control, Remove Curse/persistent cleansing and other effect clocks, surprise, opportunity reactions, stabilization/resurrection, casualty-sensitive retreat, complete recovery/injury contracts and owned companion/multiplayer participants remain open. Basic guard is the currently executed defensive reaction. Encounters can now opt into [typed damage traits](tactical-typed-damage.md) with pinned attack types, armor penetration and per-type damage resistance. Untyped encounters retain zero penetration and resistance; family inheritance, conditional changes and immunity bypass remain open. An opted-in [tactical campaign finale](tactical-campaign-proofs.md) now records pinned prerequisite victories and a durable completion proof, enters Aftercore and permits voluntary Ascension. Basic-duel proofs retain their original engine. These limits remain visible in the eight-pass plan.

## Verified development milestone

The expanded suite passed 34 unit tests and 230 database integration tests (264 total), with type checks and build passing. The final retained-pool/recovery guards then passed all fourteen focused tactical integration scenarios, including direct forged-pool and premature-recovery rejection. GitHub runs the complete suite against the published migration.

Migration 022 is applied on the private loopback server and is frozen. Full hashes confirmed that every pre-existing game table retained every field exactly; no historical tactical fights or pools were invented. Restricted runtime permissions, authenticated reads, unauthenticated denial, every integrity count and foreign-key index coverage passed. The post-upgrade backup restored successfully into a disposable database with 85 tables and matching migration checksums. Future schema fixes require migration 023 or later. Development fixture balance and encounter-provided allies do not constitute final release content or owned companion functionality.

Optional [round conditions](tactical-round-effects.md) now apply pinned on-hit numeric effects with explicit family stacking and owner-turn expiry. Broader effect hooks remain open.

Version-two [periodic effects](tactical-periodic-effects.md) now execute pinned DoT/HoT pulses at owner-turn end/start, including atomic victory, campaign and recovery settlement. Version-one history retains its original behavior.

Version-three [cleansing counterplay](tactical-cleansing.md) now executes owned Cleanse/Dispel/Cure against one selected eligible effect, with Main/mana costs and replayed removal provenance. Versions one and two retain their original behavior.

Optional [status immunity](tactical-status-immunity.md) now blocks explicitly matching harmful/mixed tags independently of damage mitigation, with pinned source profiles and immutable blocked-effect replay. Unopted histories retain their original shape.

Optional [selectable attack abilities](tactical-attack-abilities.md) now execute owned/template mana-powered offensive actions with authored damage/range, journaled rolls, costs and usage replay. Unopted histories retain their original behavior.

Optional [selectable healing abilities](tactical-healing-abilities.md) now execute owned/template single-ally casts with authored range/amount, journaled healing, resource costs and Downed revival. Generic HEAL and unopted histories retain their original behavior.
