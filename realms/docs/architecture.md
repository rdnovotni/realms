# Follybound server architecture

Reconciled October 14, 2026 through migration 032. [Documentation map](README.md) · [Implementation status](implementation-status.md) · [API](api-reference.md)

## Authority and transactions

The game is an authoritative modular monolith: strict TypeScript, Fastify, explicit SQL and PostgreSQL. SQL remains visible where ownership, ordered locking, transaction evidence and constraints matter. Valkey cache/outbox delivery, workers and scheduler are optional configured infrastructure; they do not replace PostgreSQL authority.

`src/foundation/action.ts` serializes account mutations, validates a stable request envelope and expected revision, rechecks authentication/write authority, and commits state, immutable receipt, audit and outbox together. A matching committed retry returns its recorded result before new-entry gates. Database work can retry bounded deadlock/serialization conflicts; external delivery uses durable outbox/worker receipts rather than a side effect inside the transaction.

Domain services own content, scoped state, economy, inventory, progression, encounters, lifecycle and jobs. Shared persistence never supplies a domain’s missing permission. Clients submit legal intents and never connect to PostgreSQL, choose outcome rolls, write state keys or grant rewards. The [API reference](api-reference.md) lists actual routes.

## Shared rules and retained history

`src/rules/` provides typed prerequisite facts/expressions, capability/modifier derivation, bounded checks, clocks/effect lifecycle, retry policies, resource costs and reward settlement. Combat and interaction adapters use the same services; routine recipes, class/equipment and encounter gates integrate supported expressions. These primitives do not complete the future quest/dialogue/travel engines. Top-level ABILITY shared prerequisites are rejected until enforced by selection/use adapters.

Historical D20_CHECK_V1, BASIC_DUEL_V1 and tactical formulas and reward journals retain their semantics. Saved solo/shared tactical combat uses pinned encounter-start evidence and deterministic action journals with independent replay. General shared effects and existing tactical effects have explicit integration boundaries; there is no silent conversion of old effect histories. See [shared rules](shared-rules.md) and [combat expansion](tactical-first-pass-expansion.md).

## Knowledge, content and lifetime

Queries project only owned and discovered information. Content reads require discovery and an account run containing the requested release. Instance reads require participation. Seeds, raw internal state, hidden source definitions and unrevealed checks stay server-side. Bounded lists disclose overflow rather than leaking hidden counts.

Content identities cannot be recycled. Versions and sealed manifests are immutable; runs and instances pin their release and rules. Reviewed new-run adoption is separate from publication. RETAIN_IDENTICAL permits retained-custody adoption only with every old entry at its identical revision; broader breaking/hotfix/multi-engine changes require another contract. Feature controls are audited, administration-only and read coherently by Actions. `shared.rules` starts disabled; global/action/content/reward disable and drain policies preserve committed history.

Seven typed scopes distinguish account, character, run, instance, guild, event and world. Each has a real owner foreign key; generic state contracts declare module, schema, default and lifetime. Substantial domains use dedicated relational models. Migration 030 executes generic KEEP/CARRY/RESET/ARCHIVE rules and freezes terminal scopes. The small campaign proves victory → Aftercore → current keyed Ascension preview → explicit transition → fresh build and receipt replay. Mastery, Legacy and later domain lifetimes remain separate.

## Inventory and carrying

The [inventory grid](inventory-grid.md) pages owned physical copies without limiting total-load calculation. Storage/stack/equipment intents reuse account/run authority and quantity history. Release-opted carrying rules add exact weight/bulk, explicitly owned capacity and immutable encounter penalties; old releases keep their semantics. Historical audits independently reconstruct quantity/custody and capacity-source ownership from immutable journals.

## Database and deployment

Migrations are append-only and checksummed; readiness verifies exact compatibility. The HTTP process receives allowlisted private runtime settings and a restricted SQL role. Administration/test credentials do not enter its environment. Test suites accept only the separate disposable `realms_test` database. Private data, secrets and backups stay outside Git.

The canonical source is `/srv/Realms/source` and GitHub `rdnovotni/realms`; deployed immutable images and stores have separately recorded versions. Source changes cannot establish live readiness or apply a migration. Native, staging and live stores are distinct. Follow the [operations map](../../infra/docs/README.md), [migration guide](migration-guide.md) and [release checklist](release-readiness.md) for reviewed rollout/recovery. The client is a same-origin browser implementation; other renderers can use the same protocol, but are not implemented clients merely because the protocol permits them.
