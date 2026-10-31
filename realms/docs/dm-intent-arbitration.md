# DM02 — Intent arbitration and rules explanations

DM02 extends the MU01 shell over M03–M06 public read models. The interpreter is an untrusted, deterministic candidate planner. The server remains the referee. This is a synthetic playable slice, not an unrestricted language model or an arbitrary physics engine.

## Action contract

Input → current owner/run and discovered context → classified candidate → known object resolution → published eligibility, cost and failure preview → explicit confirmation → existing GUI control → authenticated server Action → immutable public receipt → DM presentation.

Interpretation, clarification, cancellation and inspection do not submit a gameplay Action. Reading authored notes can be a consequential published OBSERVE action and therefore requires confirmation even when its Turn cost is zero. A proposal contains no callback that survives navigation or reload. Its fingerprint binds run, revision, scene, offer, eligibility, costs and currently selected form values. Detached controls, changed selections, pending actions, refresh and new scopes require a fresh preview. Server revisions, ownership, flags, check context, principal rewards and idempotency are revalidated normally. Item and companion consent remain separate explicit controls.

## Language and scope

`Could I pick the cabinet lock please?`, `lockpick the cabinet`, `examine it`, `talk to them`, `describe it`, `explain <approach>` and `do that again` resolve against public entities and current published approaches. Recent focus is bounded to eight known IDs and is dropped at run/scene changes. “The other door” excludes the most recently referenced known door; with several alternatives the DM asks which. An absent referent is unknown, never an inferred secret. Repeat reviews current legality; `retry` retains its distinct MU01 meaning of retrying the same pending request.

The classifier distinguishes observation, communication, consequential action, unsupported requests, help/rules questions and reports. Unsupported named spells or items are not substituted with a different owned resource. Multi-step creative requests offer individual published steps and require a choice. No new check or effect is invented. Unknown phrasing remains available for correction. Existing exact commands, numbered choices and GUI controls continue to work.

Scene objects, NPC dialogue choices and noncombat approaches have typed previews. Tactical commands retain their existing explicit controls; broad tactical natural-language composition is outside this increment. Dialogue opens the existing authored review before its final confirmation. Unknown NPC utterances use M05’s bounded interpretation. No external AI service or raw hidden definitions enter planning.

## Reasons, results and reporting

The preview shows literal server eligibility reasons, current costs, potential failure costs, disclosed chance, warnings and known owned matching items. An undisclosed check stays unknown. Locked abilities, insufficient resources, refusal and cooldown do not become successful narration. Immutable receipt rendering preserves public roll, degree, failed/partial outcome and consequences; committed hidden evidence is never serialized into prose. Mechanical facts take precedence over wit.

Reporting is explicitly identified but no report is transmitted by the command shell. It points to existing Contact information. Moderation intake remains separate work. Clarification has no moderation or economy side effect.

## Input parity and automation

Natural phrasing ultimately clicks the exact current GUI action. The resulting request has the same parameters, authorization, revision, costs, reward and receipt semantics. Exact short confirmation commands use that same control. The client does not set PARSER or AUTOMATION privileges to bypass a manual-only domain. Scene actions remain MANUAL_UI-only; unauthorized parser/automation envelopes are rejected. Where already supported, shared rules use the existing server-authorized automation budget and the same settlement engine. Tests compare deterministic manual, parser and budgeted automation outcomes and reject unbudgeted Turn spending.

## Evidence and integration

- Pure tests: classification, synonyms, bounded references, ambiguity, unsupported resources, combinations, stale confirmation, literal reasons and receipt privacy.
- Disposable PostgreSQL tests: free preview, identical direct/natural action selection and settlement, once-only receipt replay, domain authorization, shared-rule automation budget and parity. Existing scene, NPC and noncombat suites cover alternate outcomes, concurrency, ownership, leakage and rollback.
- Real browser walkthrough: natural preview, pronoun inspection, stale refresh rejection, unsupported spell, free clarification, explicit confirmation and recorded result.
- Six public visual fixtures exercise ready, ambiguous, blocked, unknown, reporting and rules explanations; responsive evidence lives in `docs/screenshots/dm02/`.

No migration, new endpoint, content activation or production deployment is required. Integration is stacked on MU01; merge/rebase its dependencies in order and rerun gates on the eventual main candidate. Rollback removes the client increment and restores its matching asset allowlist; saved server histories remain compatible.

| Task | Implemented behavior | Canon section evidence |
| --- | --- | --- |
| DM-021 | Public-context proposal, preview, confirmation, existing Action and receipt | SEC-D2997A73FD42; SEC-BA891D0175BD |
| DM-022 | Six input categories, explicit unsupported/report handling | SEC-B35D4CCC3427; SEC-84D4B3D85CDF |
| DM-023 | Eight known references, scene/run reset, other-door clarification | SEC-135DFA1E7648; SEC-E0C4EE14701E |
| DM-024 | Free object/approach clarification and unsupported-resource explanation | SEC-D2997A73FD42 |
| DM-025 | One published step from a creative combination, no invented mechanics | SEC-693FBD61874F; SEC-0CEC6DED732A |
| DM-026 | Public eligibility, requirements, disclosed chance and failure cost | SEC-BA0B94DF0BBF; SEC-C1BDFAF99F42 |
| DM-027 | Literal public check/degree/consequence receipt, hidden evidence excluded | SEC-BA891D0175BD; SEC-E0C4EE14701E |
| DM-028 | Shared control/action/settlement; existing automation authorization retained | SEC-84D4B3D85CDF; SEC-1B6CEA6F56C7 |
