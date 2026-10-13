# Skill-rank prerequisites for feats and equipment

Migration 020 adds server-derived proficiency evidence to immutable feat choices and equipment events. It adds no tables (the foundation remains at 80) and preserves all pre-existing event fields. Historical evidence remains NULL; the migration does not manufacture attestations or add requirements to old content.

Systems 03, 07, 29 and 43 distinguish learned proficiency, legality and capability from raw attributes or universal gear scores. This pass implements authored minimum **skill ranks**. Weapon/armor training tags, spellcasting/class-feature capability expressions and the final gameplay effects remain separate work.

## Authoring

An ABILITY with a valid `feat`, or an ITEM with valid `equipment`, may additionally declare:

```json
{"proficiencyRequirements":{"version":1,"skills":[{"skillId":"skill.example","minimumRank":2}]}}
```

This is a `mechanics` member, independent of the existing feat/equipment schema. Every skill is an explicit dependency. The 1–8 distinct requirements are conjunctive; ranks 1–5 map to Novice, Trained, Expert, Master and Legendary. Requirements must fit each skill's authored maximum rank. The declaration cannot grant ranks or substitute attributes.

Publication requires at least one authored proficiency profile that permits all required skills and funds their combined minimum advancement count. For feats, that profile must match the feat's build rules; requirements across the prior-feat family are combined using the highest rank per skill. This prevents a family whose individually legal prerequisites require incompatible profiles or more advancement points than any compatible schedule provides. It proves eventual rank reachability, not availability at the earliest feat/equipment level. Unspent feat slots can be used later. Class and prior-feat checks continue to apply independently.

Absence means no extra rank restriction. Existing version 1/2 gear and version 1 feats retain their schemas and behavior; no content revisions are rewritten. Production catalogs and numerical bonuses are not selected here.

## Authority and history

Feat choices are rejected when earned run ranks do not satisfy every requirement. Discovered option reads show `PROFICIENCY_NOT_MET` without revealing hidden skill identities or full mechanics. Normal owner, native class, prior-feat, committed-level, policy, active-instance and session checks still apply.

Equipment validates all worn and prepared slots, including the inactive weapon set. A player cannot bank an illegal item in a prepared set for later activation. The same service is used by saved loadouts. Qualification is checked before a setup or permanent binding can commit; failure rolls back the whole Action. Existing binding timing is preserved: qualifying inactive version 2 gear remains tradeable until activation.

SQL derives evidence from the current rank projection's immutable advancement identity. Each requirement records the skill ID, authored minimum rank, actual rank, skill revision and supporting choice ID. Shared weapon identities across two prepared sets record one evidence entry. Callers cannot supply evidence. History remains immutable. New ordinary events without requirements carry empty evidence; historical events retain NULL.

Auditing verifies exact requirement coverage, skill/run/release agreement, supporting immutable rank and its timestamp, and current equipped legality. Later rank gains leave old evidence unchanged; old choices remain independently explainable. Ascension clears equipment and retains archived proof. No old evidence can qualify a different run.

`proficiencyRequirementMismatches` participates in live audits, deferred database checks and restored-backup reconciliation. Existing runtime grants suffice; no new client authority, raw rank endpoint or privileged writer is added.

## Limits

Minimum skill ranks are one conjunctive prerequisite type. General capability expressions, alternative branches, weapon/armor tags, subclass-feature requirements, starting proficiency packages, training/practice, respec, check outcomes, profession ranks and derived combat statistics remain launch work. Future rank-lowering/respec contracts must explicitly resolve dependent gear and feats; this pass cannot silently revoke ranks or rewrite prior evidence.
