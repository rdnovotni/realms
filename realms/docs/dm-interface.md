# DM01 — DM-first Folio shell and continuous presentation

The approved [DM00 persona](../design/dm00/README.md) now frames the authenticated Folio through a persistent transcript and a shared command field beside contextual controls. This is a deterministic presentation layer: no model call, microphone permission, new game-state engine, migration, or production activation.

## Player workflow

After sign-in the DM introduces the saved journey. An unconfigured character opens Character with discovered starting builds. The story leads the main landmark and reading order; contextual controls follow. The same input remains available when moving among Adventure, Character, Pack, combat, Turns, food, noncombat and Journal. Native device dictation can enter text into this field; built-in speech capture/transcription is not introduced.

- `look` describes the current known destinations or saved encounter. `map` gives the same discovery-limited textual destination list; it does not invent geography or a travel graph.
- `go journal`, `go noncombat`, `go turns`, `go food`, `go character`, `go pack`, `go combat`, `go adventure` open existing panels.
- `inspect <known destination>` keeps that object as the input's focus and displays its disclosed description and entry cost. Object buttons provide the click equivalent.
- `actions` lists current visible controls. Type an exact visible action label, or use `choose <number>`. Partial matches ask a free numbered clarification. Old choice buttons retain their actual control identity and refuse detached controls rather than executing a different newly numbered action.
- `fields` lists visible editable fields and disclosed select options. `set <field number> <value>` updates a field without submitting; checkboxes accept `on`/`off`. Normal UI validation and explicit confirmation still apply. Password/hidden/disabled inputs are excluded.
- `help` explains this bounded grammar. Unknown commands, unavailable actions and absent NPC conversations receive literal feedback and do not spend resources.

The shell is a first command interface, not an unrestricted language interpreter. Commands activate the same existing controls used by clicks. Modal dialogs retain their native keyboard interaction and focus containment; the background command field cannot bypass a dialog. Every major existing gameplay action still reaches the same authenticated, revision-checked server command and receipt workflow.

## Envelope and channel contract

`client/dm-model.ts` defines `DmEnvelope` v1: stable message identity, surface, channel, immutable essential lines, optional prose, optional protected-beat marker and a typed command receipt. Surfaces cover room observations, menus, tooltips, commands, checks, battle, loot, quest, map and system notices. `notes.ts` labels supplemental tooltip text as DM guidance. This is a local presentation contract, not a new network schema accepting arbitrary server/LLM envelopes.

Channels use visible accessible labels and distinct type/border treatments: Dungeon Master, attributed NPC speech, Party chat, You, Mechanical facts, Available choices, Warning, System error. NPC speech remains an attributed claim rather than a mechanical fact. The `dm-shell` synthetic visual fixture demonstrates the transitions with the same input context. It is not a live NPC or multiplayer chat service. Actual System 34 conversation rules and multiplayer messaging remain separate feature integrations; `say` never pretends to send a message where those services are unavailable.

`DmTranscript.focus` retains the local target/conversation independently from channels and input draft. Changes of signed-in run/account clear that scope. MU01 adds validated tab-local session storage for resumable transcript/input; nothing is sent to a model or retained after sign-out. See [MUD client](mud-client.md). This session log holds the latest 200 messages; the server Journal and action histories remain the durable record. Narration preferences are explicitly session-scoped in this milestone; account synchronization is future work.

## Consequential results and receipts

`GameSession.submit` wraps confirmed results from every existing action endpoint with the same saved-receipt presentation, whether initiated by click or command. A lost response remains **unconfirmed**; Retry same action keeps its original request identity. A saved result followed by a failed view refresh remains saved and cannot be submitted again as a new action. The transcript explains read errors and reconnects without introducing new game actions.

Expandable receipts show interpreted action type, request identity, phase, disclosed costs/checks, authoritative result fields and related quest/note changes. The adapter is an explicit allowlist: it never stringifies raw parameters, result evidence, seeds, tokens or hidden definitions. Fields absent from a receipt are labelled as unavailable rather than assumed zero. Action-specific detailed controls/logs remain available. Tactical per-command detail continues to live in the existing combat log; the shell does not invent costs absent from that endpoint's public receipt.

Noncombat results now include the already charged failure-cost block alongside attempt costs. Both are presented separately; public known checks expose roll/total/difficulty/chance, while hidden checks stay hidden. Historical stored receipts retain their original content when replayed. This additive response requires no data migration.

## Density and restraint

| Mode | Optional DM sentences per response | Essential content |
|---|---:|---|
| Rich | 4 | Always displayed |
| Standard | 2 | Always displayed |
| Compact | 1 | Always displayed |
| Speed | 0 | Always displayed |

Sentence budgets count actual sentences within blocks. Full narration remains expandable. Density never trims costs, confirmations, choices, warnings, errors or mechanical fact lines. Sarcasm and banter controls preserve the approved defaults and provide Straightforward. The model includes the approved rolling aside budget; this shell does not request generated jokes or populate routine outputs with filler. Runtime prose is conservative authored framing, with cleverness reviewed under DM00 when further content is added.

Routine templates cover first login, revisits, invalid input, uncertain errors, reconnects, saved results and automation. No input requires a model. Repeat execution retains existing server budgets/stop conditions; the session log is bounded. A protected beat receives no added witty commentary. Supplying NPC or party chat later must not relax visibility, consent or these gravity rules.

## Focus, scroll and accessibility

The transcript/input DOM survives ordinary render cycles. Existing input text and selection survive updates; optional details stay expanded. New entries scroll only if the reader was already near the bottom; otherwise a Read latest response control appears. A separate polite atomic status announces the latest entry rather than rereading the complete transcript. Role/channel labels are text, not color alone. The skip link reaches the whole DM-first main landmark. Contextual headings are nested below its primary heading. Reduced motion, forced colors, large text and coarse-pointer targets use the existing Folio theme.

Changes to the surrounding contextual panel can still replace its own controls under the established rendering model. The persistent DM input and transcript are the stable focus context; closed modal focus restoration remains owned by `interactions.ts`.

## Traceability and acceptance

| Task | Evidence and boundary |
|---|---|
| DM-011 | Versioned surface/channel/receipt types; shared action-result adapter; tooltip guidance; textual known map |
| DM-012 | Explicit labels, attributed speaker, channel border/type treatments; synthetic transition fixture |
| DM-013 | Persistent command DOM, target/conversation/draft model and scope reset tests; live NPC and voice providers not added |
| DM-014 | Transcript-led main landmark and contextual Folio panels, responsive stack |
| DM-015 | Local datalist, known destination mentions, follow-ups, numbered free clarification and detached-choice refusal |
| DM-016 | Saved/unconfirmed receipts, disclosure allowlist, shared server authority, additional failure costs |
| DM-017 | Four density modes with actual sentence budgets and essential-information invariance |
| DM-018 | Deterministic templates and existing bounded automation; no model dependency |
| DM-019 | Persistent story/input, separate announcements, channel styles, prior scroll and detail preservation |
| DM-020 | Unit/session tests; disposable onboarding/command/click/hybrid browser proof and responsive/preference reports in the evidence folder |

Sources: System 16 narration `SEC-DE0C3A00FE0D`, access `SEC-2886B151AD2D`; System 18 knowledge `SEC-15B6C52B44B6`, maps `SEC-7BA4FBAEAD8B`, parser `SEC-8421E1C903FE`; System 23 pipeline `SEC-BA891D0175BD`, AI `SEC-EEFC26D2A23C`; System 34 presentation `SEC-C9DF2E1BF30C`, authority `SEC-4C7A3BF47390`; System 46 accessibility gate `SEC-1A89E2664689`. Apply the frozen source catalog/correction hierarchy and approved DM00 decision. No source reference was modified.

## Verification and operation

From `realms/`: `npm run typecheck`, `npm test`, `npm run build`, `npm run styles:check`, `npm run visual:check`. Database tests include `noncombat-integration.test.ts`, `shared-rules-integration.test.ts` and `quests-integration.test.ts`, against disposable `realms_test` only. Run DM00 validation/tests from the repository root as documented in its bible.

`TEST_DATABASE_URL=... node --import tsx scripts/dm-preview.ts` creates synthetic examples in a new test schema and serves only loopback: the returning player on 3033 and an unconfigured newcomer on 3034. The script prints clearly synthetic development keys; neither is an account credential for another environment. Stop the process to close both apps and remove its test schema. The frozen read-only preview remains `FOLLYBOUND_VISUAL_PORT=3031 node --import tsx scripts/visual-preview.ts`, with `dm-shell`, `dm-compact`, `dm-speed`, and `dm-onboarding` scenes.

The client asset router and reviewed public-edge catalog include both DM modules. Production edge refresh/restart, content activation and deployment remain separately authorized. Rollback selects the previous verified application/assets; no migration or saved-state rollback is needed. Old noncombat receipts may lack the new failure-cost field, which this client explicitly treats as not supplied.

This branch is built on the unmerged M04 implementation plus the approved DM00 design branch. It is not an independent-main integration checkpoint. Reconcile and rerun combined gates when landing that stack; persona approval is not a merge/deployment assertion.

The loopback `/dev/matrix` harness can run the complete browser matrix with one click. It uses actual same-origin browser iframe viewports and receives the rendered child's report after each load/resize. This avoids depending on the desktop app's viewport-override support and captures modal scenes without bypassing modal focus. Both the harness and child-report messaging are development-only. See [the evidence protocol](screenshots/dm01/README.md).
