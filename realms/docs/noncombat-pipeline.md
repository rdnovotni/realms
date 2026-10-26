# M03 — shared noncombat checks and consequences

[Documentation map](README.md) · [Shared rules](shared-rules.md) · [Migration map](migration-guide.md)

M03 adds run-owned, multi-step obstacles. The obstacle entity is the principal reward identity. Each step offers authored OBSERVE, INTERACT, SKILL_CHECK, CONTESTED_CHECK, ITEM_USE, ABILITY_USE or OBSTACLE_STEP approaches. Each approach references exactly one INTERACTION shared action, reserved to that obstacle; calling the ordinary interaction endpoint cannot bypass the coordinator. Separate quest/dialogue dice engines are not introduced.

Canonical references follow the [M01 source order](../design/m01/canon-and-scope.md): System 03 `skills`/`xp`; System 06 `solutions`/`party`/`rewards`; System 29 `formula`, `assist`, `passive`, `ties`, `generic`, `logs`, `data`; System 45 `objective-xp`/`check-balance`/`content-validation`; System 23 transactions, immutable versions and query/action boundaries. This implements the M03 engineering slice, not complete quest, companion, party, reputation, dialogue or campaign systems. Authored numeric DCs remain provisional tuning; no speculative class/catalog choice is locked.

## Authoring contract

An ACTIVITY owns `mechanics.noncombatObstacle` version 1: one to eight ordered steps, each with a stable step ID, name, one to eight approaches and a disclosed failure plan. A failed step advances by default in the supplied fixture; content may explicitly keep it open with the underlying shared retry policy. Failure plans declare extra costs, alert, a persistent consequence flag, shared effects and player-facing route text. The ordered step list has no graph edges. Authors must review explicit retry-in-place policies and deliberately closed branches. A successful method advances the same step as its alternatives, and terminal settlement happens once per run.

Approach ACTIVITY definitions carry `mechanics.noncombatApproach: {version:1, obstacleId}` and an ordinary `sharedAction`. Their own rewards must be empty. The principal's reward plan is paid only when every step succeeded; a failed-forward completion retains its consequences and advances without that success reward. Knowledge/item/Gold rewards reuse the existing sourced settlement; M03 does not add a generic XP faucet. Future objective XP must use its owning progression budget rather than copying an approach reward.

Checks reuse v2 DCs, attributes, skill ranks, bounded sourced effect modifiers, rank gates, advantage/disadvantage cancellation, deterministic passive scores, and authored automatic/impossible outcomes. A contested approach supplies a pinned authored NPC and eligible target check context; both sides use the same resolver, with defender ties. Preview probability enumerates that resolver. Contested natural shifts are rejected rather than changing defender tie semantics. DCs do not scale implicitly with level and Luck is used only when selected.

Item approaches consume exactly one selected physical carried item through the quantity/protection service, on either mechanical outcome, after explicit confirmation. An ability approach requires discovery and a matching pinned `noncombatAbility` class/minimum-native-level declaration; the actor must own that native level. An eligible recruited NPC may provide one explicitly selected, bounded bonus. Choosing Attempt alone clears that consent; opening a different obstacle also clears the previous selection. Its revision must match the current release and its latest recorded health must be positive. The player owns and pays every displayed resource cost. Foreign player actors/resources and automatic companion substitution are unsupported and rejected.

Required references and kinds, sole approach ownership, duplicate methods, ability source gates and failure costs are validated at publication. Inspect `test/noncombat-fixture.ts` for a complete synthetic package; it is not production content. The Studio can import/edit the definitions through its existing structured entity editor and validate them with the same backend contracts. Bespoke quest authoring and launch content remain separate milestones.

## Persistence and evidence

The coordinator executes inside the ordinary authenticated Action transaction and account/run locks. Obstacle state is nested under the existing `shared_rules_state.obstacles`, projected only from immutable `shared_rules_events`. No second mutable quest-state owner is introduced. The pinned evidence retains principal, obstacle/approach/step revisions, intent, actor/target, full check specification and actor inputs, modifiers, assistance choice, item operation, opposing context, server seed, committed rolls, costs, effects and outcome. The existing shared RNG stream is retained; opposing draws use `noncombat.contest`. The response never includes the private seed or opposing inputs.

Migration 049 adds a default-disabled `noncombat.pipeline` control and guards the existing journal against uncoordinated obstacle changes, resolved-principal reuse, mismatched release/approach ownership and missing manual owner receipts. No old migration is edited and no native lifetime fields are added. New lives start without the old run's obstacle projection; old evidence stays archived with its run. Existing binary/schema parity prevents silently running an older reader against 049.

Before any roll, the actor must afford the attempt plus the entire possible failure cost. Only the actual outcome is charged. Attempt and failure Turn costs share one request-owned ledger debit; separate cost evidence remains pinned. This prevents an unaffordable failure from becoming a free technical reroll. Late failures roll back item use, costs, clocks, rewards, progress, RNG evidence and receipt together. Exact uncertain-response retries return the saved receipt before new revision/feature checks. Different request IDs, approaches or sessions cannot claim a completed principal again. Repeating a nonterminal failed method still follows its shared NEVER/STATE_CHANGED/AFTER_TIME/PAID policy.

The shared fact service exports `obstacle.<entity-id>.complete`, `.failed` and `.alert` for authored prerequisites and alternate routes. Referenced obstacles must be declared dependencies. Raw consequence flag names are retained privately rather than exposed to novice clients.

## API and UI

`GET /api/v1/noncombat` lists at most 100 discovered obstacles. Optional `obstacleId` and `companionId` select a coherent read-only preview. Unknown approaches are omitted. Known checks display their chance; only ADVANCED approach knowledge receives the full permitted calculation. Hidden checks omit the numeric calculation. Seeds, secrets, unrevealed approaches, internal failure effect/flag IDs and raw prerequisites are excluded. Disclosed failure text, alert and cost exposure are always reviewable.

`POST /api/v1/noncombat/resolve` accepts the normal Action envelope (`RESOLVE_NONCOMBAT`) and `obstacleId`, `stepId`, `approachId`, optional `itemInstanceId`/`confirmItem`, optional `companionId`/`consentAssistance`. Extra rolls, bonuses, rewards, actor IDs or target facts are rejected. Actions require MANUAL_UI; no parser/automation bridge is claimed. Every mutation revalidates ownership, release, step, requirements and budget.

The game header's **Noncombat** button opens discovered obstacles. Cards show intent, disabled reasons, attempt costs, disclosed failure costs/branch, chance, advanced breakdown, eligible companion consent and explicit item-use confirmation. The saved result shows disclosed consequences and earned item/Gold/knowledge messages; learned clues include their public description and survive reconnect. The normal saved-action retry, refresh, read-only and Turn reserve workflows apply. Reads carry run/revision identity so stale previews cannot confirm a new step. An empty discovery list is an honest empty state, not automatic content activation.

## Verification and operation

```sh
cd realms
npm run typecheck
node --import tsx --test test/noncombat.test.ts
# Only a separate disposable database named realms_test:
node --import tsx --test test/noncombat-integration.test.ts test/shared-rules-integration.test.ts
npm test
npm run test:integration
npm run build
```

Tests cover alternative-method races, lost-response replay, fail-forward costs/state, finite item consumption, owned ability/companion consent, hidden information, method bypass, forged HTTP math, multi-step changes, independently reproduced contested evidence, late rollback and archived lifetime coverage. Full CI also rehearses checksummed migration/backup/restore through 049 and packaged-reader gates. Read the actual final candidate CI result before adoption.

For a local synthetic browser proof use `npm run preview:noncombat` with TEST_DATABASE_URL pointing only at a disposable realms_test database. The script owns a temporary test schema and closes it on SIGINT/SIGTERM. Its development credential is synthetic; never use it outside loopback.

No staging/production migration or feature activation is part of this change. Actual adoption requires its separate reviewed operator workflow and closure of applicable M00 deployment identity gates. Withdraw entry using `noncombat.pipeline` or content controls; committed receipts and reads remain. Preserve immutable state and roll forward with a reviewed fix. A source revert alone cannot undo 049: retain the matching binary/schema or rehearse restoration of the complete pre-adoption backup in isolation. Never erase player histories to roll back a rule.

## Work-item evidence

| Work item | Implemented boundary |
|---|---|
| FB-029 | Seven typed intents; stable principal, step and approach IDs; strict intent-only API |
| FB-030 | Existing prerequisites/facts, v2 checks/modifiers, shared costs/effects, conserved rewards and Action receipts |
| FB-031 | Authored DC/chance, rank gates, active/passive/automatic/impossible outcomes, bounded recruited-NPC assistance and defender-tie contests |
| FB-032 | Private immutable shared event pins complete check/actor/target context, source revision manifest, modifier provenance and server seed/draws |
| FB-033 | Exactly one run-owned principal projection across all approaches; immutable journal and resolved-principal guard |
| FB-034 | Disclosed extra resource costs, alert, persistent consequence state and ordered fail-forward route; explicit retry-in-place remains authored |
| FB-035 | Explicit selection/consent, current-release recruited NPC ownership/recovery, one bounded helper; no foreign player resource access |
| FB-036 | Noncombat view, chances, specific unavailable reasons, advanced-known calculations, item confirmation, persistent result/clue messages; no seeds/hidden definitions |
| FB-037 | Concurrency, replay, stale client generations, future-release pinning, private projection, owned skill/ability/companion and late rollback tests; 456 real browser contract cases |

The acceptance fixture resolves `activity.sluice` through either an earned Mechanisms proficiency or an owned Unseal ability. Both use the same principal and knowledge reward. Competing approaches settle once; a future content release cannot rewrite that run. [Browser proof](screenshots/m03/README.md) records the real UI, separately from static responsive fixtures.
