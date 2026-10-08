# Durable item locks

Migration 010 adds `inventory_lock_events` and `inventory_item_locks`, bringing the database to 61 tables including migration bookkeeping. Migrations 001–009 are unchanged. Existing item provenance, quantities, custody and metadata are preserved; absent lock state means unlocked, rather than inventing a prior player decision.

System 7 calls for explicit item protection. This pass implements the hard Locked flag for live personal inventory identities. It blocks ordinary manual or automated consumption, routine crafting inputs, splitting a protected stack and merging either a protected source or target. Storage moves and Ascension preserve the item identity and its lock. Players must explicitly unlock before these quantity changes; there is no bypass parameter on destructive operations.

## Authority and history

`setItemLock` accepts item ID and desired boolean state through a SET_ITEM_LOCK Action. It locks the item, checks active personal custody and current mode access, appends a consecutive lock event and advances the run revision once. Only MANUAL_UI or API authorization sources may set/unset locks; parser, automation and administrative sources cannot silently unlock through this service. The HTTP endpoint does not accept a client-selected authorization source or account identity.

Requests derive account identity from authentication and recheck GAME_WRITE inside the Action. Read-only sessions can read protection but cannot change it. Foreign, inaccessible Legacy, special/shared custody and retired items cannot be changed. A repeated request replays its receipt. A request for the already-current state creates a normal no-change receipt without a new lock event or gameplay revision; a concurrent command based on an older run revision fails normally.

Each event records the item, originating run, Action, prior/next lock state and monotonic protection revision. The projection is maintained by the event trigger. Direct projection writes, deleting protection, changing event history, skipped revisions and receipt/account/source mismatches are rejected. A late failure rolls back the projection, event, receipt, revision, audit and outbox together. The protection revision is returned as a decimal string to preserve int64 precision.

## Quantity and lifetime rules

Shared consumption/split/merge services return ITEM_LOCKED before changing quantity. SQL independently locks affected item identities in UUID order and rejects protected quantity operations even when a caller bypasses the service. MERGE checks both sides, protecting the destination as well as the identity being retired. Routine crafting rollback includes all ingredients and outputs if any selected input is locked.

Unlocking a stack allows ordinary splitting; the new child starts unlocked and the original identity retains its history. Both stacks must be unlocked to merge. Retired identities retain protection history for provenance. Item locks are separate from immutable item metadata and survive legal storage moves. Ordinary locked items still move to account storage during Ascension; locks neither delete possessions nor bypass Standard/Hardcore Legacy access. Run-bound possessions retain protection in the archived run.

The read-only audit and restore checks reconcile projection, consecutive history and receipt authority. This is structural lock-history reconciliation; it is not a complete temporal replay of every inventory operation. Existing metadata is not automatically translated into new lock events. Routine crafting still rejects unrecognized variant/protection metadata under its existing rule.

## API and remaining release work

- GET `/api/v1/inventory/:id/lock`: owned live personal item's lock state and protection revision; hidden mechanics and histories are excluded.
- POST `/api/v1/inventory/lock`: SET_ITEM_LOCK requestId/expectedRevision, itemId and locked boolean. Client overrides for actor, history, revision, bypass or authorization source are rejected.

Clients still need the visible lock/unlock control and clear confirmation before destructive actions. Saved-loadout automatic protection, favorites/collection reservations, operation-specific automation flags, identified-item rules, Keep-N/capacity controls, sale/salvage/trade policies, shared reservation authority and equipment remain distinct release work. Future destructive domains must consult the lock before custody/sink changes; quantity protection alone does not yet implement those absent domains.
