# Inventory repair and item-use services

This slice provides the workspace interactions from Systems 7 and 16, reusing
server authority (23), shared prerequisites (29), effect clocks/stacking (24),
sourced rewards and content-release pins. It adds a few disposable fixtures, not
production item content or a new balance catalog.

## Repair contract

An equipment ITEM may declare both `tacticalDurability: {version: 1, maximum: 250}`
and `repair: {version: 1, goldPerPoint: 2}` under mechanics. Rates are whole Gold
per missing durability point (1–1,000,000); no automatic price is invented for old
items without repair policy. Repair restores the authored maximum and costs
`(maximum - current) × goldPerPoint`. Selected gear and Repair all cover current
run Carried/Home custody outside every active instance. Equipment, manual locks
and saved loadouts do not prevent this restorative operation. Items without damage
need no repair; damaged items without prices are explained as unavailable.

A preview returns every affected identity, current/target condition, individual
cost, total and liquid run Gold. The client confirms that quote; commit re-reads it
under the normal account/run/item locks. Any changed revision/token, inaccessible
selected item, unaffordable cost or missing Gold sink rejects the transaction.
Full payment uses one immutable currency transfer; repair rows retain per-item
wear watermark, before/after condition, price and source run/action. Deferred SQL
checks tie the complete cost to that payment and explicit action receipt. Replays
cannot charge twice. Gold faucets/sinks and starting funds are operator-configured;
this service does not create production wallets or grant spending money.

`inventory_condition(itemId, beforeWearId?)` reconciles append-only repairs with
existing tactical wear. New failures start from repaired condition; old encounter
audits use condition immediately before their original wear event. Existing wear
rows remain immutable. Ascension archives repair events with the source life;
physical items retain their condition history when future custody permits reuse.
No per-action durability loss, material repair, partial field repair or town NPC
service availability graph is introduced. Normal current-life Home access is the
service boundary until those authored domains exist.

## Item-use contract

An ITEM can opt into mechanics such as:

```json
{
  "itemUse": {
    "version": 1,
    "kind": "USE",
    "effects": ["effect.testfocus"],
    "rewards": []
  }
}
```

USE belongs to a non-equipment CONSUMABLE. OPEN belongs to a non-equipment OTHER
item, has no effects, and has fixed release-authored contents, for example:

```json
{
  "itemUse": {
    "version": 1,
    "kind": "OPEN",
    "effects": [],
    "rewards": [{"kind": "ITEM", "id": "item.ore", "quantity": 3}]
  }
}
```

Declare each effect/reward content dependency. Effects must use the validated
shared-effect graph and an out-of-combat clock; rewards reuse the shared ITEM,
KNOWLEDGE and GOLD contract. Instance rewards require quantity 1. Publication
rejects unsupported categories, invalid bounds, missing dependencies and unknown
references. Existing releases/runs never acquire newly authored mechanics by UI
inference; normal release adoption and compatibility rules apply.

Preview checks current owned carried custody, pinned release and shared item
prerequisites. It reveals only known effect/reward names; it never discloses hidden
definitions. It shows that exactly one physical item/stack unit will be consumed,
remaining quantity and protection. Double-click opens this confirmation; it never
silently uses or opens. Favorite items require a separate explicit override.
Manual locks, equipment assignments and protected loadout references must be
released before consumption. Other-run, archived, foreign, system-untradeable and
incompatible bound items are denied. Automation/parser intent is not accepted.

Commit repeats these checks, consumes through item accounting, applies effects
through the shared clock/stack/trigger journal and grants through shared sourced
rewards, in one action transaction. Any later effect/reward denial rolls back
consumption and earlier writes. One revision increment, receipt and outbox record
represent the whole action. Retrying the same receipt cannot duplicate contents.
New reward identities naturally receive New markers from quantity accounting.

This is an inventory interaction foundation, not all of System 2: food/booze,
Fullness/Drunkenness/Tolerance, quality-to-Turn conversion, tactical HP/MP potions,
targeted combat use, random loot-table containers, keys and reusable quest tools
need their own authored contracts. The client exposes no fabricated actions for
those items. Shared effects affect their existing shared-rule consumers; this does
not claim automatic integration with the separate legacy tactical effect engine.

## Emergency controls

`actions.global`, `action.REPAIR_ITEMS`, `action.USE_ITEM`, per-item
`content.<id>`, `rewards.global` and `reward.<itemId>` reuse existing controls.
Effect-bearing items also require enabled `shared.rules`. Disabling a commitment
prevents new mutations, while original successful receipt replay remains valid.
Preview-time availability is advisory: commitment checks flags again under locks.
Operator control changes use the existing administration connection, never a
player endpoint.

## Verification

Run from the `realms` directory against disposable PostgreSQL only:

```sh
npm run typecheck
npm run build
npm test
npm run test:integration
node --import tsx --test test/inventory-services.test.ts test/inventory-browser.test.ts test/loadouts.test.ts
python3 ../infra/scripts/documentation-check.py
```

Integration tests require TEST_DATABASE_URL pointing to the separate realms_test
database. Browser verification can use `PLAYTEST_SERVICES=1 npm run dev:client`:
the loopback-only script creates test Gold, damaged gear, a saved loadout, a buff
vial and a fixed-content parcel in its disposable schema. Stop it normally to
remove that schema. The regular preview remains unconfigured for build testing.
No production database, account or definition is used by this workflow.

## Deployment and rollback

Migration 035 adds repair history/functions/guards and an account workspace
contract, without changing old migration checksums or published definitions.
Apply it through normal administration migration tooling and refresh runtime role
grants (INSERT on inventory_repairs). Verify schema readiness, permission checks,
loadout/item pages and quoted one-item repair/use in staging before deployment.
The application cannot repair an item without an authored policy or use an item
without its release-pinned itemUse contract. Source synchronization alone does not
deploy or migrate the running game. Production operations require separate approval.

For application rollback, use a compatibility build retaining migration 035's
manifest, condition reconciliation and historical audit support. A pre-035 binary
fails strict schema readiness; returning to the old wear-only condition query
would also misrepresent repaired equipment. Keep all repair/transfer/action rows
and state contracts; do not remove payments, rewrite old wear or drop player
presentation settings. Emergency action flags may stop new repair/use actions
while preserving reads and settled history.
