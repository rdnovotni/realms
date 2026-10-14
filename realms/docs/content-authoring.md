# Feature fixtures and content authoring

Current inventory UI and optional carrying policy: [inventory grid, storage and measurements](inventory-grid.md).

Follybound completes feature frameworks before production content. Keep examples small and explicitly synthetic; test classes, opponents, items and recipes are proof inputs, not a balanced release catalog. Design sources/corrections remain authoritative; the [registry](../design/README.md) is the evidence map, not new canon.

## Existing workflow

[Development Studio](../../infra/docs/development-studio.md) edits native content definitions, checks previews and records source checkpoints. `content/game.json` is the committed authored input; `scripts/content-check.ts` validates it through the same content contracts. Content publication in `src/domains/content.ts` validates typed definitions, dependencies and mechanics before sealing an immutable manifest. Reads use discoveries and pinned run releases; hidden mechanics are never a public listing shortcut.

From `realms/`:

```bash
npm run content:check
npm run features:check
npm run typecheck
npm test
npm run build
```

These commands validate source, not publish a live content release. Run relevant disposable integration tests for a changed domain; include concurrency, duplicate/stale requests, rollback, eligibility and replay. Studio is not a complete editor for every future system; consult its guide for supported kinds and current limits.

## Contract for each fixture

Define stable typed identities, explicit revisions, schema/mechanics versions and dependency references. Never recycle IDs or silently edit sealed content. Specify player-visible information separately from hidden checks/rewards. Declare the owning scope, field lifetime, costs, principal reward source, retry policy, clocks and release compatibility. Use shared prerequisite expressions and server facts; reject unsupported gates instead of accepting fields that no adapter enforces.

For shared actions use the [shared-rule contract](shared-rules.md): bounded prerequisites/checks/modifiers/effects, typed costs and success rewards. Failed checks pay declared costs; partial outcomes do not acquire success rewards. REAL_TIME windows cannot apply mechanical modifiers/capabilities/triggers. Top-level shared prerequisites on ABILITY definitions remain rejected until a selection/use adapter enforces them.

Encounter XP and loot commitments remain their existing owning journals. A shared reward plan does not create a generic XP/Mastery faucet. New quest/dialogue/travel domains must own resolution identities and failure/retry state rather than inventing rewards through client requests.

## Acceptance before larger authoring

Prove two approaches/domains use the same rules without copied calculations. Demonstrate discovery, explanations, lawful costs/rewards and clocks with saved evidence; test technical rollback separately from authored failure. Show old content and receipts still replay, existing runs remain pinned and emergency disabling blocks the intended new work without rewriting history.

Update the implementation guide, API and migration map, field manifest and registry evidence at the same checkpoint. Then follow reviewed sealed-release adoption and [staging approval](../../infra/docs/game-update-guide.md). Only expand ordinary world content after the owning framework, editor workflow and player UI pass their acceptance criteria.
