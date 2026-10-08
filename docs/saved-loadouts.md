# Saved equipment loadouts and item protection

Migration 013 adds an immutable loadout event stream, character-owned current templates and protected item references. Existing game rows are unchanged. Each character can currently keep 32 active templates, identified by a stable key and a player-visible name.

`SAVE_LOADOUT` captures the current validated equipment snapshot, including both prepared weapon sets and the selected set. It does not accept arbitrary item plans or hidden equipment fields from a client. Saving enables item protection. Shared weapon identities are recorded once for protection, even when both prepared sets reference them. Replacing a template protects its new items and releases its old references; other templates and manual item locks remain independent.

Referenced items cannot be consumed, split, merged or used by quantity-ledger processing until every applicable loadout protection is released. The service and SQL boundaries enforce this. Safe storage movement remains allowed. Deleting a template or explicitly changing `SET_LOADOUT_PROTECTION` to false releases that template's references. These changes require a manual UI or API Action; automation cannot silently override them. Unprotecting a template does not unequip items, remove manual locks or undo permanent binding.

Templates persist across Ascension and continue protecting the same stored item identities. Applying a template requires lawful current-run carried custody, the pinned definition, level and hand requirements and no active instance. It does not pull from storage, substitute items or bypass run-bound restrictions. Missing or illegal items fail the whole setup. Re-enabling protection for a template whose item was consumed or transferred also fails; save a corrected current setup instead.

The authenticated API supports listing templates, saving the current setup, explicit protection changes, deletion and application. Application uses the ordinary `SET_EQUIPMENT` Action and the shared equipment legality service. Its intent hash contains the saved key; receipt replay returns the originally applied setup even after the template has been replaced or deleted. Unchanged saves, protection settings, deletions and equipment setups do not advance their domain revision.

`GET /api/v1/inventory/:id/protection` projects only the owned item's manual lock, current equipment use and protected loadout keys. It exposes no event history or hidden mechanics. Read-only sessions can inspect these views but cannot change loadouts or gear.

Deferred constraints and the integrity audit reconcile event chains, captured equipment history, receipt ownership, current template state, exact protected references and item custody. Direct projection edits, rewritten events, protected consumption and foreign custody fail. The restricted server role can append events and maintain their projections but cannot erase history.

This completes equipment-template persistence and quantity protection. Build/ability templates, disguise loadouts, automatic sell/salvage services, unidentified-item policies, collection-copy policies, broader inventory automation and the final tactical engine remain separate launch work. The final client must show binding and equipment consequences before applying a setup.

## Verification

The local suite passes 119 tests: seven unit tests and 112 integration tests, including 13 loadout tests. Coverage includes duplicate requests, canonical noops, shared item references, explicit protection overrides, independent locks, restore/replay after deletion, overwrite, storage and Ascension, ownership and active-instance restrictions, direct SQL bypasses, rollback, template limits under concurrent SQL writes, read-only API access, restricted runtime permissions and audit corruption detection. Type checking and build pass.

The private development upgrade preserved every pre-existing game table by before/after hashes after server restart. Permission, integrity and live endpoint checks passed. The post-upgrade backup restored into a disposable database with all 68 tables, matching migrations and reconciled invariants.
