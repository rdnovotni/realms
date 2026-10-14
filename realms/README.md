# Realms

Release implementation follows the [eight-pass plan](docs/eight-pass-release-plan.md), starting with combat and character mechanics. Pass 1 is complete; see [saved tactical combat](docs/tactical-engine.md) and [release plan](docs/eight-pass-release-plan.md).

Private development foundation for KoL 2.0: a TypeScript/Fastify server and PostgreSQL persistence on Ubuntu. The shared database and server foundation is implemented and tested. A first playable browser client now connects character setup, saved tactical combat, rewards and recovery. See [game client foundation](docs/game-client.md) for setup and the disposable local playtest. See [database foundation](docs/database-foundation.md) for the schema, invariants, and implementation boundaries.

## Legacy native development runtime

The original native runtime lives at `/srv/Realms/native/realms`; its Node/PostgreSQL tools and private data are separate from `/srv/Realms/source`. The commands below apply to that native checkout. Public production and staging use the managed container workflow described in the [development baseline](../infra/docs/development-baseline.md).

```bash
bash scripts/install-local.sh
bash scripts/server.sh start
bash scripts/server.sh status
```

The installer targets Ubuntu x86_64 with the PostgreSQL 18 packages available in its configured repositories. It downloads Node 24.21.0 from nodejs.org, checks the published checksum, and extracts authenticated Ubuntu packages without installing them system-wide. Existing required system libraries are still needed. `npm ci` uses the committed lockfile.

Server: **http://127.0.0.1:3000**. Database: **127.0.0.1:55432**. These addresses are accessible only on this workstation. The host now supervises both native services at boot; inspect `kol-realms.service` and `kol-postgresql.service` for current state.

```bash
bash scripts/server.sh stop
bash scripts/database.sh stop
bash scripts/database.sh backup
```

Stopping the application leaves PostgreSQL running unless explicitly stopped. Do not remove `.state/`: it contains persistent data. The native manual backup command writes locally; the separate encrypted USB workflow covers native, production and staging. Verify recovery with `bash scripts/database.sh restore-check .state/backups/NAME.dump`; this restores into a disposable database, checks migrations, constraints and currency conservation, then removes it. Encrypted USB backups and isolated restore checks are implemented; measured recovery on another machine and other release gates remain open.

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
- `GET` and `POST /api/v1/progression/attributes`: effective scores and authored earned point allocations. See [attribute milestones](docs/attribute-milestones.md).
- `GET` and `POST /api/v1/progression/feats`: authored milestones, prerequisite eligibility and explicit feat choices. See [feat persistence](docs/feat-persistence.md).
- `GET` and `POST /api/v1/progression/subclasses`: discovered native-level eligibility and explicit subclass selection. See [subclass persistence](docs/subclass-persistence.md).
- `GET /api/v1/progression/options`: discovered starting classes and authored presets.
- `POST /api/v1/progression/start` and `/api/v1/progression/level`: explicit starting setup and earned class-level choices. See [class progression](docs/run-class-progression.md).
- `GET /api/v1/progression`: authenticated current-run XP, committed level and pending level readiness; no reward-write endpoint. See [encounter XP](docs/encounter-xp-persistence.md).
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

Domain services implement sealed content publication, explicit state contracts, integer currency transfers, inventory movement, isolated deterministic RNG, instance snapshots, rollover and a minimal completed-run transition. These are internal server contracts; only the documented routes are exposed. Durable jobs and the transactional outbox are ready for module workers. A PostgreSQL-backed scheduler now supports bounded, durable daily rollover and named SQL job hooks; see [scheduling operations](../infra/docs/scheduling.md). Automatic awards remain unconfigured until gameplay values are finalized. External delivery handlers still require explicit integrations.

Development proceeds through remaining reusable feature frameworks with small test fixtures before production content authoring. Complete progression/Ascension, quests/world, daily systems and client integration next; session authentication and operator/authoring tools already exist. See the development baseline for verification and remaining access/release gates. The client can use the same protocol from native desktop, browser, or mobile implementations.

The supplied design documents remain outside this repository in the ChatGPT project reference mirror. Systems 23 and 46 govern the shared architecture; each gameplay module will add versioned migrations and validate its own mechanics.

Routine trivial processing recipes now have atomic batches, binding preservation and ledger-linked history. See [routine crafting](docs/routine-crafting.md) for the supported policy and remaining crafting release work.

Durable player item locks block consumption, crafting and stack transfers and survive storage/Ascension. See [item protection](docs/item-locks.md) for authority, history and remaining protection rules.

Equipment snapshots now persist worn slots and two prepared weapon sets, protect equipped items and clear safely during Ascension. See [equipment persistence](docs/equipment-persistence.md) for the supported rules and remaining combat integration.

Selected gear can now opt into permanent account binding on active equipping, with atomic history and preserved original reward commitments. See [permanent item binding](docs/item-binding.md).

Named equipment loadouts now persist across Ascension and protect referenced gear until explicit release. Applying a loadout uses the ordinary current-run equipment rules. See [saved loadouts](docs/saved-loadouts.md).

Authored encounters can now opt into immutable XP budgets and cumulative level curves. Successful resolution awards XP in the same transaction as the encounter; readiness leaves build choices and campaign completion separate. See [encounter XP persistence](docs/encounter-xp-persistence.md).

Run skill ranks and explicit proficiency milestones: [proficiency persistence](docs/proficiency-persistence.md).

Authored skill-rank gates for feats and equipment: [proficiency prerequisites](docs/proficiency-requirements.md).

Infrastructure external-routing preparation: [Caddy and Cloudflare Tunnel](../infra/docs/tunnel-operations.md). Public exposure and DNS activation require explicit operator approval; staging and administration remain local.

Permanent server-folder relocation: [Realms storage layout and migration](../infra/docs/realms-storage-layout.md). The checked migration targets `/srv/Realms` and keeps the native and container databases separate.

Domain and hosting setup: [playfollybound.com operator runbook](../infra/docs/playfollybound-hosting.md). Registration/account setup and public activation are separate operator steps.

Encrypted external-drive backups: [setup, restore tests and recovery](../infra/docs/local-backups.md). Automatic jobs are enabled only after initial USB backup and isolated restoration succeed.

## Feature frameworks before content

The [feature registry](design/README.md) maps the Core Bible and Systems 01–46 to scoped implementation contracts and a dependency-ordered [work plan](design/WORK_PLAN.md). Run `npm run features:check` before advancing a feature status. Source approval, implementation evidence, automated verification and live activation are separate. Ordinary content remains limited to test fixtures until its framework and workflow pass their acceptance gates.

The [Ascension field-lifetime contract](docs/ascension-reset-contracts.md) declares native fields, executes generic field reset/carry policies, and proves the small campaign → preview → next-life → replay loop with persistent knowledge.
