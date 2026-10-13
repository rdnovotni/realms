# INFRA-007 — Backend deployment and recovery

## Architecture and boundaries

The game is the existing TypeScript/Node.js Fastify backend in `realms/`, using PostgreSQL transactions, session authentication, server-side action validation and the existing durable job architecture. Its browser client uses HTTP APIs; there is no implemented WebSocket transport to containerize. Future WebSocket support should extend this backend and the ingress configuration when the game actually needs it.

`infra/container/Dockerfile` builds the server and browser client with `npm ci`, the committed dependency lock and an immutable Node image. The runtime contains production dependencies and migrations, runs as UID/GID 10001, and has a default liveness health check. Image versions/digests are recorded in `infra/container/images.lock.json`. A release builds once, resolves its local SHA-256 image identity and deploys that identity to both environments. Rebuilding from a moving dependency tag is not the release mechanism.

Production and staging use the shared `infra/compose/kol/compose.yaml` template with distinct project identities, private networks, database volumes and credentials. API HTTP is published only on IPv4 loopback: production port 13000, staging 13001. Database, cache and workers have no published ports. The API joins a frontend network and its own internal service network; the database/cache/worker join only the private network. This follows the established, tested Docker networking arrangement.

The previously deployed native database/game services remain operational. These container environments have their own databases. This ticket does not import native players or switch the authoritative live game to the container production endpoint. That cutover requires a separate backup, migration and verification procedure.

## Configuration and secrets

`infra/templates/kol.env.example` documents non-secret deployment settings. Runtime `.env`, passwords and ACLs live under `/srv/kol-infra/projects/<project>/`, outside source control. Root owns the environment files and private secret directories. Read-only secret mounts expose only each service's required credentials: the API receives its restricted application password, throttle key and cache password; the worker receives its separate restricted worker credentials. Neither receives the database administrator or migration password.

The migration/setup profile uses separate credentials and the existing checksum-verified migration mechanism. Application startup and readiness verify the schema and restricted runtime role. An unready database, missing migration or unsafe role cannot admit game requests. Existing action authorization, request validation, ledger protections and transactional idempotency remain in the backend; clients do not obtain direct database access.

The API has its existing memory budget; workers have 256 MiB; cache has a 256 MiB container cap and 128 MiB eviction budget. Production PostgreSQL has 1 GiB and staging 512 MiB. Per-container log rotation and restart policies remain configured in Compose. See the database and cache operations documents for the detailed connection and resource budgets.

## Health and lifecycle

- `GET /health/live`: the HTTP process responds, independently of PostgreSQL availability.
- `GET /health/ready`: verifies PostgreSQL connectivity, migration checksums and restricted application role. Database failure or shutdown returns 503. With the cache configured, a successful response includes database `ready` and cache `ready` or `degraded`.
- Cache outage alone leaves readiness at 200 with `cache: degraded`. Cached content falls back to PostgreSQL; authoritative state and security rate limits remain in PostgreSQL.
- During shutdown the API marks itself draining, rejects new game requests, closes idle connections and waits for in-flight work. SIGTERM/SIGINT close the HTTP server, cache and database pool. The process has a 35-second shutdown deadline and Compose provides 45 seconds.
- Idle PostgreSQL disconnections are logged safely and removed from the pool; subsequent requests obtain new connections. Borrowed-connection errors roll back transactions. Readiness rechecks database/schema/role before reopening game traffic. Workers retain their durable leases, receipts and retry behavior.

Logs are structured JSON. Request serialization excludes query strings and redacts credentials, cookies, request bodies and response cookies. Technical database/configuration errors use safe event classifications rather than logging connection strings or secret values.

The [node-postgres pool documentation](https://node-postgres.com/apis/pool) describes idle connection errors and replacement; [Fastify server documentation](https://fastify.dev/docs/latest/Reference/Server/) describes connection handling and shutdown options.

## Deploy and validate

Run these commands from the repository's `infra` directory on the Ubuntu server:

```bash
sudo python3 scripts/backend.py deploy &&
sudo python3 scripts/backend.py validate
```

`deploy` requires the existing INFRA-005/006 stacks and recognized managed templates. It creates readable database archives, builds one image, saves private timestamped release records under `/var/lib/kol-infra/infra-007/`, and updates only the two game templates. Staging deploys first. Within one environment it stops the API and worker, runs bootstrap/migrations with separate credentials, starts the new API/worker, and runs restricted-credential smoke tests. It retains the running database/cache containers and checks the other environment and unrelated running Docker workloads for unexpected restarts. Failure stops progression to the next environment. It never automatically restores an older database.

`validate` is an active maintenance drill. For each environment separately, it briefly stops and restores PostgreSQL, then cache, and verifies liveness, readiness degradation/recovery and that the API/worker processes did not restart during dependency failures. Finally it checks a clean API SIGTERM exit and recovery. Dependencies and the API are restarted in cleanup paths even when assertions fail. Schedule this when brief container API outages are acceptable. It does not remove volumes or stop the native game.

Smoke checks verify restricted database/schema access, authenticated cache round trips, unauthorized HTTP read/write rejection, rejection of unexpected state fields, and denial of unsafe database privileges/credentials. They do not enroll players or apply real gameplay actions.

For routine checks:

```bash
sudo python3 scripts/backend.py status
sudo python3 scripts/backend.py smoke
curl --fail http://127.0.0.1:13000/health/ready
curl --fail http://127.0.0.1:13001/health/ready
```

After a separately scheduled normal host reboot:

```bash
sudo python3 scripts/backend.py after-reboot
sudo python3 scripts/cache-workers.py after-reboot
```

The deployment verifies retained worker receipts before refreshing the INFRA-006 reboot baseline to reflect the new API/worker containers. Reboot verification requires an actual changed boot identity and preserved container/storage identities; it does not perform a reboot. Finish with a desktop logout/no-login check and verify native game health, container health, database data and the existing Home Assistant workload. Docker and the stacks start independently of a graphical login; keep the desktop installed and available.

## Failure handling and rollback

Keep the private database archives and release records. Each release record preserves the original `.env` and `compose.yaml` for both environments. Inspect a failing project's service status and logs locally; redact passwords, session tokens, addresses, usernames and paths before sharing output. Fix a failing staging release before advancing to production.

For an application-only rollback with unchanged, compatible schema, restore the selected project's saved environment and Compose files with root-only permissions, validate Compose, then recreate only that project's API/worker using its recorded previous image. Use the explicit project directory/env/file arguments documented in `docker-operations.md`. Do not overwrite both environments indiscriminately. Strict migration checks mean an older image may refuse a newer schema; confirm compatibility first.

Database changes require a reviewed forward fix or a planned restoration procedure. Never restore a pre-release archive over newer transactions without evaluating data loss. Archive readability is not a full restoration test. Never run `compose down -v`, delete the database volume, or reset the native database as a rollback step.

## Verification status and next work

Verified locally for this ticket: TypeScript type checking; 119 unit tests; 34 isolated PostgreSQL integration tests, including idle disconnect recovery, live-versus-ready gating, role validation, request draining and committed in-flight transaction survival; and 40 infrastructure tests, including real Compose validation, scoped updates, secret mounts and resource/network assertions.

Verified from the operator's successful deployment and validation output on 2026-10-11: the pinned-base image built; staging and production deployed successfully; restricted database/cache access and unauthorized game-state rejection passed; existing database/cache containers and durable worker receipts were retained. Both environments passed actual PostgreSQL and cache outage/reconnection drills without restarting their API or worker processes, plus clean API SIGTERM shutdown and recovery. The other environment and unrelated Docker workloads remained running without unexpected restarts; native database, game and virtualization services remained active. The run ended with `Backend reconnection and graceful shutdown acceptance passed`.

Independently checked afterward: native, production and staging readiness endpoints returned HTTP 200; both container environments reported database and cache ready. No raw host identifiers or credentials are included in this report.

Verified from the operator's successful after-reboot output on 2026-10-11: an actual host reboot occurred after acceptance; both projects retained their containers and database volumes; HTTP health, restricted runtime permissions, authenticated cache connectivity and unauthorized-mutation rejection passed again. Cache/worker resource limits, private-network isolation and separate credentials remained intact. Durable worker effects and execution receipts survived exactly once, with completed tasks remaining terminal. Native game, database and virtualization services remained active. Both `Backend reboot acceptance passed` and `Cache and worker reboot acceptance passed` were reported. INFRA-006 and INFRA-007 initial and reboot acceptance are now verified. Native-data cutover, full backup restoration, no-login/logout observations and firmware recovery remain separate checks; this verification did not change their status.

Recommended next ticket: scheduled PostgreSQL backups with encrypted off-machine copies, retention, failure alerts and a full isolated restore drill covering migrations, job receipts and authoritative game data. Then plan native-data cutover and authenticated TLS ingress before exposing the container game beyond the host. WAN/router behavior, public TLS and Internet accessibility are not established by this ticket.

For the scheduler extension and migration 029, use [scheduling.md](scheduling.md). Its dedicated deployment command updates the API/worker/scheduler together and deliberately leaves actual gameplay policies unconfigured.
