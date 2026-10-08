# Realms

Private development foundation for KoL 2.0: a TypeScript/Fastify server and PostgreSQL persistence on Ubuntu. The shared database and server foundation is implemented and tested. Gameplay modules and a playable client are the next layer. See [database foundation](docs/database-foundation.md) for the schema, invariants, and implementation boundaries.

## This workstation

Node and PostgreSQL are installed locally under `.local/`; database data/logs live in `.state/`. They are excluded from Git. System packages, firewall settings, and router ports are not changed.

```bash
bash scripts/install-local.sh
bash scripts/server.sh start
bash scripts/server.sh status
```

The installer targets Ubuntu x86_64 with the PostgreSQL 18 packages available in its configured repositories. It downloads Node 24.21.0 from nodejs.org, checks the published checksum, and extracts authenticated Ubuntu packages without installing them system-wide. Existing required system libraries are still needed. `npm ci` uses the committed lockfile.

Server: **http://127.0.0.1:3000**. Database: **127.0.0.1:55432**. These addresses are accessible only on this workstation. Neither service automatically starts after a reboot yet.

```bash
bash scripts/server.sh stop
bash scripts/database.sh stop
bash scripts/database.sh backup
```

Stopping the application leaves PostgreSQL running unless explicitly stopped. Do not remove `.state/`: it contains persistent data. Backups remain on this machine. Verify recovery with `bash scripts/database.sh restore-check .state/backups/NAME.dump`; this restores into a disposable database, checks migrations, constraints and currency conservation, then removes it. An independent backup destination is still needed.

## Checks

```bash
bash scripts/runtime.sh npm run typecheck
bash scripts/runtime.sh npm test
bash scripts/runtime.sh npm run test:integration
bash scripts/runtime.sh npm run build
```

Integration tests only accept the separate `realms_test` database. Each suite creates and removes a disposable schema. They exercise migration upgrades, concurrent duplicate requests and spending, stale revisions, authentication, rollback, sealed content, discovery filtering, item custody, rollover, Ascension, outbox delivery and worker leases.

The same checks run on GitHub-hosted runners with an isolated PostgreSQL service. The workflow does not deploy to this workstation.

## Prototype API

- `GET /health/live`: application liveness.
- `GET /health/ready`: exact migration version and checksum compatibility.
- `POST /api/v1/combat/start`, `POST /api/v1/combat/actions`, `GET /api/v1/combat/:id`: opted-in authored basic solo combat; clients submit intents, never outcomes or rewards.
- `POST /api/v1/ascend`: authenticated, eligibility-checked run transition. See [basic combat and campaign completion](docs/basic-combat-loop.md).
- `GET /api/v1/instances/:id`: authenticated participant view; excludes seeds and internal state.
- `GET /api/v1/content/:release/:entity`: authenticated, discovery-filtered view within an account’s run snapshots.
- `GET /api/v1/state`: current development run; requires `Authorization: Bearer <DEV_API_TOKEN>`.
- `POST /api/v1/actions`: authenticated prototype `SPEND_TURNS` action.

```json
{
  "requestId": "d3a1e208-3638-4920-b636-d496ed1d976b",
  "actionType": "SPEND_TURNS",
  "amount": 1,
  "expectedRevision": 0
}
```

Configuration is generated in `.env` with random credentials and restrictive permissions. Never commit it. The server derives the account from local configuration, not request input. This is a single-user development credential, not production account authentication. `SPEND_TURNS` only proves the transaction pipeline; it does not represent a completed encounter or gameplay feature.

An optional [account/session mode](docs/account-sessions.md) now supports enrolled passwords, revocable scoped device sessions and one-use recovery codes. It derives each request's account from its session and rechecks write authority inside the Action transaction. The workstation retains development mode until a password is deliberately enrolled. Startup generates `.state/runtime.env` without administration/test secrets, and the HTTP process refuses administrative SQL privileges.

New development accounts start with 100 Turns; existing prototype balances are preserved. Running seed/start again preserves existing state. An account, persistent character identity, and current run are separate database records. One transaction commits Turn cost, revision, receipt, and ledger. Reusing a request ID with a changed payload fails. Retrying a committed Action returns its recorded result, even when the current revision has advanced.

## Foundation services

Release-readiness passes add atomic multi-leg currency settlement, tighter ownership/lifetime checks, renewable fenced leases, outbox collision detection, and [inventory quantity accounting](docs/inventory-accounting.md) for grants, consumption and stack transfers. Run `npm run db:audit` through the local runtime to reconcile wallet and item history, bindings, run scopes, job leases and foreign-key index coverage. The [release checklist](docs/release-readiness.md) separates these completed primitives from public-launch work.

The server uses `realms_app`, a restricted database role. Migrations and seeding use the separate `DATABASE_ADMIN_URL`. Startup provisions the role; `npm run db:permissions` verifies its restrictions. Administration credentials remain private in `.env`; the HTTP process receives only the allowed settings in owner-only `.state/runtime.env`.

Domain services implement sealed content publication, explicit state contracts, integer currency transfers, inventory movement, isolated deterministic RNG, instance snapshots, rollover and a minimal completed-run transition. These are internal server contracts; only the documented routes are exposed. Durable jobs and the transactional outbox are ready for module workers. No automatic rollover scheduler or external delivery handler is enabled yet.

Build the first full vertical slice next: typed encounter content, Turn commitment, deterministic resolution, quest/reward/effect integration, victory, and a player-visible Ascension manifest. Add real authentication and administration before access beyond this workstation. The client can use the same protocol from native desktop, browser, or mobile implementations.

The supplied design documents remain outside this repository in the ChatGPT project reference mirror. Systems 23 and 46 govern the shared architecture; each gameplay module will add versioned migrations and validate its own mechanics.

Routine trivial processing recipes now have atomic batches, binding preservation and ledger-linked history. See [routine crafting](docs/routine-crafting.md) for the supported policy and remaining crafting release work.

Durable player item locks block consumption, crafting and stack transfers and survive storage/Ascension. See [item protection](docs/item-locks.md) for authority, history and remaining protection rules.

Equipment snapshots now persist worn slots and two prepared weapon sets, protect equipped items and clear safely during Ascension. See [equipment persistence](docs/equipment-persistence.md) for the supported rules and remaining combat integration.

Selected gear can now opt into permanent account binding on active equipping, with atomic history and preserved original reward commitments. See [permanent item binding](docs/item-binding.md).
