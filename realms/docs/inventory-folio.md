# Inventory equipment ledger (VIS-04)

The unified Pack uses the [Adventurer’s Folio](adventurers-folio.md) palette and
[application shell](application-shell.md). Equipment remains beside the inventory
at desktop sizes, with the existing 35/65 workspace and independent scrolling.
Below 900px the equipment disclosure and floating Equipment shortcut share the
same draft and selection; the inventory returns to normal page scrolling.

## Presentation ownership

`client/inventory-folio.css` owns Pack geometry and presentation, extracted from
`styles.css`. Legacy green surface fills and per-tile shadows have been removed.
Surface, text, interaction, focus, condition and warning colors use Folio tokens.
The small blue/purple rarity accents are decorative borders; every tile also
shows the server-provided rarity name using the established public terminology.
No rarity taxonomy changed.

`equipment-presentation.ts` renders original, decorative ink slot icons and
projects known slot state. Dashed empty frames, brass occupied frames, a framed
active weapon set, selected underlining, matching-slot dashes, explicit fit/lock
hints and exact condition badges provide cues beyond color. Locked changes do
not prevent reading a slot. Mutation controls keep their existing restrictions.
The neutral silhouette is decoration, not a claim about character appearance.

Compact cards retain dense facts; Standard emphasizes art and names; Detailed
uses a catalog alignment and known description. Status marks wrap separately
from quantities. The condition/weight footer remains anchored to each tile.
Durability uses existing percentage thresholds and exact numbers; items without
a durability mechanic omit condition. Unknown weight remains distinct from zero,
and stacks retain total weight and the per-unit tooltip.

The inspector uses ruled property pairs and compact chapter headings. Authored
art selection is unchanged; category fallbacks are explicitly identified in the
inspector. Grouped copies still omit representative-only mechanics and properties.
Comparison, repair, loadout and item-use panels use the same vellum/brass surfaces.
Loadout readiness, missing-item explanations, binding warnings and protection
remain authoritative. Delete actions have a separate danger treatment.

## Verification

From `realms/`:

```sh
npm run typecheck
npm run build
npm run styles:check
npm test
TEST_DATABASE_URL=postgres://localhost/realms_test node --import tsx --test --test-concurrency=2 \
  test/client-integration.test.ts test/inventory-browser.test.ts \
  test/inventory-services.test.ts test/equipment.test.ts \
  test/item-binding.test.ts test/loadouts.test.ts
```

From the repository root:

```sh
python3 infra/scripts/documentation-check.py
python3 infra/scripts/feature_registry.py
python3 -m unittest discover -s infra/tests -p test_release_verification.py
```

The client asset allowlist, index, style checker and final release image all
include the new stylesheet. The [public edge rollout](../../infra/docs/playfollybound-hosting.md#updating-reviewed-client-assets) must also refresh its explicit static-asset catalog; the new inert staging command preserves managed credentials and listeners. No external fonts, raster artwork, database migration,
accounting change or gameplay calculation was added.

## Disposable visual fixture

Use only a loopback `realms_test` database. `scripts/client-preview.ts` rejects
other database names and non-local hosts. The standard fixture includes empty
worn positions, a damaged sword, repair, use and storage examples. Add these
flags for a populated paperdoll and a larger collection:

```sh
TEST_DATABASE_URL=postgres://localhost/realms_test PLAYTEST_SERVICES=1 \
PLAYTEST_FOLIO=1 PLAYTEST_EQUIPMENT_COPIES=48 \
node --import tsx scripts/client-preview.ts
```

This grants synthetic test gear through existing server domains, equips all worn
positions, prepares both weapon sets and authors extra test carrying capacity.
It serves only `http://127.0.0.1:3001`; sign in with `wayfarer` and the documented
fixture password `A road worth wandering 47!`. Stop the process to remove its
isolated schema. Never run this fixture against production.

[Visual evidence and browser coverage](screenshots/vis-04/README.md).
