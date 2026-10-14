# Follybound HTTP API reference

This inventories the implemented routes in `src/app.ts` and `src/client-assets.ts` through migration 031. Route schemas and domain documents define exact parameters and response shapes; this is not a claim of a stable public SDK or a deployed version. Server checks reject extra body fields. There is no generic client write of stats, arbitrary state, roll results, rewards or content definitions.

## Authentication and Action contract

Public routes are health, public pages/assets, client configuration and (in session mode) login/recovery. Protected routes require `Authorization: Bearer <token>`. Session authentication derives account and scopes from a revocable server record; development mode uses a private single-account credential. Reads enforce ownership/discovery; mutations recheck write authority within the transaction. See [sessions](account-sessions.md).

An Action request carries a UUID `requestId`, its exact `actionType` and the current `expectedRevision`, plus the owning route's allowed intent fields. Generate a new ID for a new choice. After an ambiguous response, resend the exact original envelope to retrieve the committed receipt. Never change its parameters or revision while retaining its ID. Stale state requires a new read before a new choice. Committed receipt replay precedes emergency entry gates.

Representative shared interaction (a discovered fixture and reviewed feature enablement are required):

```json
{
  "requestId": "11111111-1111-4111-8111-111111111111",
  "actionType": "RESOLVE_RULE_INTERACTION",
  "expectedRevision": 0,
  "entityId": "activity.test"
}
```

Failures expose bounded error codes, not SQL or secrets. Validation/authentication/technical failures roll back; an authored failed check can still pay its disclosed costs. Do not treat every unsuccessful result as a refunded action. See [shared rules](shared-rules.md).

## Route groups

| Group | Routes | Contract |
|---|---|---|
| Public status | `GET /health/live`, `GET /health/ready`, `GET /api/v1/client/config` | Liveness, exact migration readiness, nonsecret client mode |
| Account access | `POST /api/v1/auth/login`, `POST /api/v1/auth/recover` | Session-mode password login and one-use offline recovery; no public signup or email reset |
| Session management | `GET /api/v1/auth/sessions`, `POST /api/v1/auth/logout`, `POST /api/v1/auth/logout-all`, `DELETE /api/v1/auth/sessions/:id`, `POST /api/v1/auth/password` | Scoped account operations, not gameplay Action envelopes; see session schemas |
| Current game | `GET /api/v1/client/state`, `GET /api/v1/state` | Bounded client bootstrap / small current-run projection; both use configured authentication |
| Discovery and instances | `GET /api/v1/content/:release/:entity`, `GET /api/v1/instances/:id` | Run-release knowledge and participant-filtered projections; seeds omitted |
| Progression reads | `GET /api/v1/progression`, `GET /api/v1/progression/options`, `GET /api/v1/progression/attributes`, `GET /api/v1/progression/feats`, `GET /api/v1/progression/subclasses`, `GET /api/v1/progression/proficiencies` | Readiness and discovered/eligible choices |
| Progression choices | `POST /api/v1/progression/start`, `POST /api/v1/progression/level`, `POST /api/v1/progression/attributes`, `POST /api/v1/progression/feats`, `POST /api/v1/progression/subclasses`, `POST /api/v1/progression/proficiencies` | Explicit build/earned milestone Actions; [progression](progression-persistence-plan.md) |
| Solo tactical | `POST /api/v1/tactical/start`, `POST /api/v1/tactical/actions`, `GET /api/v1/tactical/:id` | Saved encounter intent with account/encounter/tactical revisions; [engine](tactical-engine.md) |
| Shared tactical | `POST /api/v1/tactical/shared/create`, `POST /api/v1/tactical/shared/join`, `POST /api/v1/tactical/shared/start`, `POST /api/v1/tactical/shared/actions`, `POST /api/v1/tactical/shared/claim`, `POST /api/v1/tactical/shared/cancel`, `GET /api/v1/tactical/shared/:id/invitation`, `GET /api/v1/tactical/shared/:id` | Consent, frozen participants, actions and personal claims; [expansion](tactical-first-pass-expansion.md) |
| Legacy basic duel | `POST /api/v1/combat/start`, `POST /api/v1/combat/actions`, `GET /api/v1/combat/:id` | Historical rules preserved; [basic combat](basic-combat-loop.md) |
| Companions | `GET /api/v1/companions`, `POST /api/v1/companions/recruit` | Discovered authored recruitment and owned tactical companions; broader social features separate |
| Routine crafting | `GET /api/v1/crafting/recipes/:id`, `POST /api/v1/crafting/routine` | Bounded trivial batches from owned materials; [routine recipes](routine-crafting.md) |
| Item protection | `GET /api/v1/inventory/:id/binding`, `GET /api/v1/inventory/:id/lock`, `GET /api/v1/inventory/:id/protection`, `POST /api/v1/inventory/lock` | Owned item binding/lock/loadout protection; no arbitrary custody API |
| Equipment | `GET /api/v1/equipment`, `POST /api/v1/equipment` | Complete legal preparation snapshot; [equipment](equipment-persistence.md) |
| Loadouts | `GET /api/v1/equipment/loadouts`, `POST /api/v1/equipment/loadouts/save`, `POST /api/v1/equipment/loadouts/:key/apply`, `POST /api/v1/equipment/loadouts/:key/protection`, `POST /api/v1/equipment/loadouts/:key/delete` | Owned persistent templates and explicit protection; [loadouts](saved-loadouts.md) |
| Shared rules | `GET /api/v1/rules/:entityId`, `POST /api/v1/rules/combat`, `POST /api/v1/rules/interaction` | Discovered eligibility/cost/chance/effect preview and server-only resolution; `shared.rules` disabled by default |
| Ascension | `GET /api/v1/ascend/preview`, `POST /api/v1/ascend` | Current keyed confirmation, optional reviewed `nextReleaseId`; [lifetimes](ascension-reset-contracts.md), [release policies](shared-rules.md) |
| Prototype pipeline | `POST /api/v1/actions` | `SPEND_TURNS` proof only; not a completed adventure |

New Ascension confirmations require the current preview token at the domain boundary; historical committed tokenless receipts can replay. A chosen next release is bound into that preview. Publicly allowed fields are not permission to invent a new source release or bypass compatibility.

The readonly shared preview reveals only known mechanics. Hidden checks reject automation; callers cannot submit bonuses, capabilities, RNG draws or reward amounts. Full quest graphs, dialogue sessions, travel workflows, trading, payments and public staff APIs are not supplied by these routes.

Public pages are listed in [branding and pages](branding-and-pages.md). Same-origin assets are allowlisted with restrictive response headers. The visual preview registers those assets/configuration only, so login and gameplay calls there return unavailable.
