# Illustrated Character folio

[Documentation map](README.md) · [Adventurer’s Folio](adventurers-folio.md) · [Character client](game-client.md)

VIS-03 presents Overview, Progression, Abilities, Statistics and History as chapters of one tabletop character sheet. It starts from main after CHAR-05 and VIS-02. Progression, equipment, discovery, ownership, action envelopes and database rules are unchanged.

## Reading the sheet

Overview includes an original neutral adventurer emblem, a level medallion, known native class/subclass names, run status and exact XP facts. The emblem is a decorative ink illustration, not a portrait, race or invented character identity. Each of the seven attributes has its own original small icon, framed score and visible name. These are starting-build scores plus committed attribute allocations; equipment and temporary effects are not included.

XP still comes from the existing BigInt-safe `characterXP` model. The engraved track describes the next **earnable** XP level. Pending **allocation** levels are a separate fact. Capped characters receive an explicit maximum-level message; unknown values remain unavailable. Class tracks use only the exposed native-level maximum and never imply an invented reward schedule. Committed subclass labels are shown only from the current run/revision and owned classes.

Progression uses the same eligibility explanations, earned milestone selectors, complete attribute budgets, rank-by-rank proficiency advancement and permanent-choice confirmations. Ink class/specialization cards, compendium feat entries, rank labels and milestone markers distinguish these existing workflows. The main chapter navigation retains selection, pending-choice indicators and focus behavior from CHAR-05.

The Ability Book retains search/category/source filtering and its read-only inspection. Compact entries separate action, known resource cost and cooldown, while the inspection page preserves source, effects and restrictions. Unknown costs remain unavailable; an explicitly empty authored resource-cost list and an explicit zero remain distinct. Owned permanent sources stay separate from temporary encounter grants. The bounded list scrolls independently, and inspection adapts below it on phones.

Statistics use ink-ruled row groups for vitality/combat, damage/defenses, capabilities and carrying. Values remain server projections with contextual labels. An existing Pack equipment draft can add a clearly labelled staged column. Unknown/unassessed values, hidden comparisons and conditional defenses retain their original behavior. Authorized calculation explanations remain expandable.

History is a current-run chronicle with category icons, a fine timeline, recorded values/times and the existing page controls. Events are immutable. No dates, old-life records or before/after values are fabricated. A separate historical archive is not introduced.

## Presentation ownership

- `client/character-presentation.ts`: identity/emblem frame, level medallion, attribute overview and native class tracks, extracted from `character.ts`.
- `client/character-icons.ts`: original lightweight SVG ink motifs, decorative beside visible text, with `aria-hidden` and `focusable=false`.
- `client/character-presentation-model.ts`: stale/run/ownership protection for specialization labels and honest compact cost formatting. No gameplay formulas.
- `client/character-folio.css`: one Character stylesheet, replacing the older Character/advancement/book/history blocks in `styles.css`. Shared modal geometry stays in `styles.css`; shell styling stays in `shell.css`; all colors/spacing/type/surfaces/focus use VIS-01 tokens.
- `character-book.ts`, `growth.ts`, `advancement.ts`, `character-history.ts`: existing actions and read models with small presentation additions. No new API contract or migration.

The stylesheet is explicitly approved by the asset server and copied into the production image. The existing packaging regression checks every stylesheet in the page. Core usability requires no external font, image service or dependency. No raster portrait, animation or blur was added. There is no new persistence contract.

## Accessibility and responsive behavior

Visible attribute/ability/category names carry meaning independently of decorative icons and color. Definition lists, native buttons/selects/disclosures, labelled progress bars, scoped table headers and ordered history remain semantic. Selected chapters have a fill, border and underline. The shared two-tone focus ring is preserved. Dialogs still use the original native modal, confirmation, Escape and restoration behavior.

At desktop widths, all seven attributes share one row, with class and equipment references below. Secondary chapters use a compact identity header. Small screens use compact attribute grids and stacked reading panels. All requested widths (320, 375, 768, 1024, 1440px) were checked on all five chapters and on the three-column staged statistics table. See [screenshots and measured results](screenshots/vis-03/README.md).

VIS-01 reduced-motion, texture-off and forced-color behavior remains supported. Additional Character forced-color rules preserve tracks, chapter selection and table headings. Real OS high-contrast/reduced-motion rendering still requires a manual device check when the browser adapter cannot emulate it.

## Disposable preview

With a local PostgreSQL database named `realms_test`, from `realms/`:

```sh
npm run build
TEST_DATABASE_URL=postgres://LOCAL_TEST_USER@127.0.0.1:55439/realms_test node --import tsx scripts/character-folio-preview.ts
```

Open `http://127.0.0.1:3008`, account `wayfarer`, public test password `A road worth wandering 47!`. These are synthetic fixture credentials, never production credentials. The helper accepts loopback database hosts only, requires the test database, creates its own schema and removes it on graceful SIGINT/SIGTERM. It does not start the database or alter production services. Abrupt termination can leave its isolated schema for deliberate cleanup.

`PLAYTEST_FOLIO_STATE` supports:

| Mode | Purpose |
| --- | --- |
| `multiclass` (default) | Two native classes, capped XP, committed subclass/feat/attribute/proficiency, assessed capabilities and 29 history records for pagination |
| `single` | A single configured class with committed choices and earned unallocated class levels |
| `pending` | Single class, equipped gear, earned XP and unspent advancement opportunities for real confirmation/allocation tests |
| `setup` | A fresh unconfigured character with discovered starting classes/presets |

`PLAYTEST_FOLIO_PORT` accepts 3006–3019 (default 3008). The fixture’s names, statistics and schedules are test data, not new authored game content.

Run typecheck, build, unit/client tests, relevant advancement/growth/Character Book/History integration tests, styles, documentation and registry checks. Verify setup, single/multiclass states, pending/capped XP, attribute/feat/subclass/proficiency confirmations, inspection/filtering, contextual/staged statistics, history paging, reload/sign-in retention and mobile controls. Production deployment remains a separate operation.

## Art limits

The illustration system is deliberately neutral. There are no invented portraits, racial silhouettes or class-specific lore emblems. Future authored portraits/class symbols can be introduced through an appropriate knowledge-safe contract. Existing item artwork is reused in the equipment summary; the full paperdoll/editor remains in Pack.
