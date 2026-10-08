# Progression persistence: next implementation pass

Status: the encounter XP journal is implemented in migration 014; see [encounter XP persistence](encounter-xp-persistence.md). The broader progression work below remains a release plan. Content must explicitly declare XP budgets; existing definitions do not acquire invented rewards.

## Design requirements

System 03 sections 7, 11 and 23 require XP for meaningful combat and noncombat resolution, one principal budget per obstacle, class levels summing to character level, choices outside combat, and fresh run XP/levels at Ascension. System 45 sections 2, 6–8 and 55–57 clarify controlled growth through level 999, editable authored coefficients and objective-centric rewards. Level and campaign completion remain separate. Reaching level 25 cannot by itself satisfy campaign victory or trigger Ascension.

Curves use cumulative thresholds: entry zero is level 1 at zero XP; every subsequent threshold increases. They cover at least the core 25 levels and at most 999. Decimal strings preserve exact PostgreSQL bigint values across JSON; floating-point XP and arithmetic are refused. The length determines the authored curve's cap. No production XP formula or balance constants are selected here. Test thresholds are synthetic fixtures.

Readiness reports earned levels separately from committed levels. A player may earn several pending levels; calculation alone cannot select classes, feats, subclasses or attributes, raise equipped-item eligibility, or change campaign status. XP above the final threshold remains recorded without extrapolating unauthored levels.

## Database and authority work still required

1. Add Luck through a new migration. The original progression table contains six attributes; deployed migrations must remain untouched. Its initial value requires an explicit starting-rules contract rather than inventing a seventh default in a repair script.
2. Encounter occurrence awards are implemented. Extend immutable XP awards linked to run, Action receipt, pinned content source and an owning-domain resolution identity. The uniqueness boundary must represent the obstacle, not the chosen approach or request ID: a second request or a different solution cannot repay the same principal budget. Repeatable encounters need distinct authorized occurrence identities.
3. Opening XP baselines and reconciliation are implemented for migration 014. Reconcile each XP projection to its baseline plus awards, with overflow checks and no direct runtime projection edits. Do not retroactively fabricate encounter rewards.
4. Authored encounter curves and budgets are now pinned to the run's content release. Extend this to other reward sources. Reject undeclared/missing references during publication. Encounter settlement must award XP in the same transaction as terminal outcome, loot, Gold and its receipt. No client-selected XP amount, reward identity or victory flag.
5. Owner-scoped readiness is implemented. Level commitment needs a separate Action after the encounter, an authored legal class allocation and an immutable choice history. Validate class-level sums, class-count rules and pending choices before raising equipment eligibility. Existing seed runs have no class allocation; migrate them with an explicit legacy state rather than guessing a class.
6. Ascension preserves old-run history and opens a new progression baseline under the new run's starting rules. Account mastery and Legacy remain separate persistent domains; do not conflate them with run XP.
7. Award history, XP projections and encounter content pins are included in runtime privilege checks, integrity audit and restore reconciliation. Extend these checks to level decisions as they are implemented.

## Required acceptance evidence

Exercise duplicate requests and different requests for one resolution; diplomacy followed by combat; concurrent claims; repeated encounters with distinct occurrences; foreign ownership; archived runs; active-encounter choice rejection; content-release changes; exact threshold boundaries and multi-level readiness; signed-bigint overflow; late transaction failure; class allocation and equipment eligibility; Ascension with old history retained; SQL projection/history tampering; restricted runtime permissions; upgrade preservation and backup restoration.

The encounter XP pass has focused persistence tests. The remaining progression plan needs its own integration and release evidence; the current journal does not complete class/build/mastery persistence.
