# Game client foundation

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

The updated disposable playtest grants a sword, shield and two-handed practice greatblade. Open Pack to prepare A/B sets; the sword demonstrates permanent account binding on active equipping, while the shield grants Guard in the next encounter. These are isolated fixture items, not production grants. Restart the playtest after rebuilding to load the new server projection and asset routes.

Pack includes the complete worn setup, both prepared weapon sets and the selected active set. Select gear, inspect conflicts and binding consequences, then explicitly save the complete plan. The editor retains unchanged positions, permits one weapon identity in both sets in the same hand, and asks you to clear an off hand before preparing a two-handed weapon. Permanent binding requires acknowledgement. Ownership, proficiency, level and hand legality remain server decisions.

Saved loadouts capture the committed setup, never an unsaved draft. You can apply, explicitly replace, delete, or release/restore a template's protection. Releasing protection or deleting requires confirmation and does not remove manual locks, unequip items or undo binding. A/B preparation is locked during encounters; this is not a combat weapon-swap action. Saving templates and explicit protection operations retain their existing server rules.

The bootstrap projects only owned carried gear names, position/level/binding contracts, qualification status, current condition, manual locks and loadout references, together with the current setup and owned templates. These reads occur within the existing account/run read transaction. It exposes no raw source definitions, combat modifiers or hidden grants. Gear is bounded separately from the first 100 general pack entries; when more than 100 gear items exist, editing/application pauses rather than dropping an unseen assignment. Search/pagination and numeric equipment comparison remain later work. Refreshing discards an unsaved equipment draft.

## Boundaries and modules

### Public main screen

The signed-out screen is a compact gateway with a small illustrated banner, account-access tabs, short announcement summaries with archive/changelog links below, and a newsletter availability panel. Navigation links open separate page shells at `/about`, `/guide`, `/announcements`, `/changelog`, `/newsletter`, `/privacy`, and `/contact`. These sections are intentionally placeholders for future content passes; no privacy policy or contact details are invented. Direct loads, refreshes, and browser history work through explicit server routes. The cover is an original candlelit tabletop/tavern scene, optimized as a 124 KB local WebP. Its prompt and provenance are in `client/art/README.md`. The public theme uses subtle parchment shading, paper grain, sepia rules, and a colored ruby-and-gold inline SVG d20. It is scoped in `client/welcome.css`; authenticated gameplay retains its existing layout.

For a database-free visual preview, run `npm run preview:welcome` (or through `scripts/runtime.sh` with the local runtime installed) and open `http://127.0.0.1:3010/`. This builds the browser modules and serves only the public client, marks configuration as `previewOnly`, and disables login submission. It never registers authentication or gameplay endpoints. To actually play, use the game server or disposable playtest instructions above. Opening `client/index.html` directly as a file cannot load server asset routes; its loading fallback explains the required server and links to the local preview.

Log in uses the existing session API (or private development key). A newly connected account whose build is unconfigured opens the Character screen automatically; returning configured characters retain the existing adventure/combat routing. The Log in / Sign up tabs support arrow keys, Home, and End. Password recovery is reached through “Forgot your password?” and focuses a labeled recovery region.

Public account signup, email-based password recovery, and newsletter delivery are not implemented by this screen. Their panels state that explicitly and do not collect credentials or email addresses for nonexistent services. Account enrollment remains an administrator operation. The newsletter section can be replaced with a real subscription form when an approved delivery service and consent/unsubscribe flow exist. Announcements and changelog summaries are authored in `client/landing.ts`; update them alongside game releases. They describe the development build and do not imply scheduled releases, player counts, or service uptime.

- `client/types.ts`: version-one public read contracts. Browser compilation has DOM libraries and excludes Node types/server modules.
- `client/api.ts`: same-origin JSON transport, in-memory bearer token, no credential persistence, bounded request timeout and explicit errors.
- `client/session.ts`: saved-state loading, revision agreement, one pending action, exact-envelope retry after an uncertain response, stale-state resync, explicit session revocation on sign-out. A confirmed action followed by a failed read requires refresh and cannot be resubmitted.
- `client/equipment.ts`: equipment drafts, binding acknowledgement and saved-template controls, all submitted through the central session.
- `client/views.ts` and `client/app.ts`: semantic, text-safe DOM, navigation and structured intents. All server-provided text is inserted with `textContent`, never HTML. UI target/range/resource hints support clicks; the server decides legality.
- `client/landing.ts`: public main screen, account-access navigation, and authored development updates.
- `src/domains/game-view.ts`: authenticated bounded bootstrap: owned current run, effective write permission, saved encounter identity, latest solo tactical outcome, discovered solo adventures and carried item names/counts. Uses account/run read locks in action-compatible order. Lists return the first 100 entries and an explicit overflow indicator. Mechanics, loot tables, unrevealed definitions, seeds and other accounts are excluded.
- `src/client-assets.ts`: explicit asset allowlist, same-origin Content Security Policy, no caching of the shell/config, no credential-bearing templates or arbitrary file paths. Assets are plain browser ES modules compiled by TypeScript; no framework/bundler or external fonts are required.

The game server retains the existing authenticated, versioned action protocol. The client submits a chosen class/preset or a tactical intent, with a request ID and expected revisions. It never fabricates an XP award, inventory operation, die roll or outcome. Browsing is free. Adventure cards disclose entry/recovery costs before commitment. Technical failure remains separate from gameplay defeat. A view-only session receives the same permitted information with play controls disabled, and server authorization still rejects writes.

## Next playable slices

This is the client/framework foundation, not the complete client or world. Next work should extend real vertical slices: encounter presentation/name metadata and richer narration, feat/subclass choices, quest/world exploration, party recruitment/shared human controls, accessibility preferences and saved layouts. Parser interpretation and automation must use the same intents with explicit authorization. Production signup/enrollment, secure persistent session transport, catalogs/balance, pagination/search, offline handling and operational release gates remain separate work. An existing shared/basic encounter is shown as unsupported and blocks starting another encounter; this client does not silently abandon it.

No external assets or dependencies are added. Automated tests cover action uncertainty/retry, stale resync, view-only writes, credential transport, bootstrap secrecy/ownership and the actual starting-build → encounter → reconnect → rewards/recovery → earned-level flow. Desktop/mobile browser checks verify the live client separately, including a reload mid-fight, actual healing, victory rewards and earned progression.
