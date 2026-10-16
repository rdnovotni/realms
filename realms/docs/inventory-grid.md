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

### Equipped gear and weight labels

The Pack screen begins with an equipment paperdoll beside carrying capacity on
wide screens, and above it on narrow screens. All twelve worn positions are
visible: Head, Neck, Shoulders, Chest, Hands, Waist, Legs, Feet, Trinket 1, Trinket 2,
Trinket 3 and Tool. Both weapon sets expose Main Hand and Off Hand; the current
set is explicitly labelled Active and the other Prepared. This presents the
existing broad equipment contract without adding inventory slot limits.

Select a carried equipment instance in the grid to highlight compatible
positions. Select a position, choose Equip, stage the preview, then Apply the shared draft. Replacements
warn before clearing conflicting assignments. A two-handed main weapon marks
its off hand as occupied; equipping an off-hand item instead clears the conflicting
main weapon. Grouped copies must first be expanded to select a physical instance.
Click an equipped position to inspect requirements, binding and condition or
remove that assignment. Other prepared references to the same item are preserved.
Weapon-set activation is staged with its own confirmation; Apply requires consent for permanent binding.
Equipment changes remain free outside encounters and server-authoritative.
The paperdoll reads the complete shared draft or committed plan and equipped-first gear projection,
so filtering or paging the pack does not hide equipped possessions. It does not
require the bootstrap quick list to be exhaustive; both the paperdoll and complete-plan editor can search all eligible equipment in pages.

Item tiles show only applicable status icons at the top left (locked, equipped,
loadout protection or restricted access), and quantities prefixed with `x` at the
top right. The centered item illustration sits above the name. Requirement level and
known quality appear beneath it; other items use known quality or a public key
property. The complete border indicates rarity, which is also named in the item
inspection panel. Group cards identify multiple copies rather than implying that
the representative's level, quality, protection or condition applies to every copy.
Expand them to inspect each physical instance.

The bottom row is anchored to the tile edge: condition at the left, weight at the
right. Cards stretch together within a grid row, so wrapping names do not shift
the footers. Condition preserves the true `current/maximum`, including maxima of
200, 250 and other authored values. It appears only when a durability mechanic
exists. Defaults are healthy at 70% or more (muted green), worn at 25% or more
(amber), and critically damaged below 25% (red). A shield glyph, exact fraction
and state text accompany color. Item tile display controls let players change the
two percentage thresholds or hide `x1`; these are saved account presentation
preferences. Thresholds require whole numbers with
`0 < worn < healthy <= 100`.

Individual items show unit weight; stacks show total weight. A stack of 20 pieces
at 2 each shows `40` with `2 each × 20 = 40 total` in its tooltip. Grouped copies
show combined measured weight and explain that individual weights require expansion.
Unknown measurements display `—`, never zero. Authored zero remains `0`.
All quantities and weight calculations remain exact through BigInt formatting;
visible truncation for a very large value retains the exact tooltip/accessibility
text. Tile presentation does not change encumbrance calculations.


### Shared equipment picker, drag shortcuts and grouped inspection

The same paperdoll is available on Character. An empty slot opens a searchable,
paged list of eligible physical items; occupied slots offer inspection, unequip
and replacement search. Complete-plan editor Search controls use the same picker
without committing until Apply equipment. Its quick dropdown list is a convenience,
not an inventory size limit. Current equipment and carried saved-loadout references
remain available for validation even when outside the quick list.

Drag an individual carried equipment tile onto a compatible slot to preview the
complete change, then stage and Apply. Drag an equipped slot onto Return to pack (on either
screen), or onto the Pack grid, to stage removal of only that assignment before Apply.
Other prepared references survive. Group cards must be expanded before equipping;
storage drops still reject equipped items. Binding and displacement warnings, stale
revision checks and active-encounter locks use the existing equipment authority.
Search and unequip buttons provide keyboard/touch equivalents to every drag action.

A grouped inspector shows only copy count, total quantity, total measured weight
and bulk, and location scope. It never presents a representative's description,
quality, binding, protection, condition, unit dimensions or requirement as shared
by every copy. Expanding the group exposes the actual individual records. Selection remembers whether a group or a physical copy was chosen: changing grouping never turns a group into a representative instance, and changing a selected group’s filters clears its aggregate inspection.

Verification: use the isolated `npm run dev:client` fixture; optionally set
`PLAYTEST_EQUIPMENT_COPIES=125` (allowed 0–160) to exercise more than 100 gear items.
Open Character → empty Trinket slot → page/search; choose an item on the third page;
stage, switch to Pack to verify draft retention, then Apply. In the full planner search for Sword, acknowledge
binding and Apply. Inspect the grouped rings and verify aggregate-only facts. Check
Escape focus return, empty/retry search states, a 320px viewport, and native browser
equip/unequip dragging. Unit tests separately verify owned drag identities and
preservation of other weapon-set references.

Equipment preparation now persists in session memory across rerenders and screen
changes, with Apply/Revert on the paperdoll. Saved setups can be previewed there.
Slot, equipped/usable and actual-condition filters run before grouping and paging.
Right-click/keyboard context menu and touch long-press expose the same guarded
item actions as the inspector. See game-client.md for draft lifetime, comparison
context and accessibility details; artwork authoring is documented in
client/art/items/README.md.

### Selection, favorites, inspection and default activation

Ctrl/Cmd-click toggles physical items and Shift-click selects an inclusive range.
Per-item checkboxes and Select page provide touch/keyboard equivalents. Group
representatives cannot be selected: expand copies first. Selection is bounded to
48 visible physical identities and clears on query/page/run or gameplay revision
changes. Cosmetic refreshes preserve selection and its range anchor.

Review selected action confirms an explicit list. Supported bulk operations are
protect, favorite/unfavorite, mark inspected and move to Carried/Home/Material
Vault. Each is one idempotent transaction. A foreign, inaccessible, bound,
equipped, locked or saved-loadout protected item rejects the complete move batch;
no partial move or silent skipping of denied items occurs. Already-at-destination
items are harmless noops. Bulk unlock, consume, sell and destroy are intentionally
not provided. Protection uses each item's existing immutable lock history.
Favorites are a separate presentation choice, not a replacement for manual locks.

Favorites and inspection state follow physical item identity at account scope.
Stars label favorites; a distinct New badge labels uninspected incoming quantity.
Groups show favorite/new copy counts rather than a representative's status.
Opening an individual inspector marks its displayed acquisition as seen; explicit
and bulk Mark inspected controls are also available. Opaque acquisition tokens
prevent an old observation from clearing a later grant/merge. Moving an item does
not make it new; a newly split identity or incoming merge does. Historical items
without an inspection record initially appear uninspected. Favorites do not copy
from a consumed merge source to its target, nor between different accounts.

Double-click expands a group or stages the existing equipment preview, preserving
conflict and permanent-binding consent before Apply. It never immediately commits
equipment or consumes anything. Items with authored `mechanics.itemUse` now open a Use/Open confirmation with one-item consumption and consequences; items without that contract open details. See [inventory services](inventory-services.md). Keyboard inspection and the explicit equip button remain
available. Single-click inspection waits briefly to distinguish native double
activation; modifier clicks only select.

Tile preferences now persist at account scope through `inventory.display.v1`:
show x1, healthy threshold and worn threshold. Reloading or using another browser
loads the same values. Favorites, inspection and display changes do not advance
the gameplay revision or invalidate an equipment draft. Server write permissions,
revision checks and replay receipts still apply. Display state resets locally on
sign-out so it cannot leak into another account.

Migration 034 adds cosmetic annotation storage, the account display contract and
bulk-capable lock receipt validation. No released content definitions change.
Deploy with normal migration/grant refresh and readiness checks; do not hot-run
new code on an older schema. Rollback requires a compatibility build that restores prior UI/domain behavior
while retaining the migration-034 manifest and compatible lock view. An older
pre-034 image fails strict schema readiness against the upgraded database. Keep
annotation data/contracts and all bulk lock history; do not rewrite old migration
checksums or drop player annotations as a rollback. Production migration
and deployment require the separate operations approval.


## Inventory workspace and services

Compact, Standard and Detailed views share the same physical item identities,
selection, rarity borders, status markers and bottom-anchored condition/weight.
Compact uses smaller art; Detailed adds category, binding and descriptions.
The account `inventory.workspace.v1` contract persists layout independently of
existing tile preferences. Layout changes do not advance gameplay revision.

Wide screens allocate roughly 35% to a sticky equipment column and 65% to the
pack, with selected-item details beneath the grid. Both weapon sets remain in the
equipment section; carrying totals stay beside it. Loadouts and statistics are
secondary disclosures directly within the paperdoll. Narrow screens keep equipment above the grid in a collapsible section. A floating
Equipment control reopens it without losing filters, selection or the shared draft.
Equipment and items are never mutually exclusive views. Common search,
location, category and sort remain visible; More filters reveals the rest.

Compare side by side opens a dedicated dialog with current/candidate artwork,
property columns, known modifiers, true durability, binding consequences and
conflicting assignments. Select either prepared weapon set. Character before/after
totals come from the existing equipment preview service in a known rules context;
unknown modifiers remain Unknown. It can stage the candidate but Apply and any
binding acknowledgement remain separate. A candidate in an inactive set does not
change active totals; other staged changes are included in candidate totals.

Repair selected, Repair all and individual inspector repair request fresh server
quotes. Use/Open appears on authored eligible items and through double-click and
the context menu's existing inspector actions. These workflows and their precise
supported authoring scope are documented in [inventory services](inventory-services.md).
Migration 035 and refreshed runtime grants are required before deploying this UI.


### Inventory intelligence and richer inspection (migration 036)

Pack offers Equipment, Materials, Recently Acquired and Needs Repair views plus
up to twelve account-persistent custom filter/sort views. Applying a view resets
pagination and physical selection. Storage location is selected separately;
old-life container IDs are never saved into a view.

The inspector separates Overview, Properties, known Equipment effects, supported
Actions, Comparison and player-visible History. Materials omit equipment-only
sections. Automation remains collapsed until requested. Known capability and
technique summaries require ADVANCED discovery; raw metadata, source codes,
hidden prerequisites and hidden effect IDs are never returned. History includes
quantity lineage, crafting grants, custody transfers, locks, repairs and wear.
There is no implemented item-modification/affix journal yet, so inspection does
not invent modification details or claim unknown provenance is absent.

Compare searches paginated owned gear across personal storage for the chosen
slot without changing Pack filters. Item properties compare the selected pair;
character totals compare current equipment against the proposed candidate and
are explicitly labelled accordingly. The authoritative preview still requires
assessment of all active/proposed gear before returning numeric totals. Staging
never equips automatically and retains normal binding safeguards.

Keep-N rules reserve up to N units of each definition in current-life carried
custody on future grants. Counts include equipped/prepared copies. Excess goes
to current-life Material Vault (materials) or Home (others); partial stacks are
split with a full grant, lineage operation and movement evidence, preserving
quantity, quality, binding, release and provenance. Keep-N takes priority over
existing material/overflow routing. Zero means route all future eligible grants.
Existing possessions stay in place. System-untradeable and routine crafting
outputs retain their domain-mandated custody; no automatic sale/destruction.

Collection protection is separate from favorites and locks. Protect a chosen
physical copy explicitly (bulk actions supported); consumption, use, crafting
inputs, splitting and merging reject it server-side. Removing this protection
requires explicit intent. Personal storage moves and equipping remain allowed.

Paperdoll slots use the player's configured percentage thresholds for labelled
condition badges; inactive sets remain prepared and the active set is framed.
Capacity meters scale past 100%, label exact excess and show authored comfortable,
burdened and encumbered boundaries for both weight and bulk. Unmeasured capacity
stays explicit rather than appearing as a measured zero.

Verification: `npm run typecheck`, `npm test`, and disposable-database
`node --import tsx --test test/inventory-services.test.ts test/inventory-browser.test.ts test/crafting.test.ts`.
Migration 036 must be rehearsed before deployment. Source rollback must retain
collection-protection reads/enforcement and registered state contracts; an older
binary can ignore collection protection and must not be used with this schema.
No production migration or deployment is performed by this source change.


### Inventory usability polish

Layout and tile settings remain account-persistent. Saved filter/sort views now
also support semantic current-life locations (`CARRIED`, `HOME`, `MATERIAL_VAULT`)
and `DURABILITY` sorting. No database migration is needed beyond the existing
036 schema. Search and primary storage navigation stay visible; filters, sorting
and saved-view management share one collapsible panel. Archived and account
containers remain in More storage locations and retain their existing access
rules. Merely opening an empty Home/Vault does not create a container or change
any game state.

Durability sorting uses exact condition / maximum ratios; non-durable items sort
last in both directions, and groups sort by the worst physical copy's ratio.
Two-line item names and three-line detailed descriptions preserve aligned card
footers; full names remain in accessible labels and inspection. The disposable
preview compass deliberately has a long name to exercise truncation.

Contextual action icons supplement text in the inspector and context menu.
Success feedback uses confirmed receipt counts, repair Gold costs, remaining
quantities and owned item names. Ambiguous requests still retain their original
retry envelope and never announce unconfirmed changes.

Equipment hover/keyboard-focus tooltips show a compact comparison of permitted
item facts against compatible active equipment. Grouped copies only prompt
individual inspection. No hidden modifiers, authoritative character totals,
network requests or item actions are introduced by hovering. Escape, scrolling,
resize, focus departure and item removal dismiss the tooltip; tooltip content
can itself be hovered. Touch keeps the existing tap/context-menu alternatives.

The UI displays the design bible's Common, Uncommon, Rare, Exceptional, Legendary
and Mythic tiers, plus the separate Ultra-ultra rare category. Existing persisted
`VERY_RARE` is displayed as Exceptional; published item definitions and database
codes are unchanged. Rarity describes scarcity, independently of quality/power.

Verify with `npm run typecheck`, `npm test`, and disposable-database
`node --import tsx --test test/inventory-browser.test.ts test/inventory-services.test.ts`.
