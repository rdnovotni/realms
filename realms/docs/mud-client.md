# MU01 — Playable MUD command client

MU01 extends the DM01 Folio shell with keyboard-first play using the same authenticated controls, costs, checks and confirmations as the GUI. The synthetic sample links the archive and keeper’s office and includes an authored NPC conversation. It adds no migration or production activation.

## Commands and keyboard

Enter explicitly submits. `look` describes the selected discovered scene; `visit <exact known scene>` and `exit <exact discovered exit label>` open authored contact scenes. `inspect <known object>`, `talk to <known NPC>`, `say <request>`, `actions`, numbered choices, `fields` and `set <number> <value>` reuse existing views and actions. Consequences still require their visible confirmation command. Numbered choices require a freshly requested action list; restored historical numbers cannot select a new control. `go <section>` opens the corresponding Folio panel. `help` explains the grammar.

Up/Down recall the latest 100 commands, preserving unfinished typing. Escape cancels recall. Ctrl+U clears typing and Ctrl+Z restores the locally erased draft; neither reverses game actions. Ordinary browser typing undo remains available when there is no locally erased draft to restore. Tab completes a unique visible suggestion and otherwise retains normal focus navigation. The Complete command button provides the pointer alternative. `alias <name> <command>`, `aliases`, and `unalias <name>` manage up to 20 local aliases, with recursion limits and reserved verbs. Aliases expand a single command, never macros or unattended actions.

`refresh` and `reconnect` reload authoritative state. `retry` retries only the existing pending request with its original identity. Unknown commands and unavailable controls retain input; errors arriving after an asynchronous command restore its text only if the player has not started a newer draft. A saved result followed by a failed refresh remains saved. Restored historical text never submits or reconstructs a pending request after a page reload; reconnect and inspect current server history before making another decision.

## Presentation and accessibility

The persistent shell identifies scene, focused target and conversation. A compact status panel shows Turns, owned resources, run conditions and party information. Active combat supplies current own-unit vitals; otherwise retained assessed vitals are shown. Before the first assessment HP/Mana are explicitly unknown. The scene summary includes public location/description, visible objects and observers, discovered exits, and available discovered NPC contacts. Shared encounters provide party presence; general room occupancy is not implemented or inferred from account activity.

Hybrid preserves contextual illustrated panels beside the story. Text heavy, Minimal and Retro MUD use one reading column, with normal GUI controls following the transcript. Retro uses the system monospace font. Narration density separately controls optional prose; essential facts and warnings stay visible. Transcript labels distinguish narrator, NPC speech, player actions, party messages, mechanical facts, choices, warnings and errors. Event order is monotonic. Clickable mentions re-resolve a known inspection/contact/exit; consequential choice buttons retain current DOM control identity and reject detached controls.

The focusable transcript is a semantic log with automatic announcements disabled to avoid reading every historical entry twice. A separate polite atomic status region offers Latest, Important, or Off announcements. Important announces facts, NPC speech, warnings and errors. Keyboard users can browse all transcript text independently. Redraws preserve expanded receipts, command focus and transcript scroll position; new responses show a Read latest response control when the player is reading older entries. Automated semantics and reading order are verified; a human screen-reader listening review remains a release check.

## Resume and privacy

The tab’s optional `sessionStorage` stores a versioned, owner-run-scoped presentation cache: up to 200 entries, 100 commands, draft, preferences, aliases, focus and selected contact IDs, capped at 512 KiB. The cache is untrusted and validated for schema, size, ordering and identity before use, then marked **Restored local history**. Action mentions are stripped from storage; no callback, authenticated session, password input, seed, hidden definition or authoritative state is reconstructed. Typed player commands can contain personal text, so the player can clear local scrollback and command history. Sign-out, authentication expiry and run/account changes erase it. Storage denial/quota failures cannot block gameplay and are disclosed in the history label. Authentication is required again before development-mode resume.

Selected contact IDs trigger fresh server reads after sign-in. Existing receipt IDs deduplicate replayed results. Cache text grants no eligibility, reward, travel, presence or economy authority. This is tab-local resume, not account-synced storage or an offline game.

## Additive read contracts and authoring

`GET /api/v1/client/state` optionally includes `playerStatus`: nullable retained vitals, discovery-filtered owned resource balances, condition names (unknown effects use a neutral label), and owned current-run companions. `GET /api/v1/scenes` adds public `locationId`, filtered `exits` and `contacts` to a selected scene. Exits require both target scene and target location discovery, plus authored clue gates; NPC contacts reuse M05 presence rules. Reads do not advance revision or spend Turns.

Scene v1 accepts optional `exits: [{id, label, sceneId, visibleAfter}]` (maximum eight). Targets must be scene activities in the package and clue IDs must belong to the source scene. Reciprocal navigation references are validated independently from the acyclic ownership dependency graph. These links select authored contact scenes; physical world travel costs, routing, patrols, multiplayer room occupancy and freeform world movement remain owned by later System 18 work.

Sources: M01 canon lock, System 16 keyboard/accessibility/knowledge sections (`SEC-657A8A06B466`, `SEC-2886B151AD2D`, `SEC-E0C4EE14701E`); System 18 locations/discovery/parser (`SEC-A7BB42DE1494`, `SEC-15B6C52B44B6`, `SEC-8421E1C903FE`); System 23 saving/synchronization (`SEC-AC2240CB7CA1`, `SEC-0402DF9D9C85`); System 34 authored dialogue/context (`SEC-7A5328E82352`, `SEC-135DFA1E7648`). No world-travel or social-presence catalog is declared complete by this client milestone.

## Task evidence

| Task | Evidence |
|---|---|
| MU-011 | Persistent form, current scene/target, explicit Enter/Send |
| MU-012 | Ordered channel-labelled transcript, public immutable receipts |
| MU-013 | Discovery-filtered scene, exits, contacts/observers; honest presence availability |
| MU-014 | Authoritative own status panel and shared encounter party |
| MU-015 | Bounded recall, draft cancellation/restoration, aliases, visible completion/help |
| MU-016 | Re-resolved clickable mentions and same-control consequential choices |
| MU-017 | Native controls, focusable log/context, separate configurable live region |
| MU-018 | Hybrid, Text heavy, Minimal, Retro plus independent density |
| MU-019 | Bounded versioned cache, monotonic order, owner/run checks and receipt deduplication |
| MU-020 | Editable unknown/rejected commands, same-request retry, stale/reconnect feedback |

Run `npm run build`, `npm run typecheck`, `npm test`, `npm run test:integration`, style/visual/infra gates. `scripts/mud-preview.ts` explicitly uses the guarded disposable `realms_test` database and loopback port 3042. It creates synthetic characters/content and enables features only in that isolated test schema. The proof is a client slice on the open M06 stack, not evidence of main integration, content approval, deployment or production readiness.
