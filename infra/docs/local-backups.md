# Encrypted external-drive backups

[Operations map](README.md) · [Current source status](../../realms/docs/implementation-status.md) · [Branding compatibility](../../realms/docs/branding-and-pages.md)

Status: the operator completed the first encrypted USB snapshot, full repository integrity verification, and isolated restores of the native, production and staging databases, including schema, constraints and game-data invariants. Backup and weekly restore timers are enabled and active, independently verified locally. After the operator reboot, the expected NTFS3 drive mounted through an fstab-generated systemd unit, and both timers remained enabled and active. The operator then completed a fresh encrypted backup, full repository integrity verification and isolated native/production/staging restores after reboot. USB backup and reboot acceptance passed. The operator chose local USB storage to avoid a cloud subscription. No cloud account or upload destination is configured.

## Storage and confidentiality

The observed 2 TB USB drive has an existing NTFS filesystem and about 1.9 TB free. No formatting, repartitioning or deletion of existing drive contents is performed. Setup binds its current mounted filesystem at `/mnt/Realms-backups` for this session and adds a UUID-based NTFS3 fstab entry for the same stable path after boot. Normal server startup continues if the drive is absent (`nofail`), while backup jobs fail visibly. The original desktop mount can remain available during this session; after reboot use the stable mount path.

The repository lives in `/mnt/Realms-backups/Realms-Backups/restic`. Restic encrypts database contents, private configuration, role password hashes and source/runtime snapshots before storing them on the drive. A filesystem UUID check and repository-specific marker prevent accidental writes to the server's internal disk when the drive is missing or replaced. Existing drive files remain outside the dedicated backup folder. Encryption does not make an attached drive immune to deletion by a compromised administrator.

The repository encryption password is generated once at `/srv/Realms/state/backups/repository-password`, mode 600 in a root-private directory. **Keep a recovery copy in a password manager or secure offline location outside the computer.** Losing the internal disk without that password would make the encrypted USB repository unusable. Do not put the password beside the repository, paste it into chat, put it in Git, or share recovery-key output with routine validation logs. To view it privately in your own terminal after setup, use `sudo cat /srv/Realms/state/backups/repository-password` and save it in your password manager. The assistant does not need to see it.

## What is backed up

- Consistent custom-format PostgreSQL exports of native `realms_dev`, `kol_production` and `kol_staging`; complete cluster-global role definitions are exported separately for each independent cluster.
- Their exact currently running game images and the PostgreSQL image as Docker archives, so recovery need not rebuild from a newer source checkout.
- The source repository and original native runtime, including their code, migrations, dependency lockfiles and native tools; disposable source dependencies/build output and all live `.state` trees are excluded.
- Native runtime credentials and actual deployed production/staging Compose files, cache configuration and secrets, captured in the root-private staging set. Edge configuration is included if it exists. Original native systemd unit definitions and startup helpers are included.

No live raw PostgreSQL data directories, Docker Engine directory, unrelated workloads or Valkey cache contents are treated as authoritative backups. Native test databases can be recreated; the selected native permanent game store is `realms_dev`. This does not merge the three game stores or change game authority. Existing game services keep running during logical database exports.

Root-private plaintext staging under `/srv/Realms/backup-staging/current` holds one completed set; incomplete staging is removed after failure. This same-drive staging is a working copy, not disaster recovery. Independent stores have separate consistent snapshots; they do not share one cross-cluster transaction boundary.

## First setup and restore drill

Close the desktop server console before running setup, and avoid other infrastructure deployments during the job. From `/srv/Realms/source/infra`:

```bash
sudo python3 scripts/local-backups.py setup --device /dev/sdb1
```

`/dev/sdb1` is the currently observed USB partition; setup verifies USB transport, existing mounted NTFS3, filesystem UUID, free capacity, game readiness and absence of conflicting fstab/target folders before changes. Future scheduled runs identify the drive by UUID, not its changing device name. If the drive has been reconnected and its device name changed, inspect `lsblk` and supply the correct existing USB partition instead; never point setup at the internal disk.

Setup creates the encrypted repository, runs a real backup and restores all three exports into isolated PostgreSQL containers. Restore instances have no network connectivity, no published ports and only private temporary data/socket directories. Each receives its own exported roles and complete database schema/data/permissions. The matching native or container release verifies migration checksums, validated constraints, currency conservation, ledger/domain invariants and foreign-key index coverage. Image archives are loaded from the restored backup. Test containers and plaintext temporary restores are removed after verification; production/native databases are never restore targets.

Only after that first full restore succeeds does setup enable the backup and restore timers. It installs no software, does not restart the game or Docker daemon, and does not reboot the host. It reloads systemd configuration and adds the dedicated mount entry. If setup fails, timers are not newly enabled; inspect status locally. Configuration failures restore the script's exact fstab addition without deleting the dedicated backup data or key. Preserve these recovery files rather than deleting them to force a retry.

If the first backup succeeded but verification was interrupted, resume using the existing encrypted snapshot:

```bash
sudo python3 scripts/local-backups.py finish-setup
```

This creates no additional backup and enables timers only after full repository and isolated restore verification succeeds. Keep the terminal open; full USB data verification and image restoration can take several minutes or longer. Phase messages and a heartbeat every 20 seconds during long commands show that the check is still running. Ctrl+C stops the active helper and retains completed snapshots and the recovery password. Status retains the last successful backup even if subsequent verification was interrupted.

The restore drill proves logical database recovery with matching release artifacts. It does not yet prove complete operating-system reconstruction, network/domain recovery, a measured recovery-time objective on replacement hardware, or protection against loss of the whole site.

## Schedule, retention and failure visibility

Backups run at 00:20, 06:20, 12:20 and 18:20 in the server's configured timezone, with up to five minutes jitter. A weekly full repository read and three-database restore runs Sundays at 03:30 with up to ten minutes jitter. Persistent timers catch up a missed run after boot; they do not replay every missed interval. Successful exports normally limit potential loss to approximately six hours, subject to failed jobs, upload-free USB availability and daylight-saving clock changes. This is a starting recovery-point target, not a guarantee of zero loss; high-value live transactions may later require PostgreSQL WAL-based point-in-time recovery.

Jobs take the existing infrastructure and native-console locks, preventing overlap with deployments or each other. Backup work has reduced CPU/I/O priority and a 2 GiB service memory limit; isolated restore databases have separate 512 MiB caps. Lock contention fails visibly instead of starting concurrent work. Systemd marks failures, writes them to the journal, and updates root-private status including last backup and restore success. No email or external notification destination is configured yet: periodic status checks are required until monitoring is added.

Retention is initially **review-only** so no valid backup is deleted automatically. The proposed policy keeps all snapshots within 48 hours, 7 daily, 4 weekly and 12 monthly checkpoints. Inspect the dry-run before explicitly applying deletion/pruning:

```bash
sudo python3 scripts/local-backups.py retention-plan
sudo python3 scripts/local-backups.py retention-apply
```

Retention applies only to this repository's `realms-local-backup` tag and generic `realms-server` host identity. It never deletes drive files outside the repository or live database storage. Actual space use depends on database size/change rate and versioned image archives. Configure periodic pruning only after the first restore drill and retention review; 2 TB capacity does not imply a fixed number of recovery points.

## Routine checks and reboot acceptance

```bash
sudo python3 scripts/local-backups.py status
sudo python3 scripts/local-backups.py run
sudo python3 scripts/local-backups.py restore-check
systemctl list-timers 'realms-backup*'
systemctl status realms-backup.service realms-backup-restore.service
```

The status command reports last successful encrypted snapshot, last verified restore, failure state and whether the expected drive is mounted. Do not rely on a timer being enabled as proof of a recent backup. A missing drive must produce failure, never a successful snapshot on the internal disk.

After a deliberate operator reboot, confirm `/mnt/Realms-backups` is mounted before any desktop login, confirm timers are enabled, then run a backup and restore check again. No script reboots the machine. Test an unplugged-drive run separately after cleanly unmounting it; confirm failure visibility, reconnect the correct drive and verify recovery. Avoid unplugging during active writes.

## Disable and recover

Disable only these automatic timers with:

```bash
sudo python3 scripts/local-backups.py disable
```

This preserves the encrypted repository, key, staging and mount configuration. To remove the mount configuration, stop any backup/restore jobs, unmount only `/mnt/Realms-backups`, and remove only the recorded dedicated line from `/etc/fstab`; do not restore the entire old fstab over later unrelated edits. `/srv/Realms/state/backups/fstab.before` and private `config.json` record the original configuration and exact added line. Existing USB data must never be erased as part of rollback.

For real disaster recovery, keep the drive and encryption password, install compatible Ubuntu/Docker/restic, decrypt into a new private location, load the saved images and provision separate storage. Restore each cluster's own globals and matching database, inspect restricted roles and readiness, and execute a controlled authority cutover before admitting writes. Never overwrite a running authoritative database with an older snapshot. Treat restored configuration, role hashes and account data as confidential.

This USB-only choice has no cloud subscription cost. It protects against internal-drive failure but does not provide an offsite copy against theft, fire, or damage to both devices. The user explicitly chose that tradeoff for now; rotated disconnected storage at another location remains an optional future improvement.

References: [PostgreSQL logical backups](https://www.postgresql.org/docs/18/backup.html), [restic encrypted repositories](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html).

## Workspace verification

The infrastructure suite ran 68 tests successfully, with one existing optional Caddy-binary test skipped. New checks exercised an actual encrypted restic repository, successful verified restoration, wrong-password denial, target-marker/UUID rejection, retention dry-run behavior and systemd unit/calendar validation. A real disposable PostgreSQL 18 source and separate restore cluster verified global-role import, complete database restoration, a persisted fixture row and the existing game integrity checker. These test clusters used private Unix sockets and were stopped/removed afterward. The operator subsequently confirmed USB initialization and successful live database exports in an encrypted snapshot. The operator subsequently passed full USB integrity verification and all three isolated database restores. Both timer units are enabled and active; the fstab-generated mount and both enabled/active timers were verified after reboot; the subsequent fresh backup, full repository verification and all three isolated restores passed after reboot.

## Restore startup correction

The first resumed USB drill passed encrypted repository integrity but its temporary PostgreSQL container failed readiness. The test configured a custom socket directory, while the official image initialization runs SQL through the default `/var/run/postgresql` directory ([official entrypoint](https://github.com/docker-library/postgres/blob/master/docker-entrypoint.sh)). The test now mounts its private socket directory at that default path and waits for the final server rather than the temporary initialization server. Failed startup logs are retained locally, mode 600, in `/srv/Realms/state/backups/last-restore-startup.log` before test-container cleanup. The operator must rerun `finish-setup` to confirm actual container restoration; existing backups and live stores are preserved.

A subsequent startup log reported `mkdir: cannot create directory /var/lib/postgresql: Permission denied`. The temporary mount parent was root-owned with mode 700; the official entrypoint changes ownership within PGDATA but then switches to the PostgreSQL user, which could not traverse that parent. Restore setup now resolves the PostgreSQL UID/GID from the exact saved image and assigns ownership of only the disposable data/socket mounts before startup. The data mount remains mode 700; live database directories and USB repository permissions are unchanged. The operator rerun passed all three isolated restore checks and enabled both timers.

## Post-reboot acceptance

On 2026-10-11, following an operator reboot, the USB filesystem mounted via its generated systemd mount unit and both timers remained enabled and active. Native, production and staging APIs reported ready. The operator subsequently completed a new encrypted snapshot and full repository integrity check, then restored each of the three databases into isolated test containers. Schema, constraints and game-data invariants passed for each store. Live production databases were untouched. These results establish post-reboot backup/restore acceptance; recovery-password storage outside the computer remains an operator responsibility and has not been independently verified.

The console expansion also captures root-private SMTP alert settings, gated-release records and monitor service/timer definitions in the encrypted configuration set when present. They are never included in the sanitized desktop status cache.
