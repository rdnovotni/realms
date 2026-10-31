# MU01 synthetic client acceptance proof

The loopback sample uses an isolated `realms_test` schema with synthetic content and a synthetic development credential. No production character/content was changed. The review branch remains stacked on M06 rather than merged into main.

Browser acceptance exercised the actual UI:

1. Sign in; `visit The archive’s missing ledger`; confirm reading the maintenance notes, setting reed/wheel/bell, and opening the cabinet. Three saved scene receipts, no duplicated principal outcome.
2. `exit Sluice office`; `talk to The Keeper`; `say hello`; review and explicitly confirm Introduce yourself. Attributed NPC speech and one saved conversation receipt appear.
3. Recall with Up, return to unfinished typing with Escape, clear/restore typing with Ctrl+U/Ctrl+Z; focus stays in the command input.
4. Define `alias ledger visit The archive’s missing ledger`; invoke it; preserve unknown input; inspect a known object by clicking its transcript mention. Reconnect completion works through the visible Complete command button.
5. Choose Retro and Important announcements; reload; authenticate again. The draft, selected scene/conversation, presentation and four receipt IDs resume without duplication or action replay. Restored entries have a historical label.
6. Use the ordinary GUI confirmation for the office’s escorted-copy alternative. A fifth saved receipt appears through the same session/authority path.
7. Inspect final status and transcript layout. All four presentation modes retain normal contextual controls. Loading reads report their state instead of fabricating a location; unknown input remains editable.

`retro-command.png` and `scene-status.png` show the final sample. `browser-contracts.json` records the current source fingerprint across 734 actual rendered cases: 84 scenes at six widths, plus 23 representative scenes at two widths under reduced motion, higher contrast, forced-color styles, enlarged text and coarse targets. These are browser DOM/layout/contrast checks, not a human screen-reader listening certification or full pixel comparison.

The initial responsive pass found a long Retro suggestion overflowing at 320px with 200% text; wrapping was corrected and final evidence recaptured. The sample exposes contact-scene selection, not a physical travel engine. General room player occupancy and production content readiness remain separate work.
