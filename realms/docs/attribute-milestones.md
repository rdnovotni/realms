# Earned attribute milestones

Migration 018 adds immutable `run_attribute_choices`, bringing the private foundation to 78 tables. Configured normal builds can allocate authored point budgets at committed character levels. This growth is separate from feat choices and from the starting preset; the migration invents no historical allocations or production balance constants.

## Authored rules

TUNING `mechanics.attributeRules` declares `version: 1`, `ruleset: ATTRIBUTE_MILESTONES_V1`, `buildRulesId`, seven `maximumScores`, and 1–32 ascending milestones. Each milestone has `level` (1–999), `points` (1–30) and a unique nonempty `allowedAttributes` list. Caps are integer scores from 1–9999. These are validation bounds, not production targets. System 03's approximate 4/8/12/16/20/24 cadence remains tunable content data.

The referenced build TUNING rulebook must be an explicit dependency, with a valid XP curve. Milestones must fit that curve, every starting preset must fit the caps, and all milestones must be jointly allocatable within their allowed attribute sets. Publication checks all seven-attribute capacity subsets. A valid allocation must also leave enough capacity for every remaining authored milestone, including future and older unspent ones; early choices cannot consume capacity needed by a restricted later milestone.

Luck receives no automatic increase. It can change only if the chosen milestone explicitly permits it and its authored cap allows the increase. Growth does not introduce fortune, critical-hit, loot or economic formulas.

## History and effective scores

The class-build journal and `run_builds.state.attributes` retain immutable starting attributes. Attribute growth is a separate ordered overlay. Effective `run_progression` scores equal the starting values plus all committed point allocations. Migration 018 replaces class-projection/apply functions through a new migration so later native level-ups preserve growth; deployed migration files and old class events are unchanged.

Public progression and class-choice responses show effective scores. The attribute endpoint additionally shows ordered allocations and rulebook summaries. Internal class event JSON remains the starting-attribute baseline. Audits reconcile both the baseline class history and the effective score projection; neither raw score edits nor history edits are allowed.

SQL derives each choice's release/rule revisions, committed level, supporting build event, sequence number, and before/after scores. The first choice pins one attribute rulebook for the run; later choices cannot mix schedules. Each milestone can be spent once, and point allocations must exactly spend its budget using positive integers in allowed attributes. Deferred reconciliation verifies owner receipts, action/source, rule compatibility, sequence, budget, caps, remaining capacity and effective scores. Audit and restore checks report `attributeMismatches`.

## API and lifetime

- `GET /api/v1/progression/attributes` returns current effective attributes, the allocation history, and compatible rule summaries with earned unused milestones and active-instance blocking.
- `POST /api/v1/progression/attributes` accepts `requestId`, `actionType: ALLOCATE_ATTRIBUTES`, `expectedRevision`, `rulesId`, `milestone`, and `allocation` (attribute names mapped to positive point increments).

Clients choose point distribution, never raw resulting scores or caps. Only configured STANDARD/CASUAL runs can allocate; pending XP alone is insufficient. Every active instance must be finished. Writes require owner GAME_WRITE scope and explicit manual/API intent; automation cannot commit choices. Allocations cost no Turns.

Run locking handles competing requests; receipts make retries replayable. Allocation, scores, revision, receipt, audit and outbox commit or roll back together. Existing projections and class histories survive upgrade unchanged. Ascension retains old history and resets the new run to unconfigured starting values, including unknown Luck, until its fresh preset is chosen.

This pass does not implement respec, challenge-path growth rules, species/quest bonuses, Mastery or derived combat statistics. Those need independent authored contracts and histories; they cannot write around this journal.
