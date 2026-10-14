# KoL Server Console

[Operations map](README.md) · [Current source status](../../realms/docs/implementation-status.md) · [Branding compatibility](../../realms/docs/branding-and-pages.md)

The desktop app now includes container projects, gated releases, encrypted USB backups, website routing checks, job reports, searchable logs and alerts. See [operations-console.md](operations-console.md) for current controls and installation. The original native-only tools documented below remain under **Native tools**; they do not deploy the public container production game.

A native Ubuntu desktop client for the existing KoL PostgreSQL and game system services. It uses the installed Python/Tk desktop library. It does not run an administration web server or require the laptop.

## Launch

Open **KoL Server Console** from Ubuntu's application menu. The current-user menu entry has been installed. From a terminal already inside `infra/`, alternatively run:

```bash
bash scripts/server-console.sh
```

Run it as your regular desktop account, not sudo. The application can remain open while you use the desktop. Closing it leaves the game/database running. Administrator service actions use Ubuntu's graphical authentication dialog via polkit; the client does not read, store or transmit the administrator password. No passwordless sudo/polkit rule was added.

To reinstall the launcher after moving the workspace, run `python3 scripts/install-console-launcher.py` from inside `infra/`. Its entry points at this workspace, so keep the program files available. Removing the launcher from `~/.local/share/applications/kol-server-console.desktop` uninstalls the menu entry without changing services or deleting data.

## Controls

| Page | Tools |
| --- | --- |
| Overview | Automatic refresh every five seconds; API and PostgreSQL states, boot enablement, process memory, restart counts, game readiness, read-only database/schema checks, RAM/swap/storage/CPU load, start/stop/restart, open game |
| Deploy & backups | Choose Follybound source folder, deploy checked code, optional explicitly selected migrations, code rollback, create database dump, create a fresh dump and test its restore |
| Service logs | Read recent API/database journal entries; restart both services with confirmation |
| Diagnostics | Current boot/service timestamps, PostgreSQL version/start time, capacity, reboot-required marker, infrastructure checklist, status-report export, open backup folder |

**Start services** starts database before the game using systemd dependencies. **Stop services** stops both; database files remain intact. **Restart game** keeps the database running. Start/stop does not change boot enablement, so a stopped-but-enabled service returns on reboot. Closing the client does not stop services. Failed status queries are shown as unavailable rather than as a stopped service.

Game readiness and database connectivity are separate checks. The database probe uses the existing restricted application role in an explicitly read-only SQL transaction. It compares migration names and checksums, reports pending/changed/extra migrations, shows database size/version and counts connections. It does not display database credentials or inspect account/player records.

CPU values are 1/5/15-minute load averages, not CPU utilization percentages. Disk capacity refers to the filesystem holding the existing runtime. Service memory is the current systemd cgroup measurement if available. The reboot-required marker is an indication for planned maintenance, not a command to reboot.

## Deployment behavior

Deployment is operator-triggered and briefly interrupts the game at handoff. It discovers the actual runtime through the installed system unit, rather than assuming this source checkout contains the live database.

1. Snapshot the selected source into a private build folder under the live runtime's `.state/control-panel/releases/`. `.env`, `.state`, `.local`, Git internals and existing dependencies/build output are excluded. Source artifact symlinks are refused.
2. Use the existing local Node runtime to install locked dependencies in that isolated build folder, typecheck, run unit tests and build. These processes run as the ordinary service owner. They execute the selected project's code and may download dependencies; choose a trusted checkout. Failures at this stage leave running code/services untouched.
3. Verify source migration names/checksums against the current database. Changed or removed applied migrations are refused. New migrations require the explicitly selected checkbox.
4. Create a fresh database dump and verify that its archive listing can be read. This listing check is not a full restore test.
5. Stop only the API. If selected, apply forward migrations; then provision restricted-role permissions. Database initialization and seeding are never invoked.
6. Save previous code, install the built artifact set, preserve `.env`, `.state`, runtime binaries and database files, then start the API and require readiness.

This original console checkpoint only deployed the Follybound project to the already-installed KoL services. It does not create arbitrary project services, upgrade Ubuntu packages, modify firewall/networking, or implement Git pulling/publishing. Current source checkpoint/GitHub work is supplied separately by [Development Studio](development-studio.md); immutable staging/promotion and protected monitoring are documented in [operations console](operations-console.md). It runs typecheck/unit/build checks; production integration tests are not run against live data.

Retained previous code and the database backup remain on the same disk. Monitor free capacity; no automatic deletion of backups/releases is performed. The guard requires at least 1 GiB free before a deployment starts, but this is not a guarantee that an arbitrarily large project fits. Dependency downloads/builds can fail cleanly for capacity or network reasons before handoff.

## Recovery and backups

A failed handoff without schema changes attempts to restore previous code and the API's previous running state. Deployment history records results under `.state/control-panel/releases/`. **Roll back code** restores the most recent successful console deployment's previous artifacts and restarts the API; it does not restore database contents.

If forward migrations were successfully applied and a later step fails, the API is kept down and automatic code rollback is withheld because old code might be incompatible with the changed database. The fresh database dump, previous artifacts and failed build folder are retained for deliberate recovery. This client does not perform destructive automatic database restores or attempt reverse migrations. Review the action log and the existing rollback documentation before recovery.

Only one console action can mutate the runtime at a time, including across multiple client windows. Build/backup errors and authentication cancellation appear in the action output; background threads keep the GUI responsive. The window refuses a normal close while an action is in progress. An OS crash/forced kill can still interrupt a deployment; its private release manifest and saved artifact set support manual recovery. A crash during artifact replacement may require manual restoration, since replacement of the entire artifact set is not one filesystem operation.

**Backup + restore test** creates a fresh backup, restores it into a disposable database using the project's existing restore checker, checks schema/constraints/ledger invariants, then removes that disposable database. It never restores over production. If interrupted or failed, inspect the output and disposable-database cleanup before retrying. Independent backup storage remains a separate infrastructure requirement.

Journal text and command output redact common password/token/connection-string patterns, but do not export journals automatically. Redaction is best effort; inspect text before sharing it. The status report omits the explicit runtime/user/PID fields and all journal/credential contents; review any error text before sharing. Reports and backups are local files, not committed ticket evidence.

## Verification

- Sixteen isolated tests passed for unit parsing, query errors, fixed action allowlists, credential redaction, sanitized subprocess environment, relative backup paths, source exclusions, symlink refusal, exclusive actions, complete/partial code swaps, workflow success and recovery, and schema rollback refusal.
- Live read-only checks confirmed both services active/enabled, game readiness OK, and 27/27 matching migrations with no pending/changed/extra entries.
- The native window opened and refreshed live status in a desktop smoke test. All four pages and button bounds were verified against the actual desktop window. The finished application was opened for the operator. System screenshot capture was blocked by the display environment, so no screenshot is claimed.
- A user-menu launcher was installed. Production Start/Stop/Deploy actions were not exercised during client development; service effects and deployment workflows were simulated in tests. A real deploy still depends on the selected checkout passing its checks and the operator authenticating service actions.

Re-run isolated tests from the workspace root with `python3 infra/tests/test_control_panel.py`. The desktop smoke test is `bash infra/scripts/server-console.sh --smoke-test`; it performs observations only and closes after a few seconds.
