# VIS-01 visual verification

[Design system](../../adventurers-folio.md)

Captured 2026-10-17 against a loopback-only disposable Character fixture, not production. Before images use main `8719f1062e0d2539662612e6f7cd71388076c7bd`; after images use this PR's Folio styles. All screenshots show synthetic test characters and public assets, with no account credentials or tokens. Desktop viewport: 1440 × 1000; full-page captures include content beyond the viewport.

| Screen | Before | After |
|---|---|---|
| Character Overview | [Before](before-character.png) | [After](after-character.png) |
| Unified Pack / paperdoll | [Before](before-pack.png) | [After](after-pack.png) |

Other checked views: [welcome](after-welcome.png), [375px Pack](after-pack-mobile.png), [reusable primitives](after-reference.png), [two-tone keyboard focus](after-focus.png). The public header illustration and authored item SVGs are retained.

[Viewport observations](viewport-checks.json) record the actual DOM viewport and content width for Welcome, Character Overview/Progression/Abilities/Statistics and Pack at 320, 375, 768 and 1440px. All tested pages had content width equal to viewport width (a scrollbar may consume 15px). The reference also fit at those widths. Adventure/navigation were checked separately at desktop. No screen geometry or interaction code changed.

Keyboard Enter opened an empty-slot equipment picker; Escape dismissed it. An equipment weapon-set change staged successfully, showed an authoritative current/preview table, and Revert restored the committed setup. Carried/Home storage and Adventure navigation remained usable. The reference's texture-off link produced `background-image: none`; Tab moved focus from Primary to Secondary with a computed 3px outline and 3px contrasting halo.

Local verification: typecheck, build, 195 unit tests (including 73 client regressions), 14 relevant client/inventory/Character integration tests, 53 semantic contrast pairs (minimum normal-text pair 4.79:1), documentation and feature-registry checks passed. Stylesheets parsed in the browser. A rendered-text scan found no under-4.5:1 opaque-background text in the sampled Pack view; this is a bounded check, not a claim that every future authored image/background has been audited.

Remaining limits: OS forced-colors, increased contrast and reduced-motion modes have explicit CSS contracts but were not emulated by this browser tool. Verify those preferences manually on target platforms. Legacy compact item metadata and feature-specific breakpoint blocks remain for later VIS tickets. CHAR-05 is a separate open PR, so the baseline History label remains unavailable here; this ticket does not implement or remove that feature. Source previews do not establish production deployment.
