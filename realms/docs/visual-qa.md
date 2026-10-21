# Folio visual QA and theme maintenance (VIS-07)

[Documentation map](README.md) · [Canonical design tokens and components](adventurers-folio.md) · [Screenshot evidence](screenshots/vis-07/README.md)

## Turns and rollover browser gate (October 21)

The Turns slice expands the required matrix to **234 cases**: 24 scenes at six widths, plus nine scenes at two widths in five preference modes. The six new scenes are daily planner, waiting rollover, reserve confirmation, loading, error and read-only. The daily planner joins the preference matrix. The historical 188-case VIS-07 baseline below does not certify the changed client.

Fresh capture is pending: browser safety policy rejected access to the stale preview tab after the environment restarted. Reopen the loopback preview in the app browser before continuing capture. Preserve the stale-evidence failure in `npm run visual:check`; do not replace the stored fingerprint or synthesize reports. The source slice is not ready to merge until all 234 current-source reports pass and the planner receives visual review.

## Historical VIS-07 cross-screen audit

The integration preserves the exact VIS-03–07 heads, including the three-parent VIS-03–05 reconciliation at `161514f` and VIS-06 at `d738065`. The integration follow-up corrects mobile shell geometry and strengthens the browser evidence contract. Source integration does not establish production activation.

| Area | Findings and resolution |
|---|---|
| Character's five chapters | Preserve identity medallion, seven attributes, progression confirmations, compendium, contextual statistics and immutable chronicle. Shared tokens and focus contract remain consistent. |
| Pack, paperdoll, inspector, comparisons, loadouts | Remove superseded paint declarations; retain rarity, condition, binding and unknown-value labels. Replace absolute tile footers with flex bottom alignment so enlarged metadata cannot overlap condition/weight. Minimum heights scale with text. |
| Adventure, combat, Journal | Preserve journal/tactical distinctions. Wrap section-header metadata and combat identity at enlarged text; align shared ink icons. |
| Shell and dialogs | Mobile branding, connection/tools and navigation have separate rows, preventing Appearance from overlapping the wordmark. Utility tools wrap rather than widen the page. Coarse-pointer targets remain at least 44px tall. Appearance reuses native dialog/focus restoration. |
| Empty/loading/error/setup and long lists | Explicit states remain understandable; setup comes before equipment. Stress reference exercises 64 public feat/skill rows, long labels and a 120-record inventory. |
| Palette/controls | Authenticated screen hex paints now use semantic roles. Primary destructive buttons use a contrast-tested foreground/background pair. Forced-color roles use system colors. |

CSS cleanup removes 74 declarations superseded within the same selector/media context and unused legacy login, attribute, row and tag rules. Surviving cascade order is preserved. Screen-specific responsive blocks remain where merging them would change precedence. The public illustrated hero intentionally retains its art palette and legibility overlays. See the machine-readable [CSS audit](screenshots/vis-07/css-audit.json).

## Theme architecture

`client/folio.css` is the single token contract: semantic surfaces, foregrounds, controls, focus, feedback, typography, spacing, decoration and motion. Screen styles own geometry, not a second palette. See the canonical [token inventory](adventurers-folio.md#token-inventory).

Parchment is the only implemented theme. `appearance.ts` validates that identifier and a texture boolean; session storage is cosmetic and may fail safely. Appearance in the authenticated header changes paper grain without a server action. It survives reload in the same tab where session storage is supported; login session persistence is independent.

To add Dark, Light, High Contrast, Minimal or Retro MUD later: override semantic roles under a validated root theme identifier; supply correct paired foregrounds for every surface/action/feedback state; define texture independently; run all contrast and responsive checks and review illustrations before exposing that option. Never invert the whole page or assume a light background. No future theme appears as a selectable placeholder.

`--folio-texture-source` is independent from semantic colors; `--folio-paper-texture` is its enabled output. Root `data-folio-texture="off"` removes grain. System contrast/forced-color preferences still override decoration. Rarity accents have dedicated roles. Authored illustrations remain colored; new interface icons follow the shared ink SVG convention, with decorative SVGs hidden from assistive technology.

## Repeatable visual reference

From `realms/`, run `npm run build` and `npm run preview:visual`, then open `http://127.0.0.1:3012/dev/visual`. This loopback-only tool needs no database, random seed, clock rewriting or external service. It renders the production components with frozen, synthetic, discovery-filtered public read models. It rejects gameplay writes and unsupported reads. Development modules and fixture routes return 404 from the production server and are excluded from the edge asset allowlist.

Five JSON fixtures in `test/visual-fixtures` were explicitly captured from disposable local preview accounts: multiclass Character, equipment-heavy Pack, dense combat, unconfigured setup and Adventure. Recorded event times remain actual frozen values. Capture strips inspection tokens and rejects credential-shaped fields. To intentionally regenerate, start the existing disposable client (3001), Character (3008), and campaign (3011) previews using the documented fixture configuration, then run `npm run visual:fixtures`. Capture requires the disposable marker on every response and has no arbitrary-host argument. Review fixture changes before accepting them.

The scene picker includes all five Character chapters, Pack, paperdoll, inspector, comparison, loadouts, Adventure, combat, Appearance dialog, empty/loading/error, setup and long-list stress. Reference-only controls are labelled separately from game UI. Empty/error/loading and stress scenes are explicit presentation projections, not claims that the server generated those states.

### Baseline review process

1. Build and start the frozen preview. Keep the same local fonts and browser configuration for comparisons.
2. Capture the 24 normal scenes at 320, 375, 768, 1024, 1440 and 1920px, height 1000. Wait for `#visual-audit` to contain its report before capturing.
3. Capture overview, progression, inventory, inspector, comparison, Adventure, combat, dialog and daily planner at 320/1440 with modes `motion`, `contrast`, `forced`, `text200`, `coarse`. These deliberately activate CSS branches; they are not OS preference emulation.
4. Review screenshots and interactions. Use **Export captured browser reports** to download the current-source captures as one JSON array. The development reference retains reports for each scene/mode/width in optional tab session storage; denied storage still allows current-page export. Run `npm run visual:check -- --actual /absolute/report.json` (absolute paths are accepted). Resolve overflow, header overlap/overflow, footer collisions, heading skips, unnamed controls, icon semantics, target and sampled contrast failures.
5. Commit reviewed screenshots and `docs/screenshots/vis-07/browser-contracts.json` together. Explain intentional changes. The manifest hashes client CSS/TypeScript, entry HTML, recursive local artwork and all five fixtures; changing visual sources requires fresh evidence.

The validator requires every documented tuple: all 24 scenes at all six widths and all nine preference scenes at both widths in each of five modes. Omitting a tuple fails even if other records are duplicated. Header assertions compare rendered brand text, connection, utility and navigation boxes across groups, including content that paints beyond a compressed grid cell.

CI `npm run visual:check` verifies recorded contracts against the current source fingerprint. It does **not** launch a browser, compare pixels, or establish that the stored screenshots are visually correct. It intentionally fails on stale source evidence. Browser capture and human screenshot review remain required. Do not update a hash without rerunning the matrix.

## Accessibility results and limits

The historical VIS-07 baseline has 188 passing browser contracts: 108 normal screen/width cases and 80 preference/text/pointer projections. No document overflow, header overlap/overflow, footer collision, skipped heading level, unnamed control, invalid decorative icon semantics or enabled button below 24px was detected; coarse projections have no enabled button below 44px tall. Sampled opaque rendered text pairs have a minimum 6.59:1 contrast. This sample is not an exhaustive contrast audit of every pixel, illustration, disabled control, checkbox or label hit area. The independent source checker validates 55 semantic contrast pairs (normal text minimum 4.79:1; applicable boundaries/focus at least 3:1).

Live disposable-client verification confirms Appearance checkbox announcements, Escape dismissal, focus restoration to Appearance, texture off, and retained texture after reload. Reload returns to login under the fixture's existing authentication behavior; texture remains off independently. The mobile equipment toggle opens the shared paperdoll. The comparison dialog opens from the inspector; Escape dismisses it and returns focus to Compare. Native dialog semantics and keyboard controls are preserved. No gameplay action is used by the cosmetic preference.

The browser tool cannot set native OS forced colors, reduced motion, actual browser 200% zoom, screen-reader speech, or physical touch. `text200` doubles root text to 32px; this is an enlarged-text test, not actual browser zoom. Before release, manually test actual 200% zoom, OS preference combinations, screen-reader announcements, touch scrolling and the tap/picker alternative to dragging. CSS branch projections do not replace those device checks.

## Performance observations

All art, grain and fonts are local or system resources. Grain is one static sub-1KB SVG background, disabled independently. Repeated item-art drop-shadow filters were removed; all 188 reports observe zero filtered item illustrations. Inventory retains pagination instead of rendering the entire collection. There are no new animated textures, font downloads, observers or production screenshot instrumentation. Audit calculations run only in the development reference on request/initial render.

[CSS byte counts](screenshots/vis-07/css-audit.json) compare source styles to VIS-06. Appearance adds a small module; fixture JSON and reference JavaScript are development-only. These are source/DOM observations, not a measured frame-rate, load-time or memory benchmark. Larger real catalogs and native device performance remain release checks.

## Validation record

- TypeScript typecheck and client/server build: passed.
- Unit/client: 219 passed, zero skipped.
- Integration: 389 passed, zero skipped, disposable PostgreSQL.
- Worker/runtime: 7 and 3 passed, zero skipped.
- Infrastructure: 175 cases, 10 conditional skips, no failures.
- Styles, documentation navigation, feature registry and visual source contracts: see the PR's final command results.
- Release build-stage allowlists include the visual-contract unit-test helper; a packaging regression test guards both Docker COPY and context inclusion. No production deployment or release-checkpoint result is implied by local tests.

October 19 integration verification recaptured all 188 required browser cases after the mobile-header correction. The sampled minimum remains 6.59:1; no header collision/overflow was detected. Screenshots from the initial VIS-07 pass are historical and can contain the superseded cramped header.

Rollback is a source revert and rebuild. No migration, public service change, combat/progression formula, ownership rule, discovery gate or persistent gameplay contract is changed.
