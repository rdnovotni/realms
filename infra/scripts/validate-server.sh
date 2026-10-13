#!/usr/bin/env bash
# Read-only validation. Nonzero exit means one or more acceptance checks remain open.
set -uo pipefail
export LC_ALL=C SYSTEMD_PAGER=cat SYSTEMD_COLORS=0
failed=0
check() {
  local name=$1; shift
  printf '\n-- %s --\n' "$name"
  if timeout 20s "$@"; then printf 'PASS\n'
  else printf 'FAIL / UNKNOWN\n'; ((failed+=1)); fi
}
check 'Time synchronization' bash -c 'test "$(timedatectl show -p NTPSynchronized --value)" = yes'
check 'Timezone America/Chicago' bash -c 'test "$(timedatectl show -p Timezone --value)" = America/Chicago'
for unit in chrony.service NetworkManager.service glances.service libvirtd.service rsyslog.service logrotate.timer apt-daily.timer apt-daily-upgrade.timer; do
  check "$unit active" systemctl is-active "$unit"
  check "$unit enabled at boot" systemctl is-enabled "$unit"
done
for target in sleep.target suspend.target hibernate.target hybrid-sleep.target suspend-then-hibernate.target; do
  check "$target masked" bash -c 'test "$(systemctl show "$1" -p LoadState --value)" = masked' _ "$target"
done
check 'Automatic reboot explicitly disabled' bash -c 'apt-config dump | grep -Fx '\''Unattended-Upgrade::Automatic-Reboot "false";'\'' && apt-config dump | grep -Fx '\''Unattended-Upgrade::Automatic-Reboot-WithUsers "false";'\'''
check 'Journald profile installed' bash -c 'grep -Fx "SystemMaxUse=1G" /etc/systemd/journald.conf.d/90-kol-server.conf && grep -Fx "MaxRetentionSec=14day" /etc/systemd/journald.conf.d/90-kol-server.conf'
check 'No failed units' bash -c 'failed_units=$(systemctl --failed --no-legend --plain --no-pager) || exit 1; test -z "$failed_units"'
# Explicit units supplied by the operator, once runtime/data location is established.
for unit in "$@"; do
  if [[ ! "$unit" =~ ^[a-zA-Z0-9_.@-]+\.service$ ]]; then
    printf 'Invalid service name\n' >&2; exit 2
  fi
  check "$unit active" systemctl is-active "$unit"
  check "$unit enabled at boot" systemctl is-enabled "$unit"
done
printf '\nManual checks still required: no-login boot, logout survival, application health, database data, local console recovery, effective journal policy and firmware recovery.\n'
printf 'Failed/unknown automated checks: %s\n' "$failed"
((failed == 0))
