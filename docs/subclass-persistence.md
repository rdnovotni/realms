# Native subclass selection

Migration 016 persists one explicit subclass choice per native class per run, using immutable `run_subclass_choices` records and reconciled `run_subclasses` projections. The two new tables bring the private foundation to 75 tables. The subclass roster and gameplay packages remain deliberately deferred by System 43; this milestone adds their selection framework without inventing production content.

## Authored contract

An ABILITY entity can declare `mechanics.subclass` with `version: 1`, `ruleset: SUBCLASS_CHOICE_V1`, `classId`, `unlockNativeLevel: 5` and `access: DISCOVERED`. ABILITY is the existing envelope for selectable capability definitions; this contract identifies a subclass selection, not an executable combat ability. Its dependencies must include the referenced CLASS, whose validated native progression must reach at least level five. Wrong kinds, undeclared references, unreachable classes and malformed contracts fail publication.

Only configured STANDARD and CASUAL builds can select subclasses. The account must have discovered the definition, invested at least five native levels in its class, and left every active instance. Total character level cannot substitute for native class level. Each class qualifies independently, so a multiclass run can eventually choose two specializations. Class initiation handlers must establish discovery eligibility; quest initiation and account shortcuts remain future gameplay work.

## Authority and lifetime

`CHOOSE_SUBCLASS` accepts a subclass identifier, request identifier and expected run revision. SQL derives the base class, exact content/release revisions, native-level snapshot and supporting build-event identity. Clients cannot supply eligibility, pins, abilities or outcomes. Choices cost no Turns. Automation cannot commit them. Scoped sessions require GAME_WRITE; reads require ordinary authenticated ownership.

The run lock serializes competing choices. Receipt replay returns the original result even after Ascension; a different stale request cannot choose another specialization. Choice, projection, run revision, audit and outbox commit together. Deferred checks bind history to an owner receipt with the correct action and explicit source, the native-level evidence and the current projection. Routine privileges prohibit journal/projection edits and deletion. `db:audit` and restore checks report `subclassMismatches`.

Content updates cannot change a run's chosen revision. Existing runs receive no inferred subclass. Ascension retains old history and choices on the archived run; new runs have no selected subclass and must qualify again. Respec requires a future explicit history contract; editing these records is not supported.

## API

- `GET /api/v1/progression/subclasses` returns selected summaries and discovered options from the current run's pinned release. Eligibility explains AVAILABLE, NATIVE_LEVEL_REQUIRED, ACTIVE_INSTANCE or ALREADY_CHOSEN. Unknown definitions and full mechanics are excluded.
- `POST /api/v1/progression/subclasses` accepts `requestId`, `actionType: CHOOSE_SUBCLASS`, `expectedRevision` and `subclassId`.

The current build JSON continues to describe attributes and class-level allocation; subclass selections have their own read model and journal. This pass grants no class features, resource engines, capstones, feats or combat statistics. Those need authored content and their own validated execution systems.
