# Equipment persistence

Current inventory UI and optional carrying policy: [inventory grid, storage and measurements](inventory-grid.md).

[Documentation map](README.md) · [Current status](implementation-status.md) · [Migration map](migration-guide.md)

This guide records the owning feature’s implementation checkpoint. Table counts, dated checks and “remaining” notes refer to that checkpoint; newer combat, Ascension and shared-rule work is summarized in the current status.

Migration 011 stores an immutable equipment event stream and derives the current setup into `run_equipment` and `equipment_slots`. Existing characters begin with empty equipment and prepared set A; existing inventory is unchanged.

`SET_EQUIPMENT` replaces the complete setup, including the selected A/B set, through the ordinary revision-checked Action transaction. The authenticated equipment endpoint accepts item identities and positions only. Gear definitions opt into a strict equipment schema with allowed slots, hand count, minimum level and the version 1 `PRESERVE` binding policy. Version 2 additionally supports [permanent account binding on active equipping](item-binding.md). The worn slots are head, neck, shoulders, chest, hands, waist, legs, feet, two rings, trinket and tool. Each prepared weapon set has main-hand and off-hand positions.

Only one-unit instance gear in the current run's active carried inventory and pinned content release is eligible. Two-handed weapons exclude the off-hand in that set. One physical weapon may appear in both prepared sets in the same hand position. A physical ring cannot fill both ring positions. No equipment reconfiguration is permitted during an active instance.

Equipped identities cannot move between containers or change quantity until unequipped. Service checks and SQL triggers enforce this protection. Explicit item locks remain independent and survive equipping, unequipping and Ascension. Ascension clears the old setup before storing possessions and links the clear event to its run-history receipt. The new run begins empty.

Repeated requests replay their committed receipt. An unchanged setup creates no new equipment event or run revision. Event chains, projections, ownership, custody, requirements and Ascension linkage participate in the read-only integrity audit and deferred database checks. Direct projection edits and rewritten event history are rejected.

This checkpoint introduced persistence and legality. Later [qualification gates](proficiency-requirements.md), [character snapshots](character-mechanics.md) and [tactical expansion](tactical-first-pass-expansion.md) execute supported equipment effects, derived statistics, conditional defenses and weapon-set combat actions. The basic duel prototype retains its authored profile. Full encumbrance, durability/repair lifecycle, upgrades and remaining binding policies still need owning contracts.

## Verification

The equipment milestone passed 96 tests: seven unit tests and 89 integration tests, including 12 equipment tests. Equipment coverage includes duplicate requests, canonical noops, shared weapon identity, hand and level requirements, ownership and storage, consumption and custody protection, lock-preserving Ascension, transaction rollback, immutable history, strict API authorization, active-instance restrictions, restricted SQL permissions, forged events and corruption detection. Type checking and the server build pass.

The private development upgrade was rehearsed with preservation hashes for every pre-existing game table. All prior table contents remained unchanged after migration and server restart. The live permission probe, integrity audit and endpoint smoke checks passed. Restoring the post-upgrade backup into a disposable database verified all 64 tables, matching migrations and reconciled invariants. Production readiness still requires the launch gates in [release readiness](release-readiness.md).

Migration 013 adds [named saved equipment loadouts and item protection](saved-loadouts.md), using the same equipment legality service.

Migration 020 adds optional [skill-rank prerequisites and immutable qualification evidence](proficiency-requirements.md), enforced for worn gear, both prepared sets and saved-loadout application. [Shared rules](shared-rules.md) now add structured equipment prerequisites and supported server-derived capabilities; a complete authored weapon/armor training and respec workflow remains future work.

The inventory now presents committed equipment in a paperdoll above the item grid
(`client/paperdoll.ts`). It shares `prepareInventoryEquipment` and
`bindingConsequences` with the existing equipment controls; its previews do not
replace server validation. Slot removal affects only the selected assignment,
while inventory's "Unequip this item" removes all its assignments. Both weapon
sets remain visible, with two-hand reservations explained in the empty off-hand
position. The complete-plan editor and saved loadouts remain available in the expandable
Equipment planner & saved loadouts section below the pack for preparing several
changes together.

Verification: `npm run typecheck`, `npm run build`, `npm test`, and
`node --env-file=.env --import tsx --test --test-concurrency=2 test/equipment.test.ts test/loadouts.test.ts test/inventory-browser.test.ts test/client-integration.test.ts`
with the documented isolated `TEST_DATABASE_URL`. For visual verification, run
`npm run dev:client` against the disposable test database, open Pack, equip the
fixture sword and shield, replace them with the practice greatblade, activate the
other set, and wear the fixture Tool satchel. Confirm capacity updates, binding
warnings, filter-independent equipped gear, and a narrow-screen layout without
horizontal overflow. No database migration or production content change is needed.


### Three interchangeable trinkets

Rings and trinkets can occupy any of the three accessory positions, displayed as
Trinket 1, Trinket 2 and Trinket 3. Existing persisted identifiers `RING_1`,
`RING_2` and `TRINKET` remain stable for receipts, equipment history and saved
loadouts. Equipment specifications that include any one of those positions are
interpreted as eligible for all three; non-accessory positions are unchanged.
This compatibility rule applies to existing pinned releases as well as new runs.
It does not grant extra copies: three positions require three distinct item IDs.

Migration `033_interchangeable_trinkets.sql` adds `equipment_eligible_slots` and
updates the database integrity view to match the server's normalized specification.
The inventory and equipment projections expose the same effective slots. It does
not rewrite authored definitions, existing assignments, immutable history, saved
loadouts or account data. The integration test restores the old integrity policy,
creates legacy gear/loadout history, applies the migration, verifies unchanged
records, equips mixed accessories in each position and reapplies the saved loadout.

Deployment requires the normal reviewed source/schema release procedure and a
backup. Apply migrations before activating the matching server build; do not run
an older build against the new schema. Verify with `npm run typecheck`,
`npm run build`, `npm test` and the equipment/loadout/client integration commands
above against an isolated test database. No production migration is performed by
this implementation pass. Rollback after activation requires restoring the matching
pre-release database backup and previous packaged release together under maintenance;
reverting only the slot policy could invalidate new accessory placements. A UI-only
rollback can retain the broadened server/database policy.
