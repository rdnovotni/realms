# Authored feat milestones and choices

Migration 017 adds `run_feat_choices` and `run_feats`, bringing the private foundation to 77 tables. It persists legal choices and their eligibility evidence; production feats and their gameplay effects remain authored work. It makes no automatic grants to existing runs.

## Content contracts

TUNING `mechanics.featRules` declares `version: 1`, `ruleset: FEAT_CHOICES_V1`, `buildRulesId` and a strictly increasing array of 1–32 milestone levels. Each level is 1–999 and must fit the referenced build's XP curve. The rulebook explicitly depends on that build's TUNING rulebook. System 03's core cadence is 3/5/10/15/20/25; schedules are content data because the design permits tuning. Tests use synthetic content; the migration selects no production balance values.

An ABILITY `mechanics.feat` declares `version: 1`, `rulesId`, `access: DISCOVERED`, `antiTaxReview: PASS`, and `prerequisites` containing `classes` and `feats` arrays. Class requirements specify `classId` and `nativeLevel`; prior feat requirements specify feat IDs. Empty arrays represent a universal feat. All requirements are conjunctive. Every reference is an explicit dependency; prior feats must use the same feat rulebook, and class requirements must use the same build rulebook and be reachable within their native caps.

Publication rejects malformed references, cycles, chains deeper than two prerequisite steps, impossible class combinations, prerequisite families larger than the available slots, and milestones beyond the curve. PASS records an author's anti-tax review declaration; it is not an automated proof of balance or mandatory-math behavior. Capability-tag, proficiency, subclass, alternative-expression and special-source prerequisites need future execution contracts. Unknown fields are rejected.

## Authority and lifetime

Only configured STANDARD and CASUAL builds may choose discovered feats, outside every active instance. XP readiness alone does not unlock slots: the character must commit the milestone's level. A choice consumes one authored milestone and cannot repeat a previously selected feat. Older unspent milestones remain available, and their order need not match the order of selection. Prior-feat prerequisites use the actual choice sequence, not milestone ordering.

The first choice pins the feat rulebook within the run's immutable content release. Later choices cannot switch schedules to manufacture slots. SQL derives content revisions, current committed level, sequence number and supporting build-event identity. Eligibility uses the recorded native class distribution and only earlier feat choices. Clients cannot supply ranks, attributes, outcomes or content pins. Explicit player/API choices spend no Turns; automation cannot commit them.

Run locking serializes competing requests. Choice, projection, run revision, receipt, audit and outbox commit together. Replays return their original results, including after Ascension. Deferred reconciliation verifies owner receipts, action/source, content rules, milestone legality, prerequisites, choice sequence and projections. Runtime privileges deny history/projection edits and deletion. Audit and restore checks report `featMismatches`.

Ascension keeps old choices on the archived run and opens the new run without feat selections. No history is inferred during upgrade. This contract has no respec, repeatable feats or special quest-granted slots; these require later explicit domains.

## API

- `GET /api/v1/progression/feats` returns selected summaries and discovered options from one consistent database snapshot, with available earned milestones and eligibility explanations.
- `POST /api/v1/progression/feats` accepts `requestId`, `actionType: CHOOSE_FEAT`, `expectedRevision`, `featId` and `milestone`.

Reads use authenticated ownership; writes require GAME_WRITE. Responses exclude unknown definitions and full mechanics. An ELIGIBLE option still needs a nonempty availableMilestones array before it can be chosen. Feat selection does not change attributes or grant combat abilities, proficiency ranks, class engines or Mastery. Those remain separate gameplay systems.
