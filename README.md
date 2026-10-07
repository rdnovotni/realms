# Realms

Private development foundation for KoL 2.0: a TypeScript/Fastify server and PostgreSQL persistence on Ubuntu. This is an initial server prototype; there is no playable client yet.

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

Stopping the application leaves PostgreSQL running unless explicitly stopped. Do not remove `.state/`: it contains persistent data. Backups currently remain on this machine; an independent backup destination and restore drill are later work.

## Checks

```bash
bash scripts/runtime.sh npm run typecheck
bash scripts/runtime.sh npm test
bash scripts/runtime.sh npm run test:integration
bash scripts/runtime.sh npm run build
```

Integration tests only accept the separate `realms_test` database. They exercise concurrent duplicate requests, stale revisions, authentication, invalid inputs, state recovery after application recreation, and full rollback after an intentionally failed ledger write.

The same checks run on GitHub-hosted runners with an isolated PostgreSQL service. The workflow does not deploy to this workstation.

## Prototype API

- `GET /health/live`: application liveness.
- `GET /health/ready`: database/migration availability.
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

The first seed grants 400 prototype Turns. Running seed/start again preserves existing state. An account, persistent character identity, and current run are separate database records. One transaction commits Turn cost, revision, receipt, and ledger. Reusing a request ID with a changed payload fails. Retrying a committed Action returns its recorded result, even when the current revision has advanced.

## Next work

Real account authentication; content/schema package validation; deterministic encounters and RNG; scoped rollover; minimal Ascension; player/admin interfaces. Desktop packaging is a separate decision and is not installed by this server bootstrap.

The supplied design documents remain outside this repository in the ChatGPT project reference mirror. The game architecture follows Systems 23 and 46; this prototype is only its first tested boundary.
