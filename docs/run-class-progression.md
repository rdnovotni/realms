# Starting builds and native class levels

Migration 015 adds an immutable class-choice journal and a current build projection. Starting setup applies a published seven-attribute preset, including Luck, and one discovered class at native level one. Each subsequent explicit choice allocates one earned character level to a discovered class. Character level equals the sum of native class levels; normal builds allow at most two classes.

The `CLASS_LEVELS_V1` contract supports STANDARD and CASUAL runs. Choices require no active instance, an authenticated write-capable owner, an expected run revision, and a unique request ID. They spend no Turns. Concurrent stale choices fail; retrying the same request returns its original receipt. Receipt, journal, attributes, native levels, run revision, audit and outbox records commit together.

## Authored content

CLASS `mechanics.classProgression` declares `version: 1`, `rulesId`, `access: DISCOVERED`, and `maximumNativeLevel` (1–999). Its dependencies must include the referenced TUNING rulebook.

TUNING `mechanics.buildRules` declares `version: 1`, `ruleset: CLASS_LEVELS_V1`, `curveId`, `maximumClasses: 2`, `startingLuck`, and 1–16 uniquely keyed presets. Every preset contains strength, dexterity, constitution, intelligence, wisdom, charisma and luck, each an integer from 1–30. Every preset uses the same authored starting Luck. The rulebook explicitly depends on a valid XP curve. These validation limits do not select production balance values; test fixtures are synthetic.

The first choice pins class, rulebook, XP curve and release revisions from the run's content snapshot. Later publication cannot change those rules. XP awards and build choices must use the same curve. XP readiness alone never allocates levels.

## HTTP interface

- `GET /api/v1/progression` includes the current build, XP and pending levels.
- `GET /api/v1/progression/options` returns discovered class summaries and authored presets in the owner's pinned release.
- `POST /api/v1/progression/start` accepts `requestId`, `actionType: START_BUILD`, `expectedRevision`, `classId` and `presetKey`.
- `POST /api/v1/progression/level` accepts `requestId`, `actionType: LEVEL_UP`, `expectedRevision` and `classId`.

Clients cannot submit attributes, XP, native levels, content revisions or outcomes. Automation cannot allocate class levels. Discovery acquisition remains the responsibility of gameplay handlers.

## Upgrade and release scope

Pre-existing runs receive frozen LEGACY build snapshots preserving their recorded attributes and class levels. Historical Luck remains NULL. No class choice or Luck value is invented. Fresh runs and Ascension open UNCONFIGURED builds; setup must precede encounter history and XP. Ascension preserves old choices and receipts while resetting the new run's build.

SQL derives every event transition and validates receipts, ownership, pinned content, XP eligibility, event chains and projections. `db:audit` reports `buildMismatches`; routine runtime privileges deny journal modification and deletion. Migration 015 adds two tables, bringing the foundation to 73 tables.

This milestone persists build decisions. Full class kits, derived combat statistics, feats, subclasses, proficiency and attribute milestones, respec, mastery/Legacy rewards, special challenge starts and class initiation gameplay remain release work.
