# VIS-03 visual comparisons and verification

Baseline: main `88667e6` after VIS-02 and CHAR-05. Before/after captures use the same synthetic multiclass state: Warden 20, Wayfarer 5, 2,400 XP at the authored total-level cap, Sentinel, committed feat/attribute/proficiency choices, equipped sword/shield and 29 history events. Each fixture records its own actual event times; timestamps naturally differ. These are disposable local browser captures, not production.

| Chapter | Before | After |
| --- | --- | --- |
| Overview | [Before](before-overview.jpg) | [After](after-overview.jpg) |
| Progression | [Before](before-progression.jpg) | [After](after-progression.jpg) |
| Abilities | [Before](before-abilities.jpg) | [After](after-abilities.jpg) |
| Statistics | [Before](before-statistics.jpg) | [After](after-statistics.jpg) |
| History | [Before](before-history.jpg) | [After](after-history.jpg) |

Detail views: [class/specialization cards](advancement-cards.jpg), [proficiency ranks/milestones](proficiency-milestones.jpg), [ability inspection](ability-inspection.jpg), [mobile allocation confirmation](mobile-allocation-confirmation.jpg), [single-class pending XP](single-class-pending-xp.jpg), [fresh starting build](fresh-starting-build.jpg), [375px Overview](overview-mobile-375.jpg), [320px Overview](overview-mobile-320.jpg).

Desktop captures requested 1440×1100px; mobile examples requested 375×1000 and 320×1000px. The screenshot service can omit scrollbar space and slightly scale returned images. Live geometry is used for overflow claims, not the image dimensions.

## Executed automated checks

- TypeScript typecheck and server/client build passed.
- **204 unit tests** passed, including existing large-XP/cap/native-class tests and new current-run/revision/owned-class specialization gates and unknown/empty/zero cost distinctions.
- **19 relevant integration tests** passed across advancement, growth, Character Book, History and client integration. Coverage includes legal class/subclass/feat choices; exact attribute budgets/caps/future capacity; one-rank proficiency choices; stale/replayed actions; active/read-only restrictions; account/discovery boundaries; contextual and unassessed statistics; immutable current-run history and lifecycle reset.
- Style checks passed: **75 existing tokens**, **53 semantic contrast pairs**, minimum normal text **4.79:1**; CSS structure/local-asset checks passed.
- Five release-verification infrastructure tests passed, including the production-image stylesheet packaging contract.
- Documentation/API navigation and feature-registry checks passed.

## Executed browser scenarios

- All five chapters at **320, 375, 768, 1024 and 1440px**, with no page or Character-element horizontal overflow. [Raw measurements](browser-geometry.json) also cover three-column committed/staged statistics at all five widths.
- Fresh unconfigured character saw starting-build selection before any equipment summary. Chose a real starting build; Overview showed all seven scores; History recorded the single starting choice. No assessed abilities and no discovered stat context displayed clear, honest empty/unavailable states.
- Single class with earned XP displayed level 5, 800 total XP, four pending allocations, and the next earnable level 10 at 900 XP. After native level 6 was committed, it displayed three pending allocations without moving the next earnable threshold.
- Multiclass/capped state displayed both native class levels and the committed subclass. The capped message was separate from available unspent feat/attribute/proficiency/subclass decisions.
- On mobile, cancelled a permanent subclass review with Escape and observed focus restore to its review button. Then committed subclass Sentinel, native Warden level 6, feat Steady footing at milestone 2, exactly two Luck points (10→12), and proficiency Untrained→Novice at milestone 1. Each required its existing confirmation and produced a specific success notice. Overview and History refreshed; the single-class timeline grew from five to ten committed entries.
- Ability search/category filtering and inspection preserved source, supported cost/cooldown, effects and restrictions. Inspection received focus. Owned class, feat, subclass and active equipment sources were visible in the assessed multiclass fixture.
- Expanded authorized calculation explanations. Staged weapon-set B in Pack, returned to Statistics and enabled the staged column, verified contextual before/after values and unavailable measurements, then reverted the draft in Pack. No equipment editor was added to Character.
- Paged the 29-entry chronicle to entries 26–29, then reloaded, signed in and reopened Character. History and its page were retained. Returned to earliest entries through existing controls.
- Chapter Tab/Shift+Tab navigation showed the shared 3px light focus halo. Existing native modal dialogs, explicit confirmation, Escape and restoration logic were retained; no custom focus trap was substituted.
- In-app Refresh and sign-out worked. The inspected browser console had no warnings or errors.

## Accessibility and art limits

Decorative SVGs are hidden from assistive technology and are not focusable. Visible names, semantic definition lists, native controls, labelled progress bars, table row groups and ordered history preserve the information structure. Active states use shape/border/underline as well as color.

OS forced-colors/increased-contrast and reduced-motion preferences could not be emulated by the browser adapter. Their existing fallback rules remain, with Character-specific track/table/chapter fallbacks; real OS preference rendering is a manual check, not claimed executed. Screen-reader speech was not audited with a native screen reader. No performance benchmark was collected; no external fonts, raster art, animation, blur or scrolling script was added.

The neutral emblem and original small ink SVGs intentionally avoid invented portraits, races or class lore. Future authored art remains a content-contract decision. Existing item artwork is reused. Gameplay formulas, write authority, API contracts and database schemas were not changed. No production deployment is claimed.
