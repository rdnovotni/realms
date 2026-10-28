# M04 — Validated quests and Journal

M04 adds an opt-in quest reader on the verified M03 source tree. `quests.journal` is disabled by migration 050. This source checkpoint does not deploy, adopt content, merge dependencies or activate production. M02 PR #71 and M03 PR #72 remain prerequisites until their trees reach main. FB-006 deployment reconciliation remains open.

## Canon and contract

Source order remains the M01 correction register and owning system bibles. Relevant sections: System 06 graph SEC-89BB26A2D59A, outcomes SEC-C7179DE03E81, Journal SEC-1E649BE4028C, rumors SEC-4384977DA32A, repeatability SEC-82BF7C2AF47F and rewards SEC-3AABC279DD47; System 38 truth/belief SEC-B97469D64AE1 and clue record SEC-9C5B3E0508CA; System 44 run/world boundaries SEC-84E105FCC1E7. Rumors use fictional provenance and qualitative credibility, never numeric truth probabilities. The Marsh Road is a synthetic acceptance fixture, not a locked launch catalog decision.

The new strict `mechanics.questRuntime.version=1` is additive. Released M02 `questObjectives.version=1` authoring graphs keep their original reader and validation. Runtime definitions contain a start, named SCENE/OBJECTIVE/OUTCOME nodes, optional subgoals, named alternative edges, availability prerequisites, disclosed grades and consequences, principal identity and bounded reward plan. Edges cite committed OBSTACLE, ENCOUNTER, QUEST or explicitly scoped KNOWLEDGE evidence. There is no second dice engine. Skill/ability/item checks remain in M03 and combat remains in the encounter owner. A Journal click cannot synthesize a victory.

All reward-bearing terminal routes must include authoritative outcome evidence. Cycles, missing targets, unreachable nodes, hard dead ends, duplicate identities, contradictory conjunctions and impossible whole routes through immutable obstacle outcomes are rejected at content publication. Cross-quest prerequisite cycles and duplicate principal owners are rejected. A one-shot obstacle has one consuming quest owner across the package; other stories may use it as a non-consuming availability fact. This prevents a valid first quest from silently stranding a second quest after consuming the only source. Complex graphs exceeding the 4,096-state semantic analysis budget are rejected explicitly. Optional goals are authored branches with a skip route; consequences and grades remain in history.

## State, evidence and ownership

`quest_states` is the current-run projection. Immutable `quest_events` pin definition/release, before/after state, route decision, source evidence and earned reward operations. SQL guards require a matching event for runtime projection changes and deferred owner receipts. `quest_outcome_claims` has one `(run, principal, cycle)` identity across all solutions, including fail-forward. Claims and earned rewards commit in the same account/run-locked action transaction. Disconnects replay the saved request receipt before revision and feature-gate checks. New requests cannot re-open terminal one-life quests.

`quest_source_claims` prevents a finished obstacle/encounter from funding another quest objective or contract iteration. Availability reads may reconcile against already-used facts; consuming an objective requires an unclaimed source. Ordinary encounter rewards remain with the encounter owner; the quest principal reward is separately declared and cannot repeat through another route. No arbitrary client reward, state, grade or check parameter is accepted.

`journal_records` retains immutable information and note provenance. RUN information is visible only in the originating life. ACCOUNT hints and personal notes persist across Ascension. WORLD information is personal knowledge bound to a real world UUID; it persists independently and can be filtered by world, without writing shared world truth. `first_run` provenance does not grant access to another account. Past quest projections and decisions archive in place; new lives start fresh. Completed stories and abandoned histories remain account-visible. Receipt replay remains valid after Ascension.

The Journal has active/discovered quests, leads/rumors, completed stories, personal notes and discovered hints. Only discovered quests and earned information are projected; raw graphs, hidden prerequisite facts, future consequences, seeds and secret definitions are omitted. Visible edges show server eligibility. Notes are bounded append-only account memory (500 notes, 1,500 characters each) and never establish a quest fact. Read-only, loading, empty, error, disabled, completed and partial outcomes are explicit UI states.

Repeat contracts are deliberately small authored templates: one declared encounter source, 2–20 iterations per run and 1–10,000 committed-revision cooldown. Every terminal route must require that source. Each cycle needs a distinct finished encounter after acceptance, within the pinned release. The principal is unique per cycle. Abandoned iterations count toward the cap. There is no generated bounty market, real-time refresh, procedural reward invention, party-shared principal or full bounty economy.

## API

- `GET /api/v1/journal` — coherent read-only run projection, earned information and previous-life story history; optional `worldId` filters WORLD memory.
- `POST /api/v1/quests/command` — ordinary action envelope with `actionType=QUEST_COMMAND`, `questId`, `command=ACCEPT|ADVANCE|ABANDON`; only ADVANCE accepts/requires `edgeId`.
- `POST /api/v1/journal/notes` — envelope with `actionType=JOURNAL_NOTE` and bounded `text`.

Reads are bounded: 100 quests, 100 latest completed story events and 500 information entries, with `hasMore` explicitly disclosed. The underlying immutable history is retained. Full history search/export, note editing and procedural rumor propagation are later work. No universal full System 06/38 completion is claimed.

## Acceptance evidence and checklist

| Work | Implemented evidence |
|---|---|
| FB-038 | Typed runtime schema, alternate and optional routes, explicit outcomes, publication lint |
| FB-039 | Single principal/cycle claim, unclaimed authoritative source, same transaction as reward |
| FB-040 | RUN/ACCOUNT/WORLD information, quest prerequisites, old-life archive/new-life reset |
| FB-041 | Immutable event, source, reward and information journals with owner receipt guards |
| FB-042 | SUCCESS/PARTIAL/FAIL_FORWARD grades and saved narrative consequences; terminal fail-forward route |
| FB-043 | Five Journal sections with server reads and saved personal notes |
| FB-044 | Source/credibility claim records, no automatic world-truth disclosure |
| FB-045 | Capped contract template, fresh source, cooldown and principal per iteration |
| FB-046 | Schema/reference/reachability/cycle/contradiction/reward-path validation |
| FB-047 | Two routes, real M03 evidence, partial failure, races, reconnect, abandon, Ascension, secret/owner isolation |

`test/quest-fixture.ts` defines The Marsh Road. Accept the lead, investigate the keeper, resolve the M03 sluice via an available method, then report success or take the consequence route. Both terminal routes earn the single declared quest reward; source events retain the actual chosen method. `test/quests-integration.test.ts` exercises PostgreSQL transactions and HTTP rejection. `test/quests.test.ts` checks malformed authoring. The checkpoint rehearsal now creates quest, outcome, rumor/hint and personal-note histories before backup/restore and compares exact immutable journal bytes.

## Local verification and rollback

Use the existing separate `realms_test` integration database workflow. The synthetic `scripts/journal-preview.ts` calls `testDatabase`, which refuses any other database name and creates a private schema; bind is loopback port 3025. It is not a publishing or production endpoint. Synthetic credentials printed by this script grant only its disposable account. Stop the preview to drop its schema. Frozen visual fixtures use the existing preview server and cover current Journal states across widths and preference branches.

Before adoption, apply 001–050 sequentially on a backed-up staging-like database, provision the updated restricted role, rerun full gates and restore rehearsal, and pin the exact source tree/build/release. New tables accept INSERT only for the runtime role; runtime quest projection changes remain guarded. Old migration checksums are untouched. Forward-fix an adopted schema; do not drop journals or rewind player rewards. Disable `quests.journal` and the affected content/reward gate to stop new actions while retaining readable history and saved receipt replay. A source rollback must retain a compatible 050 reader once histories exist. Production activation and FB-006 deployment evidence remain separate.
