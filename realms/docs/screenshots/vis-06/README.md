# VIS-06 interaction verification

These are disposable loopback accounts, not production. Reuse the VIS-03
Character, VIS-04 populated Pack and VIS-05 campaign preview instructions.

- [Mobile advancement review](mobile-advancement-review.jpg): permanent feat
  selection with safe initial focus, explicit milestone, Cancel and Confirm.
- [Mobile comparison note](mobile-comparison-note.jpg): explicit click/tap
  alternative to hover, known facts only, constrained to viewport.
- [Dense combat controls](combat-controls-desktop.jpg): shared ink motifs,
  labelled budgets, costs and current-target controls.

Fifty measured geometry checks cover Overview, Progression, Abilities, Statistics, History,
all three Pack layouts, saved-encounter Adventure and dense Combat at
320/375/768/1024/1440px. No horizontal overflow was found. Buttons had accessible
names, decorative SVGs were hidden/non-focusable and combat meters were labelled.
The Pack account had 120 physical records, with 48 tiles per ungrouped page. [Recorded requested/actual viewport dimensions](browser-geometry.json) match for every check.

Actual browser checks:

- Native comparison naming, initial selection focus, Escape and opener return.
- Repair quote naming through asynchronous replacement; Tab and Shift+Tab wrap
  even with a single enabled button; Escape returns to Repair all.
- Item-use review cancellation returns to Use item; unavailable quote costs and
  unidentified effects keep their authoritative explanations.
- Inline collection-protection and loadout-delete reviews cancel with Escape
  and restore their source control.
- Shift+F10 opens item actions. Opening comparison from that menu leaves one
  modal, then returns focus to the originating inventory tile.
- Explicit Quick comparison note opens on mobile, fits the viewport, announces
  expanded/described state and dismisses with Escape.
- Advancement review cycles focus in both directions, Escape restores its
  opener, and a legal class allocation updates native/total levels, choices and
  the specific saved-action notice while remaining in Progression.
- Feat review includes its earned milestone. An exact two-point attribute draft
  opens its permanent review without committing silently.
- Combat’s native control link focuses the controls heading.

Automated regressions cover repeated confirmation (one callback only),
Escape cancellation, blocked reviews, bounded local SVG paths, public styles,
and existing revision/ownership/read-only safeguards.

## Device verification still required

The connected browser supports DOM clicks and keys but does not provide physical
touch, a native screen reader, OS media-preference emulation or browser zoom.
A Control-plus attempt left device pixel ratio, layout width and visual scale
unchanged, so it is not claimed as a 200% zoom test. The CSS reduced-motion,
increased-contrast and forced-color fallbacks are checked by inspection and
style checks, not claimed as OS-rendered results.

Before release, use a real browser/device to:

1. Enable reduced motion and high contrast/forced colors; check focus, selected,
   occupied, warning and disabled cues remain visible without color.
2. Set browser zoom to 200%; traverse all five Character sections and Pack,
   scroll long modal content, and verify no essential controls are clipped.
3. Use touch to select gear, open the equipment picker, inspect notes and cancel
   item-use/repair reviews; test long-press versus ordinary scrolling.
4. Use a screen reader to confirm modal names, state announcements, meter values,
   progression review descriptions and absence of decorative-icon noise.

No production deployment or benchmark claim is made.
