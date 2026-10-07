# Inventory accounting

This implements the shared quantity and provenance boundaries for Systems 02, 07, 08 and 28. It does not define recipe balance, loot eligibility or equipment power.

## Content contract

New grants require an ITEM in the current run's exact release, with this versioned declaration in its server-only mechanics:

```json
{
  "inventory": {
    "version": 1,
    "storageMode": "STACK",
    "category": "MATERIAL"
  }
}
```

Categories are MATERIAL, CONSUMABLE, EQUIPMENT and OTHER. Materials and consumables use stacks; equipment uses individual instances. OTHER declares either mode explicitly. Unknown fields, unsupported versions and incompatible modes fail publication. Historical ITEM definitions without this declaration remain readable and movable, but cannot issue new items through the grant service until a new definition revision and release supply it. Sealed historical definitions are never edited.

## Transactions and authority

`grantItem` and `consumeItem` accept an existing Action context. Owning reward, consumable, crafting or administration modules must authorize entitlement, required inputs, protection flags and costs, then call these functions in the same transaction. No client endpoint accepts an arbitrary grant or crafting output. Multiple inputs, outputs, currency legs, Turn costs, receipt, audit and outbox can therefore commit together or roll back completely.

Each quantity operation has a unique key within its Action. Retrying the Action returns its original receipt and item identifiers without another grant. Quantity values are positive decimal strings bounded by signed int64; they never pass through floating point. Individual instances can only issue one unit. Quality uses positive exact decimal text with at most eight integral and four fractional digits, matching the existing SQL column.

Personal operations require active custody in the current run, or account storage in Casual mode. Shared Guild vaults, escrow, mail, museums, another account and archived scopes are refused. Those systems need dedicated authority before using a separate custody service. Run/account binding must agree with actual custody.

`splitStack` and `mergeStacks` wrap the normal Action transaction. Item locks use UUID order. Splitting moves part of a stack into a new identity; merging moves the entire source into an existing live target. Custody, exact definition release/revision, quality, binding, source and metadata must match. Different maker marks or provenance cannot disappear into a merged stack. A movement into compatible custody can precede a separate merge.

## SQL accounting and migration

Migration 004 adds `inventory_quantity_operations`. A single SPLIT or MERGE row debits one item and credits the other in a SQL trigger, so quantity cannot disappear between independently recorded legs. GRANT is a source; CONSUME is a sink. Ledger rows cannot be edited or deleted. Foreign keys link ordinary operations to their Action receipt, checked at transaction commit.

Every legacy item receives a migration-only OPENING operation for its existing quantity. Its identity, quantity, custody, timestamp, quality, binding and metadata remain unchanged. This is an opening snapshot, not a reconstruction of pre-migration grants or consumption.

New item identities begin at zero and require an issuance operation before commit. Fully consumed and merged source rows remain at zero as tombstones; later grants cannot revive them. They cannot move, and Ascension leaves their historical custody intact. Live materials still enter persistent Material Vault storage during Ascension. Ordinary live instances retain their identity when moved.

The database denies direct quantity updates and item deletion. It freezes definition, binding, quality and provenance until a future explicit audited evolution mechanism is introduced. This intentionally leaves binding-on-acquire/equip transitions, repairs, durability changes, upgrades and protection edits unimplemented rather than permitting arbitrary metadata edits.

The read-only integrity audit reconciles each item against incoming and outgoing quantity operations, including consumed identities and opening balances. Restore verification runs this same reconciliation. Audit totals use SQL numeric arithmetic so many int64 rows cannot overflow an aggregate.

## Evidence and remaining item work

Tests cover duplicate rewards, split/merge conservation, incompatible provenance, int64 limits, concurrent consumption, cross-account and restricted-custody denial, atomic crafting rollback with a Turn cost, SQL mutation denial, retired identity protection, opening-balance upgrades, corruption detection, Ascension handling and restricted runtime privileges.

Before declaring Items/Crafting complete, add authored recipes and yield rules, protection/automatic-consumption policy, capacity and weight/bulk, slot/anatomy requirements, equipment/loadouts, binding transitions, durability/repair, audited item evolution, salvage, loans, market/commission custody and knowledge-filtered inventory queries. These require their owning design rules and acceptance tests; the accounting primitives alone do not complete them.
