# Public monetization policy

`/monetization` is an authored policy page in `client/landing.ts`, using the existing public shell and scoped parchment styles. This is a statement of funding and design commitments, not a payment implementation. There is no checkout, donation collector, subscription form, or token grant on this page.

## Source reconciliation

Reviewed the supplied `high_fantasy_kol_semisuccessor_core_design_bible.html` (sections 31 and 35) and `system_17_monetization_supporter_tokens_iotm_cosmetics_donations_design_bible.html` from the master feature index bundle in Downloads/Sources. The user's October 10, 2026 direction governs the public commitments:

- Donation funded while the project can maintain the game and cover hosting/server costs. The bulk stays free, and support is never required for a complete core experience. This qualifies System 17's “indefinitely” language with a realistic service-maintenance condition.
- No advertisements and no selling personal data. These are explicit user commitments, added to the older monetization design.
- Donations buy supporter tokens for optional unique content. System 17 permits extra quests/mini-zones, cosmetics, music, companions, and bounded mechanics. Do not describe all rewards as cosmetic, or promise every optional supporter adventure is free.
- Comparable power remains available through free play; supporter rewards cannot become mandatory progression/raid/competitive power. Basic storage, loadouts and automation remain free. No raw Turn sales, direct Gold sales, loot boxes/gacha, or paid event/leaderboard advantages.
- System 17 plans a player-market Gold route to tokens/goods, not direct Gold sales. The page labels trading as planned and does not promise universal availability or reissues.
- System 17 allows voluntary recurring token delivery without exclusive subscription-only gameplay. The page states that it is not available and that no subscription is required. It does not commit to launching subscriptions.

The core bible's earlier preference for tiny boosts is refined by System 17's more detailed bounded-sidegrade model. The page describes the guardrails without promising no gameplay effects at all. This also respects System 17's requirement that free content remain innovative and substantial.

## Implementation boundaries

[Database foundation](database-foundation.md) provides integer supporter-unit wallets but explicitly does not enable payments, settlement, fees or refunds. [Release readiness](release-readiness.md) requires verified receipts, idempotent grants, entitlement/reversal handling and reconciliation before supporter purchases launch. The public page therefore describes the intended model and explicitly states that donations, token purchases, supporter shop, token trading and recurring support are unavailable in this build.

The source's approximate $10 unit, fractional amounts, cadence and refund proposals are not published as settled commercial terms. Prices, amounts, reward catalog, payment/refund details, and each reward's mechanics/restrictions must be finalized and disclosed before payments open. Future policy changes must preserve or explicitly reconcile these public commitments.
