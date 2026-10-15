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
replacement, protection and deletion controls remain in the advanced planner.

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
consumable Use and loot-container Open still need their owning server domains.
See [inventory interaction details](inventory-grid.md). Migration 034 is required;
source merge does not imply live migration/deployment.
