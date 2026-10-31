# M05 — Authored NPC conversation contract

M05 adds one repeatable, server-owned conversation contract to the M03 checks, M04 quests and DM01 Folio. The synthetic keeper can remember a report backed by a committed sluice encounter, change their greeting on return, and retain the exchange across reconnects. This is a source candidate, not deployed or activated content. Migration 051 installs `npc.dialogue` disabled.

## Authoritative flow

1. Discover an NPC and their contact location in the run’s pinned release. Open People, or type `go People`, then `talk to The Keeper`.
2. Read the NPC’s own authored voice, known options, costs, consequences and disabled reasons. The DM frames navigation; NPC speech has a separate label.
3. A free-text request (or `say hello`) is interpreted against exact authored labels/aliases among currently eligible choices. Case, Unicode width and whitespace are normalized. Unsupported requests and collisions return structured fallback, spend nothing and create no receipt or memory. There is no generative service dependency.
4. Review one proposal and explicitly confirm it. The request supplies only NPC, node, choice, confirmation and the normal revision/idempotency envelope. The server reloads the pinned definition, current node, presence, ownership, prerequisites, evidence, controls and memory policy inside the existing account/run transaction.
5. Commit the canonical reply, consequence, node transition, optional structured memory and source evidence together with the Action receipt. Client prose, user text, rewards and arbitrary effects are never accepted as mutations.
6. Render the authoritative NPC reply, mechanical receipt and saved exchange. Lost responses retain the exact request for retry. Generation cannot duplicate a committed choice because generation does not perform settlement.

Dialogue consequences in v1 are NPC node/memory changes. Quest and obstacle links open their owning views for separate preview/confirmation. NPC dialogue does not award Gold/items, alter faction standing, resolve uncertain checks or claim a principal reward. M03 and M04 retain those responsibilities. There is no parallel social dice engine.

## Content and presence

An `NPC` entity may declare `mechanics.npcDialogue` version 1: role/pronouns; authored background, personality, motives, values and boundaries; faction references; a location reference; presence requirements; start node; node text and remembered variants; typed choices, aliases, eligibility, consequence, response, memory and optional domain link. Stable IDs and all content references are validated at package publication and by Studio candidate validation. Duplicate memories/choices, unreachable nodes, broken edges, unknown recalls, malformed or contradictory requirements, unsupported economy fields and unapproved account memory are rejected. Loops and terminal conversation nodes are legal.

Presence is a **static authored contact scene** (System 34 tier 1), accessible after discovering its location and satisfying current story conditions, outside an active encounter. Opening a contact does not move the player or claim they physically travelled. Missing locations do not disclose their names. Absence hides current scene dialogue/options while retaining immutable history. Routine banking/repair services are not gated by this conversation module. System 18 time-based schedules, movement simulation and narrative appointments remain later integrations.

Every node label and alias is authored public presentation; writers must keep undiscovered truths in hidden definitions, not in disabled choice labels.

The guided Studio now includes NPC creation, profile fields, nodes/choices, optional memories/links, presence and evidence requirements, aliases, references and recall variants. Start a disposable workspace with `content/fixtures/m05-npc.json`; ordinary writing changes require no TypeScript edit. Use its existing draft → candidate → staging → approved/export workflow. Approval/export still does not adopt a production release. The server validator remains authoritative when an incomplete draft needs repair.

## Memory, privacy and evidence

Only fictional, canonical choice summaries are stored. Free-text interpretation is bounded to 500 characters and is not stored as gameplay memory or sent to an external model. The browser keeps an unsaved draft and bounded session transcript, both cleared at logout/run change. There is no indefinite verbatim conversation archive. Each NPC/run is capped at 1,000 committed exchanges; the public view shows the latest 50 exchanges and up to 32 memory summaries.

`npc_conversation_events` is append-only, release/revision pinned and owned by the account/run. It records the canonical label/reply/consequence, prior/next node, optional memory and evidence references, Action ID, committed revision and timestamp. A deferred database guard requires the owner receipt, current run/release and exact authored choice/continuation. Existing event rows cannot be edited/deleted by the runtime role. Raw input is absent from the table schema. Public history includes human-readable exchanges and expandable Action/revision references; private source evidence stays server-side.

RUN memory and conversation position reset with Ascension. Old evidence archives; old receipts still replay. Ordinary NPCs never acquire the player’s account knowledge or remember another life. Actual ACCOUNT memory additionally requires an exact NPC/approval pair in the reviewed `accountMemoryApprovals` registry; that registry is intentionally empty. Content authors cannot self-approve a supernatural exception. No NPC identity, cosmology or trans-life exception was approved by this increment. Personal NPC memory does not mutate System 21 faction standing.

## API

- `GET /api/v1/npcs?npcId=…`: known contact list and optional discovery-filtered conversation, revision, presence, choices, history and memory.
- `POST /api/v1/npcs/interpret`: `{npcId,text}` → PROPOSED / AMBIGUOUS / UNSUPPORTED plus eligible authored alternatives. Read-only transaction; no action receipt.
- `POST /api/v1/npcs/choice`: `NPC_CHOICE` envelope plus `{npcId,nodeId,choiceId,confirm:true}`. Extra state/economy fields are rejected. New choices require a supported reader and current run release. Committed receipt replay remains available across feature shutdown or Ascension.

All endpoints require the normal authenticated owner; writes recheck GAME_WRITE inside the transaction. Other actors’ resources, inventories, knowledge and conversation histories are not accepted as parameters. Group decisions, trade execution, relationship dimensions and generative paraphrasing are separate providers; neither presence nor text implies another player’s consent.

## Acceptance and sources

| Milestone task | Implemented evidence |
| --- | --- |
| M05/FB-047 | Typed NPC persona, affiliations and location in `npc-content.ts`; package reference validation |
| M05/FB-048 | Pinned dialogue graph, shared prerequisites/evidence, canonical replies and transactional NPC consequences |
| M05/FB-049 | Run memory, remembered variants, Ascension isolation; explicit closed account-exception registry |
| M05/FB-050 | Exact bounded interpreter → proposal → explicit confirmed schema; no text-originated effects |
| M05/FB-051 | Revalidated target/node/presence; no NPC economy action; M03/M04 links retain owning authority |
| M05/FB-052 | People panel, suggestions via visible choices/typeahead, command route, review/confirm and labeled speech |
| M05/FB-053 | Unsupported/ambiguous/disabled/stale responses never report success; same-request retry |
| M05/FB-054 | Known static contact location, story requirements and active-encounter exclusion |
| M05/FB-055 | Immutable canonical exchange/evidence; readable history, Action/revision references and restore proof |

Canonical anchors: System 34 layers `SEC-B5A3FADEC39A`, presence `SEC-EC175ABF01ED`, dialogue hybrid `SEC-3504149866C8`, pipeline `SEC-B35D4CCC3427`, memory `SEC-B68AAB92A08A`, UI `SEC-C9DF2E1BF30C`, authority `SEC-4C7A3BF47390`, commit contract `SEC-AF7F37B905EF`; System 29 freeform `SEC-693FBD61874F`; Systems 16/23/44 and approved DM00 govern framing, state authority and tone. System 21 separates individual disposition from faction standing. These are source obligations; the deterministic alias provider and static contact scene are this increment’s implementation choices, not a supersession of the broader dialogue design.

## Verification and operation

Run `npm test`, `npm run typecheck`, `npm run build` and the integration suite with a disposable `TEST_DATABASE_URL` ending `/realms_test`. `scripts/npc-preview.ts` creates synthetic characters and local-only servers; `scripts/npc-rehearsal.ts` dumps/restores an owned temporary schema/database and checks identical views, migration checksums and exact receipt replay. The latter uses local `PG_BINDIR` and writes `docs/screenshots/m05/restore-proof.json`. Never point either workflow at production.

See [browser proof](screenshots/m05/README.md). Responsive reports are actual browser DOM contracts, not pixel approval or physical screen-reader testing. CI results are recorded separately from local evidence.

Before adoption, reconcile the open M02 → M03 → M04 → DM01 stack with main and rerun the exact combined candidate gates. Install migration 051 and refresh restricted role grants under the ordinary reviewed migration process. Keep existing historical readers and immutable migration checksums. Emergency disable stops new NPC choices while preserving reads/replay. Forward-fix invalid content through a new immutable revision/release; do not rewrite stored replies, receipts or memories. Restore a backup only through the separately rehearsed operational recovery process. Production migration, image deployment, content adoption and feature activation each require their own authorization.
