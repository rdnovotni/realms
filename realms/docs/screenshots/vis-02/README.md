# VIS-02 shell verification

Baseline: main `7a4bc24` after VIS-01. Both sides use the same synthetic Warden 5 fixture, 800 XP, four earned class allocations, 48 sword/shield copies and active set A. Screens are local browser captures, not production. The Adventure capture was refreshed after test actions; content state may differ while the shell comparison remains valid. Equipment captures show the expanded slot after its normal focus scroll.

| Screen | Before | After |
| --- | --- | --- |
| Character Overview | [Before](before-character.jpg) | [After](after-character.jpg) |
| Character Progression | [Before](before-progression.jpg) | [After](after-progression.jpg) |
| Pack | [Before](before-pack.jpg) | [After](after-pack.jpg) |
| Equipment workspace | [Before](before-equipment.jpg) | [After](after-equipment.jpg) |
| Adventure | [Before](before-adventure.jpg) | [After](after-adventure.jpg) |
| Advancement confirmation | [Before](before-confirmation.jpg) | [After](after-confirmation.jpg) |
| Mobile navigation | [Before](before-mobile.jpg) | [After](after-mobile.jpg) |

Additional states: [comparison dialog](after-comparison.jpg), [Combat](after-combat.jpg). Captures use 1440×1000 desktop and 375×900 mobile viewport requests; the capture service can omit scrollbar space and scale the returned image slightly. Browser measurements below use live document geometry, not image pixel assumptions.

## Executed checks

- TypeScript typecheck and client/server build passed.
- All **197 unit tests** passed.
- **22 integration tests** passed across client integration, inventory browser, Character Book, advancement and growth. They include read-only and account isolation, discovery restrictions, stale/replayed actions, legal advancement and equipment/state persistence.
- Style check: **75 tokens**, **53 semantic contrast pairs**, minimum normal text **4.79:1**. CSS structure and local-asset checks passed.
- The production-image stylesheet regression reproduced missing `folio.css`/`shell.css`, then passed after adding them to the image copy list.
- Documentation links/API coverage and feature-registry checks passed.
- Browser console reported no warnings/errors after the complete scenario.

## Browser scenarios

Signed in; opened Character Overview, Progression, Abilities and Statistics; reviewed/cancelled a subclass selection; inspected equipped Sword; opened side-by-side comparison; used Escape; expanded filters and ungrouped 48 instances; opened the keyboard context menu with Shift+F10 and dismissed with Escape; navigated Adventure and refreshed; signed out to the unchanged public page.

Actual disposable actions committed Sentinel subclass, Warden native level 6, and weapon set B. Success notices named each change, available choices refreshed, and Statistics/Ability Book reflected the committed equipment set. Entering the known Tactical encounter rendered Combat with Adventure selected in the main navigation. No production account was used.

Escape restored focus to the subclass review button, comparison action and original inventory tile respectively. Existing confirmation logic and modal mechanisms were not replaced. Native pointer drag/drop was not automated by this DOM-only browser tool; drag handlers and targets are untouched, their payload/authority regressions are covered by existing tests. Manual pointer and touch-device validation remains useful.

## Responsive measurements

[Raw measured geometry](browser-geometry.json) records populated Pack, Adventure, Character and comparison dialog at **320, 375, 768, 1024, 1440 and 1920px**. Document scroll width equaled client width throughout. All three navigation choices, Refresh and Sign out remained within the viewport; phone controls measured at least 44px high.

At 1024px and above, equipment retained `position:sticky` and the populated item grid retained independent `overflow-y:auto` with 650px client height at a 1000px viewport. Below the existing equipment breakpoint it stacked with normal mobile scrolling. Comparison dialog content widths stayed within their client widths at all six sizes and long content remained scrollable.

OS high-contrast/forced-colors and reduced-motion preferences could not be emulated by this browser adapter. Styles preserve VIS-01 fallbacks and add explicit shell fallbacks; real OS preference rendering is a remaining manual check, not claimed as executed. No performance benchmark was collected: the change adds static CSS and a few inline SVGs, with no external font load, blur, animation or scrolling script.

## Remaining visual scope

Legacy equipment-bank/comparison fills, some dense metadata and screen-specific glyphs remain for subsequent VIS tickets. Native JavaScript confirmation dialogs remain platform styled. Character History is not merged into this baseline. This PR changes shared presentation only and does not claim production deployment.
