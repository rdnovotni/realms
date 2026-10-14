# INFRA-002 — Rollback

[Operations map](README.md) · [Current source status](../../realms/docs/implementation-status.md) · [Branding compatibility](../../realms/docs/branding-and-pages.md)

Rollback requires root on the real host. Never delete database state or reinstall Ubuntu to undo this ticket. Record every apply snapshot and perform rollbacks in reverse apply order; the latest snapshot restores the state immediately before that apply. Rollback snapshots contain private previous configuration and must stay outside Git.

## Host profile

From the workspace root, substitute the exact snapshot path printed by apply:

```bash
sudo bash infra/scripts/configure-server.sh rollback \
  --snapshot /var/lib/kol-infra/infra-002/snapshot-REPLACE_WITH_ACTUAL_SUFFIX
```

This restores previous configuration files, including original file modes/ownership, prior sleep-target links/absence, timezone, and chrony/APT timer enabled/active states. It reloads systemd and restarts journald to load the restored log policy. Logind is not restarted; restored logind policy takes effect at the next planned boot. The script restores absent files by removing only the profile-created files, and leaves any newly created empty directories harmlessly in place. It does not restore logs already expired after application or undo security packages installed by the normal update schedule. Saved files are restricted to this profile's known configuration paths.

If automatic rollback reports a failure, use the printed snapshot to retry from the local console, inspect errors privately, and do not proceed with target/reboot changes. Existing custom drop-ins outside the profile remain intact and may override restored settings; review merged configuration. Snapshot integrity, root ownership and private permissions are checked, but snapshots are not cryptographically signed. Do not edit them casually.

## Game service handoff

These steps are only for the new units created by this ticket. If units existed before the handoff, restore their saved originals instead of removing them.

1. During a maintenance window, stop API before database: `sudo systemctl disable --now kol-realms.service`, then `sudo systemctl disable --now kol-postgresql.service`.
2. Confirm graceful PostgreSQL shutdown and that the intended ports are unused. Restore any pre-existing unit/entry-point files. For a verified first install, remove only `/etc/systemd/system/kol-realms.service`, `/etc/systemd/system/kol-postgresql.service` and `/usr/local/lib/kol-infra/run-existing-realms.sh`, then `sudo systemctl daemon-reload`.
3. Return to the verified existing runtime as its original non-root owner. Do **not** invoke `scripts/server.sh start` blindly: it also builds, migrates, seeds and provisions. To restore the prior process model without those operations, use its existing runtime wrapper to run `pg_ctl -D "$live_project/.state/postgres" -l "$live_project/.state/postgres.log" -w start`, then run the same API-only command used by `infra/scripts/run-existing-realms.sh api` with `REALMS_PROJECT_DIR` set and detached execution/output directed to the existing private log. Record the returned API PID in the existing `.state/server.pid` so the old stop script can manage it. Verify the health endpoint and data. If paths or state are uncertain, recover under supervision instead of improvising.
4. Leave data, `.env`, `.state/runtime.env`, binaries and backups untouched. Service rollback does not restore lost/corrupt data; use a separately verified backup if data recovery is actually needed.

Example API-only fallback, as the existing owner with `live_project` already verified:

```bash
umask 077
(cd "$live_project" && bash scripts/runtime.sh pg_ctl \
  -D "$live_project/.state/postgres" -l "$live_project/.state/postgres.log" -w start)
setsid env REALMS_PROJECT_DIR="$live_project" \
  bash infra/scripts/run-existing-realms.sh api \
  > "$live_project/.state/server.log" 2>&1 < /dev/null &
printf '%s\n' "$!" > "$live_project/.state/server.pid"
curl --fail --silent --show-error http://127.0.0.1:3000/health/ready
```

Run this from the workspace root; keep the old runtime owner unchanged. Only run after the system units have stopped and ports are free. The API wrapper removes administration/test credentials from inherited environment and does not run migrations.

## Optional boot target and firmware

The host profile never changes the default target. If you separately selected console-first boot, restore the recorded previous target (normally `sudo systemctl set-default graphical.target`). `sudo systemctl start graphical.target` starts the desktop now; it does not reboot. Avoid isolating targets from an active remote desktop session.

Restore recorded BIOS/UEFI values locally if firmware changes were made. UPS configuration is not part of the applied profile; future UPS changes need their own backed-up configuration and rollback. None of these procedures require repartitioning or desktop removal.
