# Turns and rollover browser evidence

[Visual QA](../../visual-qa.md) · [Player and server contracts](../../turns-rollover.md)

Captured October 21, 2026 in the Codex in-app browser using the loopback frozen synthetic preview. No production account or gameplay writes were involved. The JSON was exported through **Export captured browser reports** after all required cases were observed.

- Source fingerprint: `afbd8c2f93da0fa0467835022e5ed5292a45f316cb962763fc71c6fb0d90dde2` (80 visual sources/fixtures).
- 144 normal cases: 24 scenes × 320/375/768/1024/1440/1920px, height 1000px.
- 90 preference cases: overview, progression, inventory, inspector, comparison, Adventure, combat, Appearance dialog and daily planner × 320/1440px × motion/contrast/forced/text200/coarse.
- Every case passed the source contract. Minimum sampled rendered text contrast: 6.59:1.
- Screenshots were visually inspected in the conversation for the normal desktop planner and the enlarged-text header before/after its correction. This folder contains exported DOM contracts, not a pixel screenshot baseline.

The header fix uses intrinsic wrapping for desktop groups and retains the existing tablet/mobile grid. All reports were recaptured after the fix. Old VIS-07 evidence remains historical under its original directory.

The preference controls activate CSS branches. They do not emulate native OS forced colors, actual browser zoom, screen-reader speech or physical touch. Perform those manual release checks separately. Fixture rollover dates are frozen synthetic values, not a live schedule.

Validate with `npm run visual:check`. Do not edit fingerprints or generate substitute browser reports. Any visual source change requires fresh capture.
