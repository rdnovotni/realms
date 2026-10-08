# Equipment persistence

Migration 011 stores an immutable equipment event stream and derives the current setup into `run_equipment` and `equipment_slots`. Existing characters begin with empty equipment and prepared set A; existing inventory is unchanged.

`SET_EQUIPMENT` replaces the complete setup, including the selected A/B set, through the ordinary revision-checked Action transaction. The authenticated equipment endpoint accepts item identities and positions only. Gear definitions opt into a strict equipment schema with allowed slots, hand count, minimum level and the version 1 `PRESERVE` binding policy. Version 2 additionally supports [permanent account binding on active equipping](item-binding.md). The worn slots are head, neck, shoulders, chest, hands, waist, legs, feet, two rings, trinket and tool. Each prepared weapon set has main-hand and off-hand positions.

Only one-unit instance gear in the current run's active carried inventory and pinned content release is eligible. Two-handed weapons exclude the off-hand in that set. One physical weapon may appear in both prepared sets in the same hand position. A physical ring cannot fill both ring positions. No equipment reconfiguration is permitted during an active instance.

Equipped identities cannot move between containers or change quantity until unequipped. Service checks and SQL triggers enforce this protection. Explicit item locks remain independent and survive equipping, unequipping and Ascension. Ascension clears the old setup before storing possessions and links the clear event to its run-history receipt. The new run begins empty.

Repeated requests replay their committed receipt. An unchanged setup creates no new equipment event or run revision. Event chains, projections, ownership, custody, requirements and Ascension linkage participate in the read-only integrity audit and deferred database checks. Direct projection edits and rewritten event history are rejected.

This is the persistence and legality foundation. It does not yet implement class proficiency, derived combat statistics, encumbrance, durability, upgrades, additional binding policies or Quick Action weapon swapping. The basic duel prototype continues to use its authored combat profile. These rules must be implemented before equipment can be advertised as affecting the final combat engine.

## Verification

The equipment milestone passed 96 tests: seven unit tests and 89 integration tests, including 12 equipment tests. Equipment coverage includes duplicate requests, canonical noops, shared weapon identity, hand and level requirements, ownership and storage, consumption and custody protection, lock-preserving Ascension, transaction rollback, immutable history, strict API authorization, active-instance restrictions, restricted SQL permissions, forged events and corruption detection. Type checking and the server build pass.

The private development upgrade was rehearsed with preservation hashes for every pre-existing game table. All prior table contents remained unchanged after migration and server restart. The live permission probe, integrity audit and endpoint smoke checks passed. Restoring the post-upgrade backup into a disposable database verified all 64 tables, matching migrations and reconciled invariants. Production readiness still requires the launch gates in [release readiness](release-readiness.md).

Migration 013 adds [named saved equipment loadouts and item protection](saved-loadouts.md), using the same equipment legality service.
