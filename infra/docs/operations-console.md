# Realms desktop operations

The expanded **KoL Server Console** is a native Ubuntu desktop app. It administers the existing container projects, Caddy and dashboard-managed Cloudflare connector while retaining the older native service controls under **Original local tools**. It opens no administration HTTP listener and stores no administrator password. Closing it leaves the game running.

Launch from Ubuntu's application menu or run `bash scripts/server-console.sh` from `/srv/Realms/source/infra`, as your normal account. The launcher points to the canonical `/srv/Realms/source` tree.

## Initial monitoring and email setup

The console and launcher have been updated. Background monitoring is installed and active. To install it on another host or refresh its protected code, use administrator authentication:

```bash
cd /srv/Realms/source/infra
sudo python3 scripts/console-admin.py install
```

Alternatively use **Overview → Install / update monitoring** and Ubuntu's authentication dialog. This installs only the dedicated service/timer, starts monitoring and creates a sanitized status cache. It installs no packages, changes no firewall/network settings and does not restart game services. Customized existing monitor units are not overwritten. Authenticated administrative actions execute the reviewed source scripts. The unattended monitor runs from an administrator-owned runtime under `/srv/Realms/system-tools/console-runtime`, with protected ancestors and a file-hash manifest; install/refresh this copy through administrator authentication. This protected runtime was verified active on October 12, 2026. Source edits alone do not change the unattended root monitor. No passwordless sudo/polkit policy is added.

**Checks & alerts → Configure email alerts** accepts your existing provider's SMTP hostname, port, username, app password, sender and recipient. Select STARTTLS (normally the provider's submission port) or implicit TLS according to that provider's settings; plaintext delivery is refused and TLS certificates are verified. Fields travel over stdin to the authenticated helper, never command arguments. Settings stay root-private at `/srv/Realms/state/console/email.json`; the password is never returned to the GUI. Blank password preserves a saved password. Saving settings and sending a test require administrator authentication. **Test email** must succeed before relying on delivery; this has not yet been verified with an operator mail account. No mail subscription or account has been purchased.

The monitor runs roughly once a minute while logged out. It retains alert opening/recovery history, coalesces changes, retries pending email after delivery failure, and does not repeatedly notify unchanged issues. Public HTTPS health is checked roughly every five minutes. Desktop notifications require the console to be open; email and persistent alert history continue with the monitor timer. Acknowledgement records review but does not erase unresolved failures. Planned GUI staging/production handoffs temporarily suppress readiness alerts for their affected project; suppression expires after two hours and does not hide storage/backup failures.

Monitor coverage includes project readiness, managed service/container failures, USB availability, backup older than 12 hours, restore drill older than eight days, disk capacity, low available memory, public website health, failed email delivery, latest failed release, and sensitive origin ports listening beyond localhost. Thresholds are initial operational defaults. Monitor/query failure or stale cache is shown as unavailable, not healthy. Alert history is bounded to 200 transitions; operation history retains 80 actions.

## Pages

| Page | Controls and information |
|---|---|
| Overview | Production/staging readiness, SQL counters, resource capacity, active alerts, monitor setup, refresh and acknowledgement |
| Projects | Container health, resource limits, restart counts, network/volume/port details; scoped start/stop and API restart |
| Releases | Named tested staging builds, manual staging check, separately approved production promotion, schema-compatible rollback |
| Backups | USB snapshot/restore status and timers, encrypted backup, isolated restore drill, deletion-free retention preview |
| Website | Live website, public/private route verification, local proxy checks, existing connector restart |
| Jobs | Actual schedule execution report and dry run; no gameplay policy or reward enrollment |
| Logs | API/database/cache/worker/scheduler/test-project logs and system journals; search, error/warning filters, private sanitized export |
| Checks & alerts | Local IPv4/IPv6 bindings, sanitized status export, private email setup/test and outside-network procedure |
| Help & guide | Built-in update walkthrough, plain-language glossary, backup and troubleshooting instructions |
| Original local tools | Original native service overview/deploy/backup/log/diagnostic tools, explicitly separate from public container production |

Actions stream output into the activity panel and keep the UI responsive. One action is allowed per console window; existing infrastructure locks serialize conflicting project/release/backup work across windows. Native deployment locks are not held while calling the container/USB tools, avoiding deadlock. Closing the window normally is refused during an active action. A forced kill or OS failure can still interrupt work; durable records and database receipts support investigation.

Start/stop changes the selected project's current operation, not restart policy or storage. Stopped services with restart policies may return at boot. No `down -v`, volume deletion, production database replacement, arbitrary shell command, password viewer or unreviewed gameplay award button is exposed. Administrative templates and Ubuntu installations remain deliberate ticket work rather than arbitrary GUI operations.

## Gated game/website releases

Use **Game updates → 1 · Build for testing → Build and install on test game**. Give the release a name and leave forward migrations disabled unless the change intentionally adds reviewed migrations. The tool first creates an encrypted USB backup, then builds `Dockerfile.release`, runs locked dependency installation, type checks, unit tests and the application build inside the build stage. It records the immutable resulting image and its exact migration checksums. Applied migrations cannot be edited or removed. Pending migrations require explicit consent.

Only staging is updated during this action. A fresh logical backup precedes its handoff. The API, worker and scheduler stop gracefully; restricted roles and forward migrations are applied; the same three services start from the recorded image and must pass smoke/schema checks. Database/cache containers and all other running projects must retain identities/start times. No native-player migration occurs.

Open staging, test login and representative game actions, inspect logs and job reports, then select that recorded release, complete the two checks under **2 · Test and approve**, and choose **Save test approval**. Under **3 · Publish or recover**, choose **Review what will change**, then **Publish this build to the live game**. Promotion is separately confirmed, requires staging still to run the exact recorded image/schema, rechecks staging, creates a fresh USB/logical backup and installs that same immutable image into production. It does not rebuild. The production service pause is brief but this is not a zero-downtime deployment. The website continues to use its existing domain/proxy route. Production promotion can apply the explicitly authorized forward migrations; review their compatibility and consequences before confirmation.

CLI equivalents:

```bash
sudo python3 scripts/releases.py stage --label 'Reviewed game update'
# Add --allow-migrations only for intentionally reviewed new migrations.
sudo python3 scripts/releases.py history
sudo python3 scripts/releases.py verify-staging --release ACTUAL_RECORDED_RELEASE_ID --confirm-manual-test
sudo python3 scripts/releases.py promote --release ACTUAL_RECORDED_RELEASE_ID --approve-production
sudo python3 scripts/releases.py rollback --release ACTUAL_RECORDED_RELEASE_ID --project kol-production
```

Replace placeholder IDs; use the GUI picker to avoid typing them. The old `backend.py deploy`/`edge.py deploy-backend` workflows remain for their original infrastructure tickets and automatically update both game projects. Use the new Releases page for normal game releases requiring a manual staging gate.

Rollback is code-only and requires the selected release still to be running, unchanged database migration records, a retained previous image and exact previous-image schema compatibility. It does not overwrite player data or undo migrations. A failed handoff attempts old-code recovery only if the schema remains unchanged. Once migrations have changed the schema, failing services stay down for a reviewed forward fix; automatically restoring an old database over newer transactions is forbidden. Failed rollback is recorded for manual recovery. Root-private records are in `/srv/Realms/state/releases/<release-id>/release.json`. Backups capture these records, SMTP settings and monitor unit definitions inside the encrypted configuration set; previous image archives also reside in earlier full snapshots.

## Exposure verification

The GUI local audit detects sensitive ports listening outside localhost. That alone cannot prove router firewall/NAT behavior. A scan of `playfollybound.com` tests Cloudflare's edge, not the home origin.

From a device on another Internet connection, determine your **own** router WAN IPv4 and, if present, the Ubuntu server's global IPv6. Keep those addresses private. Run the stdlib-only script against each real origin address:

```bash
python3 check-origin-ports.py YOUR_OWN_WAN_IPV4 --outside-network --owned-origin
python3 check-origin-ports.py YOUR_OWN_SERVER_GLOBAL_IPV6 --outside-network --owned-origin
```

Copy `infra/scripts/check-origin-ports.py` to that outside device. Python 3 is required; no scanning package is installed by the script. The flags assert the operator verified ownership and is actually outside the home LAN. Do not supply Cloudflare IPs, private LAN addresses or someone else's server. It probes a bounded list of TCP service ports and omits the supplied address from its output. The script first requires a working HTTPS liveness positive control through the public game hostname. Unreachable origin ports can still mean closed, filtered or an origin-route problem; validate the supplied addresses independently. Review any reachable port against all intended home workloads; do not blindly remove rules or disable unrelated services. Router port-forwarding/UPnP rules, IPv6 firewall policy, UDP, other ports and changing policies remain separate review items. This external test has not yet been executed.

## Monitoring recovery and rollback

```bash
systemctl status realms-console-monitor.timer realms-console-monitor.service
sudo python3 scripts/console-admin.py monitor
```

The sanitized root-generated cache is `/run/realms-console/status.json`, readable by the local desktop; it contains no passwords or account records. Root-private alert/operation/email state is `/srv/Realms/state/console`. SMTP failure details are limited to exception types. Raw application/journal output is redacted for common connection strings, command/JSON tokens and cookies before display/export; inspect exports before sharing because redaction is best effort. Logs are never added to status exports automatically. The GUI status export excludes socket addresses, mail settings and journals.

To disable only the added monitor, run `sudo systemctl disable --now realms-console-monitor.timer`. Keep state/configuration and the original game/backup units intact. Email can also be disabled through its settings window. Re-enable with `sudo systemctl enable --now realms-console-monitor.timer`. The menu launcher can be removed without stopping services. No backup repository or database data is deleted by this rollback.

## Validation and remaining operator acceptance

Ninety-one infrastructure tests passed (one optional Caddy-binary test skipped), covering native deployment, release gate/failure recovery, SMTP TLS/privacy, alert transitions and systemd unit validation. Desktop smoke/layout checks passed at normal and minimum window sizes. All 122 existing game unit tests and type checks passed, including a second run with only files included in the release build context and existing locked dependencies. Disposable PostgreSQL and encrypted restic recovery tests continue to pass. Every console page's visible controls fit the observed desktop window. These tests do not claim production deployment, real SMTP delivery, external origin scanning or monitor reboot survival. Verify the actual authenticated installation/cache, a staged current-code release, operator email test and outside-network exposure before closing those acceptance items.

## Live installation acceptance

On 2026-10-11 the operator authenticated the monitor installation. Its timer is enabled and active, and the desktop-readable cache reports actual healthy production/staging services, SQL metrics, mounted USB backup storage and public website health. The initial local exposure audit found the pre-existing Glances web listener bound to all interfaces. An authenticated, narrowly scoped systemd drop-in restricted it to localhost:61208; only Glances restarted. A subsequent audit reported zero sensitive non-loopback bindings and zero active monitor issues. All public HTTPS route checks still passed.

**Checks & alerts** also provides Open local monitoring, Keep monitoring local and Restore prior binding. The correction preserves the original service user, executable and other settings and refuses custom commands/drop-ins. It stores a root-private rollback record and removes only its own unchanged override during rollback. The override and console settings/history are included in encrypted backups. Restoring the prior binding can reopen LAN monitoring access; review before use. These local checks do not claim an outside-origin IPv4/IPv6 scan, real SMTP delivery, a live gated game release/promotion, or monitor recovery after another host reboot.

The monitoring timer was observed executing again without an interactive console action, refreshing the cache with zero active issues. An additional external-probe unit check verified actual TCP open/closed results and failure of the Internet positive control while offline. The expanded configuration backup subsequently completed successfully at 2026-10-12T02:53:45Z. A fresh backup is still required to capture later source changes.

## Second console upgrade

The console adds a **History** page with persistent operation results and incident openings/recoveries, private history export, a recent CPU/memory chart and a readiness checklist that distinguishes verified checks from pending operator work. Resource history is bounded; CPU usage uses actual kernel counter differences, handles reboot/counter resets and excludes double-counted guest time. Unknown first samples are not shown as zero. Console actions that can modify services or data now take a separate cross-window action lock before writing shared operation state.

**Backups → Refresh restore points** lists the encrypted repository's Realms snapshots by time and short ID. Select a point, then **Test recovery safely**. The full ID must belong to the expected repository/host/tag; arbitrary or unknown identifiers are refused. Tests still restore into isolated temporary databases, never over live data. The default remains Latest. Snapshot metadata is cached only after an authenticated refresh.

**Game updates → Review what will change** is read-only and shows pending migrations, consent status and expected rollback compatibility. After testing staging, choose **Save test approval** to confirm login/game-action testing. Smoke checks and exact image/schema identity are validated and recorded. Production promotion now requires that matching record; it cannot rely on an unrecorded confirmation or an older staging build. Invalid promotion requests are rejected before starting a new USB backup, and the gate is rechecked under the infrastructure lock immediately before deployment. Existing staging-ready records need a new manual test receipt before promotion.

The unattended monitor now has an authenticated protected-runtime installation path. It copies only reviewed script dependencies, rejects source symlinks, records hashes and refuses writable/untrusted destination ancestors. Updating it stops only its monitor timer/service, replaces the protected bundle, validates/re-enables the timer and exercises the installed copy. It accepts only the previously generated source-based unit or the managed protected unit, refusing unrelated customizations. This installation is required to complete the runtime hardening; verify the service ExecStart points at the protected copy. No game services or public routes are changed.

Exports force mode 600 even when overwriting older files and refuse symlink destinations. Busy email dialogs preserve entered settings rather than losing them to another operation. The UI no longer continually jumps the history scroll position while its content is unchanged. Operations active for more than two hours raise an attention alert; they are never force-killed or automatically rolled back.

New release and backup behavior has isolated tests covering missing/stale staging receipts, promotion without side effects, selected snapshot authorization, counter resets, private overwrites and protected runtime inputs. Desktop checks exercised all ten pages at normal and minimum sizes. Actual production promotion, real email delivery, selected-snapshot live restoration and outside-origin scanning remain separate operator acceptance; no new game build has been deployed in this upgrade.

The readiness checklist now also shows whether the active monitor unit uses the protected runtime. On October 12, 2026, the installed monitor was verified completing successfully, with its ExecStart pointing at `/srv/Realms/system-tools/console-runtime/infra/scripts/console-admin.py`. The former pending migration is complete.

Final second-round verification: 99 infrastructure tests passed with one optional Caddy-binary test skipped; all ten desktop pages fit both tested sizes, and public HTTPS route tests passed. Existing monitoring remained active with zero current alerts. The protected-runtime migration subsequently completed; later changes to monitoring code still require an authenticated refresh.

## Plain-language workflow polish

**Game updates** now has three tabs: **1 · Build for testing**, **2 · Test and approve**, and **3 · Publish or recover**. The selected build has a readable name, date, state and approval status. Publish eligibility is explained above the tabs and disabled when observations are stale, the test server has a different build, or matching approval is missing. Changing the selected build clears both manual checklist boxes. Backend checks remain authoritative and revalidate the image and schema under lock.

Projects and logs show **Live game**, **Private test game**, **Game server**, **Database**, **Temporary cache**, **Background jobs** and **Scheduled tasks**, while retaining exact internal IDs for privileged actions. Progress appears under **What is happening**; common errors include a next step rather than only an exit code. **Help & guide** includes the release walkthrough, a glossary, backup instructions and troubleshooting. A standalone guide is in [game-update-guide.md](game-update-guide.md).

This UI update does not deploy a game build, apply database migrations or change public routes. Live promotion, provider email delivery and a scan of the home origin from a different network remain operator checks.

Verification for this polish: 106 infrastructure tests ran (105 passed, one optional test skipped), console launch and all eleven page layouts passed at 1320×950 and 1120×820, including every update tab. Public HTTPS route checks passed. The protected monitoring run completed successfully.

## Attention, diagnostics and service-log polish

**Needs attention** groups active problems and unverified checks, with a next step and an **Open the relevant tool** button. It never performs a repair or deployment automatically. A missing or out-of-date monitor record is an unknown state, and pending email/port-scan/release-rehearsal checks remain visible even when observed services are healthy.

**Projects → Read selected service logs** opens the selected project's exact service. Selection uses project/service identity so an updated monitor list cannot change which service is selected. Log service choices follow the chosen project. Search and severity filters update immediately; **Follow newest** can be turned off while reading earlier lines. F1 opens the guide, and Ctrl+F opens log search.

Long operations show elapsed time. The game update page identifies currently observed live and test builds by matching their exact images to release records, or states that an existing image has no console release record. It does not infer approval from a build name.

**Save shareable summary** exports a deliberately limited JSON report: resource counters, known service states, backup/recovery timestamps and issue/check counts. It omits host addresses, paths, credentials, raw logs, release names and free-text issue messages. Exports require regular files, refuse symbolic links and special files, and use private permissions even when overwriting. The report describes cached observations; it does not prove external reachability or successful gameplay. Detailed logs/history are separate local exports and should be reviewed before sharing.

This round changes desktop code only. It does not restart services, install packages, deploy a game image or change player data. Reopen the console to load it.

Round verification: 120 tests ran (119 passed, one optional Caddy binary test skipped). Read-only desktop workflow tests cover stable service selection, exact project/service log targets, structured error filters, progress-callback isolation and approval-checklist reset. All twelve page layouts and every update tab fit both supported window sizes. No live promotion, real email delivery or outside-origin port scan was performed.

## Canonical Git source integration

Game builds now require a recorded Git source checkpoint. Use Development Studio to save content/source changes and commit the checkpoint before choosing Build for testing. Server Console checks for a clean checkout and supplies its source commit to the existing release pipeline. The build uses a frozen Git snapshot and records source provenance; unsaved or uncommitted edits are excluded. GitHub remains `rdnovotni/realms`, branch `main`, and the canonical checkout remains `/srv/Realms/source`. See [Development Studio](development-studio.md). The protected monitor runtime now also includes the Git snapshot helper dependency; an authenticated Install / update monitoring refresh is required when upgrading an existing monitor bundle.
