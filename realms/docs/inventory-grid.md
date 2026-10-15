# Inventory grid, storage and carrying rules

Follybound's Pack provides a paged RPG grid over conserved physical item records. The grid has no fixed slot limit: System 07 §17 specifies simplified weight and bulk. Migration `032_inventory_carry.sql` extends existing custody, quantity operations, binding, equipment and protections. Synthetic fixtures demonstrate the framework; production catalogs and live activation remain separate.

## Player workflow

Search owned item names; filter by personal location, category, public rarity, binding and protection. Sort ascending/descending by name, acquisition date, quantity, total weight, bulk or known quality. The server returns 48 rows per page; load totals cover **all** carried items, including other pages and filtered-out items. Identical base definitions can be grouped, then expanded into their individual copies. Grouping never combines quality, provenance, bindings or physical IDs; stack merging separately requires exact compatibility.

Tiles show category beneath the name and, for individual equipment, its authored required level. Items without an equipment level show only category; grouped copies defer level details to expansion because versions may differ. These presentation fields are separate for future player display settings; no new settings controls are introduced. Equipment above the current character level highlights its requirement. Tooltips use readable separate lines. Opening an item focuses its details and brings them into view on small screens; closing returns focus to its tile, or to search if the tile is on another page or filtered out.

Select a copy to inspect its public description, condition, binding, protection and measurements. Advanced discovery reveals numeric quality and known equipment modifiers for comparison. Raw item metadata, grant reasons, hidden mechanics and RNG seeds are not exposed. Public rarity and quality labels are authored presentation, not inferred reward odds.

From details, move an eligible copy among Carried, current-life Home and Material Vault; drag individual tiles into those destination zones as a pointer shortcut. The same controls work without dragging. Only materials enter the Vault. Split a stack by an exact positive quantity or choose another compatible stack to merge. Server receipts conserve quantities and retain retired-stack history. Manual unlock needs confirmation; loadout protection remains independently visible and cannot be removed by unlocking. Equip/prepare and unequip reuse the complete equipment plan, two weapon sets, legal slots, prerequisites and binding authority; permanent binding requires explicit confirmation. Saved loadout controls remain below the grid.

Item history pages show quantity directions, storage destinations and manual lock changes (20 per page), including history of a retired split/merged copy. They omit private staff reasons, raw action metadata and foreign account details. Binding and condition are current inspection facts; this is not yet a universal repair/commission/crafting genealogy UI.

The location picker lists up to 200 containers and discloses truncation; All personal storage still pages items across owned personal containers. Archived or mode-restricted possessions remain inspectable but cannot be moved by this UI. Guild, escrow, mail and museum custody require their own future authority/workflows. Current-life Home/Vault are run scoped; previous-life account storage preserves existing Casual-only access. Standard Legacy Allowance and full Home upgrades remain future owning features.

## Measurements and release opt-in

Existing `mechanics.inventory` version 1 remains valid and is **unmeasured**, never silently assigned zero physical cost. Version 2 requires the existing storage mode/category plus:

```json
{"version":2,"storageMode":"STACK","category":"MATERIAL","unitWeight":2,"unitBulk":1,"mundane":true}
```

Units are abstract authored whole numbers; no kilogram conversion is implied. Both measurements are required, nonnegative integers up to 1,000,000,000. Instance quantity remains one. Stack quantities retain the existing signed-int64 bound; aggregate arithmetic uses exact PostgreSQL numeric / JavaScript BigInt and responses encode totals as decimal strings.

At most one TUNING entity in a release may define `mechanics.inventoryRules`:

```json
{"version":1,"baseWeight":60,"weightPerStrength":2,"baseBulk":30,"bulkPerStrength":1,"comfortableBps":10000,"burdenedBps":12500,"encumberedBps":15000,"burdened":{"initiative":-1,"stealth":-1,"mobility":-1},"encumbered":{"initiative":-3,"stealth":-3,"mobility":-3},"stealthSkills":[],"mobilitySkills":[]}
```

These numbers are fixture examples, not canon balance. Thresholds are increasing basis-point ratios; the upper boundary of each band is inclusive. Either weight or bulk can raise the band. Capacity is base + effective Strength × authored coefficient + explicitly owned bonuses. Valid `mechanics.inventoryCapacity` version 1 sources are a native class level, selected feat/subclass, or actively equipped item. Its fields are `weight`, `bulk`, `minimumNativeLevel`; only classes may require a positive native level. Worn/active-set gear counts each physical item once; inactive preparations and mere companion presence grant nothing. Temporary magic, Mastery and Home upgrade adapters are not implemented by this slice.

- Comfortable: no encumbrance penalty.
- Burdened: authored small initiative and skill-check penalties.
- Encumbered: authored stronger penalties.
- Overloaded: ordinary dangerous encounter entry is blocked, without spending Turns.

Skill lists contain explicit SKILL entity IDs and dependencies; they must be disjoint. Shared checks refer to those IDs through the canonical `skill.<entity ID>` fact namespace. Penalties flow through shared check contributions and their known preview explanation. They do not invent new tactical movement costs. Initiative is pinned into opted-in character encounter evidence. Active encounters keep their saved stats; physical storage transfers are blocked until the instance ends.

No policy means UNCONFIGURED: old releases keep their entry/stat behavior. An opted-in policy with unmeasured carried items or missing effective Strength reports UNMEASURED and blocks dangerous entry. Publish measured items and complete a starting build before enabling that release; do not retrofit weights into sealed releases or hot-adopt changed content into existing runs. The existing reviewed new-run adoption/compatibility policy still applies.

## Future-loot routing and lifetimes

Account preference `inventory.preferences.v1` defaults both `autoStoreMaterials` and `autoOverflow` to false and persists across Ascension through its registered KEEP contract. Optional material auto-storage routes future eligible grants to the current-life Material Vault. Overflow routing applies to measured material/mundane loot that would exceed the Comfortable threshold, using permitted Vault/Home custody. It changes initial location only: quantity, source, binding and release pins remain intact. System-untradeable grants are not auto-routed. Preferences do not silently move existing possessions.

`inventory_quantity_order` adds immutable trigger-assigned sequence evidence for the existing UUID quantity journal. Runtime may read it but cannot append/rewrite it or invoke its SECURITY DEFINER recorder directly. Its trusted search path is fixed during migration. Existing quantity rows receive sequence entries without changing their UUIDs, values or receipts. Immutable sequence/movement watermarks permit independent historical-load reconstruction after later consumption, transfers and Ascension. Snapshot insertion checks actual owned capacity evidence; replay independently recomputes capacity/bands/penalties and audits the historical quantity/custody load. The complete capacity-source vector is independently reconstructed from pinned build/equipment events and earlier choice receipt revisions, so valid but unowned definitions, omitted sources and duplicates cannot pass a coherently altered snapshot.

All mutations reuse authenticated Action envelopes, account/run locks, expected revisions and exactly-once receipts. Reads hold owner/run locks and can require the expected revision; the client rejects crossed/out-of-order reads and clears cached inventory on sign out/new life. Global emergency write disable remains authoritative. There is no new inventory-specific emergency flag: release opt-in controls carrying mechanics, and reviewed global controls handle incident containment without mutating pinned rules.

## Verification and remaining boundaries

Run against a disposable `realms_test` database using the contributor environment:

```bash
npm run typecheck
npm test
npm run test:integration
npm run test:workers
npm run test:runtime
npm run features:check
python3 ../infra/scripts/documentation-check.py
```

Focused proofs: `test/inventory-rules.test.ts`, `test/inventory-browser.test.ts`, `test/inventory.test.ts`, `test/client.test.ts` and the existing equipment/lock/binding/Ascension suites. `scripts/client-preview.ts` provides a few weighted test items, a capacity satchel, protected gear and stack copies for browser verification. No production content is added.

Selling, salvage, trading, mail attachments, consumable use effects, item repair, advanced quality production, commissions, auto-equip/auto-salvage and full Legacy Allowance are separate features. This pass does not claim all of System 07 complete. For rollout, rehearse migration 032, runtime permissions, historical-load audits and representative saved snapshots in staging; preserve backup/image identity and verify exact readiness. A source merge does not migrate or deploy the live game. See [migration guide](migration-guide.md), [API reference](api-reference.md), [accounting](inventory-accounting.md) and [shared rules](shared-rules.md).
