# Run skill proficiency persistence

Migration 019 introduces typed `SKILL` content, immutable `run_proficiency_choices` and reconciled `run_skill_ranks`, bringing the foundation to 80 tables. No historical ranks, production skill catalog, numerical check bonuses or default advancement schedule are invented.

## Contract

Systems 03 section 9 and 29 sections 7–8 define Untrained → Novice → Trained → Expert → Master → Legendary. System 03 requires build choices after an encounter and run ranks to reset/rebuild at Ascension. System 43 keeps skills distinct from classes. Repeated trivial uses must not grant optimal progression.

A `SKILL` declares a version 1 `skill` mechanic: family (`PHYSICAL`, `SUBTERFUGE`, `KNOWLEDGE`, `SURVIVAL`, `SOCIAL`, `CARE`, or explicit `FORTUNE`), default attribute, maximum rank (1–5), and discovered access. Fortune uses Luck; ordinary skills do not. Contextual substitutions belong to the future check engine.

A TUNING `proficiencyRules` profile declares version 1, `PROFICIENCY_CHOICES_V1`, a build-rules reference, allowed skill IDs and strictly ascending committed-level milestones. Every milestone funds exactly one next-rank advancement in a selected skill; no skip or client-selected rank is accepted. Profiles explicitly depend on their build rules and every allowed skill. Publication rejects milestones beyond the XP curve, invalid ranks, missing references and total budgets greater than the allowed skills' combined rank capacity. These are engine bounds, not the final game's balance schedule.

Configured STANDARD/CASUAL runs can choose a discovered skill from their pinned release, outside active instances, through MANUAL_UI or API intent. The first choice pins one profile for the run. Later unused milestones remain usable, even out of level order; each skill still advances sequentially. Equal access to all profile skills at every milestone means spending a point reduces both remaining budget and capacity by one. Discovery may still be required before all rewards can be spent; publication does not grant knowledge.

Each choice derives the content revisions, release, supporting class-build event, committed level, global sequence and before/after rank. The immutable record and current rank commit with the owner-scoped Action receipt, audit/outbox records and run revision. No Turns, XP, attributes, feats or class choices change. Duplicate requests replay; different competing requests serialize and require a fresh run revision.

The SQL boundary checks eligibility and receipt ownership/type/source independently of HTTP. Projection inserts/updates require the corresponding next immutable choice. History cannot be changed or deleted; projection deletion is denied. Deferred reconciliation checks ordered ranks, milestones, authored caps, pins, supporting evidence and the latest projection. Integrity auditing and restored-backup verification include the new domain, and all foreign keys have leading-key indexes.

Ascension retains old-run history and opens a run without earned ranks. Owner reads return only current-run ranks, ordered choice history and discovered authored options, using the pinned release. A known allowed skill without a choice is shown as Untrained; historical/LEGACY runs do not acquire invented ranks. Replaying an old receipt does not grant ranks in the new run.

## API

`GET /api/v1/progression/proficiencies` returns selected skills, choices and discovered options with available earned milestones, authored rank caps and instance blockers. It uses one consistent read snapshot. Hidden definitions and undiscovered skills are excluded.

`POST /api/v1/progression/proficiencies` accepts only `requestId`, `actionType: ADVANCE_PROFICIENCY`, `expectedRevision`, `rulesId`, `skillId`, and `milestone`. It requires GAME_WRITE. Rank, bonuses, actor/run IDs, evidence and raw outcomes are not client parameters.

## Verification and remaining work

Focused tests cover the complete rank ladder, authored caps, replay/concurrency, level evidence, discovery, policy pinning, active instances, out-of-order milestones, later class levels, atomic rollback, SQL forgery, restricted runtime access, HTTP scopes, upgrade preservation, corruption detection and Ascension history/reset.

This foundation covers explicit level-milestone allocations only. Class/species starting packages, tutors and training costs, meaningful practice with diminishing returns, broader capability expressions, contextual checks/DCs, RNG/retry contracts, party assistance, profession skills, mastery starting options and respec remain separate authored gameplay work. The game is not yet ready for public release.

Migration 020 implements [minimum skill-rank gates for feats and equipment](proficiency-requirements.md); general capability tags remain separate gameplay work.
