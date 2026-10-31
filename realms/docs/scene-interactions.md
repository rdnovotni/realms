# M06 — scene objects, investigation, stealth and puzzles

This increment implements FB-056–064 as a synthetic, playable scene slice on M05. It is a reviewed-content framework, not completion of every feature in Systems 29–31 or 38. `scenes.interaction` installs disabled. Nothing here activates production or changes an existing run's release pin.

## Player contract

The Scenes chapter lists discovered scenes. Opening one shows known objects, their current state, available approaches, costs, disclosed check chance, disabled reasons and owned key/tool choices. Consumed items require a separate checkbox. Expanded checks expose public attributes, proficiency and modifiers. The shared command field supports `go Scenes`, `look`, `inspect <known object>`, visible approach labels and numbered choices. It reuses the same explicit confirmation buttons.

Only discovered clues appear as observation, reasoning or rumor records. Journal records carry a source, credibility and run lifetime; they do not become inventory items. Known approaches are summarized in the Journal. A saved scene decision contains its action receipt and consequence. Reconnecting reloads server state; lost responses retain the original idempotency key. Run changes, sign-out and expired sessions clear selected scenes and item drafts.

Guard presentation separates suspicion/awareness, presence, last-known/current position and identity. A noisy bell does not magically identify the player or generate a crime/warrant. Disguise checks require owned, discovered, carried gear actually worn in the active equipment set, relevant authored knowledge and the shared check. Each disguise check names its observer. Clothing cannot erase that observer's explicit recognition, and another observer does not inherit it.

## Authored archive proof

`content/fixtures/m06-scene.json` defines the ordinary content without adding a dedicated dice engine:

* Read the maintenance drawing, reason about reed → wheel → bell, disconnect the alarm and open the cabinet safely.
* Use an owned key, or pick the lock with owned tools. An armed wire rings once and leaves persistent local suspicion.
* Detect the bell through observation, then attempt to disarm it. Failure triggers its bounded consequence and cannot be retried as a free reroll.
* Use an owned native class ability to unseal and quiet the approved cabinet.
* Slip through the passage or wear a compatible tabard, learn the clerk's duty and survive a social check for a different usable-copy route.
* Accept an escorted public copy for a free, always structurally available fail-forward resolution. The original cabinet remains locked on bypass/copy routes.

Routine observation and reasoning cost no Turns. Risky checks disclose 1 Turn and 2 world minutes in this fixture. One principal outcome ends the scene; alternate approaches cannot claim it again. Scene settlement itself grants no economic rewards. An M04 quest may require a terminal scene outcome and claim its immutable source once; M05 NPC memory may refer to the same committed evidence without granting rewards.

## Authority and persistence

`src/rules/scenes.ts` owns the typed state machine and deterministic transition. Each approach references a private, release-pinned shared INTERACTION action. Approach visibility derives from the discovered scene and its clue gates, without requiring discovery of private shared-rule entity IDs. Direct shared-action calls cannot bypass the scene coordinator. `src/domains/scenes.ts` enforces explicit manual intent, discovery, location, run ownership, active encounter exclusion, source compatibility, prerequisites and worst-case failure budgets before item consumption or RNG. Existing shared rules own check math, effects, costs and time.

Migration 052 adds immutable `scene_events`, guarded `scene_states`, and unique `scene_outcome_claims`. A SQL evaluator independently reconstructs authored transitions and bounded trap consequences. Deferred checks link each event to its matching shared check and owner receipt. Public Journal clues must originate in the matching authored discovery event. Runtime grants permit appends/projection updates, never history edits. All three tables archive with the run at Ascension; the new life begins with fresh object/observer state.

Traps execute one bounded pass per committed action; they cannot recursively emit commands or spawn traps. Each action is attempted at most once per life. Resource-dependent routes can fail; every valid scene must also define a visible free fallback from every fallback-object state. Publication rejects invalid references, state transitions, unreachable actions, missing solved routes, shared rule ownership conflicts, incomplete ability sources and resource-gated fallbacks. Bounded reachability analysis stops at 4,096 states and rejects packages it cannot prove within that limit. It conservatively considers both check results; it is not a proof that an impossible character build can solve every optional route.

## Canon and boundaries

Source order follows M01. The immutable imported catalog fingerprint is recorded in `design/m06/contract.json`.

| System section | Applied obligation |
|---|---|
| 30 `SEC-581013B70916`, `SEC-498156BB3C7E` | Independent observer truths and four awareness levels |
| 30 `SEC-F6561563AC35`, `SEC-8C75974EF9BE` | Meaningful action updates, local observers; no omniscient real-time propagation |
| 30 `SEC-1957B1070A4D`, `SEC-0370964ACDF7` | Disguise combines appearance, knowledge and behavior |
| 30 `SEC-FBB3BB586047` | Scene awareness owns no crime/warrant/accountability mutation |
| 31 `SEC-0CEC6DED732A`, `SEC-9F403B48E9D4` | Unified objects and explicit persistent states |
| 31 `SEC-41FF06A182F0`, `SEC-3582B6840546` | Hidden mechanisms require discoverable clues |
| 31 `SEC-882040DAF7C9`, `SEC-9A954265D180` | Persistent trap consequences with bounded execution |
| 31 `SEC-011D30CAF61E`, `SEC-976E00E2C1EC` | Player reasoning and alternate physical/ability routes |
| 31 `SEC-6C282129401B`, `SEC-56DE2831A44D` | Free ordinary inspection and fail-forward exits |
| 38 `SEC-B97469D64AE1`, `SEC-708E4057D193` | Observation/reasoning/rumor separation; evidence is not automatically an item |
| 38 `SEC-A523331A8F0D`, `SEC-0755013B3086` | Journal evidence and anti-softlock routes |

Broader patrol movement, timed stealth, cover geometry, passive detection of arbitrary entities, factions/criminal accountability, disguise catalogs, recursive environmental simulation, player-party investigation, arbitrary freeform spell physics and production region content remain separate work. Scene location here is a discovered contact scene outside active encounters, following the M05 availability model; it does not claim a full travel engine. No player-submitted state patch, free text or model output can grant a scene consequence.

## Verification and integration

See `docs/screenshots/m06/` for executed verification and browser evidence. Run `npm test`, `npm run typecheck`, and the isolated `npm run test:integration` with a disposable `realms_test` database. `scripts/scene-preview.ts` creates a synthetic loopback playtest. The standard checkpoint rehearsal now upgrades through 052 and backs up/restores real legacy combat, consumption, quest, NPC and scene histories.

This branch depends on the open M05 PR #76 and its DM01/M04/M03/M02 ancestors. Main was observed at `d5781f1c868dcebcf0afa93558743859c321e465` on October 31. Source verification does not establish a main merge, deployed image, production schema, production content readiness or activation. Review and merge the stack in dependency order, then rerun combined CI on the exact main integration candidate. Production migration/content/flag adoption remains separately authorized.
