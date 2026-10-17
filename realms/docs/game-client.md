# Game client foundation

Current inventory UI and optional carrying policy: [inventory grid, storage and measurements](inventory-grid.md).

[Documentation map](README.md) · [Current status](implementation-status.md) · [Migration map](migration-guide.md)

The first browser client is served from the same origin as the authoritative game server. It follows the uploaded core bible and Systems 16/23: Character on the left, Adventure/Combat in the center, Journal on the right, structured choices, keyboard access and knowledge-filtered reads. On small screens the panels stack. No client code or third-party service computes rewards, damage, random draws or recovery.

## Run it

```bash
bash scripts/runtime.sh npm run build
bash scripts/server.sh start
```

Open `http://127.0.0.1:3000/`. An enrolled account uses the existing session login. Development mode uses the private local access key entered in the connection form; the key is never injected into HTML or assets. The original development seed contains no adventures, so its honest empty state is expected.

For a complete disposable playtest, with a fresh character and an authored encounter:

```bash
bash scripts/runtime.sh npm run build
bash scripts/runtime.sh npm run dev:client
```

Open `http://127.0.0.1:3001/`, account `wayfarer`, password `A road worth wandering 47!`. This is a public example password for the isolated local test fixture, never a production credential. The script refuses remote database hosts and requires `realms_test`; it creates its own disposable schema, binds only to loopback and removes the schema on graceful shutdown. Its Warden/Wayfarer/Arcanist and watchtower labels are playtest presentation, not a production lore/catalog decision. It does not alter the existing development account, run, release or server on port 3000. Abrupt process termination can leave its disposable schema for deliberate cleanup.

Choose a starting build, begin The Old Watchtower, act as the hero and companion, allow the server to resolve opponent turns, complete the encounter, inspect the pack and choose an earned level. Reload and sign in during combat to resume exactly. Victory rewards/recovery are settled by existing server routes; no separate client reward claim writes exist.

## Equipment and saved loadouts

The disposable playtest grants a sword, shield, two-handed practice greatblade, material stack copies, a test vial, compass and carrying-capacity satchel. Weighted measurements and a fixture carrying policy demonstrate the Pack meters; these values are test balance only. Open Pack to prepare A/B sets; the sword demonstrates permanent account binding on active equipping, while the shield grants Guard in the next encounter. These are isolated fixture items, not production grants. Restart the playtest after rebuilding to load the new server projection and asset routes.

Pack includes the complete worn setup, both prepared weapon sets and the selected active set. Select gear, inspect conflicts and binding consequences, then explicitly Apply the complete draft. The editor retains unchanged positions, permits one weapon identity in both sets in the same hand, and asks you to clear an off hand before preparing a two-handed weapon. Permanent binding requires acknowledgement. Ownership, proficiency, level and hand legality remain server decisions.

Saved loadouts capture the committed setup, never an unsaved draft. You can preview and Apply, explicitly replace, delete, or release/restore a template's protection. Releasing protection or deleting requires confirmation and does not remove manual locks, unequip items or undo binding. A/B preparation is locked during encounters; this is not a combat weapon-swap action. Saving templates and explicit protection operations retain their existing server rules.

The bootstrap projects owned carried gear names, position/level/binding contracts, qualification status, current condition, manual locks and loadout references, together with the current setup and owned templates. Advanced discovery may reveal aggregated known stat modifiers for comparisons; raw source definitions and hidden grants stay private. The bootstrap includes a bounded quick list plus every currently equipped or carried saved-loadout reference. The complete-plan editor stays enabled for large inventories: each slot has a paged Search control that can select any eligible carried item, beyond the quick list, while preserving the rest of the draft. Both Character and Pack reuse the same paperdoll, with searchable empty slots, replacement controls and confirmed equip/unequip drag shortcuts. Search, filtering, sorting, per-copy expansion, known comparisons and storage/stack/history controls are documented in the [inventory contract](inventory-grid.md). Refreshing retains a draft; a changed revision requires Revert before new preparation.

## Boundaries and modules

### Public main screen

The signed-out screen is a compact gateway with a small illustrated banner, account-access tabs, short announcement summaries with archive/changelog links below, and a newsletter availability panel. Footer and announcement archive links open separate page shells at `/about`, `/guide`, `/announcements`, `/changelog`, `/community`, `/newsletter`, `/privacy`, `/monetization`, and `/contact`. The monetization page publishes our funding commitments and distinguishes planned supporter features from live services; see [monetization policy decisions](monetization-policy.md). The privacy page provides a detailed development notice tied to reviewed data handling and explicitly identifies launch gaps; see [privacy notice evidence](privacy-policy.md). The other sections now contain factual Follybound development information and a small player guide. Announcements/changelog distinguish source milestones from deployed updates; Community, Newsletter and Contact disclose services that remain closed. See [public-page scope](branding-and-pages.md). Direct loads, refreshes, and browser history work through explicit server routes. The cover is an original candlelit tabletop/tavern scene, optimized as a 124 KB local WebP. Its prompt and provenance are in `client/art/README.md`. The public theme uses subtle parchment shading, paper grain, sepia rules, and a colored ruby-and-gold inline SVG d20, and small decorative key, quill, and compass motifs. Footer links are ordered About, Player guide, Community, Newsletter, Privacy policy, Monetization policy, and Contact. Responsive touch targets, readable footer type, keyboard focus states, and reduced-motion support complete the welcome theme. It is scoped in `client/welcome.css`; authenticated gameplay retains its existing layout.

For a database-free visual preview, run `npm run preview:welcome` (or through `scripts/runtime.sh` with the local runtime installed) and open `http://127.0.0.1:3010/`. This builds the browser modules and serves only the public client, marks configuration as `previewOnly`, and disables login submission. It never registers authentication or gameplay endpoints. To actually play, use the game server or disposable playtest instructions above. Opening `client/index.html` directly as a file cannot load server asset routes; its loading fallback explains the required server and links to the local preview.

Log in uses the existing session API (or private development key). A newly connected account whose build is unconfigured opens the Character screen automatically; returning configured characters retain the existing adventure/combat routing. The Log in / Sign up tabs support arrow keys, Home, and End. Password recovery is reached through “Forgot your password?” and focuses a labeled recovery region.

Public account signup, email-based password recovery, and newsletter delivery are not implemented by this screen. Their panels state that explicitly and do not collect credentials or email addresses for nonexistent services. Account enrollment remains an administrator operation. The newsletter section can be replaced with a real subscription form when an approved delivery service and consent/unsubscribe flow exist. Announcements and changelog summaries are authored in `client/landing.ts`; update them alongside game releases. They describe the development build and do not imply scheduled releases, player counts, or service uptime.

- `client/types.ts`: version-one public read contracts. Browser compilation has DOM libraries and excludes Node types/server modules.
- `client/api.ts`: same-origin JSON transport, in-memory bearer token, no credential persistence, bounded request timeout and explicit errors.
- `client/session.ts`: saved-state loading, revision agreement, one pending action, exact-envelope retry after an uncertain response, stale-state resync, explicit session revocation on sign-out. A confirmed action followed by a failed read requires refresh and cannot be resubmitted.
- `client/equipment.ts`: equipment drafts, binding acknowledgement and saved-template controls, all submitted through the central session.
- `client/views.ts` and `client/app.ts`: semantic, text-safe DOM, navigation and structured intents. All server-provided text is inserted with `textContent`, never HTML. UI target/range/resource hints support clicks; the server decides legality.
- `client/landing.ts`: public main screen, account-access navigation, and authored development updates.
- `src/domains/game-view.ts`: authenticated bounded bootstrap: owned current run, effective write permission, saved encounter identity, latest solo tactical outcome, discovered solo adventures and carried item names/counts. Uses account/run read locks in action-compatible order. Adventure and compact inventory lists return their first 100 entries with an overflow indicator. Equipment uses a quick list plus equipped/saved references and a separate paged search. Mechanics, loot tables, unrevealed definitions, seeds and other accounts are excluded.
- `src/client-assets.ts`: explicit asset allowlist, same-origin Content Security Policy, no caching of the shell/config, no credential-bearing templates or arbitrary file paths. Assets are plain browser ES modules compiled by TypeScript; no framework/bundler or external fonts are required.

The game server retains the existing authenticated, versioned action protocol. The client submits a chosen class/preset or a tactical intent, with a request ID and expected revisions. It never fabricates an XP award, inventory operation, die roll or outcome. Browsing is free. Adventure cards disclose entry/recovery costs before commitment. Technical failure remains separate from gameplay defeat. A view-only session receives the same permitted information with play controls disabled, and server authorization still rejects writes.

## Next playable slices

This is the client/framework foundation, not the complete client or world. Next work should extend real vertical slices: encounter presentation/name metadata and richer narration, feat/subclass choices, quest/world exploration, party recruitment/shared human controls, accessibility preferences and saved layouts. Parser interpretation and automation must use the same intents with explicit authorization. Production signup/enrollment, secure persistent session transport, catalogs/balance, pagination/search, offline handling and operational release gates remain separate work. An existing shared/basic encounter is shown as unsupported and blocks starting another encounter; this client does not silently abandon it.

No external assets or dependencies are added. Automated tests cover action uncertainty/retry, stale resync, view-only writes, credential transport, bootstrap secrecy/ownership and the actual starting-build → encounter → reconnect → rewards/recovery → earned-level flow. Desktop/mobile browser checks verify the live client separately, including a reload mid-fight, actual healing, victory rewards and earned progression.

The Pack's equipment paperdoll shows all worn slots and both prepared weapon
sets above inventory browsing. Select an individual carried equipment item to
highlight compatible positions; equipment changes and set activation use explicit
confirmations and the existing revision-checked equipment intents. Item-grid
weight glyphs show unit weight for instances and totals for stacks/groups, with
unknown measurements marked `—`. Durability uses exact fractions and configurable
percentage color thresholds; the footer stays anchored across wrapping names.
See [inventory grid](inventory-grid.md) for interaction and accessibility details.


Equipment search uses `equipmentSlot` on the inventory read endpoint, returns at
most 48 physical instances per page, and checks current run/revision, ownership,
carried custody, slot eligibility, level, proficiency and shared prerequisites.
The picker does not change the Pack query or selected item. Searches ignore stale
responses, close on game refresh/sign-out, trap focus in a native dialog, and
restore the opener on close/Escape. Touch users can use the same search and
confirmation buttons instead of dragging. Drafts remain in memory on refresh, with stale revision protection.

The new `client/equipment-picker.ts`, `client/equipment-drag.ts` and
`client/item-art.ts` modules supply shared search, owned-assignment drag parsing,
and a safe artwork hierarchy. Illustrations in `client/art/items/` are original
repository-native vectors served only from an explicit same-origin allowlist.
Authored public `itemArt` keys take priority over public `itemIcon`, then specific
public item/slot identity and a category/unknown fallback; arbitrary URLs and paths
are never loaded. Reviewed local authored raster paths are also supported as described in `client/art/items/README.md`; missing artwork falls back through known icons and contextual illustrations to the neutral glyph.

### Equipment preparation and contextual statistics

The Character and Pack paperdolls share a session-owned equipment draft. Slot
choices, weapon switches, unequips and saved-loadout previews stage the complete
plan. The draft survives screen changes, inventory browsing and rerenders. Apply
uses the existing revision-checked equipment command and explicit permanent
binding consent; Revert discards preparation. A refreshed game revision keeps the
draft visible but prevents Apply until it is reverted. Successful matching commits
clear it. Logout, reconnect and a different run discard it. Drafts are deliberately
in memory, never stored across account sessions or browser reloads.

Statistics use a discovered encounter as a rules context, because profiles and
damage vocabularies are encounter authored. The read-only preview reuses equipment
legality, character scaling, native-level modifiers, encumbrance and typed-damage
calculation. It displays current/after armor, accuracy, evasion, initiative, health,
mana, damage range, resistance percentages, conditional resistances, penetration,
guard/heal availability and carrying capacities. Only worn and active-set gear
contributes. Prepared weapons remain visible without contributing. Equipping never
reduces carried weight. Temporary battle effects and target/roll outcomes are not
predicted. Numerical totals and comparisons are concealed until every item in
both the currently active and proposed active setups has ADVANCED knowledge,
including removal previews, so subtraction cannot reveal hidden modifiers. The context is labelled and a missing discovered context is explicit.

The paperdoll includes a saved-loadout preview selector and a control to save the
committed setup. Apply the draft before saving it as a template. Existing template
replacement, protection and deletion controls are shared between the paperdoll and advanced planner.

Inventory offers server-side Equipped/Unequipped/Usable, slot and condition
filters. Needs Repair means actual condition below its authored maximum; Broken
means zero, and Full means equal to maximum. Items without durability never match
condition filters. Usable means eligible carried equipment whose level,
proficiency and shared prerequisite requirements are met; it does not mean a
consumable has an implemented use action. Filters apply before grouping/counts.
Right click, Shift+F10/context-menu key, or a stationary 550ms touch press opens
item actions. Movement cancels touch activation. These actions reuse the inspector
and its confirmations; the inspector remains the accessible fallback.


Inventory P3 adds page-bounded physical multiselection and atomic bulk-safe
operations, persistent account favorites/uninspected acquisition markers and tile
preferences. Double-click reuses equipment preparation or opens groups/details;
authored consumables and parcels now open confirmed server-backed Use/Open actions.
See [inventory interaction details](inventory-grid.md). Migration 035 is required;
source merge does not imply live migration/deployment.


The current inventory workspace offers Compact/Standard/Detailed account-saved
viewing modes, nearby equipment on wide displays and a collapsible equipment section above inventory on
narrow displays. Comparison uses a dedicated two-column dialog and server-derived
character totals. Repair quotes show condition before/after, per-item Gold cost,
total and affordability. Shared loadout cards show readiness, explain missing or
stored gear, flag binding, search by name and provide Preview/Replace/Protection/
Delete controls. Preview preserves the Apply/Revert draft flow.
See [inventory service contracts and limitations](inventory-services.md).

## Character Overview (CHAR-01)

Character opens on Overview for a newly connected configured run. Its main content
contains total committed level, discovered native class names/levels, current run
mode/status, exact XP, pending level-ups, all seven current attributes, per-class
limits where available, and a compact active equipment summary. It uses the generic
label “Your character”; the current API does not supply a character name, biography,
race or portrait. Essential information is repeated in the main sheet rather than
relying on the sidebar hidden at narrow widths.

Overview and Progression use reusable section navigation. Progression preserves the
existing explicit class-level action; Abilities, Statistics and History are labeled
as unavailable text rather than unfinished controls. CHAR-02 expands Available Decisions to the authoritative class, subclass and feat
read models described below. Other choice categories await their own tickets;
the absence of a connected projection is not presented as zero available choices.
Unconfigured runs see starting class/preset selection first, without an equipment
editor. Existing setup and level action envelopes and server legality checks remain
unchanged.

`GET /api/v1/progression` adds the read-only `xpProgress` projection: the cumulative
threshold for `readiness.readyThroughLevel`, and the authored curve's maximum level.
It uses the same pinned curve already selected by the progression read model.
There are no new writes or migrations. Readiness retains its existing shape.
The browser uses decimal strings/BigInt for total, remaining XP and interval ratios;
only the bounded percentage becomes a Number. The next earnable level is after the
highest XP-earned level, while the next allocation is after the committed level.
At the cap, pending allocation remains visible. Missing curve information produces
an unavailable state rather than invented progress or an assumed cap.

Equipment uses the shared plan/gear cache, including retained drafts and their active
weapon set. It shows known item art/names and honest unavailable fallbacks. Editing,
comparison, binding confirmation and Apply/Revert remain exclusively in Pack, reached
through Open Pack & equipment. Viewing the sheet submits no game actions.

Verify with typecheck/build, client unit regressions and progression/client integration
tests. In a disposable playtest, check setup first, configured Overview, Progression
navigation with keyboard focus, and Pack navigation/draft preservation. Check 320px,
375px and 768px for overflow, including long names and exact large XP values. Rollback
is a source/build rollback; the additive read projection needs no data rollback.


## Character Advancement Center (CHAR-02)

Progression contains Available Decisions, Class Advancement, Subclasses and Feats.
Overview uses the same decision summary. It distinguishes available choices, earned
choices blocked by active instances, unmet requirements/not-yet-earned milestones,
and committed selections. The class cards show current/proposed native level and
limits. Subclasses are grouped by owning class and display the authored native-level
requirement. Feats support search and All/Eligible/Selected/Known but unavailable
filters, public descriptions/effects, a detail panel and an earned milestone picker.
Eligible means the feat's requirements pass; a feat without an earned unused milestone
cannot be committed. Chosen feats/subclasses remain visible using the existing pinned
selection read models. No unknown catalog entities or raw mechanics are exposed.

All three actions require review and explicit confirmation. They use the existing
GameSession request ID, revision, write-scope and ambiguous-response replay handling.
A dialog closes if its source view changes; the session revalidates the choice and
scope before constructing an action. Optional catalog failures stay in the advancement
panel and preserve already-confirmed action feedback and unrelated controls; only
authentication failures affect the global session. No double-click or selection event commits a
choice. Successful actions refresh core progression and all decision catalogs, retain
the Progression section, and report the chosen name/native level/milestone. New runs,
logout and expired sessions forget old catalogs and browser selections.

The existing GET subclasses/feats endpoints, and options with the explicit
`?advancement=true` query, include runId, revision and activeInstance. Ordinary options
reads retain the lightweight starting-class catalog and do not run class previews.
Unrelated actions invalidate old catalogs without eagerly running advancement reads;
returning to Character loads them on demand. Advancement commits refresh them immediately. Each scoped projection runs in a repeatable-read, read-only transaction.
The client accepts the catalogs only when their run/revision match the saved snapshot
and one another. Crossed catalog revisions disable only advancement choices until Refresh. Empty catalogs and read
failures have explicit states; no class/feat schedules are guessed in the browser.

The options projection reuses the same immutable SQL `next_build_state` function and
shared entity prerequisite guard used by class writes; savepoints recover expected
limit errors without recording actions. XP readiness and curve compatibility use the
existing pinned rules. Subclass and feat eligibility reuse their existing authoritative
queries; the projections add only public descriptions/effects, native requirements and
stable milestone ordering. Existing domain calls retain their default result shapes;
scoped HTTP reads opt in to the revision envelope. No write domain, journal, milestone
schedule, migration or feature policy changes.

Disposable browser verification:

```sh
TEST_DATABASE_URL=postgres://rdnovotni@127.0.0.1:55439/realms_test node --import tsx scripts/advancement-preview.ts
# Optional: PLAYTEST_ADVANCEMENT_STATE=blocked or empty
```

This loopback-only preview uses port 3002 and the example account/password documented
above. It creates its own test schema; XP is earned through the existing encounter
journal and native levels through the existing action domain. It never edits production
runs or grants UI-only eligibility. Stop gracefully to remove its schema.

Run typecheck/build, client tests and advancement/build/subclass/feat/proficiency tests.
Coverage includes legal commits, native multiclass gates, missing prerequisites and
proficiencies, unavailable milestones, active instances, stale/concurrent requests,
replay, ownership, undiscovered content, read-only sessions, late reads and new runs.
Rollback is a source/build rollback; the scoped projections are additive and no data
migration requires reversal.

## Attribute and proficiency advancement (CHAR-03)

Character → Progression adds Attributes, Proficiencies and Upcoming Milestones.
Overview shares the earned attribute/proficiency decision summary. The seven attribute
cards show the server's current committed effective scores (starting build plus milestone
allocations), applicable contract caps and earned opportunities. Equipment/temporary
bonuses are not included in this progression projection. The editor starts with zero
points allocated, previews each result, supports keyboard buttons and requires the exact
authored budget. Disallowed attributes and capped increases are disabled. The server
continues to validate capacity reserved for future milestones; a rejection explains why
an allocation below today's caps can still fail. Draft points survive ordinary rerenders
and same-revision refreshes, and are discarded on changed revisions or new runs.

Proficiencies lists discovered skills authorized by applicable pinned contracts, including
family, default attribute, current/max rank, eligibility and earned unused milestones.
Search by name and filter by family, rank or eligible advancement. The established ladder
is Untrained, Novice, Trained, Expert, Master, Legendary. Review shows exactly one rank
increase and the selected milestone; the client never supplies a resulting rank.
Both workflows reuse the shared confirmation dialog, action envelopes, receipts and
revision/write-scope guards. Committed choices survive reload/reconnect; local uncommitted
drafts are not permanent choices. Success refreshes all Character catalogs and Overview,
retains Progression and reports the allocation or skill/rank/milestone. Active instances
and view-only sessions retain inspection access but cannot submit.

GET `/api/v1/progression/attributes` and `/proficiencies` add runId/revision/activeInstance
stamps in scoped HTTP reads; internal default domain calls retain their previous shape.
GET `/api/v1/progression/milestones` is an authenticated, account-owned, read-only public
projection, sorted and bounded to 512 facts with an explicit truncation indicator. It uses
only the active run's pinned release and applicable build contract; prior choices lock
attribute/proficiency/feat policy. Feat/proficiency schedules require a discovered matching
option; subclass facts require a discovered option and an owned native class. It exposes
no raw mechanics, hidden IDs/names, speculative class rewards or universal milestone
schedule. Completed, earned unused and upcoming facts remain separate. Alternative
contracts/subclasses are alternatives, not cumulative grants. Earned does not imply that
all eligibility restrictions are satisfied. Unavailable/undiscovered information stays
unexposed. All six advancement reads must agree on run, revision and active-instance state.

Verification: `npm run typecheck`, `npm run build`, `npm test`, and
`node --import tsx --test --test-concurrency=1 test/growth.test.ts test/attributes.test.ts test/proficiencies.test.ts test/advancement.test.ts`
with the disposable `TEST_DATABASE_URL`. The existing preview above includes test-only
attribute schedules and multiple proficiency milestones. Test exact budgets, caps, future
capacity rejection, Luck, rank sequence/caps, receipt replay, stale requests, ownership,
discovery, active/read-only restrictions, pinned schedules and Ascension reset. Browser
checks should include explicit cancellation, legal commits, refreshed summaries, reload,
and 320/375/768px layouts. No production content, schema or write-domain changes; rollback
is a source/build rollback and requires no data reversal.
