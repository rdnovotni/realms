# Folio icons and interactions (VIS-06)

Follybound uses the existing Adventurer’s Folio palette, ink strokes, parchment
notes and restrained feedback. These are presentation helpers, never action or
knowledge authorities. Item illustrations remain owned by `item-art.ts`.

## Audit and consolidation

| Area | Finding | Shared convention |
| --- | --- | --- |
| Character, attributes, abilities, History | Separate 32-unit motif renderer | Original motifs through `icons.ts` |
| Empty equipment slots | Another 32-unit renderer | Same renderer, existing slot drawings |
| Inventory status/action/weight | Duplicated 24-unit paths and renderers | Status/action/common motif families |
| Shell, Adventure, Combat, Journal | Separate decorative renderers and sidebar text symbol | Common SVG families; no emoji |
| Comparison, repair, use | Browser modal containment, inconsistent opener restoration | `mountDialog` lifecycle and focus cycling |
| Inventory/loadout reviews | Inline groups lacked Escape and one-shot guard | `inlineConfirmation` cancellation and commitment |
| Compact comparisons | Hover/focus-only note implementation | Shared parchment notes plus an explicit inspector control |
| Action feedback | Busy actions said “Connecting” | Saving/Refreshing labels with atomic live feedback |

## Icons

Call `folioIcon(name, family, optionalClass)` from `client/icons.ts`. Families:
`character` (all seven attributes, advancement, abilities, records), `slot`
(armor, weapons, trinkets), `status` (equipped, protected, favorite, new,
condition), `action` (equip/use/move/repair/compare) and `common` (Health, Mana,
weight, notices, road, combat, Journal).

Original drawings retain their local 24- or 32-unit coordinates. Shared CSS uses
current ink color, rounded caps/joins and a 1.6px non-scaling stroke. Existing
screen wrappers retain their size/layout classes. Large authored item art is
not converted into tiny control icons. No external library, font or image host
is required.

SVGs are decorative (`aria-hidden=true`, `focusable=false`). Put meaning in
visible text or the owning control’s accessible name. Status badges keep their
text equivalents and item accessible labels. Never derive hidden item effects,
class identity, enemy names or eligibility from an icon.

## States and motion

Use Folio semantic tokens. Selection includes underlining/frame cues, occupied
slots retain labels/frames, disabled controls keep dashed borders, and errors
have labelled notices. Dialog destructive confirmation has an explicit “Confirm
delete” label and danger treatment. Pending actions have Saving feedback;
read-only/encounter restrictions retain their existing reasons.

Pressed controls use a small inset rule. Inventory hover elevation is 1px, only
on hover-capable devices without reduced motion. There are no continuous
animations or new per-tile shadows/filters. Forced colors retain frames and text;
reduced motion disables transitions and elevation. Coarse-pointer controls have
44px targets. Existing theme contrast checks cover 53 text/state pairs.

## Notes and explanations

`attachNote(owner, {title, lines}, clickToToggle)` in `client/notes.ts` provides
one bounded, wrapping parchment note. Hover notes also open on keyboard focus;
Escape, blur, scrolling, resize and outside interaction dismiss predictably.
Moving onto a hover note preserves it. The helper preserves other description
IDs, removes its own description when dismissed, and cleans up listeners when
its owner leaves the page.

The inspector’s **Quick comparison note** opens by click/Enter/Space, including
the mobile tap alternative. It exposes expanded state and remains focused on
its trigger. Full side-by-side comparison remains a separate action. Essential
requirements, condition, weight, protection, and action restrictions remain in
visible sections or labelled controls. Native titles are supplemental; they are
not the sole source of these facts. Notes never fetch or discover information.

## Reviews and dialogs

`mountDialog(box, {origin, initialFocus, restore})` uses native `showModal` for
inert background content and Escape. Provide a stable `aria-label`, or a heading
for generated `aria-labelledby`. Focus starts at a safe Cancel control or the
first search/selection control. Tab/Shift+Tab wrap through currently visible,
enabled controls, including dynamically loaded quotes. Content scrolls within
the viewport.

On close, focus returns to the connected opener or its `data-focus` replacement.
If it is unavailable, use the current Character section or main heading. Do not
steal focus from another open dialog. Picker/context menu callbacks retain their
existing lifecycle guards; menu-to-dialog handoff restores the originating tile
before opening the next modal. Quotes retain stable names when replacing their
loading headings.

Inline equipment/inventory/loadout reviews use `inlineConfirmation`. Cancel and
Escape restore the opener. Confirm disables immediately and runs once; this is
additional UI protection, not a replacement for revisions, action envelopes,
receipts or server validation. Advancement continues to use the same confirmed,
authoritative action workflow.

## Verification and release

From `realms/`: `npm run typecheck`, `npm run build`, `npm test`,
`npm run styles:check`. Relevant integration checks include `client-integration`,
`advancement`, `growth`, `character-book`, `character-history`,
`inventory-browser`, `inventory-services`, `equipment` and `loadouts` test files.
Use only the loopback disposable previews documented in the Character,
Inventory and Campaign Folio references.

[Browser evidence and manual device checklist](screenshots/vis-06/README.md).
The index, server asset routes, public-edge catalog, style checker and final
release image include the shared stylesheet/modules. Rollback means selecting
the previous verified application image and matching reviewed asset catalog;
no migration or gameplay reset is involved. Existing managed public edges need
the [documented asset refresh](../../infra/docs/playfollybound-hosting.md#updating-reviewed-client-assets)
before the separately approved Caddy restart. This work does not deploy or restart
production.

VIS-03/04/05 were unmerged at implementation time. The review base
`chore/vis-03-05-foundation` combines their exact heads and reconciles their asset,
packaging, extracted-style and test conflicts. Main remains untouched. Land the
prerequisites and reconcile that foundation before retargeting VIS-06 to main;
retain every screen stylesheet and public module in the shared asset contracts.
