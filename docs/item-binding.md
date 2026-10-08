# Permanent equipment binding

Migration 012 adds an immutable `item_binding_events` ledger. It preserves all existing item rows and the version 1 equipment contract. Version 2 equipment may declare `bindingPolicy: ACCOUNT_ON_ACTIVE_EQUIP`; `PRESERVE` remains available for ordinary gear.

Selected gear becomes account-bound when placed in a worn slot or in the selected weapon set. Merely preparing it in the inactive set does not bind it. Switching the selected set binds newly active qualifying gear. Each physical item records at most one irreversible tradeable-to-account-bound transition. Existing account or run binding is never weakened. Binding remains after unequipping, storage, consumption and Ascension. Item locks remain independent.

The SQL boundary derives transitions from committed equipment intent. It validates the owning account, current run, carried custody, pinned definition, live item identity and the historical equipment snapshot. Binding and equipment changes commit with the same Action receipt, or roll back together. Clients cannot select a binding outcome, owner or grant. The authenticated read-only `/api/v1/inventory/:id/binding` endpoint shows the owned item’s current binding, policy and whether active equipping will create a new bond, without exposing hidden mechanics or history. Successful equipment commands return `boundItemIds` for any new bonds created by that Action; retries replay that result.

The quantity/provenance guard permits this recorded transition while still rejecting direct binding edits, unbinding and unrelated item changes. Events cannot be rewritten or deleted. Deferred integrity checks, the read-only audit and backup restore verification reconcile the permanent bond with its equipment intent and receipt.

Authored loot plans continue to describe the original award. Reward reconciliation reads the item's issuance binding from its transition history when it has subsequently bound. A permanent bond therefore does not rewrite the original reward commitment or report legitimate gameplay as reward corruption.

This opt-in policy is explicitly binding on active equipment setup. It does not implement binding on attack or ability use, automatic challenge-path acquisition binding, public trade/market services, staff bond removal, or binding transitions for stacks and materials. Bind-on-acquire rewards continue to use the existing authoritative account-bound grant contract. The final combat engine must expose the applicable item policy to players before they commit equipment changes.

## Verification

The local suite passes 106 tests: seven unit tests and 99 integration tests, including ten binding tests. The binding coverage exercises inactive versus active sets, duplicate requests, preserved and stronger existing bonds, item locks and Ascension, late rollback, direct SQL bypasses, immutable history, original authored loot, restricted runtime permissions, pinned releases, audit corruption detection and safe read-only preview. Type checking and the server build pass.

The private development upgrade preserved the contents of every pre-existing game table, verified by before/after hashes after restart. Live permission, integrity and endpoint smoke checks passed. Restoring the post-upgrade backup into a disposable database verified all 65 tables, matching migration checksums and reconciled invariants.
