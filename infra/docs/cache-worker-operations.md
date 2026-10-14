# INFRA-006: disposable Valkey and durable workers

[Operations map](README.md) · [Current source status](../../realms/docs/implementation-status.md) · [Branding compatibility](../../realms/docs/branding-and-pages.md)

Production and staging were deployed on 2026-10-11. Local verification passed (119 backend unit tests, 30 PostgreSQL integration tests, 36 infrastructure tests, TypeScript checks and image build). Operator-provided output confirms live initial acceptance passed for production and staging, including process-crash recovery. Host-reboot acceptance remains pending. Existing native game data has not been imported, migrated or cut over by this ticket.

## Boundaries and resource budgets

Production and staging each have a separate digest-pinned `valkey/valkey:9.1.2-alpine` instance, passwords, ACL namespace and private internal network. Version 9.1.2 is listed by [Valkey's official downloads](https://valkey.io/download/); the registry manifest digest is recorded in `infra/container/images.lock.json`. Node's Redis protocol client `@redis/client` is pinned to 6.3.0 in the backend lockfile. Redis-specific maintenance negotiation is disabled.

Each Valkey container has a 256 MiB cgroup limit and a 128 MiB `maxmemory` limit, `allkeys-lru` eviction, a 16 MiB client-memory allowance and 64 connections. RSS includes allocator and client overhead: `maxmemory` alone is not a process memory guarantee. The cgroup cap bounds the process; acceptance tests check both that cap and actual eviction under pressure. Valkey has no persistent volume, RDB snapshots or AOF. Total cache loss is an expected condition. [Valkey's eviction documentation](https://valkey.io/topics/lru-cache/) explains the policy and overhead.

Worker caps are 256 MiB, 0.5 CPU and 128 processes, with a read-only filesystem and temporary heartbeat file. Production's DB/API/cache/worker limits sum to 2 GiB; staging sums to 1.25 GiB. These are starting upper bounds, not reserved allocations. Preserve headroom for the native game, desktop, Home Assistant/libvirt, monitoring and the OS. Measure actual memory and latency before adding more projects.

Only the existing API loopback HTTP ports are published. Cache and workers have no host ports and join only their own internal network. Docker administration through the root-owned local socket remains an administrative privilege. No Docker group membership or firewall reset is introduced. IPv4 loopback HTTP exposure is covered by INFRA-004; this ticket additionally tests a real cache connection from an unauthorized frontend network. No claim of WAN testing is made. Cache authentication is plaintext on the local private bridge; do not stretch it across untrusted networks without TLS.

The default Valkey user is disabled. The runtime `cache` user has hashed-password authentication, project-prefixed keys and only the commands needed for cache reads/writes, deletion and atomic ephemeral rate counters. It cannot flush, configure or administer the instance. A separate admin credential is mounted only into explicit acceptance tools. [Official ACL documentation](https://valkey.io/topics/acl/) describes these permissions. Host secrets remain under a root-only directory; individual bind-mounted files are readable inside their intended containers. API and worker containers receive no database admin, migration or cache admin password.

## Backend integration

Authoritative characters, economy state, reward receipts, authentication limits, sessions, outbox records and jobs remain in PostgreSQL. Valkey is never a critical queue, game lock, reward ledger or session authority. Authentication throttling continues to execute its PostgreSQL transaction even after cache eviction or outage.

`contentView` checks account discovery and pinned-release access in PostgreSQL on EVERY request. Only immutable public/advanced content projections are cached for five minutes, with knowledge level included in the key. Hidden mechanics/secrets are not cached in this path. Content reads get supplemental ephemeral per-account traffic shaping (120/minute). Cache errors have a 600 ms bound and a two-second reconnect backoff; reads fall back to PostgreSQL, and this non-security traffic counter may reset. Database authentication limits do not reset. API readiness depends on PostgreSQL, not Valkey.

Existing PostgreSQL `outbox_events` are dispatched transactionally to `durable_jobs` using the existing unique job key. A worker claims a 30-second lease with a fresh fencing token. The runtime handles:

- `ACTION_COMMITTED`: verifies the original authoritative action receipt and acknowledges it; rewards were already committed by the original action transaction and are not applied again.
- `CACHE_INVALIDATE`: deletes a validated project-local cache key, a safe repeated operation. Payload is `{ "key": "content:..." }` without the project prefix. Cache outage delays this job rather than pretending deletion succeeded.

Unknown kinds retry then become durable failed jobs. No invented asynchronous gameplay reward handler is enabled. Existing rewards remain in the inspected synchronous PostgreSQL architecture.

`commitJob` accepts a SQL-only handler. It locks and validates the durable record, checks the lease token and actual clock, applies SQL effects using the supplied transaction client, inserts a unique execution receipt and log, and marks success in ONE transaction. It checks `clock_timestamp()` again before completion; expiry during a transaction rolls everything back. Concurrent replay cannot commit the same job twice. Never put HTTP requests, emails, payments, filesystem writes or Valkey effects inside this handler: database serialization retries may invoke it again.

For future critical handlers, reuse the domain's business idempotency receipt as well as the job key, and grant only the necessary database permissions. A new job key is not permission to repeat a business reward. External effects require a provider-enforced idempotency key and reconciliation; this ticket does not claim exactly-once delivery to external systems. The worker login currently cannot modify wallets or characters, create schema objects, delete execution receipts or administer roles.

Failures use exponential delays of 5, 10, 20... seconds, capped at 300 seconds. The existing default is three attempts. Terminal `FAILED` records are the dead-letter queue; existing database triggers prevent reopening terminal work. `job_execution_log` records success, retry, failure and lost-lease classifications without payloads or raw exceptions. Exhausted crashed leases produce `LEASE_EXHAUSTED`. Jobs/receipts/logs are durable; do not apply a blind age-based deletion policy. Track their disk growth and design explicit archival in a later ticket.

SIGTERM stops new claims, wakes idle polling and allows the current SQL operation to finish. Compose grants 45 seconds to exit. If killed or disconnected, PostgreSQL rolls back its transaction; a new worker can reclaim the expired lease. If the commit completed before termination, its durable terminal state and receipt prevent replay. Health is a recent PostgreSQL loop heartbeat, with no administrative HTTP port.

## Deploy and validate

Run from the repository's `infra/` directory, using the desktop terminal:

```bash
sudo python3 scripts/cache-workers.py deploy
```

The script recognizes managed production/staging configurations, verifies existing database identities and native readiness, verifies a backup archive for each database, builds the image and stores its immutable local image ID, preserves existing credentials and database volumes, generates new independent credentials, and applies migration `028_worker_receipts.sql` and explicit worker grants. It updates one project's API/worker at a time; this causes a brief interruption of THAT container API. It does not stop the native game, PostgreSQL system service, libvirt, another project's database or Docker itself. No reboot is performed. Existing archives are checked for readability, which is not a full restore test.

The command runs container acceptance after deployment. `validate` is an ACTIVE failure test: it stops the selected worker, creates non-game durable probe records, flushes and destroys its disposable cache container, tests SQL effect/receipt replay and retry exhaustion, restarts it, then SIGKILLs cache and worker processes from the host using verified process descriptors to verify Docker recovery. Each project is tested in turn. PostgreSQL volumes and real player data are not removed; probe SQL uses its own schema. It fingerprints real characters, wallets and durable auth limits around cache loss without printing those rows. Run during a maintenance window. Other projects and the native game must remain ready.

```bash
sudo python3 scripts/cache-workers.py validate
sudo python3 scripts/cache-workers.py status
sudo python3 scripts/cache-workers.py dead-letters
```

Local integration tests use a separately initialized temporary PostgreSQL 18 cluster and isolated test schemas; the test database must be named `realms_test`:

```bash
TEST_DATABASE_URL='postgresql://.../realms_test' npm --prefix ../realms run test:workers
```

Do not point tests at production or paste a credential-bearing URL into a shared log. The infrastructure container helper supplies credentials through private files instead.

## Restart and reboot checklist

After initial acceptance passes, schedule a normal reboot using the desktop. Leave the graphical login screen untouched long enough for services to start. Then log in solely to run validation:

```bash
sudo python3 scripts/cache-workers.py after-reboot
```

It requires a changed boot ID, checks original database/cache/API/worker containers and durable volumes, verifies health and isolation, and verifies the durable probe effect/receipt. Disposable cache entries are expected to disappear after a container or host restart. Desktop access remains available. Reboot acceptance is a separate operator step and is never inferred from restart policies alone.

## Failed jobs and recovery

Inspect `dead-letters` and the local execution classifications first. Do not delete the failed row or edit its identity/status. Fix the handler, permissions, input or dependency before considering replay. For SQL-only work, an administrator may create a NEW job referencing the failed record using a new documented key and exactly the same payload only after verifying there is no successful execution receipt and no already-applied domain receipt. Use the application's existing `enqueue` function so reused keys with different work are rejected. Keep the original row as evidence. External-provider work additionally requires verifying the provider's idempotency result. There is deliberately no one-click blind reward replay command.

An administrative Docker stop/kill can suppress an `unless-stopped` restart policy. Sending `kill -KILL 1` from inside a PID namespace can be ignored because PID 1 has [special signal protection](https://www.man7.org/linux/man-pages/man7/pid_namespaces.7.html). Crash tests now open a host PID descriptor, verify the exact Docker container identity and cgroup, recheck the running process, and signal that descriptor; [Docker restart-policy documentation](https://docs.docker.com/engine/containers/start-containers-automatically/) describes the manual-stop exception. `sudo python3 scripts/cache-workers.py recover-components` explicitly starts the two projects' cache/worker components and reruns active acceptance if a prior test left one stopped.

Cache damage: recreate ONLY the project's cache service. Keep its credentials/configuration. PostgreSQL data and leases require no restoration. A worker killed mid-task resumes after the lease expires; unknown kinds must be implemented or investigated before replay. PostgreSQL outage: API readiness drops, workers stop successful polling, and existing Docker restart policies remain in effect. Restore database availability and inspect delayed/exhausted tasks rather than moving them to Valkey.

## Rollback and upgrades

This is a forward schema migration. Keep the pre-deployment database archive and `.env.before-infra006` / `compose.yaml.before-infra006` files private. Do not blindly run the old image against schema 028: its strict checksum/version check will fail.

To disable just the new components, use the explicit project paths from `docker-operations.md` and `compose stop worker cache`. The new API falls back to PostgreSQL; original native services remain available. Keep new receipt/log tables and role definitions, with the current API image, until an explicitly reviewed downgrade is available. Never restore a live pre-ticket database over newer authoritative transactions. Full recovery from a pre-ticket archive requires a maintenance window, proven restore procedure and assessment of all post-backup changes.

For Valkey updates, resolve a supported version and official manifest digest, update the lock/config, back up PostgreSQL, build/test, then update one project's cache at a time. Its data is disposable. Worker/API updates must migrate through the separate migration login before startup; immutable receipt formats and business keys require compatibility review. Existing PostgreSQL major-version procedures and backup integration are documented in `postgresql-operations.md`.

## Evidence and remaining work

Verified locally: TypeScript compilation/type checking, infrastructure Compose validation and secret/network/resource assertions, backend unit tests, isolated PostgreSQL tests for replay, rollback, expired leases, bounded retries, lost connections and content-access boundaries. Local tests do not constitute container or host reboot acceptance.

Verified during deployment: both project stacks started with the pinned image, new roles and migration, while the native services remained healthy.

Verified by the operator's successful `recover-components` output: both production and staging passed healthy cache/worker startup, private-network isolation and unauthorized connection tests, separate credentials, restricted database/cache permissions, actual memory-pressure eviction, full cache flush and container recreation, unchanged character/economy/auth-limit data, interrupted SQL rollback, reclaimed leases, concurrent replay protection, bounded retries into durable dead letters, retained effects/receipts and graceful worker shutdown. Both cache and worker processes automatically recovered from host-injected SIGKILLs. Restarting one project's components left the other project's worker running and game ready. The run ended with `Cache and worker initial acceptance passed` and wrote its private reboot baseline.

The crash test now signals only the verified container host process through a PID descriptor, with a second Docker identity/PID check and matching cgroup; it refuses an ambiguous target. This avoids both Docker's administrative-stop exception and namespace PID 1 signal protection. The subsequent scheduled reboot and after-reboot acceptance are recorded below.

Independently verified after reviewing the output: native, production and staging readiness endpoints each returned `{"status":"ready"}`. The committed report contains no operator hostname, username, addresses, passwords or container identities.

Host-reboot acceptance passed in the operator's output on 2026-10-11, after the INFRA-007 release refreshed the baseline for its replacement API/worker containers. An actual changed boot identity was confirmed; both projects retained their containers and volumes. Cache/worker health, memory limits, private-network isolation, separate credentials and restricted roles passed. Durable probe effects and execution receipts remained present exactly once, and completed jobs remained terminal. Native game, database and virtualization services stayed active. The run ended with `Cache and worker reboot acceptance passed`. Full restore drills, off-machine backups, native game data cutover, external worker/provider integrations and WAN exposure verification remain separate work.

Recommended follow-up after backend deployment: scheduled PostgreSQL backups with encrypted off-machine copies, retention, failure alerts and a full isolated restore drill. Durable job records and execution receipts must be included in database backups, and restoration must consider external effects before any worker resumes.
