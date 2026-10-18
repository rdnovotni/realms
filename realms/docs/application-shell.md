# Authenticated application shell

[Documentation map](README.md) · [The Adventurer’s Folio](adventurers-folio.md) · [Browser client](game-client.md)

VIS-02 applies the existing Folio theme to the signed-in application. A walnut header, inset parchment sidebars, clean vellum page and fine brass rules frame Adventure, Combat, Character and Pack. The original public cover and login remain unchanged. No gameplay, authentication, action envelopes, discovery gates, routes or database contracts change.

## Ownership and scope

- `client/shell.ts` renders shared navigation and global feedback, retaining existing callbacks, disable rules and focus keys. Notices keep their original message and live-region role, with a decorative ink glyph and visible status label. Read-only connection status remains visible on small screens.
- `client/shell-model.ts` supplies presentation labels. Combat highlights Adventure as its containing navigation destination while its page label remains Combat.
- `client/shell.css` owns authenticated framing and shared overlay paint, loaded after screen styles. It does not replace Pack grid definitions, drag/drop, staging, scrolling, Character section selection or dialog behavior. Superseded header/overlay paint rules were removed from older sheets.
- `client/folio.css` remains the single token contract. Three subtle alpha tokens extend it: `--folio-page-edge`, `--folio-page-glow`, `--folio-stitch`. Existing surfaces, typography, spacing, borders, focus, status, shadow and icon primitives are reused. No external fonts, assets, libraries, animations or scroll listeners are added.

The desktop frame is bounded at 1660px. At 1050px the primary navigation moves to a second compact row. Below 680px the wordmark, account controls and connection state fit above three full-width navigation choices. Safe-area insets and dynamic viewport units bound the shell and overlays. The header scrolls normally so the existing sticky equipment panel can occupy the viewport.

## Accessibility and interaction

The current page has `aria-current="page"`, a light tab, underline and brass edge. Text labels accompany notice colors/icons; icons beside text are hidden from assistive technology. Existing focus rings, skip link, main landmark, keyboard controls, modal focus trapping/restoration and explicit confirmations remain in place. Sidebars now have descriptive landmark labels. Essential Character information still lives in the main Character page.

Texture-off and reduced-motion behavior come from VIS-01. Increased contrast removes the background effects and page shadow; forced colors use system colors and a selected-navigation outline. Source contrast checks cover semantic text, focus and interactive boundaries, not every legacy screen-specific paint combination. OS forced-color/reduced-motion rendering still requires a manual device check when preference emulation is unavailable.

## Disposable browser fixture

After building, point `TEST_DATABASE_URL` at a loopback PostgreSQL database named **realms_test**:

```sh
npm run build
TEST_DATABASE_URL=postgres://LOCAL_TEST_USER@127.0.0.1:55439/realms_test node --import tsx scripts/shell-preview.ts
```

Open `http://127.0.0.1:3005`, sign in as `wayfarer` with the public fixture password `A road worth wandering 47!`. This is synthetic test data, never a production credential. The helper refuses remote hosts and other database names, creates its own schema and removes it on graceful SIGINT/SIGTERM. It does not start PostgreSQL or change production configuration. Abrupt termination can leave a test schema for deliberate cleanup.

The configured fixture has pending advancement decisions, known capabilities, an encounter and 48 carried sword/shield copies, two equipped in set A. `PLAYTEST_SHELL_ITEMS` supports 2–96 items. Expand Filters and uncheck Group matching bases to exercise long-grid scrolling. Unmeasured capacity and missing authored rarity/weight remain honestly unmeasured/unknown. These labels are test fixtures, not new game content.

Check sign-in, Character sections, progression review/cancel/commit, Pack inspection/comparison, slot search, weapon-set stage/revert/apply, context-menu keyboard access, Adventure, Refresh and sign-out. A full browser reload requires signing in again because bearer tokens are intentionally held in memory; the in-app Refresh retains the session.

## Verification and remaining scope

See [screenshots, responsive measurements and results](screenshots/vis-02/README.md). Run typecheck, build, unit tests, relevant integration tests, `npm run styles:check`, documentation and feature-registry checks before shipping.

This is shared framing, not a complete screen redesign. Screen-specific compact metadata, legacy green equipment-bank/comparison fills and some legacy glyphs remain for subsequent VIS tickets. Native browser JavaScript confirmations retain browser styling. No Journal navigation or unfinished functionality is introduced. Character History is absent from this main baseline; its separate PR is not part of VIS-02. No production deployment is implied.
