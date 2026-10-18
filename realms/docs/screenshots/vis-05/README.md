# VIS-05 visual verification

Images show disposable server-backed fixtures on loopback, not production.
Baseline and after scenarios use the same definitions and legal setup actions;
random encounter rolls can produce different legitimate health/status details.
Desktop is 1440 × 1100, mobile is 375 × 1100.

| State | Before | After |
| --- | --- | --- |
| Adventure and empty Journal | [Before](before-adventure.jpg) | [After](after-adventure.jpg) |
| Player turn and effects | [Before](before-player.jpg) | [After](after-player.jpg) |
| Server turn | [Before](before-server.jpg) | [After](after-server.jpg) |
| Exhausted Main/Quick | [Before](before-exhausted.jpg) | [After](after-exhausted.jpg) |
| Victory and recorded outcome | [Before](before-victory.jpg) | [After](after-victory.jpg) |
| Defeat and recovery | [Before](before-defeat.jpg) | [After](after-defeat.jpg) |
| Insufficient Turns | [Before](before-spent.jpg) | [After](after-spent.jpg) |
| Starting-build restriction | [Before](before-newcomer.jpg) | [After](after-newcomer.jpg) |
| Mobile player turn | [Before](before-mobile.jpg) | [After](after-mobile.jpg) |

Additional checks: [read-only encounter](after-viewer.jpg),
[dense technique controls](after-dense.jpg), [mobile controls](mobile-controls.jpg), [active encounter resume](active-resume-mobile.jpg), [exhausted controls](exhausted-controls.jpg),
[victory result](victory-result.jpg) and [defeat/recovery result](defeat-result.jpg).

Fifty layout checks across ten fixture accounts at 320, 375, 768, 1024 and 1440px
found no horizontal overflow or oversized action controls. The server-turn
screenshot records the initial saved segment; that fixture was then continued
legally to verify control returns to the player.

The browser pass checks responsive layouts, long names, multiple combatants,
status effects, target changes, action controls, saved continuation, outcomes,
recovery, Journal links and empty states. Native anchor navigation focuses the
control heading; Tab then reaches the target selector with the shared visible
focus ring. A Quick technique and Guard were committed through normal controls;
the resulting saved budgets, Mana, resources and cooldown facts updated. The
viewer fixture returned read-only server data and every mutation control was
disabled. Committing Attack exhausted its Main budget and restored focus to
the turn-control heading instead of jumping back to the top of the battlefield. UI state and geometry are observed from
the rendered page; no state is injected into the browser.

Limits: native screen-reader speech, OS forced-color preferences and physical
touch hardware are not emulated by the connected browser. Shared CSS fallbacks
and semantic labels/meters remain present. No production deployment is claimed.
