# INFRA-005: durable PostgreSQL stores

## Deployment scope and authority

The existing backend was inspected before implementation. Its SQL migrations, checksum ledger, transactional migration runner, restricted role grants, runtime role validation, append-only ledgers, wallet transfer guards, request receipts, and account access-status protections are reused. No gameplay tables or rules were invented for this infrastructure ticket. A separate `infra_probe` schema holds only acceptance counters/receipts, not gameplay data.

Production and staging each use their own PostgreSQL instance, database (`kol_production` / `kol_staging`), named volume, internal network, root-private configuration, and independent administrative, migration, and application passwords. The new stacks begin empty except for the backend schema and infrastructure probes. The existing native game/database remain active and retain their existing data and authority. Do not point two game deployments at diverging copies of live player state. Making the container production stack the primary game requires the explicit cutover procedure below; provisioning it does not implicitly migrate player data.

No applicable AGENTS.md was found in the inspected repository or parent directories. See [Docker operations](docker-operations.md) for the host/desktop architecture and previous container reboot checks.

## Version, storage and startup

The Compose database image is pinned to `postgres:18.6-bookworm@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c`. The digest was resolved from Docker's official registry manifest; the checked-in [image lock](../container/images.lock.json) also pins the Node build/runtime base. PostgreSQL 18 is a [supported major release](https://www.postgresql.org/support/versioning/). Image digests establish immutable content, not automatic security updating: upgrades remain deliberate.

Each project mounts its own Compose-namespaced volume at `/var/lib/postgresql`. The official image initializes its PostgreSQL-18 versioned PGDATA path and ownership; acceptance checks require mode 700 and owner postgres. Never recursively chmod a database volume or mount the live native PostgreSQL data directory here. Production has a 1 GiB memory cap and staging 512 MiB; each has shared_buffers 128 MiB, work_mem 4 MiB, shared memory 128 MiB, max_connections 40, CPU one core, and PID cap 256. These are starting budgets for the measured 16 GiB host and shared HDD, not a performance guarantee.

`fsync`, `synchronous_commit`, and `full_page_writes` remain on and are verified. Container filesystem persistence does not protect against disk failure, controller failure, or a power outage with volatile disk caches. Keep off-machine backups and plan UPS/power-recovery testing.

Database and API use `unless-stopped`, with API startup depending on DB health. Health checks use local TCP `pg_isready` against the explicit project database, avoiding the official image's temporary Unix-socket initialization server. Stopping a project deliberately keeps it stopped after daemon reboot; use `up` to enable normal operation again. Host reboot acceptance is a separate recorded test, not inferred from the restart policy.

## Roles and private administration

| Login | Purpose | Limits and access |
| --- | --- | --- |
| postgres | Explicit bootstrap and private operator backup/restore | Administrative password mounted only to DB/bootstrap; local Docker administrators can also use the DB container's Unix socket |
| realms_migrator | Migration job / schema ownership | Owns only this project database and its objects; no cluster superuser, role creation, database creation, replication, bypass-RLS, or inherited membership; four connections |
| realms_app | HTTP backend | Existing explicit table/column grants; no schema creation, migration-ledger update, protected ledger deletion/truncation, account access-status update, or ability to assume migration role; ten connections |

Bootstrap creates roles and resets only their intended attributes and connection budgets, refusing unexpected role memberships. Migration/schema jobs authenticate as `realms_migrator`, not postgres. They use the backend's transactional checksum runner and advisory lock, then apply the same application grants used by native provisioning. Applied migration edits/removals are rejected by the backend's schema/checksum checks. Database public CONNECT/TEMP privileges and schema public CREATE are revoked. There are no grants to anonymous services.

The API mounts only its application password and session throttle key. It never receives the administrative or migration passwords. Secret files are mode 444 for file-backed Compose mounts inside their assigned containers, with a mode-700 root-owned secrets parent on the host. The host environment file is mode 600 and has database names/image IDs rather than credentials. Docker/root administrators can read mounted secrets; these controls do not claim encryption at rest.

No DB host ports are published. The DB attaches only to the project's internal bridge; the API also has a separate frontend bridge with an explicitly localhost-bound HTTP publication. No shared host networking, public administrator UI, Docker API endpoint, or DB socket bind mount is introduced. Administrators use sudo/pkexec and the local Docker socket. Do not rely on UFW to filter Docker publications; see [Docker firewall behavior](https://docs.docker.com/engine/network/packet-filtering-firewalls/).

Private administrative SQL, from `infra` (change both project paths/database for staging):

```bash
sudo docker --host unix:///var/run/docker.sock compose \
  --project-directory /srv/kol-infra/projects/kol-production \
  --env-file /srv/kol-infra/projects/kol-production/.env \
  -f /srv/kol-infra/projects/kol-production/compose.yaml \
  exec db psql -U postgres -d kol_production
```

The Unix-socket operator path intentionally has administrative privileges; possession of Docker access is root-equivalent. Never grant it to the application or an untrusted user.

## Deployment and migrations

The agent can run the same commands through Ubuntu graphical administrator authentication. Terminal equivalent from `infra`:

```bash
sudo python3 scripts/postgresql.py deploy
sudo python3 scripts/postgresql.py status
```

Deploy preflights both projects before modifying either. It refuses customized Compose configurations and pre-existing DB volumes without an explicit matching database identity, preserves existing credentials, adds only the missing migration secret, backs up the old nonsecret environment configuration, builds the game image from an allowlisted context, and records its local immutable image ID in each project. It then starts the new stores, provisions roles, applies migrations, starts each isolated game API, validates, checks DB restart durability and project independence, and produces private backups. No native service or database is stopped or migrated.

For a later schema change, build and test a versioned image, create and fully restore-test a backup, update only the intended project's image setting, stop its API, and explicitly run:

```bash
sudo python3 scripts/docker-projects.py project kol-staging prepare
sudo python3 scripts/docker-projects.py project kol-staging up
```

`prepare` explicitly runs bootstrap and migrations; `up` never implicitly migrates. A failed migration rolls its transaction back. Successfully committed forward migrations are not automatically downgraded after an application failure. Check exact schema compatibility before reverting a code image. No destructive automatic data rollback is provided.

## Logs and basic metrics

PostgreSQL logs connections/disconnections and lock waits. Slow statements above 250 ms are logged; parameter value logging is disabled and statement logging is off. Error-statement logging is suppressed to avoid recording credential-bearing administrative statements. Bootstrap disables slow-statement text logging for its credential-changing transaction. Treat database logs as private: query text/error detail can still contain application data or identities. Docker local log rotation caps DB logs at approximately 10 MiB times three files plus rotation overhead.

`postgresql.py status` shows both project states and per-database `pg_stat_database` counters: active connections, commits, rollbacks, deadlocks, temporary bytes, disk block reads, and buffer hits. Inspect `pg_stat_activity`, `pg_locks`, `pg_database_size`, and PostgreSQL/container logs privately when investigating. Compare counter deltas over time; a single snapshot is not a latency or throughput measurement. Docker stats/host disk free space/OOM events complement these counters. No public metrics/admin service is exposed.

## Acceptance tests

```bash
sudo python3 scripts/postgresql.py validate
```

This command changes only dedicated infrastructure probe records and deliberately restarts the new DB containers/API containers one project at a time. Run during a maintenance window after these stacks receive real users. It does not restart native services or drop/truncate gameplay tables.

The Node acceptance job verifies role attributes and connection limits, runtime schema checksums, unsuccessful schema creation, migration-ledger updates, ledger deletion/truncation, account-status changes, role assumption, and invalid-password rejection. It tests concurrent/repeated migration runs, eight concurrent committed transactions, duplicate-receipt suppression, rollback behavior, and persistent marker data. Administrative probe tables are confined to `infra_probe`; the application receives rights only to those explicit test tables. The Python runner verifies the pinned image, no host DB publications, an internal-only network, separate credentials/volumes, API secret mounts, PGDATA mode/ownership, and a failed TCP connection to the DB from a frontend-only container. It checks API readiness, native workload health, archive readability, and preservation of the other project's DB startup time during each restart.

After a deliberate desktop reboot, leaving the login screen untouched for two minutes, run:

```bash
sudo python3 scripts/postgresql.py after-reboot
```

This requires a changed kernel boot ID, checks the same container/network/volume identities and committed counters/receipts, and does not start/recreate containers or rewrite the probe records. The acceptance baseline lives at `/var/lib/kol-infra/infra-005/acceptance.json` (root-private). INFRA-004's reboot success does not substitute for this test of the newly deployed PostgreSQL stores. Firmware power-loss recovery and physical disk health remain separate checks.

## Backup and restore integration

```bash
sudo python3 scripts/docker-projects.py project kol-production backup
sudo python3 scripts/docker-projects.py project kol-staging backup
```

Backups are custom-format `pg_dump` archives written mode 600 to each project's private backups directory and checked using `pg_restore --list`. The database name is read from that project's validated configuration. Archive readability is **not** a full restore test. Role passwords are not exported by ordinary per-database dumps; retain credential-management/reprovisioning procedures separately. Dump jobs use the private local operator socket and may see all authoritative data. Copy encrypted backups to independent storage, define retention, and schedule restore exercises in the backup ticket. Do not use globally destructive Docker prune/down-with-volumes commands.

For a restore exercise, provision a separate disposable project/database with new credentials and storage, restore using `pg_restore --no-owner --no-acl --role=realms_migrator` through a PostgreSQL administrator, then apply the existing runtime grants and verify migration checksums, row counts, application health and representative authoritative transactions. Rehearse ownership/ACL restoration before restoring live data. Restore exactly once into an empty schema; do not overlay live player state casually. Restore tests must not use the production/staging acceptance volumes as a scratch target.

## Updates and cutover

Minor update: read release notes, resolve the intended official patch tag to a new immutable digest, back up and fully restore-test, change the staging database image first, recreate only its DB service, verify version and schema/application checks, then schedule the same production operation. The same-major volume can be retained. Reverting to an older patch is not a substitute for a tested rollback plan.

Major update: do **not** point a new major image at an existing major's PGDATA. Create new storage and an isolated new-major project. Use a tested logical dump/restore, or a deliberately prepared `pg_upgrade` procedure including both old/new binaries and extension compatibility. Verify collation changes/reindex requirements, permissions, schema checksums, durability and game behavior, then perform a maintenance cutover. See [PostgreSQL upgrade documentation](https://www.postgresql.org/docs/18/upgrading.html).

Native-to-container authority cutover: inventory and freeze game writers in a maintenance window, capture and restore-test a final native dump into the isolated production store (preserving migration ownership and existing schema), provision the restricted runtime role, verify existing accounts/game state and session/enrollment behavior, update game routing/client configuration and desktop management controls, and start exactly one authoritative game deployment. Keep the native database/data and final backup untouched for rollback. Reopen writers only after confirming the new deployment is the primary. Rollback after accepting writes requires an explicit data-reconciliation plan; starting an older diverging database can lose player progress. This deployment does not execute that cutover.

## Verified evidence

Implementation checks and actual host acceptance results are recorded below as they complete. Do not treat prepared test code or the old native database's successful reboot as evidence that the new stores passed. Committed reports omit user names, machine names, addresses, boot IDs, private paths and secrets. Share only sanitized PASS/FAIL summaries, never `.env`, credential files, raw inspect output or dumps.

- Verified locally: all five project definitions parse with the installed official Compose plugin; PostgreSQL and Node references are pinned to official registry digests; TypeScript checks pass; all 119 application unit tests and 29 infrastructure regression tests pass; container helper syntax checks pass. The backend currently contains 27 existing gameplay migrations.
- Operator-verified deployment and initial acceptance passed for both production and staging. The image built successfully from its pinned Node base; both pinned PostgreSQL containers and game APIs became healthy. Existing migrations and runtime grants applied, and repeated/concurrent migration runs agreed on checksums. Runtime schema validation, non-superuser role attributes, role connection limits, protected-data authorization failures, invalid-password rejection, durability settings, concurrent increments, duplicate-request suppression, and transaction rollback checks all passed.
- Storage/access checks passed: dedicated volumes and internal networks, PGDATA owned by postgres with mode 700, no published DB ports, distinct credentials, private host secret directories, and no administrative/migration secret mounted in either API. Frontend-only probe containers could not connect directly to either DB.
- Container restart persistence passed independently for both stores: committed counters and receipts survived, the other project remained available without a DB restart, and database container identities remained unchanged. Both private dump archives passed readability checks; a full restore exercise remains pending. The private host-reboot baseline was saved. These results are from the operator-supplied complete deploy output, not an independently privileged database audit by the agent.
- The initial tmpfs quoting defect was repaired through the managed-template update while preserving already initialized storage and credentials. No native data was imported or cut over; the container stores remain separate empty game deployments with existing schema and dedicated infrastructure acceptance records.
- The existing native game and PostgreSQL remained active; native readiness returned success during preparation. The existing SSH boot-time binding failure remains documented in Docker operations and was not changed by this ticket.
- Operator-verified host-reboot acceptance passed for both stores. The recorded kernel boot identity changed, and the same database containers, networks, and volumes recovered unchanged. Both committed probe counters and request receipts survived. Pinned images, PGDATA permissions, role attributes/limits, protected-data authorization failures, invalid-password rejection, durability settings, private DB access, separate credentials, and both game readiness checks passed again. The native game, native PostgreSQL, and libvirt services remained active and native readiness passed. Evidence is the operator-supplied complete `after-reboot` output; the acceptance verifier did not start/recreate database or API containers or rewrite probe records.
- The database deployment and restart/reboot acceptance checks for INFRA-005 are complete. The live native datastore remains the authoritative source for the existing game; container production/staging are separate initialized stores. Native-data authority cutover has not been executed. Recommended next ticket: automated off-machine backups with a full restore drill and explicit retention/recovery objectives, before a maintenance-window native-to-container cutover. SSH boot-time recovery remains a separate open host issue. Neither archive readability nor restart/reboot success establishes full backup restorability or power-loss/disk-failure recovery.
