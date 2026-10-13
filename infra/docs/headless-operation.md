# INFRA-002 — Ubuntu 24/7 operation

Status: **host profile applied successfully by the operator; all automated checks passed**. Evidence is the operator-supplied apply and validation transcript (local timestamp 2026-10-10 21:33). A private rollback snapshot was created under the documented root-owned snapshot directory. No reboot, service handoff or graphical target change was performed by the profile. Ubuntu and its desktop remain installed. The operator subsequently completed the game/database system-service handoff: both units passed active/enabled checks and the health endpoint returned ready. Logout/reboot survival and firmware recovery remain pending. No AGENTS.md was found in the workspace search; INFRA-001 contains the broader instruction search record.

## Baseline observations before application

Outside-sandbox host checks show America/Chicago, hardware clock in UTC (`LocalRTC=no`), `NTP=yes`, `NTPSynchronized=yes`, chrony active/enabled with normal leap status and sub-millisecond reported offset. There were zero failed system units. NetworkManager, Glances, libvirt, rsyslog, chrony, logrotate and APT upgrade timers are active/enabled. Chrony, Glances and libvirt unit installation targets include `multi-user.target`, so their boot configuration does not require graphical login; an actual no-login boot is still untested. Boot currently uses `graphical.target`.

Journals used about 120 MiB at capture. Current rsyslog rotation is weekly with four retained rotations. Daily security updates are enabled, but no explicit automatic-reboot override was present in effective APT output. Current GNOME AC idle action is `nothing`; system sleep targets remain available and the current user's linger setting is `no`.

The live PostgreSQL cluster and game runtime were located in a separate application-managed project copy under the user's app storage, rather than this workspace. The preview uses this workspace. Exact user/path identifiers are omitted here. Do not initialize a replacement database or point boot services at this checkout's absent `.local/` directory.

## Apply the host profile

Review the plan and run the following from the workspace root in a terminal on the actual Ubuntu host:

```bash
bash infra/scripts/configure-server.sh plan
python3 infra/tests/test_server_profile.py
python3 infra/tests/test_realms_units.py
sudo bash infra/scripts/configure-server.sh apply --timezone America/Chicago
bash infra/scripts/validate-server.sh
```

Enter any sudo password only into the server's terminal. Never send it to this chat. The installer requires a booted systemd host and existing chrony, APT timers, logrotate and Ubuntu rsyslog rotation. It does not install software. It refuses conflicting active time providers, unexpected unit states and unsafe configuration symlinks. Root snapshots are private under `/var/lib/kol-infra/infra-002/snapshot-*`; record the exact path printed by the command. On an apply failure it attempts rollback and prints any rollback failure. Reapplying creates another snapshot; the most recent snapshot restores the immediately preceding state.

The profile:

- Retains the existing chrony provider, enables/starts it if necessary, and sets America/Chicago. It does not step the clock manually or introduce a second NTP daemon.
- Masks sleep, suspend, hibernate, hybrid-sleep and suspend-then-hibernate targets immediately, and sets the four `Allow*` sleep flags to `no`. The logind drop-in ignores idle sleep, sleep/hibernate keys and lid events. Logind policy takes effect at the next boot; logind is not restarted during application. The target masks block normal systemd sleep requests immediately. Privileged kernel writes, firmware actions, power loss and physical long-press power-off are outside this guarantee. The ordinary power button is left with its existing behavior.
- Preserves the observed Ubuntu base/security/ESM unattended-update origin set, explicitly disables unattended automatic reboots both with and without logged-in users, and keeps daily package refresh/security upgrade timers enabled. ESM availability still depends on the host's subscription. It does not run an immediate package upgrade. Starting a previously inactive timer can trigger an overdue scheduled run.
- Enables persistent journaling with a 1 GiB system budget, 256 MiB runtime budget, 2 GiB system free-space reserve, 14-day maximum retention and daily journal file rotation. It restarts only journald; no application, network or login service is restarted. New limits govern rotation and archived retention; the installer does not vacuum existing logs. Limits are operational budgets, not a total filesystem quota.
- Replaces rsyslog's existing rotation stanza with daily rotation, 14 archives, compression and a 50 MiB `maxsize` threshold, after saving the previous file. Rotation only runs on the existing logrotate schedule, so rapidly growing files can exceed the threshold between runs. Logs from other programs and existing application file logs are not covered by this stanza. Applications converted below send stdout/stderr to the bounded journal.

Automatic security updates can restart affected services even with automatic **reboots** disabled. This profile does not promise zero interruption from package upgrades, Snap refreshes, custom jobs or operator commands. Before production, review `needrestart` and package-specific restart behavior and add maintenance policy for any workload requiring scheduled service restarts. Track `/var/run/reboot-required` and reboot deliberately in a maintenance window. See [Ubuntu's automatic-update documentation](https://github.com/canonical/ubuntu-server-documentation/blob/main/docs/how-to/software/automatic-updates.md).

Validate merged configuration using `systemd-analyze cat-config systemd/sleep.conf`, `systemd-analyze cat-config systemd/logind.conf`, `systemd-analyze cat-config systemd/journald.conf` and `apt-config dump`. Any later-sorting administrator drop-in can override file settings; automated validation checks masks and the APT reboot values, and the checklist includes reviewing merged power/journal values.

## Existing game and database boot services

Core system services are already enabled. The game/database background processes require a separate, controlled handoff to systemd. The prepared `kol-postgresql.service.in` and `kol-realms.service.in` templates use `multi-user.target`, the existing non-root owner, foreground processes, readiness checks, restart backoff, graceful database shutdown and journal output. They perform no build, migration, seed, credential generation or database initialization. The API reads only the existing restricted `.state/runtime.env`. The preview and other desktop tools are not converted.

The current app-managed runtime path may change when project storage is managed or removed by the desktop app. For an initial continuity handoff, use the verified existing path; before production, plan a separately backed-up migration to a stable deployment/data location. If the home directory is encrypted or unavailable before login, services cannot use it at cold boot. `RequiresMountsFor` cannot unlock a per-user encrypted home; that must be resolved before acceptance.

Locate the existing cluster without printing credentials:

```bash
pgrep -x postgres
# Select the verified postmaster PID from the current inventory:
readlink /proc/POSTMASTER_PID/cwd
readlink /proc/POSTMASTER_PID/exe
```

Set the exact runtime project root (parent of `.state`) and its verified owner in your own terminal. These are placeholders to replace locally, not a new deployment path:

```bash
live_project='/absolute/path/to/the/existing/realms'
run_user='existing-non-root-owner'
stage_dir=$(mktemp -d /tmp/infra-002-services.XXXXXXXX)
python3 infra/scripts/prepare-realms-services.py \
  --project-dir "$live_project" --user "$run_user" --output-dir "$stage_dir"
```

The renderer refuses a missing built runtime, root service account, state owned by a different account or runtime credential file accessible to other users. Output stays private because unit files contain local paths. Review the staged units and perform the handoff only during a maintenance window with a verified database backup and a local console or independently tested laptop access path. No SSH server was observed in INFRA-001; optional non-graphical boot must not remove your only working administration method.

If units or the entry-point script already exist, stop and back them up/reconcile them instead of overwriting them. For the first install:

```bash
sudo test ! -e /etc/systemd/system/kol-postgresql.service
sudo test ! -e /etc/systemd/system/kol-realms.service
sudo test ! -e /usr/local/lib/kol-infra/run-existing-realms.sh
sudo install -d -m 755 /usr/local/lib/kol-infra
sudo install -m 755 infra/scripts/run-existing-realms.sh /usr/local/lib/kol-infra/
sudo install -m 644 "$stage_dir/kol-postgresql.service" /etc/systemd/system/
sudo install -m 644 "$stage_dir/kol-realms.service" /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/kol-postgresql.service /etc/systemd/system/kol-realms.service
sudo systemctl daemon-reload
```

Run the assertions as separate commands and stop on any error; existing broken symlinks also require review. Unit installation alone does not stop or start the existing processes. As the existing runtime owner, during the agreed window:

```bash
bash "$live_project/scripts/server.sh" stop
(cd "$live_project" && bash scripts/runtime.sh bash scripts/database.sh stop)
```

Verify that only the intended API/PostgreSQL processes stopped and ports 3000/55432 are now unused before proceeding. Do not kill an unidentified process to clear a port. Then:

```bash
sudo systemctl enable --now kol-postgresql.service
sudo systemctl enable --now kol-realms.service
bash infra/scripts/validate-server.sh kol-postgresql.service kol-realms.service
curl --fail --silent --show-error http://127.0.0.1:3000/health/ready
```

These are system services; user lingering is not necessary. The API is ordered after database startup and stops/restarts with explicit database-unit operations. If repeated failures exhaust the start limit, investigate privately, fix the cause, then use `systemctl reset-failed` and start the affected units. Systemd restart policy is not a substitute for monitoring application-level readiness. Complete the [startup checklist](startup-validation.md) before claiming reboot/logout survival; use [rollback instructions](rollback.md) if the handoff fails.

## Optional console-first boot

Keep `graphical.target` as the default until reliable laptop access or local console access and no-login application boot are proven. Do not run `systemctl isolate multi-user.target` from the current desktop session: it can terminate the session immediately. Optional future-boot change:

```bash
systemctl get-default                 # Record previous target privately.
sudo systemctl set-default multi-user.target
# Reboot only in the agreed maintenance window.
```

This keeps desktop packages installed. From a local console or trusted remote session, `sudo systemctl start graphical.target` starts the desktop when needed. Restore desktop boot with `sudo systemctl set-default graphical.target`. Do not disable GDM or remove desktop software for this ticket. This profile never changes the default target itself.

## Firmware and future UPS

BIOS/UEFI changes require a local maintenance window. Record existing values before editing. Look for `Restore on AC Power Loss`, `AC Back`, `After Power Failure` or similar. `Power On` is the intended automatic-recovery behavior; `Last State` may leave a gracefully shut-down machine off after a UPS drain. Verify boot order uses the current Ubuntu disk and that no keyboard/F1 prompt or interactive disk-unlock step prevents unattended startup. Firmware options and actual recovery behavior are not yet verified. Do not pull mains power while the machine is running to test recovery; shut down cleanly and test under supervision in a planned window.

For a future UPS, protect the server and any router/switch needed for administration. Select hardware with enough measured runtime for a graceful PostgreSQL shutdown and compatible USB or network monitoring. Possible integration is Network UPS Tools: driver, local `upsd`, and `upsmon` as system services, with low-battery shutdown and UPS power-off/recovery coordination. Restrict the monitoring endpoint to intended clients; keep UPS credentials private. Verify utility-power return, UPS output restart and firmware `Power On` together to avoid a machine that stays off after graceful shutdown. No UPS software or hardware was installed or assumed. See the [NUT configuration manual](https://networkupstools.org/docs/user-manual.chunked/ar01s06.html).

## Current validation record

Configuration plan and Python/Bash syntax passed. Three simulated lifecycle tests passed: successful apply/rollback, automatic rollback on validation failure, and rejection of an external snapshot path. The proposed APT override also parsed successfully with explicit reboot=false values and security origins. A fourth test verified rendered units with spaces and percent signs in the runtime path using the actual host systemd verifier; it is skipped in the restricted sandbox. Real-runtime staged units also passed host `systemd-analyze verify`. The read-only baseline validator passed time and existing boot-service checks and reported seven expected pending profile checks. Lifecycle tests use temporary files and mocked system commands; they do not prove privileged host application. Time synchronization and existing boot enablement were verified directly. The operator subsequently ran apply successfully and supplied validation output with zero failed/unknown automated checks. That transcript confirms synchronized time, the existing active/enabled services, five masked sleep targets, explicit unattended reboot=false settings, installed journal limits and zero failed units. The logrotate debug warning is expected: rotation was simulated, not executed. This evidence is operator-provided rather than a new independent Codex host check. Reboot, logout, effective merged log/power policy, firmware recovery and post-handoff application/data validation remain pending.


## Desktop-administered continuation

The operator chose to administer from the Ubuntu desktop and stop the laptop onboarding procedure. Graphical boot remains enabled; no SSH removal or firewall change is implied.

A later direct read-only check found API liveness OK but readiness HTTP 503. The live database has 22 applied migrations while its runtime directory contains 27; five migrations (023–027) are pending, with no changed checksums or extra applied migrations. No database updates were performed by that diagnostic.

From the `infra/` directory, the new one-time handoff command is:

```bash
sudo bash scripts/enable-realms-startup.sh --migrate-pending
```

The flag explicitly includes a forward application-schema update: it creates a fresh dump, checks that its archive listing is readable, runs the existing migration and role-provision commands, and requires readiness before stopping existing processes. Archive readability is not a full restore rehearsal. The dump is on the same disk and is not an independent disaster-recovery backup. The installer does not initialize, seed or build the game. It rejects existing startup files, ambiguous clusters and a mismatched API process. The handoff briefly interrupts the game/database but preserves the desktop and other projects.

It then installs and enables the verified database/API system services and runs validation. A failed handoff attempts to return to the previous background processes. Any forward migrations remain applied; a schema/data rollback would require a deliberate restore from the fresh backup, not automatic deletion. If file installation itself fails before the handoff begins, original processes keep running; inspect/remove partial new startup files using the rollback procedure before retrying.

The operator completed the privileged command successfully after correcting a relative backup-path lookup bug. A fresh database dump was created and its archive listing read successfully; forward migrations and restricted-role provisioning succeeded. Both system services were enabled and started, the automated validator reported zero failed/unknown checks, and the game returned ready. These results are operator-supplied evidence, not proof of a cold start. Do not rerun this first-install script. Verify application data and complete a planned reboot and no-desktop-login test.
