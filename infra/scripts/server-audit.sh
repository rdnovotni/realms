#!/usr/bin/env bash
# INFRA-001: observational queries only. Output is PRIVATE, not commit-safe.
# Usage: bash server-audit.sh [--privileged] [--project-root /absolute/path ...]
# --privileged must be run with sudo on the actual server; never invokes sudo itself.
set -uo pipefail
export LC_ALL=C SYSTEMD_PAGER=cat SYSTEMD_COLORS=0
privileged=0
project_roots=()
while (($#)); do
  case "$1" in
    --privileged) privileged=1; shift ;;
    --project-root)
      if (($# < 2)) || [[ "$2" != /* || ! -d "$2" ]]; then
        printf 'Expected an existing absolute project directory.\n' >&2; exit 2
      fi
      project_roots+=("$2"); shift 2 ;;
    --help) printf 'Usage: bash server-audit.sh [--privileged] [--project-root /absolute/path ...]\nPrivate stdout; no host configuration changes.\n'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done
if ((privileged && EUID != 0)); then
  printf '%s\n' '--privileged requires root on the actual server.' >&2; exit 2
fi
if ((${#project_roots[@]} == 0)); then
  project_roots+=("$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)")
fi
ok=0; unknown=0
section() { printf '\n## %s\n' "$1"; }
query() {
  local label=$1 rc
  shift
  printf '\n-- %s --\n' "$label"
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'UNKNOWN: tool unavailable: %s\n' "$1"; ((unknown+=1)); return 0
  fi
  # Prevent an inaccessible bus, device, or command from hanging the inventory.
  if command -v timeout >/dev/null 2>&1; then timeout 20s "$@" 2>&1; rc=$?
  else "$@" 2>&1; rc=$?; fi
  if ((rc == 0)); then ((ok+=1))
  else printf 'UNKNOWN/PARTIAL: query exit=%s (may also indicate an inactive/absent unit or health warning).\n' "$rc"; ((unknown+=1)); fi
  return 0
}
section 'Scope and provenance'
printf 'PRIVATE RAW INVENTORY: review and redact before sharing. No automatic sanitization.\n'
printf 'Root mode: %s; project search limited to explicitly listed roots plus /opt and /srv.\n' "$privileged"
query 'UTC capture time' date -u +%FT%TZ
query 'OS release' cat /etc/os-release
query 'Kernel and architecture (no hostname)' uname -srmo
query 'Execution PID 1' cat /proc/1/comm
query 'Virtualization / container boundary' systemd-detect-virt
query 'System state' systemctl is-system-running
section 'CPU, memory and load'
query 'CPU topology and VM capabilities' lscpu
query 'RAM in bytes' free -b
query 'Swap devices/files' swapon --show --bytes
query 'Uptime seconds' cat /proc/uptime
query 'Load averages' cat /proc/loadavg
query 'KVM device access' ls -l /dev/kvm
if ((privileged)); then query 'Physical memory inventory (includes identifiers; private)' dmidecode --type memory; fi
section 'Storage'
query 'Block devices: no UUIDs or serials requested' lsblk -e 7 -o NAME,TYPE,SIZE,ROTA,TRAN,FSTYPE,MOUNTPOINTS
query 'Mounted filesystems and capacity' df -hT
query 'Inode capacity' df -hi
query 'Filesystem topology and mount options' findmnt -o TARGET,SOURCE,FSTYPE,OPTIONS
if ((privileged)); then
  if command -v lsblk >/dev/null && command -v smartctl >/dev/null; then
    while read -r device kind; do
      [[ "$kind" == disk && "$device" == /dev/* && -b "$device" ]] || continue
      # Read health only: never starts a SMART self-test or changes drive settings.
      query "SMART information $device (includes identifiers; private)" smartctl -n standby -a "$device"
    done < <(lsblk -dnpo NAME,TYPE)
  else printf 'UNKNOWN: SMART utility unavailable; do not install during this ticket.\n'; ((unknown+=1)); fi
else printf 'UNKNOWN: disk health requires optional privileged capture.\n'; ((unknown+=1)); fi
section 'Packages and project footprints'
query 'Installed package inventory' dpkg-query -W '-f=${binary:Package}\t${Version}\t${db:Status-Status}\n'
# Avoid snap queries: contacting snapd can socket-activate it.
query 'Snap on-disk package names (daemon not contacted)' ls /var/lib/snapd/snaps
query 'Process names only; no command-line secrets' ps -eo comm
for root in "${project_roots[@]}" /opt /srv; do
  [[ -d "$root" ]] || continue
  query "Project markers under $root (depth <= 5; no file contents)" find "$root" -maxdepth 5 \
    \( -name node_modules -o -name .git -o -name .env -o -name .state -o -name .local -o -name .venv \) -prune -o \
    \( -name package.json -o -name pyproject.toml -o -name requirements.txt -o -name Cargo.toml -o -name go.mod -o -name compose.yml -o -name compose.yaml -o -name docker-compose.yml -o -name AGENTS.md \) -print
  query "Project disk usage $root" du -sh -- "$root"
done
section 'Services and listeners'
query 'Running system services' systemctl list-units --type=service --state=running --no-pager --plain
query 'Enabled and disabled service units' systemctl list-unit-files --type=service --no-pager
query 'Failed system units' systemctl --failed --no-pager
query 'Listening TCP and UDP endpoints; no process arguments' ss -lntu
query 'Listening Unix sockets' ss -lx
query 'Scheduled timers' systemctl list-timers --all --no-pager
section 'Networking (private addresses; redact before sharing)'
query 'Link state and wired interfaces' ip -brief link
query 'Addresses' ip -brief address
query 'IPv4 routing' ip -4 route
query 'IPv6 routing' ip -6 route
query 'DNS state' resolvectl status
query 'NetworkManager device status' nmcli -t -f DEVICE,TYPE,STATE device status
for nic in /sys/class/net/*; do
  [[ -e "$nic" ]] || continue
  for field in operstate carrier speed; do
    [[ -r "$nic/$field" ]] && query "${nic##*/} $field" cat "$nic/$field"
  done
  [[ -d "$nic/wireless" ]] && printf 'Wireless interface present: %s\n' "${nic##*/}"
done
section 'SSH and Docker (no daemon activation)'
query 'SSH units, including socket activation' systemctl show ssh.service ssh.socket -p LoadState -p ActiveState -p UnitFileState
query 'SSH client version' ssh -V
if ((privileged)); then
  query 'Effective SSH daemon configuration; default connection context only' /usr/sbin/sshd -T
else printf 'UNKNOWN: effective sshd settings require privileged capture; Match rules need connection-specific review.\n'; ((unknown+=1)); fi
query 'Docker client version only' docker --version
query 'Container daemon unit state' systemctl show docker.service docker.socket containerd.service -p LoadState -p ActiveState -p UnitFileState
query 'System Docker socket metadata; not contacted' ls -l /run/docker.sock
query 'Rootless/user service unit files' systemctl --user list-unit-files --type=service --no-pager
# Never run docker info/ps/inspect: these can activate a stopped socket-backed daemon.
printf 'UNKNOWN: container inventory deliberately not queried; daemon queries could activate a stopped service.\n'
((unknown+=1))
section 'Firewall'
if ((privileged)); then
  query 'UFW status and policy' ufw status verbose
  query 'nftables rules' nft list ruleset
  query 'IPv4 iptables rules' iptables-save
  query 'IPv6 iptables rules' ip6tables-save
else printf 'UNKNOWN: firewall rules require optional privileged capture.\n'; ((unknown+=1)); fi
section 'Power, session independence and update policy'
query 'System boot target' systemctl get-default
query 'Sleep target state' systemctl show sleep.target suspend.target hibernate.target hybrid-sleep.target -p LoadState -p ActiveState -p UnitFileState
query 'Effective login policy including drop-ins' systemd-analyze cat-config systemd/logind.conf
query 'Effective sleep policy including drop-ins' systemd-analyze cat-config systemd/sleep.conf
query 'User linger status' loginctl show-user "${SUDO_USER:-$(id -un)}" -p Linger -p State
if ((EUID != 0)); then
  query 'GNOME idle AC suspend behavior' gsettings get org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type
  query 'GNOME idle AC timeout' gsettings get org.gnome.settings-daemon.plugins.power sleep-inactive-ac-timeout
fi
query 'Effective APT periodic and unattended policy' apt-config dump
query 'Automatic update service/timer state' systemctl show apt-daily.timer apt-daily-upgrade.timer unattended-upgrades.service -p LoadState -p ActiveState -p UnitFileState
query 'Reboot required marker (missing means no marker visible)' ls /var/run/reboot-required
section 'Collection result'
printf 'Successful queries: %s; unavailable/partial queries: %s.\n' "$ok" "$unknown"
printf 'Collection completed. Exit 0 means the collector finished, not that all checks passed.\n'
printf 'UNKNOWN: BIOS AC recovery, UPS, thermals under sustained load, actual no-login boot, ISP restrictions, upload performance, public NAT/CGNAT, IPv6 reachability, router rules, external backups and restore success.\n'
