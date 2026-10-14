# INFRA-001 — Hardware and configuration inventory

[Operations map](README.md) · [Current source status](../../realms/docs/implementation-status.md) · [Branding compatibility](../../realms/docs/branding-and-pages.md)

Audit date: 2026-10-10 (America/Chicago). Execution: read-only. Ubuntu remains installed; no package, service, SSH, network, firewall, disk-layout or power configuration was changed. Only ticket artifacts and private audit captures were written.

## Evidence and limitations

The initial Codex execution environment is a sandbox: PID 1 is `codex`, virtualization detection says `container-other`, host systemd/netlink operations are denied, and the visible process list is incomplete. An empty sandbox socket list does **not** mean the host has no listeners. Read-only execution outside the sandbox subsequently reached the host systemd manager and network namespace. Findings below distinguish host observations, filesystem evidence and unresolved checks. This is a snapshot, not a reliability or performance test.

No `AGENTS.md` was found in the workspace, project subtree, accessible parent chain, Documents tree or Sources tree. No additional repository instructions were available. The workspace Git status already contained an untracked `realms/` directory and numerous preview images; they were left untouched. No commit was created. Personal paths, usernames, IP addresses, MAC addresses, machine IDs, serials, hostnames and credentials are omitted from this report. Raw captures are outside the repository and must not be committed.

## Hardware and storage

| Item | Observation | Evidence / qualification |
| --- | --- | --- |
| OS | Ubuntu 26.04.1 LTS, Resolute Raccoon | `/etc/os-release`; local installation evidence |
| Kernel / architecture | Linux 7.0.0-38-generic; x86_64 | `uname -srmo` |
| CPU | Intel Core i5-4440 @ 3.10 GHz; maximum reported 3.30 GHz | `lscpu` |
| Topology | 1 socket, 4 physical cores, 4 logical CPUs; 1 thread/core | `lscpu` |
| Virtualization | VT-x/VMX and EPT advertised | CPU capability; host `/dev/kvm` exists, but account access and successful VM execution not tested |
| RAM | 15,719,448 KiB = about 14.99 GiB usable | `/proc/meminfo`; consistent with nominal 16 GB installed, DIMM layout not verified |
| Memory headroom | About 6.3 GiB available at initial capture | Dynamic snapshot; not a reservation or idle baseline |
| Swap | 4 GiB swap file; about 139 MiB used | `swapon --show`; do not disable or resize in this ticket |
| Main device | One visible 465.8 GiB SATA disk, rotational flag 1 | `lsblk`: consistent with a nominal 500 GB HDD; exact model and health unknown |
| EFI partition | About 1 GiB, FAT/vfat, mounted at `/boot/efi` | `lsblk`, `df` |
| Root partition | About 464.7 GiB, ext4 | Single root partition; no separate data partition observed |
| Root capacity | About 457 GiB filesystem, 29 GiB used, 405 GiB available, 7% utilization | `df -hT`; GiB rounding and reserved blocks explain differences |
| Other devices | SATA optical device; no NVMe or additional data disk visible | Namespace-visible inventory; no RAID/LVM device shown |
| Disk health | Unverified | SMART utility not visible in sandbox; no self-test was started |
| Uptime / load | About 3.29 days; load approximately 2.21 / 1.87 / 1.61 | Initial `/proc` snapshot; does not prove unattended uptime |

## Network and exposed endpoints

Host `ip` queries show a physical Ethernet interface up, enslaved to a bridge with a private IPv4 address and global IPv6 addresses. Sysfs reports carrier present and 1000 Mb/s link speed. IPv4 default routing uses DHCP through the bridge. A separate libvirt bridge exists but has no active carrier. Exact addresses and prefixes are redacted. DHCP reservation, router rules, external reachability and IPv6 firewall policy need verification; global IPv6 does not establish inbound access.

Host `ss -lntu` snapshot:

| Scope | TCP ports | Interpretation |
| --- | --- | --- |
| Loopback | 3000, 3010, 55432 | Host process metadata attributes 55432 to PostgreSQL and 3000/3010 to Node-style MainThread processes; exact application identity not probed |
| Loopback | 53, 631, several high ports | Consistent with local DNS, printing and desktop/development tooling; high-port attribution pending |
| All IPv4 interfaces | 61208 | Glances service is active; process attribution and authentication still need checking |
| Libvirt bridge | 53 | Virtual-network DNS; UDP 53/67 also observed |

UDP listeners also include mDNS 5353, WS-discovery 3702, loopback NTP 323, IPv6 DHCP-client 546 and dynamic ports. No TCP 22 listener was observed. Listener scope is evidence of binding, **not** proof that the firewall/router permits remote access. No scan of other machines or Internet reachability probe was performed.

## Services, packages, SSH and Docker

Host systemd reports `running`, with 39 running system services in the initial host snapshot. The observed set includes:

- Desktop/power: GDM, accounts-daemon, colord, geoclue, rtkit, switcheroo-control, power-profiles-daemon, upower, thermald.
- Networking/time: NetworkManager, networkd-dispatcher, ModemManager, wpa_supplicant, systemd-resolved, Avahi, chrony.
- Virtualization: libvirtd, virtlockd, virtlogd, systemd-machined.
- Monitoring/printing: Glances, CUPS, cups-browsed.
- System/update: cron, dbus, polkit, rsyslog, fwupd, snapd, Canonical Livepatch, unattended-upgrades, whoopsie, udisks2, uuidd and systemd journal/logind/udev/oomd/user manager.

Package database evidence: OpenSSH client 10.2p1, UFW 0.36.2, nftables 1.1.6, iptables 1.8.11, NetworkManager 1.54.3, unattended-upgrades 2.12, libvirt 12.0.0 and QEMU 10.2.1 families are installed. Versions are a snapshot, not a vulnerability assessment. A full package inventory is emitted only to private audit output.

`openssh-server` is marked not installed in the visible package database; `/usr/sbin/sshd` and SSH daemon configuration were not visible. Host capture reports `ssh.service` and `ssh.socket` as `not-found`; no port 22 listener was observed. Effective SSH authentication policy and alternative/custom SSH daemons remain unverified. The separate administration laptop's actual access method is unknown.

Docker CLI is absent from the sandbox PATH and no Docker/containerd package family was found in the visible package inventory. No Docker service appears among the running host services. Host capture additionally confirms no Docker CLI on PATH, no `/run/docker.sock`, and Docker/containerd units `not-found`. No Docker user service was listed for the current user. Custom binaries, other users and Snap/container inventory were not exhaustively checked. The audit deliberately does not contact the Docker or Snap daemon: a socket request could start a stopped daemon.

UFW/nftables packages being installed does **not** establish firewall activation. The initial outside-sandbox UFW query required root, and subsequent `sudo -n` attempts required interactive authentication. Firewall rules and default policies remain unknown pending user-run privileged output. Host `systemctl --failed` reported zero failed units.

## Existing projects and operational state

The accessible workspace contains `realms/`, a private TypeScript/Fastify/PostgreSQL Follybound project, client assets, migrations, tests and preview artifacts. Another application directory exists under `/opt`; its private name and purpose are not recorded here. `/srv` appeared empty. The audit is not a complete inventory of other users' homes, VMs, containers or remote mounts.

Repository evidence from `realms/README.md`, `package.json`, `scripts/server.sh` and `scripts/database.sh`:

- Package requires Node >=22 and <25; README describes a local Node 24 / PostgreSQL 18 bootstrap.
- Intended application binding is loopback port 3000; local PostgreSQL binding is loopback port 55432.
- Start script starts/provisions the database, runs migrations/seed/build, then backgrounds the HTTP process with `setsid`. It is not an installed boot-managed service.
- `.env`, runtime credentials, database state, logs and backups are excluded by the project's `.gitignore`. Their contents were not read.
- README states neither application nor database starts automatically after reboot and backups remain on the machine. These are documented limitations, not a tested reboot/restore result.
- Both sandbox and outside-sandbox filesystem checks at this workspace path lacked `.local/`, `.state/postgres` and `.state/backups`; the sandbox exposed only a preview log in `.state/`. Host PostgreSQL/application listeners indicate processes are running, but their runtime/data location and relationship to this checkout remain unresolved. Do not run the installer or recreate a database until those locations are identified.

## Unattended operation and unresolved information

Host `apt-config dump` confirms daily package-list refresh and unattended upgrades. The host APT daily and daily-upgrade timers are active/enabled, and unattended-upgrades is active/enabled. Upgrade failures, explicit automatic reboot policy and package freshness remain unverified. No reboot-required marker was present at capture; this is not proof that no reboot or update is needed. No `apt update` or upgrade was run.

Host boot target is `graphical.target`. Host merged logind/sleep configuration showed commented defaults and no observed disabling override. Sleep/suspend/hibernate targets are loaded, inactive and static (not masked). Current user has `Linger=no`; that affects user services, not system service startup. The current user’s GNOME AC idle-suspend action is `nothing`, a favorable setting for the current desktop session; it does not establish behavior before login or for other users. Firmware AC-recovery, UPS, temperature under sustained load, no-login service startup and logout survival remain unverified. No reboot, logout, suspend, stress test or disk self-test was performed.

Outside-machine unknowns: ISP hosting restrictions, upload bandwidth, latency/loss, public IPv4 versus CGNAT/double NAT, router inbound rules, IPv6 inbound filtering, DNS control, independent backup destination and recovery success. Confirm by the follow-up procedure in `server-readiness.md`.
