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

## Boundaries and modules

- `client/types.ts`: version-one public read contracts. Browser compilation has DOM libraries and excludes Node types/server modules.
- `client/api.ts`: same-origin JSON transport, in-memory bearer token, no credential persistence, bounded request timeout and explicit errors.
- `client/session.ts`: saved-state loading, revision agreement, one pending action, exact-envelope retry after an uncertain response, stale-state resync, explicit session revocation on sign-out. A confirmed action followed by a failed read requires refresh and cannot be resubmitted.
- `client/views.ts` and `client/app.ts`: semantic, text-safe DOM, navigation and structured intents. All server-provided text is inserted with `textContent`, never HTML. UI target/range/resource hints support clicks; the server decides legality.
- `src/domains/game-view.ts`: authenticated bounded bootstrap: owned current run, effective write permission, saved encounter identity, latest solo tactical outcome, discovered solo adventures and carried item names/counts. Uses account/run read locks in action-compatible order. Lists return the first 100 entries and an explicit overflow indicator. Mechanics, loot tables, unrevealed definitions, seeds and other accounts are excluded.
- `src/client-assets.ts`: explicit asset allowlist, same-origin Content Security Policy, no caching of the shell/config, no credential-bearing templates or arbitrary file paths. Assets are plain browser ES modules compiled by TypeScript; no framework/bundler or external fonts are required.

The game server retains the existing authenticated, versioned action protocol. The client submits a chosen class/preset or a tactical intent, with a request ID and expected revisions. It never fabricates an XP award, inventory operation, die roll or outcome. Browsing is free. Adventure cards disclose entry/recovery costs before commitment. Technical failure remains separate from gameplay defeat. A view-only session receives the same permitted information with play controls disabled, and server authorization still rejects writes.

## Next playable slices

This is the client/framework foundation, not the complete client or world. Next work should extend real vertical slices: encounter presentation/name metadata and richer narration, equipment editing and feat/subclass choices, quest/world exploration, party recruitment/shared human controls, accessibility preferences and saved layouts. Parser interpretation and automation must use the same intents with explicit authorization. Production signup/enrollment, secure persistent session transport, catalogs/balance, pagination/search, offline handling and operational release gates remain separate work. An existing shared/basic encounter is shown as unsupported and blocks starting another encounter; this client does not silently abandon it.

No external assets or dependencies are added. Automated tests cover action uncertainty/retry, stale resync, view-only writes, credential transport, bootstrap secrecy/ownership and the actual starting-build → encounter → reconnect → rewards/recovery → earned-level flow. Desktop/mobile browser checks verify the live client separately, including a reload mid-fight, actual healing, victory rewards and earned progression.
