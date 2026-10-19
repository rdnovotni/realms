# The Adventurer's Folio

[Documentation map](README.md) · [Game client](game-client.md) · [Identity and artwork](branding-and-pages.md)

Follybound should feel like an adventurer's character sheet inside a leather-bound campaign journal. Warm parchment frames clean vellum; walnut supplies structure; antique brass supplies restrained ornament. Deep brown ink carries information. Forest green and burgundy identify actions and states. Text and controls come first during long play sessions.

This is a reusable visual foundation, not a screen redesign or a new design-bible mechanic. Server authority, discovery-safe projections, equipment drafts, progression choices and combat calculations are unchanged. Theme classes never decide eligibility or expose hidden values. Follow the [design registry's source authority](../design/README.md); this reference defines presentation, not new gameplay canon.

## Existing-style audit

The baseline main branch was `8719f1062e0d2539662612e6f7cd71388076c7bd` (through CHAR-04). At the VIS-01 baseline, CHAR-05 was an independent PR. It is now merged; the [illustrated Character folio](character-folio.md) applies these same primitives to all five Character chapters.

| Finding | Foundation response |
|---|---|
| Green-tinted ink, unrelated greens/browns, repeated `#315e4f` and `#68725f` | Semantic brown ink, forest action, readable muted text; migrate common paints in place |
| Shared `styles.css` (410 lines) and welcome styles (158 lines) separately define controls, focus, shadows and fonts | `folio.css` owns the shared visual contract; screen CSS retains layout and compact exceptions |
| Welcome already has original tavern art, manuscript SVGs, brass rules and a die | Preserve those assets and header composition; remove heavier repeating paper gradients and panel gradients |
| Inventory tiles have several accumulated unconditional rules and responsive refinements | Reuse theme paint, radius and typography tokens; retain grid, footer anchors, inspector and paperdoll geometry |
| Focus colors compete across welcome, inventory, paperdoll and Character | One high-specificity two-tone focus rule covers buttons, links, fields, summary and focusable headings |
| Faded disabled buttons and undefined `--border` fallback | Readable disabled tokens with dashed boundary; replace undefined token with semantic border |
| Four reduced-motion blocks and two contrast blocks; fifteen 650px feature-specific blocks | Consolidate preference rules centrally and adjacent 600px blocks; leave screen-specific responsive ordering intact to avoid a cascade rewrite |
| 8/12/16/24px spacing repeats; 2–12px corner radii vary | Adopt shared scale at exact matches and small folio radii; do not move layout breakpoints |
| Item art, fallback SVGs, selected/equipped/protected markers already exist | Preserve authored art and semantics; standardize future ink icon conventions |
| No forced-colors treatment; metadata advertises unsupported dark mode | Respect system colors and remove decorative texture/shadow in high contrast; advertise the supported light theme |

## Loading and ownership

`client/index.html` loads `folio.css`, then `styles.css` and `welcome.css`. The latter two retain screen geometry. `folio.css` owns tokens, shared typography, controls, primitives and accessibility preferences. Repeated legacy colors and spacing now reference it rather than accumulating a new per-screen override sheet.

Assets are explicitly same-origin allowlisted in `src/client-assets.ts`. There is no external font, stylesheet, icon library, CDN, telemetry or theme request. The system font stack and solid background remain usable if a decorative asset cannot load. Reverting this ticket's source and rebuilding restores the previous theme; there is no database or deployment migration.

## Token inventory

Canonical definitions live in `client/folio.css`. Use semantic roles rather than choosing a new hex value per component.

| Group | Tokens (`--folio-` prefix) | Purpose |
|---|---|---|
| Palette | `parchment`, `vellum`, `ink`, `walnut`, `brass`, `burgundy`, `forest`, `muted` | Stable theme identity |
| Surfaces | `page`, `surface`, `surface-raised`, `surface-inset`, `nav`, `nav-hover` | Paper → vellum → raised card; inset facts; dark framing |
| Text | `text`, `text-secondary`, `text-muted`, `on-dark`, `on-dark-muted`, `brass-ink` | Distinct readable roles; brass itself is decorative |
| Boundaries | `border`, `border-interactive`, `focus`, `focus-halo` | Quiet decoration versus recognizable control/focus edges |
| Actions | `action`, `action-hover`, `on-action`, `on-danger`, `danger-hover`, `selected`, `hover`, `control-highlight` | Primary actions and selection |
| Feedback | `success`, `success-surface`, `warning`, `warning-surface`, `danger`, `danger-surface`, `disabled`, `disabled-surface` | Paired text/surface colors |
| Elevation | `shadow`, `shadow-raised`, `shadow-dialog`, `backdrop` | Quiet panels, floating surfaces, modal separation |
| Shape | `radius-sm` (2px), `radius` (4px), `radius-panel` (5px) | Avoid dashboard-like pill cards; circles remain for circular motifs/meters |
| Spacing | `space-1`…`space-7` (.25, .5, .75, 1, 1.5, 2, 3rem) | Reusable rhythm; existing compact screen geometry may use intermediate values |
| Typography | `font-heading`, `font-body`, `font-narrative`, `type-small`, `type-label`, `type-body`, `type-card`, `type-section`, `type-title`, `leading`, `leading-heading` | Roles described below |
| Motion/texture | `duration` (120ms), `ease`, `texture-source`, `paper-texture` | Restrained interaction feedback and optional grain |

Compatibility aliases: `--paper`, `--ink`, `--muted`, `--accent`, `--line`, `--gold`, `--danger`. Do not introduce another root palette in a screen stylesheet. The offline checker resolves references and rejects missing tokens.

## Typography

- Wordmark, page/section titles, card headings: Palatino Linotype / Book Antiqua / Palatino / Georgia / serif. These are local font choices, not downloads.
- Body, buttons, tables, labels, item properties and tooltips: system UI stack. Keep dense information simple. Existing responsive type sizes remain where useful.
- Narrative prose: Georgia / Times New Roman / serif, with generous line height. Use `.folio-narrative` for descriptive passages, not tiny labels.
- Statistics and table values: lining tabular numbers, without changing the underlying strings or precision.
- Body baseline: 16px, 1.55 line height. Heading line height: 1.2. New small prose should normally use `type-small` (.875rem); compact existing item metadata is retained for later screen tickets.

Do not introduce decorative fonts for essential controls or tiny statistics. Font fallback must never hide information or change calculations.

## Reusable primitives

| Class | Treatment |
|---|---|
| `.folio-panel` / existing `.panel` | Vellum with fine border and understated inset highlight |
| `.folio-card` | Raised clean vellum, standard padding |
| `.folio-inset` | Slightly darker paper for grouped facts |
| `.folio-leather` | Walnut with separate light foreground roles |
| `.folio-section-heading` | Double-rule section boundary |
| `.folio-divider`, `.folio-ornament` | Plain ink rule / restrained double brass rule |
| `.folio-table` | Clear rows, wrapping cells, tabular values |
| `.folio-label`, `.folio-value`, `.folio-narrative` | Information hierarchy |
| `.folio-status` + success/warning/danger/pending | Text-led status, bounded surface; pending uses dashed border |
| `.folio-empty` | Dashed inset panel with a reason and next supported step |
| `.folio-selected`, `.folio-locked`, `.folio-unavailable` | Outline or dashed boundary; must also have explicit text/semantics |

Examples (documentation only):

```html
<section class="folio-panel"><h2 class="folio-section-heading">Known properties</h2>
  <div class="folio-inset"><span class="folio-label">Condition</span>
    <span class="folio-value">87 / 100 · Healthy</span></div>
</section>
<button class="primary" type="button">Apply reviewed choice</button>
<button type="button">Cancel</button>
<button class="danger" type="button">Remove selected entry</button>
<span class="folio-status folio-status-warning">! Worn · needs repair</span>
```

The example removal button is not an instruction to add deletion controls to immutable history. Use only operations supported by the owning feature.

## Controls and states

Primary buttons use forest and light text; secondary buttons use vellum and ink. Destructive actions use burgundy text/border and explicit wording. Links stay underlined. Native inputs, checkboxes and radios remain recognizable. Shared dialogs use raised vellum, a dark backdrop and the same border/radius/shadow contract; their focus traps, cancellation and confirmations remain owned by existing components.

| State | Required non-color cue |
|---|---|
| Hover | Border/surface feedback; no essential information revealed only on hover |
| Focus | 3px outline plus contrasting halo; never suppress the ring |
| Selected | `aria-current`, `aria-selected` or `aria-pressed`, plus outline, active treatment or explicit label |
| Equipped | Existing equipped icon and accessible text; do not infer from border color |
| Locked | Existing protection icon/label; optional dashed boundary |
| Disabled/unavailable | Native disabled semantics where appropriate, readable text, dashed boundary and a nearby reason |
| Success/warning/error | Specific textual feedback, existing live region where appropriate, color as reinforcement |
| Pending | Visible pending/processing text, appropriate `aria-busy`, duplicate-submission prevention owned by the action workflow |

Primary controls target 44px; compact established interfaces can retain smaller geometry but must keep at least WCAG's applicable 24px target/spacing or equivalent label hit area. No state change should depend on an animation.

## Texture and accessibility

`folio-grain.svg` is a 128px original procedural SVG tile under 1KB: static, near-transparent, no script, external resource or animation. It is used only on page/welcome backgrounds, not over body text. Clean cards provide quiet reading surfaces. Header illustration overlays remain for legibility, not as a general gradient style.

Set `--folio-paper-texture: none`, or `data-folio-texture="off"` on the root, to disable grain. The Appearance dialog retains this cosmetic preference in the current tab using guarded session storage; no database state is introduced. `prefers-contrast: more` disables grain and deepens text/borders. `forced-colors: active` uses system colors, removes decoration and keeps explicit selected outlines. Default forced-color adjustment stays enabled. `prefers-reduced-motion` removes transitions/animations, tile translation and illustration filters.

The style checker covers 55 opaque semantic pairs: normal text ≥4.5:1; control boundaries and focus ≥3:1. Decorative brass/borders are not used as small-text colors. The two-tone focus ring remains visible against both walnut and vellum. Source checks are not a substitute for checking rendered text over illustration or future component-specific colors.

## Ink icon conventions

Reuse original manuscript motifs and item SVGs. New interface icons should use a square 24/32 viewBox, `fill="none"`, `stroke="currentColor"`, approximately 1.5–1.6 strokes, round caps/joins and clear small silhouettes. `.folio-icon` supplies the default treatment. Avoid tiny flourishes, new emoji controls or a second icon library. Authored item art can remain full-color; this convention is for interface glyphs.

Decorative icons beside text use `aria-hidden="true"`. Icon-only controls need an accessible name and a touch/keyboard alternative; meaningful standalone images need equivalent text. Never put undiscovered stats in titles, labels or SVG metadata. Preserve the existing public die's deliberate colored illustration rather than recoloring every asset.

## Authenticated framing

The [VIS-02 application shell](application-shell.md) applies this contract to shared navigation, page layers, sidebars, notices and overlays. `shell.css` owns this framing and replaces older header/dialog paint rather than creating a parallel theme. The token inventory now includes three derived alpha treatments for page edge, page glow and leather stitching (81 tokens total after VIS-07, including rarity accents and separate texture/control roles).

## Reference and verification

See the committed [before/after screenshots and verification record](screenshots/vis-01/README.md).

From `realms/`:

```sh
npm run typecheck
npm run build
npm test
npm run styles:check
python3 ../infra/scripts/documentation-check.py
npm run features:check
npm run preview:welcome
```

Open `http://127.0.0.1:3010/dev/folio` for the internal component reference. It has no gameplay actions, account access or database. Its texture-off link demonstrates the opt-out. The route exists only in the loopback preview script and is deliberately 404 on the game server. This is an inspection tool, not another public page.

For authenticated regression screenshots, use the existing disposable Character preview documented in [the client guide](game-client.md). Check welcome/login, Adventure, Character Overview/Progression/Abilities/Statistics, Pack grid/paperdoll/inspector, equipment picker and confirmation dialog. Test 320, 375, 768px and desktop, keyboard Tab/Enter/Escape, wrapping and unchanged operations. Manually check OS high-contrast/forced colors and reduced motion where available; do not claim preference emulation if the browser tooling cannot enable it.

Keep before/after screenshots outside synced reference material. The PR records the checked screens, results and remaining limitations. This ticket does not claim production activation or a comprehensive screen redesign. Remaining incremental work includes legacy compact item metadata, unrelated illustration palettes and screen-specific responsive blocks; reuse these tokens during later VIS tickets instead of overriding whole screens again.

## Final QA and theme extension

See [VIS-07 visual QA](visual-qa.md) for cross-screen findings, theme extension rules, responsive conventions, performance limits and the frozen screenshot regression process. Inventory footers use flex bottom alignment and text-relative minimum heights; shared headers/tools wrap under text enlargement. New authenticated screen paint must use semantic tokens; the style checker rejects hex palette drift. Future themes must supply paired surface/foreground roles and pass the same matrix before being exposed.
