# INFRA-001 — Server readiness and next ticket

As of 2026-10-10 (America/Chicago), the machine has enough visible CPU, RAM and disk capacity for a modest initial KoL 2.0 deployment alongside small projects. It is **not yet verified as a secure, unattended 24/7 server**. No host configuration was changed by this ticket. Ubuntu remains installed.

## Readiness assessment

| Area | Assessment | Evidence / next gate |
| --- | --- | --- |
| CPU / memory / capacity | Suitable for an initial pilot | Four physical cores, about 15 GiB usable RAM, about 405 GiB free; benchmark with representative workload later |
| Storage reliability | Unverified | Single rotational SATA disk, no verified SMART health or independent recovery copy; database/log contention possible |
| Wired networking | Present | Carrier and gigabit speed, bridge addressing and DHCP route; preserve the existing bridge/VM setup |
| Remote administration | Not ready / access method unknown | OpenSSH server package absent in visible database; no TCP 22 listener observed; establish how the laptop currently administers the machine |
| Firewall / IPv6 | Unknown | UFW/nftables installed; rules require root; global IPv6 addresses are present |
| Monitoring exposure | Needs review | Glances active; wildcard IPv4 TCP 61208 listener; confirm owner, authentication and firewall reachability |
| Boot / logout independence | Not verified | Background start script; README says no reboot autostart; current user Linger=no; no boot/logout test performed |
| Power / recovery | Unknown | Current GNOME AC idle action is `nothing`, but sleep targets remain available; firmware recovery, UPS and no-login endurance unknown |
| Updates | Partially verified | Daily APT policy and timers enabled/active, unattended-upgrades active; actual updates and reboot policy need review |
| Docker | No standard installation observed | Host CLI/socket absent and Docker/containerd units not found; deployment need should determine whether Docker is useful |
| Existing workload | Preserve and inventory | Desktop services, libvirt/QEMU, printing, monitoring, application/database listeners and another `/opt` application |
| Public hosting | Deferred | ISP, upload performance, CGNAT/double NAT, IPv6 rules, DNS, authentication and recovery requirements unresolved |

Installed software and listeners do not establish application health, security, external reachability, or automatic startup. The audit made no application/database writes and did not invoke the project's start, build, migration or restore scripts.

## Provisional resource plan

These are starting planning budgets, not configured limits or performance promises. About 6.3 GiB RAM was available during the initial desktop snapshot, so do not allocate the full machine to new services while existing workloads remain active.

| Workload | RAM budget | CPU planning | Storage planning |
| --- | --- | --- | --- |
| Ubuntu and filesystem cache | 4 GiB | Keep capacity available | Existing OS use about 29 GiB; maintain generous free space |
| PostgreSQL | 3 GiB total budget | Up to 1–2 cores during queries | Initial 30 GiB allowance for data/indexes/WAL; measure growth |
| Game API and workers | 2 GiB total | Start with one API process and limited worker concurrency | 10 GiB for releases and bounded logs |
| Monitoring | 0.5 GiB | Small collection load | 5 GiB with short retention |
| Other small projects | 2 GiB total | Share remaining capacity; limit concurrent builds | 30 GiB initially |
| Unassigned RAM | About 3.5 GiB | Burst and recovery headroom | Keep at least 20% of root filesystem free |

The RAM budget totals about 11.5 GiB plus 3.5 GiB reserve. On a shared host, start PostgreSQL `shared_buffers` around 512 MiB–1 GiB inside its 3 GiB budget, with a small connection pool (for example 10–20 connections) and conservative per-operation `work_mem` (for example 4 MiB). Benchmark before tuning; parallel workers and concurrent sorts can multiply memory use. PostgreSQL's 25% starting guidance concerns a dedicated database server, so it should not be applied blindly to all RAM on this mixed-use host. See the [PostgreSQL resource documentation](https://www.postgresql.org/docs/current/runtime-config-resource.html).

Retain existing swap as emergency headroom; sustained swapping would indicate excessive allocation. Avoid simultaneous heavy builds, database backups and bulk VM disk activity on the single HDD. Plan an independent backup destination before using significant local space for duplicate backups. No partitioning or hardware purchase is required by this assessment.

## Recommended next implementation ticket

**INFRA-002 — Establish secure laptop administration and a verified unattended baseline.** Priority P0. Depend on this report and completion of the privileged evidence below; scope is LAN administration first.

1. Confirm that this is the intended server and identify the laptop's current administration path. Capture root firewall, disk health, effective power policy and SSH evidence. Attribute the monitoring listener and preserve existing VMs/projects.
2. Design then implement key-based SSH access for the intended administration account, subject to verified current configuration. Verify a second laptop session before tightening authentication. Keep the current access path available during the change and document recovery from local console.
3. Define explicit IPv4 **and IPv6** LAN administration policy and review Glances reachability/authentication. Confirm real client access before applying restrictive firewall policy. Do not assume NAT protects IPv6. Do not expose game/database services publicly in this ticket.
4. Establish an explicit no-suspend-on-AC policy appropriate to the host, preserving Ubuntu. Record firmware AC-power recovery and UPS status. Schedule any necessary reboot test with the user; reboot is outside INFRA-001.
5. Locate and reconcile the running application/database binaries and data directories first: the documented runtime/data paths are absent from this checkout despite live listeners. Then define boot-managed service ownership and ordering without replacing or deleting live data. Prefer a system service for the dedicated application account; document working directory, restricted credentials, restart policy, readiness checks and graceful shutdown. Never put migration/build/seed operations into an uncontrolled restart loop. If user services are chosen instead, verify lingering: [systemd loginctl documentation](https://www.freedesktop.org/software/systemd/man/252/loginctl.html) describes its boot/logout behavior.
6. Document rollback for SSH, firewall and power changes. Acceptance: laptop can administer via verified keys; firewall/IPv6 policy is recorded and tested; monitoring exposure is intentional; service/power behavior without an interactive login is demonstrated in an agreed maintenance window; existing projects and data remain available.

Follow with **INFRA-003 — Independent backups and restore verification**, then resource monitoring and deployment hardening. Docker installation should be a separate decision after service ownership and isolation needs are clear. If selected, validate container-published ports against actual firewall behavior; Docker documents that published traffic can bypass UFW's normal filtering path in its [firewall documentation](https://docs.docker.com/engine/network/packet-filtering-firewalls/).

## Complete the missing evidence safely

The collector does not install tools, contact container daemons, start SMART self-tests, refresh package lists, restart services or change configuration. It emits private stdout and records missing commands/permissions as `UNKNOWN/PARTIAL`. Exit 0 means collection completed, not that every check passed. It does not automatically redact output: addresses, filesystem paths, service/project names, package inventory and privileged SMART/DMI identifiers can be sensitive.

Run these commands in a terminal **on the actual Ubuntu server**, from the workspace containing this `infra/` directory. If the laptop cannot connect by an existing trusted method, use the server's local console; do not install SSH for this audit. These commands only create private evidence files; they do not change host configuration.

```bash
# From the workspace directory containing infra/:
umask 077
audit_dir=$(mktemp -d /tmp/infra-001.XXXXXXXX)
bash -n infra/scripts/server-audit.sh
bash infra/scripts/server-audit.sh --project-root "$PWD" \
  > "$audit_dir/user-audit.txt" 2>&1
printf 'Private audit directory: %s\n' "$audit_dir"
```

Then, if you have administrator credentials, run the same collector with its read-only privileged checks:

```bash
sudo bash infra/scripts/server-audit.sh --privileged --project-root "$PWD" \
  > "$audit_dir/root-audit.txt" 2>&1
```

Run both captures in the same terminal so `audit_dir` is preserved. Add repeated `--project-root /absolute/path` arguments for other known project directories if desired. Search is bounded to five levels and does not read `.env`, Git internals, application state or credential files. A default scan is limited to this workspace, `/opt` and `/srv`; other users' projects are unknown unless explicitly included. A read-only `du` of selected roots can be slow and is capped at 20 seconds when `timeout` exists.

For precise listener ownership, root may additionally run:

```bash
sudo ss -lntup > "$audit_dir/listeners-private.txt"
```

These raw files belong outside Git and should remain private. Review them locally with an editor, then supply a sanitized text attachment or paste only the relevant sections. Remove usernames/home paths, hostnames/domains, all actual public/private IPs and MACs, UUIDs/serials, SSH key material/fingerprints, account allowlists and any token/password/connection string. Preserve categories such as `LAN_IP`, `GLOBAL_IPV6`, `LOOPBACK`, port numbers, interface roles, policy/actions, service state, model/capacity and error messages. Replace repeated identifiers consistently so rule relationships remain understandable. Do not paste `.env`, keys, `/etc/shadow`, arbitrary service environment blocks, project logs, full container inspections or NetworkManager/Netplan credentials. This report uses manually selected/redacted evidence; it is not a raw capture.

If tools such as `smartctl` or `dmidecode` are absent, retain that unknown; do not install them during INFRA-001. `smartctl -n standby -a` reads health without initiating a self-test and avoids waking a standby drive; its nonzero status can also mean a health warning. SSH `-T` checks the default effective context; any `Match` rules need a later connection-specific `-C` review using the intended account/client.

To complete external information without changing networking: supply a summary of ISP plan/hosting restrictions, existing router WAN-address category versus LAN category (redacted), double-NAT topology, existing router IPv4/IPv6 inbound policy, and any previously measured upload/latency results. Do not send router credentials or publish exact WAN addresses. New speed tests, outside-network reachability tests, boot/logout testing and firmware changes belong in a separately agreed validation window.

## Validation and acceptance status

- `bash -n infra/scripts/server-audit.sh` passed.
- Unprivileged collector completed with exit 0 in the sandbox: 42 successful queries and 27 partial/unavailable queries. This is intentionally incomplete host evidence.
- Unprivileged collector completed with exit 0 outside the sandbox on the host: 60 successful queries and 9 partial/unavailable queries.
- Initial host systemd, network and listener queries succeeded. Noninteractive privileged firewall queries failed because sudo requires interactive authentication; no credentials were requested or supplied and no rules were changed.
- Reports omit host identifiers and secrets; raw captures were stored outside the repository. No services were started, stopped, restarted, installed or removed.
- Hardware/capacity and key operational risks are identified. **Privileged firewall/health checks and actual unattended operation remain open**, with exact collection commands above. INFRA-001's documentation and collector are delivered; full host verification requires that additional evidence.
