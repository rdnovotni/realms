# VIS-04 visual evidence

All images show the loopback disposable test environment, not production.
Baseline images use the standard services fixture. Populated after images use
`PLAYTEST_FOLIO=1` with 48 additional equipment copies; synthetic labels are
intentional. Layout comparisons therefore include different equipment occupancy.

| View | Before | After |
| --- | --- | --- |
| Desktop, 1440 × 1100 | [Before](before-desktop.jpg) | [After](after-desktop.jpg) |
| Mobile, 375 × 1000 | [Before](before-mobile.jpg) | [After](after-mobile.jpg) |

Mobile with equipment collapsed: [inventory access](mobile-collapsed.jpg).

Additional panels: [comparison](comparison-desktop.jpg), [repair quote](repair-desktop.jpg).

All three layout modes passed DOM geometry checks at 320, 375, 768, 1024 and
1440px with 48 visible individual items. No horizontal overflow or metadata/footer collisions were detected;
mobile grid/equipment overflow stays visible rather than creating nested scrollers.

The browser pass covers the standard partly empty paperdoll and fully populated
worn slots, active A/prepared B, two-hand occupancy, exact damaged condition,
grouped facts and 48-item pages from 68 physical records, all three layout modes,
item inspection, comparison and Escape/focus restoration, draft stage/revert,
bulk selection, storage empty states, repair affordability, confirmed item use,
keyboard slot search, loadout preview/revert, reload/reconnect, and mobile equipment disclosure. Server integration tests cover actual repair,
binding, loadout commits, stale writes, replay and ownership restrictions.

Remaining verification limits: native pointer drag/drop cannot be automated by
the connected DOM-only browser; existing drag payload/model tests and tap/picker
alternatives cover its underlying flow. A zero-condition slot is covered by a
presentation regression test; ordinary current failure wear stops at one, so the
live fixture does not fabricate broken gear. OS forced-colors, native screen
reader output and physical touch behavior require manual device verification.
No production deployment is claimed.
