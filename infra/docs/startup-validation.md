# INFRA-002 — Startup validation checklist

This checklist is the acceptance record. Unchecked items are not verified. Capture results privately and share only redacted summaries; exclude credentials, host addresses, usernames, paths and serials.

## Before applying

- [x] Ubuntu remains installed; timezone America/Chicago and chrony synchronization verified on 2026-10-10.
- [x] Networking, time, monitoring, virtualization and logging services observed active/enabled; zero failed units.
- [x] Locate live application/database runtime; distinguish it from this checkout and preview.
- [x] Review script syntax, three simulated apply/rollback tests, APT parsing, and actual-host systemd unit verification (including special-character paths).
- [x] Operator successfully applied the profile using interactive sudo in the server terminal.
- [ ] Confirm laptop access method and independent local console recovery. SSH is not yet configured by this ticket.
- [ ] Record privately: default target, boot ID, active/enabled services, application readiness, data identity, VM state and existing log policies.
- [ ] Verify database backup before service handoff; verify the existing home/data directory is available without graphical login.

## After profile application, before any reboot

- [x] Operator transcript records a private rollback snapshot and successful application; keep its exact path privately.
- [x] Operator ran the validator: zero failed/unknown automated checks. From inside `infra/`, use `bash scripts/validate-server.sh`.
- [ ] `timedatectl show`: America/Chicago, NTPSynchronized=yes, LocalRTC=no; `chronyc tracking`: normal leap status. Allow initial synchronization time if chrony was previously stopped.
- [ ] All five sleep targets are masked; merged sleep flags are no; merged logind idle/lid settings match the profile. Do not invoke suspend as a test.
- [ ] Effective APT Automatic-Reboot and Automatic-Reboot-WithUsers are false; permitted origins match approved base/security/ESM policy; APT timers remain enabled/active.
- [ ] Merged journal configuration has 1 GiB system / 256 MiB runtime budgets, 2 GiB system reserve and 14-day retention. `journalctl --disk-usage` remains reasonable; rsyslog rotation debug check succeeds.
- [ ] Existing networking, Glances, libvirt and logging units passed active/enabled checks; verify actual VM, game, preview and laptop functionality separately.
- [x] Operator completed the game handoff: both new services active/enabled and readiness returned ready; migration and role provisioning succeeded. Database backup archive was readable, but a full restore test remains open.

## Logout and cold-start acceptance

Only perform disruptive tests in an agreed maintenance window with console recovery available. Save work, verify a fresh database backup and ensure a root snapshot is recorded. Enabled units alone do not prove these items.

- [ ] From the laptop, record game readiness and baseline service states; log out the desktop user without shutting down the machine. Verify network, monitoring, database and game remain accessible. Read-only validation must still pass.
- [ ] For the agreed reboot test, record `cat /proc/sys/kernel/random/boot_id` privately, then issue `sudo systemctl reboot` from the server terminal. Do not reboot merely to complete documentation.
- [ ] After reboot, before anyone logs into the desktop, connect by the already-tested laptop method or use a text console. Verify boot ID changed, expected time sync returns and automated validation passes.
- [ ] Verify game `/health/ready`, existing database/character data and VM/project state without migrations, seeding or destructive test writes.
- [ ] Check `systemctl --failed`, `journalctl -b -p warning`, and service logs privately. Confirm no unexpected reboot is scheduled; check reboot-required marker for future maintenance.
- [ ] Let the server run through the desktop's former idle interval and at least one update/logrotate cycle. Confirm no sleep, uncontrolled log growth or unexplained service interruptions; record duration and observations.
- [ ] Confirm desktop can still be started if optional non-graphical boot was selected, and its packages remain installed.
- [ ] Separately verify firmware AC-recovery/UPS behavior under a supervised, clean-shutdown procedure.

## Acceptance status

Host profile application and automated validation **passed**, based on the operator-supplied transcript. Game service handoff and readiness also passed. Effective merged policy review, existing game-data verification, logout survival, reboot survival and firmware recovery remain **pending**. Do not mark INFRA-002 fully accepted until the above runtime evidence exists. A 24-hour observation supports readiness but does not guarantee indefinite uptime.


## Desktop console observations

Subsequent direct host observations showed both KoL services active/enabled and game readiness successful after the reboot. Systemd recorded database/game startup before the current desktop user's manager startup, supporting operation without a graphical login. The new KoL Server Console exposes these states and database/schema checks without requiring terminal output. Logout endurance, firmware recovery, independent backup recovery and extended operation still need their respective checks; the client does not mark them passed automatically.
