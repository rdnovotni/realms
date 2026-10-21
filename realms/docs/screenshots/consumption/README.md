# Consumption browser verification

The required matrix is 304 real browser captures: 34 scenes at widths 320, 375, 768, 1024, 1440 and 1920, plus ten scenes at widths 320 and 1440 in motion, contrast, forced-color CSS projection, doubled-root-text and coarse-pointer CSS projection modes. Browser viewport height is 1000. Reports were exported through the development fixture's browser download control and filtered to the exact required cases without changing observations.

Source fingerprint: `680344c2a80ad4b153f550f99c8c47deccb95a1d5d02198c3639c9cd03e78c95`.

The first matrix found native progress bars exceeding their grid track at 320px with doubled text. Capacity labels now constrain the grid column and bars to available width. All cases were recaptured after this fix. The final contract file records zero document/header overflow, header/tile collisions, unnamed controls, heading skips, enabled targets below 24px, sampled contrast failures, decorative icon errors and filtered item art. Coarse projections have no enabled target below 44px tall. This is sampled DOM geometry/contrast evidence, not a pixel diff or a native assistive-device certification.

New scenes cover capacities and saved meals; overdrunk state and one-time reversal; no stock; loading; errors; read-only; active execution; explicit nightcap consent; meal preview; and blocked paid adventures. The existing character, inventory, combat and daily planner scenes remain in the matrix. Screenshots were visually reviewed in the browser; no PNG export is claimed by this JSON record.

A separate disposable live playtest verified rollover catch-up, food and tonic use, observed yield/effect labels, saving/reviewing a meal, safe steps stopping at the reserved nightcap, unchecked nightcap consent, paid-adventure blocking, and the immediate account-wide reversal withdrawing seven Turns and restoring one drink. Entering the meal name after adding a line was also verified after its enablement fix. These actions used synthetic stock in an isolated loopback database schema, not production accounts or content.

Native OS forced colors/reduced motion, actual browser 200% zoom, screen-reader speech and physical touch remain release checks. The text200 branch doubles root text to 32px. See [visual QA](../../visual-qa.md) and [consumption rollout](../../consumption.md#validation-and-safe-rollout).
