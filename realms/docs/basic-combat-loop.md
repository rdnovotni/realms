# Basic solo combat and campaign completion

Migration 008 adds seven tables for run combat state, encounters/steps, Home recovery, committed Gold/claims and campaign completion evidence. The total including migration bookkeeping is 57 tables. Existing runs receive `completion_policy: LEGACY`; their existing fields, items, wallets and historical encounters are preserved. Migrations 001–007 remain unchanged.

This is an explicitly opted-in BASIC_DUEL_V1 ruleset for testing the complete authoritative persistence loop. It is not the final System 4 tactical engine. It uses authored profiles and a single opponent, ATTACK/GUARD/RETREAT intents, player-first exchanges, rational hit chances, uniform damage ranges, flat armor, resistance basis points and bounded rounds. Main/Quick/Reaction economies, initiative, positioning, party/downed rescue, crits, statuses, derived character/build/equipment stats and final combat tuning remain required for the launch engine. Test numbers are fixtures, not production balance.

## Authored content and access

MONSTER mechanics declare a versioned `combatMonster`; TUNING mechanics declare `combatProfile`. Both specify maximum health, damage range/hit chance, armor and resistance. The profile also declares positive functional Home recovery health. ENCOUNTER mechanics use the existing version 2 item-loot declaration plus `combat` with version 1, ruleset BASIC_DUEL_V1, access DISCOVERED_REPEATABLE, profile/monster IDs, a round limit, retreat chance and a RETURN_HOME failure contract with a 1–3 Turn cost. Optional `gold` declares a world name and fixed positive amount; optional `campaignId` links a final encounter to campaign tuning.

All numerical values and references are validated before publication. Fighter health/damage/armor are bounded by one million, chances by one million and rounds by 1,000. Basic duel resistance is below full immunity. Every connected hit deals at least one damage after armor/resistance; GUARD halves incoming damage, also with minimum one. These explicit prototype formulas must not silently change: a new ruleset is required for incompatible behavior.

Only discovered encounters explicitly authored as repeatable basic duels can start through this API. The client supplies an encounter ID, never a monster/profile, reward plan or eligibility override. This access policy does not implement zone movement, unique encounter queues, quest gates, parties or boss mechanics. Those encounter families must have their own authored policies rather than being labeled DISCOVERED_REPEATABLE.

## Actions, resume and settlement

`startCombat` pins the profile/monster to the run's release, initializes the run's combat profile once, preserves remaining health on subsequent fights, commits the Adventure Turn and item plan, and creates combat state. A fixed Gold plan stores the server-selected world faucet and current run wallet at this same creation point. No client wallet IDs or faucet access are accepted. A missing Gold source rolls back start completely.

`takeCombatAction` runs through the normal account/session/run locking and receipts. It checks the expected round, derives damage and retreat from pinned content, and records random draws in the combat stream. Round/state updates, journal checkpoints, rewards, recovery, progression and the receipt commit together. Duplicate requests replay; another stale command cannot also advance the same round. A failed settlement rolls the entire round back while retaining the creation-time reward plans. Reconnecting reads persisted rounds and health, with no reroll or reset.

ATTACK resolves a player strike, then a surviving enemy strike. GUARD defends against the enemy strike. A successful RETREAT ends without another Turn cost; failure allows the enemy strike. A zero retreat chance makes retreat unavailable. Reaching the authored round limit while both sides remain able to fight resolves FAILED_FORWARD through the disclosed Home failure contract. This prevents indefinite prototype fights.

A server-resolved victory issues the exact item plan and one conserved Gold transfer, then records any campaign completion. The client cannot assert victory. SQL checks health/outcome consistency, consecutive steps, receipt ownership, matching journal revisions, exact Gold legs and terminal history. This structural reconciliation is not a cryptographic combat replay verifier; complete replay and production balancing remain launch gates.

## Solo failure and Home recovery

When the sole combatant reaches zero health, no eligible ally remains. This basic solo ruleset resolves the encounter as DEFEAT with its explicit RETURN_HOME contract; it does not label every zero-health event in a future party engine as actual death. The player returns functional at authored partial health. The additional Turn cost is capped to remaining Turns, never creates debt and needs no mandatory Rest. A round-limit failure uses the same authored return contract with the distinct FAILED_FORWARD outcome.

Victory loot and Gold are not granted on failure. XP, equipment, Fullness, Drunkenness and Tolerance are not reduced/reset by this ruleset. Gold death penalties, durability, injuries, captures, surrender contracts, rescue windows and party/downed systems still need their own policies. Recovery receipts and Turn entries are durable and append-only.

## Campaign and Ascension evidence

TUNING `campaign` mechanics declare version 1, a final encounter ID and up to 32 unique prerequisite encounter IDs. Prerequisites are explicit dependencies and must reference typed combat encounters using the same immutable run profile as the final fight. The final encounter explicitly depends on the campaign and names its campaign ID; the final ID in the campaign is a validated backlink rather than a dependency cycle.

The final fight cannot begin until the same run has verified victories over every prerequisite. Only winning that final fight creates immutable completion evidence and transitions the run to Aftercore. Starting active basic combat opts the run into CAMPAIGN completion policy; this policy cannot revert to LEGACY. SQL rejects Aftercore without valid final/prerequisite evidence. Old LEGACY Aftercore history retains the previous compatibility behavior; public production migration must review that allowance.

The existing Ascension transition now preserves CAMPAIGN policy for the new life. It archives the old run, retains completion history, moves eligible ordinary items to account storage, transfers run Gold to account wealth, preserves remaining Turns/consumption and begins an Active life with no completion evidence. Old victories cannot satisfy the new run. Legacy/mastery rewards, class/path setup, complete Chronicles, player previews and other launch Ascension features remain work.

## API and operations

Authenticated routes:

- POST `/api/v1/combat/start`: START_COMBAT envelope plus definitionId.
- POST `/api/v1/combat/actions`: COMBAT_ACTION envelope plus instanceId, expectedRound and ATTACK/GUARD/RETREAT intent.
- GET `/api/v1/combat/:id`: own combat health/round/outcome, opponent name, disclosed failure contract/round limit and recovery result. Seeds, draws, profiles, hidden loot plans and mechanics remain excluded.
- POST `/api/v1/ascend`: ASCEND envelope; no client eligibility or reward parameters.

Write routes derive identity from authentication and recheck GAME_WRITE authority inside their Action. Unknown fields such as health, damage, outcomes, rewards, wallet IDs and principal are rejected. Production clients still need an explicit visible Ascension preview/confirmation flow.

Runtime can update combat projections and append history, recovery, Gold and completion records; it cannot rewrite or delete histories. Deferred constraints and read-only audits reconcile combat and campaign evidence. The backup restore check includes these views. Current ordinary encounter/tactical and production release requirements remain documented in release-readiness.
