# INFRA-004: Docker and multiple projects

[Operations map](README.md) · [Current source status](../../realms/docs/implementation-status.md) · [Branding compatibility](../../realms/docs/branding-and-pages.md)

## Current evidence and limits

No applicable `AGENTS.md` was found in the repository or its inspected parent directories.

Read-only host inspection found Ubuntu 26.04.1 LTS (amd64), about 15 GiB usable RAM, 4 GiB swap (unused), and approximately 405 GiB available on the single SATA HDD. Before installation, Docker, Compose, containerd, and Podman were absent. Docker/containerd service units and runtime data directories were absent. The operator subsequently installed Docker Engine 29.9.0, Compose 5.6.0, and containerd 2.4.1 from the official package source; Engine and containerd were active and boot-enabled in the supplied output. The native game, native PostgreSQL, and libvirt services were active and enabled. The game and database use loopback ports 3000 and 55432. Wired networking uses an existing bridge; preserve it and the virtual-machine network. UFW was reported inactive by the operator. Glances has a non-loopback listener on port 61208; this ticket does not change it.

Verified during implementation: official Compose configuration validation for five distinct projects, infrastructure regression tests, application TypeScript checking, all 118 application unit tests including checks of the container-only listener option, secret preservation, explicit schema preparation, and volume-preserving lifecycle commands. The standalone Compose validator was downloaded into `/tmp` and its official release SHA256 checked; this did not install Engine or change host configuration.

**Operator-verified initial Engine acceptance passed:** both test projects were healthy through their actual localhost publications; memory caps and restart policies matched; their four private/frontend network IDs and two volumes were distinct; project marker data remained intact after restarting test A; test B retained its container identity and startup time and remained available. Host non-loopback address connection probes failed as intended. An independent bridge probe passed its host-gateway positive control and could not reach either fixture's internal-network IP or its LAN-address published port. Native game, native PostgreSQL, and libvirt service states remained active, and native game readiness returned success. These results come from the operator-supplied full validator output, not an independently privileged audit by the agent. The successful run saved a private reboot baseline and left the fixtures running.

The initial internal-only HTTP templates had failed localhost publication. Corrected templates attach HTTP services to separate per-project frontend bridges while backend networks remain internal. The managed refresh preserved credentials and volumes, and the corrected full live validation passed. Configured port bindings are now checked against actual programmed Engine mappings as well as connection probes.

**Post-reboot Engine acceptance independently verified:** after the operator restarted Ubuntu, the agent ran the full `validate-docker.py --after-reboot` check using Ubuntu graphical administrator authentication. The kernel boot ID changed; Docker/containerd were active and enabled; the same fixture container IDs, network IDs, volumes, and marker data recovered. Localhost HTTP, non-loopback negative probes, and the independent-bridge positive/negative probes passed again. Native game readiness and native PostgreSQL/libvirt service states passed. Startup timestamps placed Docker at approximately 70 seconds, PostgreSQL at 73 seconds, and the game at 85 seconds after boot, before the user's desktop-session manager at 171 seconds. No fixture start/recreation operation was used during reboot acceptance.

The broader server validator passed time synchronization, timezone, power masks, update reboot policy, configured logging limits, and all explicitly checked service activity/boot enablement, but its no-failed-units check failed for `ssh.service`. Boot journal evidence showed sshd could not bind its configured LAN address because the address was unavailable at that time. The installed unit orders after `network.target` rather than `network-online.target`, has no address-readiness check, and prevents retries for exit status 255. SSH configuration or restart behavior was not modified in this validation. Recommend a focused follow-up to make LAN-bound SSH wait/retry safely without broadening its listening addresses, if SSH is to remain enabled. Desktop administration and the game/database services remain available; remote SSH recovery is not verified.

**Still pending:** KoL container image builds and empty staging-stack initialization, and manual VM/game/database functional checks beyond readiness and service state. Production/staging definitions are staged; the live native database has not been moved. ISP/NAT behavior, external-device/Internet IPv6 reachability, firmware power recovery, and UPS behavior remain unknown.

## Install and stage

Run from the repository's `infra` directory. Review the plan first:

```bash
bash scripts/install-docker.sh plan
sudo bash scripts/install-docker.sh apply
sudo python3 scripts/docker-projects.py init
sudo python3 scripts/validate-docker.py
```

The installer uses the [official Docker Ubuntu apt repository](https://docs.docker.com/engine/install/ubuntu/), stable channel, and its apt signing key over HTTPS. It installs Engine, CLI, bundled containerd, Buildx, and the Compose plugin with `apt-get --no-remove`. It refuses existing runtime packages, data, sockets, daemon configuration, or Docker apt sources instead of removing them. An existing working local Engine with Compose can use `install-docker.sh adopt`: it checks the local socket and enables boot startup without restarting or replacing daemon configuration. Missing Compose on an existing installation requires inspecting its original package source before adding a matching plugin; adoption intentionally stops in that case.

Fresh installation chooses an IPv4 address pool that does not overlap current route/address data, bounds daemon logs, enables live restore, and preserves the existing forwarding policy with `ip-forward-no-drop`. Docker still creates isolation and NAT rules and may enable IP forwarding. This is an explicit host networking effect of Engine installation. The installer does not edit NetworkManager, the LAN bridge, libvirt configuration, UFW rules, or user group membership. It records private before/after service states, route/address data, firewall rules, forwarding settings, and generated daemon settings under `/var/lib/kol-docker-install.*`. A changed native service state causes failure, not a success report. `NEEDRESTART_MODE=l` requests reporting rather than restarting other services during package installation.

Check VM guest reachability, desktop networking, native game behavior, and existing database data immediately afterward. Active service state alone does not establish those workloads work correctly.

## Repair the initial internal-only HTTP templates

If the first validation stopped with localhost `Connection refused` while both fixtures were internally healthy, do not reinstall Docker. Run from `infra`:

```bash
sudo python3 scripts/docker-projects.py refresh-templates &&
sudo python3 scripts/validate-docker.py
```

The refresh checks all installed Compose files against the known original template hashes before changing anything. It refuses customized configurations, backs up each replaced Compose file, validates the new definition, and preserves `.env`, credentials, volumes, and containers. It does not restart services. The subsequent validator recreates only the two fixture containers to attach their new frontend networks, reseeds their markers, and reruns real packet checks. Production/staging are staged only. Repeat reboot acceptance only after initial acceptance passes.

## Project layout and budgets

`/srv/kol-infra/projects/<project>/` contains root-owned `compose.yaml`, a mode-600 `.env`, a private backups directory, and (for KoL) a mode-700 secrets directory. Secrets are random, generated separately per project, and never copied from the live native application. Individual secret files are read-only and readable inside their assigned containers; their host parent directory is root-only. Compose's local file-backed secrets do not implement uid/gid remapping. Backups are mode 600. Do not commit `/srv` configuration, secret files, resolved environment output, or raw installation records.

| Project | HTTP on this computer | Memory caps | Runtime identity |
| --- | --- | --- | --- |
| `kol-production` | `127.0.0.1:13000` | PostgreSQL 1 GiB + API 512 MiB | API 10001:10001 |
| `kol-staging` | `127.0.0.1:13001` | PostgreSQL 512 MiB + API 256 MiB | API 10002:10002 |
| `infra-test-a` | `127.0.0.1:18081` | 96 MiB | 65534:65534 |
| `infra-test-b` | `127.0.0.1:18082` | 96 MiB | 65534:65534 |
| `example-project` | `127.0.0.1:18090` | 96 MiB | 65534:65534 |

All projects are staged without starting containers. The validator starts only the two acceptance fixtures. KoL setup jobs temporarily have a 512 MiB cap. Set aside at least 4 GiB for Ubuntu/desktop and additional measured capacity for the existing VM and native game. Start with 512 MiB for one unrelated workload and 256 MiB for future monitoring, then measure RSS, OOM events, CPU, and HDD I/O before expansion. Caps are limits, not preallocated RAM. Production and staging each cap DB CPU at one core and API at one core; setup and fixtures use smaller CPU caps. All share one disk and kernel, so these limits do not provide complete failure isolation.

Each Compose project has a unique internal backend bridge, a separate frontend bridge for HTTP publication, and a named volume, all prefixed by its project name. No shared `container_name`, external networks, host networking, host devices, Docker socket mounts, or shared DB volumes are used. Database and setup containers attach only to the internal network, preventing outbound network access. HTTP containers attach to both networks and can initiate outbound connections through their frontend bridge; localhost publishing restricts inbound host addresses and does not constitute an outbound firewall. Docker can pull images on the host before starting containers. App containers drop capabilities, disallow new privileges, use read-only root filesystems, and write only to capped tmpfs. PostgreSQL uses the official image bootstrap, which initializes volume ownership as root and runs the database as its image's postgres user; its writable storage is a separate named volume. PostgreSQL 18 uses a volume mounted at `/var/lib/postgresql`, as described by the [official image documentation](https://github.com/docker-library/docs/blob/master/postgres/content.md).

Logs use the local driver with 10 MiB × 3 files per KoL container, 5 MiB × 2 per fixture; compression and transient rotation can affect actual usage. Docker images, build cache, database growth, WAL, dumps, and retained releases need separate monitoring. Do not use global prune commands to reclaim space across unrelated projects.

## Build and start an empty staging stack

This creates a **new empty database**, not a clone of the live game. The production template is also a separate empty stack, not a declaration that this development application is ready for public production use.

```bash
sudo python3 scripts/docker-projects.py build release-001
sudo python3 scripts/docker-projects.py project kol-staging config
sudo python3 scripts/docker-projects.py project kol-staging prepare
sudo python3 scripts/docker-projects.py project kol-staging up
sudo python3 scripts/docker-projects.py project kol-staging status
curl --fail http://127.0.0.1:13001/health/ready
```

`prepare` starts the project DB, explicitly applies migrations, and provisions the restricted application role using administrative secrets in a separate one-shot container. `up`, `start`, and `restart` never run migrations. The API gets only its role password and session throttle key; it never receives the admin password or development bypass token. Native provisioning and container provisioning share the same grant definitions. The application's native bind defaults remain loopback; an explicit container binding flag plus session authentication permits listening on all IPv4 interfaces *inside* the container. Host publishing remains loopback-only.

The image build allowlist excludes local secrets, runtime data, dependencies, and Git metadata. The image uses Node 24 and PostgreSQL 18 image tags. These major-version tags are mutable: record and pin tested registry digests before a release to public users, and rebuild deliberately for security fixes. No automatic image pull/update agent is installed. Do not change a PostgreSQL major image tag against an existing volume; plan a tested upgrade/restore instead.

Accounts/session enrollment and importing native data require a separate application/cutover ticket. Do not mount the native `.state/postgres` directory into a container. A cutover needs a verified full restore on a disposable DB, restricted-role validation, staging application checks, rollback instructions, a maintenance window, and an explicit decision about native services. The existing desktop Server Console continues to manage native services; Docker controls in this ticket use the scoped commands below.

## Operations and deliberate releases

```bash
sudo python3 scripts/docker-projects.py project kol-staging stop
sudo python3 scripts/docker-projects.py project kol-staging start
sudo python3 scripts/docker-projects.py project kol-staging restart
sudo python3 scripts/docker-projects.py project kol-staging logs
sudo python3 scripts/docker-projects.py project kol-staging backup
sudo python3 scripts/docker-projects.py project kol-staging down
```

`stop` retains containers and volumes; an intentionally stopped container stays stopped after daemon reboot under `unless-stopped`. `down` removes only that project's containers and networks and retains its database volume. `up` recreates it. No script exposes `down --volumes`, global prune, or host service shutdown. Operations use a nonblocking administrative lock and the fixed local Unix socket, so an inherited remote Docker context cannot redirect them.

Before updating a running KoL stack, create a dump, test a full restore, build a new versioned image, and edit only that project's root-owned `.env` `KOL_IMAGE` setting. Validate config, stop its API, explicitly run `prepare` if forward migrations are required, and then `up`. A failed migration or unhealthy release is a failed deployment; inspect logs locally. No destructive automatic database rollback is attempted. Code can return to the previous image only if it supports the resulting schema; restore data only through a reviewed recovery procedure. The supplied backup checks archive readability with `pg_restore --list`, which is **not** a full restore test. Retain and copy backups to independent storage; a dump on the same HDD does not protect against disk failure.

## Firewall and privilege boundary

[Docker administrative access grants root-level privileges](https://docs.docker.com/engine/install/linux-postinstall/). These scripts keep commands behind `sudo` and do not add the desktop user to the Docker group or expose an unauthenticated Engine API. Application containers receive no administrative host credentials or Docker socket. Root/Docker administrators can inspect container secrets; Compose secrets are not an encryption-at-rest service.

[Docker port publishing](https://docs.docker.com/engine/network/port-publishing/) binds all host addresses when an explicit host IP is omitted. Every supplied HTTP publication specifies `127.0.0.1`; databases and setup containers have no published ports. [Docker traffic can bypass UFW filtering](https://docs.docker.com/engine/network/packet-filtering-firewalls/). Enabling UFW later is not sufficient evidence of container port isolation. Do not disable Docker's iptables/ip6tables rules or enable direct routing while relying on this profile. A future public reverse proxy should be the only deliberately exposed entry point, with its own tested firewall/TLS policy.

The acceptance script verifies Engine/Compose, boot enablement, real HTTP responses, per-project marker data, memory/restart settings, separate network/volume IDs, internal backend and separate frontend network settings, configured and actually programmed localhost port bindings, and failed connections through the host's LAN/global addresses. It probes both fixtures' published ports and internal-network container IPs from a third independent Docker bridge. A temporary listener on that bridge's host-only gateway is a positive control proving the probe can reach the host; no LAN listener is created. The probe network and helper containers are removed afterward. IPv6 host-address probes run where global IPv6 exists; the independent bridge probe uses IPv4. These are actual on-host packet tests, but not a substitute for a probe from a separate physical LAN device or the Internet. Do not claim external IPv6/ISP filtering was tested. The script checks native service states and native game readiness after its tests; VM guest health and database data require manual verification.

## Reboot acceptance and cleanup

After initial validation passes, save work and choose a maintenance window using the desktop's normal Restart menu. Leave the desktop session logged out for at least two minutes after startup, then log in and run:

```bash
sudo python3 scripts/validate-docker.py --after-reboot
sudo bash scripts/validate-server.sh kol-postgresql.service kol-realms.service
```

The reboot validator does not start fixtures: it requires a changed kernel boot ID and checks that the same containers, networks, volume contents, Engine, and native services recovered. The private boot baseline is stored under `/var/lib/kol-infra/infra-004/`. Check actual VM and game behavior. Docker service startup timestamps can be inspected with `systemctl show docker.service -p ActiveEnterTimestampMonotonic`; compare with the user's login time to verify startup before graphical login.

After acceptance, remove fixture containers/networks while retaining their tiny volumes:

```bash
sudo python3 scripts/docker-projects.py project infra-test-a down
sudo python3 scripts/docker-projects.py project infra-test-b down
```

The reboot validator will then fail until the initial fixture acceptance is repeated, by design. Do not paste full `docker inspect`, unfiltered logs, `.env`, secret files, backups, or raw installer snapshots into chat. Share PASS/FAIL lines and sanitized error messages; remove user names, host names, addresses, paths, tokens, and credential-bearing connection strings.

## Adding another project and recovery

Use [the reusable template](../templates/README.md). Choose a unique project name and localhost port, project-local env/secrets, separate named volumes and internal networks, a non-root runtime identity compatible with the image, memory/CPU/PID limits, health checks, capped logs, and `unless-stopped`. Keep port 3000 and 55432 reserved for the native game/DB. The fixed helper intentionally accepts only supplied project names; extend its reviewed `PROJECTS` registry or use a fully qualified Compose invocation for a new project.

For per-project rollback, stop that project's containers and restore its previous Compose/image configuration; preserve volumes. Never remove data to solve a startup error. Installation is not a transactional OS rollback: apt may have partially installed packages when network or package operations fail. The installer conservatively refuses a second fresh apply after finding those files. Inspect `/var/lib/kol-docker-install.*`, apt status, and `systemctl status docker` before completing recovery/adoption. Do not blindly delete `/var/lib/docker` or `/var/lib/containerd`. If deliberately retiring Docker after migrating all workloads away, stop each project, back up data, disable Docker/containerd boot startup, and separately review package/source/config removal. Docker shutdown affects every container project; do not use it for routine application maintenance. Snapshots contain prior firewall/forwarding observations, not an automatic whole-host firewall restore: replacing all rules would risk clobbering newer libvirt/network state.

## PostgreSQL follow-up

INFRA-005 extends the KoL template with immutable image references, distinct database names, migration credentials, administrative bootstrap, and database acceptance tooling. Existing legacy deployments should use `scripts/postgresql.py deploy`, which upgrades recognized staged configuration without importing native data, rather than refreshing the new template before its database identity/secret preflight. See [PostgreSQL operations](postgresql-operations.md) for current verified/pending status and authority cutover. The generic `init` now creates the required DB identity and migration secret for new projects.

## Cache and durable worker extension (INFRA-006)

KoL stacks now include independent disposable Valkey instances and PostgreSQL-backed workers in the source templates. Updating a template alone does not deploy them or apply migration 028. Use `sudo python3 scripts/cache-workers.py deploy` from `infra/` for backed-up, ordered migration and acceptance. See [cache and worker operations](cache-worker-operations.md), including failure tests and the separate reboot check.

Backend releases and dependency recovery checks are documented in [backend-deployment.md](backend-deployment.md). Use that staging-first release workflow after INFRA-005/006; it scopes template updates to the two game projects.
