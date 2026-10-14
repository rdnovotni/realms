# Consolidate the server under /srv/Realms

[Operations map](README.md) · [Current source status](../../realms/docs/implementation-status.md) · [Branding compatibility](../../realms/docs/branding-and-pages.md)

Status: operator-executed migration completed successfully on October 11, 2026. Post-migration checks passed; operator-supplied host-reboot acceptance passed. Interactive administrator authentication is required for privileged validation and recovery. `Realms` is the requested spelling, including the capital R.

## Proposed permanent layout

```text
/srv/Realms/
├── README.txt             folder guide, created after successful migration
├── source/                entire existing KoL2 repository, including Git and local files
├── native/realms/          existing native runtime and its authoritative database
│   ├── .state/postgres/    original PostgreSQL cluster, same data and service identity
│   ├── .state/backups/     original native database archives
│   ├── .state/runtime.env  private native runtime settings
│   ├── .local/             existing Node and PostgreSQL tools
│   └── dist/               compiled native backend
├── projects/              existing Compose project folders, secrets and backups
│   ├── kol-production/
│   ├── kol-staging/
│   ├── infra-test-a/
│   ├── infra-test-b/
│   └── example-project/
├── data/                  root-private parent; PostgreSQL handles these files
│   ├── kol-production/database/
│   └── kol-staging/database/
├── state/                 private deployment records and acceptance baselines
│   └── install-records/   existing private Docker installation records
├── system-tools/          existing root-owned native startup helpers
└── relocation/            root-private migration journal and recovery files
```

The native, production and staging databases remain distinct. This is a filesystem relocation, not an authority cutover, schema change, game deployment or migration of native data into container production. Existing images and configuration are reused. No gameplay awards or public tunnel routes are enabled.

Docker Engine, container images/writable layers, fixture/unrelated volumes and OS files remain in their standard directories. In particular, moving `/var/lib/docker` would unnecessarily affect unrelated workloads. `/etc/systemd/system` retains boot service definitions and standard system logs stay under `/var/log`. The two game database volumes become explicit external Docker local-driver volumes bound to their new physical directories. Compose does not manage/delete their backing directories.

Existing repository/runtime/project/state/helper paths become compatibility symlinks, so launchers and previously installed scripts continue working. Infrastructure tools prefer the new canonical project/state directories after relocation. Source remains editable by its original owner; runtime identity, database ownership and private file permissions are preserved. Credentials never move into the source tree.

## Run the checked migration

Use the server desktop terminal. Close the server control panel and avoid concurrent deployments or direct database administration during this maintenance window. Enter sudo passwords only into the terminal.

From the existing repository's `infra` directory:

```bash
sudo python3 scripts/relocate-realms.py plan
sudo python3 scripts/relocate-realms.py apply
```

`plan` is read-only and performs the same prerequisite checks used before applying. It verifies current health, native service identity/boot configuration, managed Compose files, ordinary unshared local database volumes, absence of external tablespaces/links or an active public tunnel, same-filesystem directory moves, destination availability and free-space margin. It refuses customized unit drop-ins, ambiguous storage, non-loopback game publication, reused destination volumes or an existing `/srv/Realms` directory. No software is installed and nothing is rebooted.

`apply` briefly stops application/worker/scheduler writers, creates readable database backups, checks PostgreSQL control files to confirm clean shutdown, copies both container database directories and compares file contents/ownership/modes/timestamps/link identity. It retains the original volumes, creates dedicated bound volumes, moves the repository/runtime/project/state/helper directories and updates the native systemd paths. It restarts the existing databases and applications and verifies actual durable receipts, schema/runtime permissions, readiness, private storage, boot enablement, and unrelated workload identities/start times. It does not rebuild images, run migrations, delete original volumes or expose a service.

The source directory move includes existing untracked content and Git history. The native runtime directory move preserves the complete native cluster, including development/test databases and cluster roles. Existing absolute references remain usable through compatibility links.

On failure, the script attempts a data-preserving rollback. Do not rerun `apply` over a partial destination. Preserve all files and review the private journal before recovery. Command error output is intentionally withheld when it could disclose configuration; inspect service status locally.

## Validate and navigate

After successful migration:

```bash
cd /srv/Realms/source/infra
sudo python3 scripts/relocate-realms.py validate
```

Open `/srv/Realms/source` for source work. The desktop console's existing launcher continues working through its old-path link. Private data/configuration folders appropriately require administrator access.

A host reboot is not performed automatically. After an operator-initiated reboot:

```bash
cd /srv/Realms/source/infra
sudo python3 scripts/relocate-realms.py after-reboot
```

This requires a changed boot identity and checks the same migrated container/volume identities, scheduler persistence, database readiness and actual bound storage. Unrelated containers should retain their identities/images after reboot; their process start times are expected to change. Existing INFRA-005/006/007/008 acceptance records are refreshed only after durable-record verification, to account for the intentional database container/volume replacement. This does not claim reboot acceptance before a reboot occurs.

## Rollback

For an operator-requested rollback, use the same script through either source path:

```bash
sudo python3 /srv/Realms/source/infra/scripts/relocate-realms.py rollback
```

Rollback first stops writers and databases. If relocated databases have been started, it copies their **latest** cold contents back to the original volume directories; it never swaps in a stale pre-move database after newer writes. The original pre-move copy is retained separately in the private relocation folder. It restores prior Compose/env/unit files, moves ordinary directories back, leaves new-path compatibility aliases, restarts and verifies the databases. No volumes or recovery copies are deleted. If graceful stop or copy verification fails, recovery stops rather than copying live or unverified data.

Do not manually restore an old dump over current data, remove compatibility links, run `docker compose down -v`, delete old volumes, or prune the retained recovery copies until migration/reboot validation and a proper backup/recovery procedure are complete. This relocation keeps everything on the same physical drive; it does not provide off-machine disaster recovery.

## Evidence

62 infrastructure tests pass, including workspace checks that cover verified cold copies, permissions/link preservation, interrupted-rename recovery, post-move-write preservation during rollback, refusal of ambiguous layouts, read-only plan dispatch, template recognition, and official Compose resolution of ordinary versus relocated external volume identities. Operator output verifies host-root preflight and actual service relocation. Operator-supplied host-reboot acceptance passed. No migration journal or real host identifier is committed to the repository.

## First attempt and corrected retry

The operator's first attempt on October 11, 2026 passed preflight, created readable database backups and stopped the services, then failed before any directory or database-volume cutover. The initial cluster check counted per-database `PG_VERSION` files as separate clusters. Automatic rollback completed and durable database/worker/scheduler verification passed. Direct read-only checks subsequently confirmed native, production and staging readiness returned HTTP 200, and native service directories remained at their original paths.

The corrected check recognizes a cluster root by `global/pg_control`, ignoring per-database version files, and now checks cluster identity during preflight before stopping services. A read-only check of the existing native cluster confirmed this distinction (six version files, one real cluster root). Regression tests cover nested database version files and rejection of multiple real clusters.

For this specific early, fully rolled-back attempt:

```bash
sudo python3 scripts/relocate-realms.py retry
```

Retry requires a healthy original deployment, a rolled-back journal with no directory moves or started destination databases, no destination volumes and no unexpected destination files. It preserves the failed attempt under the root-private `/srv/Realms-relocation-history/` directory before running the complete checked migration again. It does not delete recovery files or bypass preflight. Later/partial cutovers require explicit recovery review instead of this automatic retry. The corrected retry subsequently completed successfully; operator-supplied reboot acceptance passed.

## Successful migration acceptance

The operator-supplied retry output confirms both cold database copies were verified, the complete migration succeeded, durable database/worker/scheduler receipts and restricted roles were preserved, and unrelated workloads were unchanged. Direct local observation confirms both native systemd services are active with WorkingDirectory `/srv/Realms/native/realms`, the source and project directories exist at their new locations, and the old project path is a compatibility link. Native, production and staging readiness all return HTTP 200 after migration.

Compose warnings about the old `kol-production_database` and `kol-staging_database` volumes are expected: those volumes are intentionally retained for rollback, while the active databases use their new Follybound-bound volumes. Do not remove the retained originals based solely on these warnings. Source work should now use `/srv/Realms/source`; operator-supplied host-reboot acceptance has passed for the new layout. No Internet exposure or authority cutover occurred.

## Reboot acceptance and validation-helper correction

The operator supplied successful `after-reboot` output on October 11, 2026. The verifier checked an actual changed boot identity and retained migrated database/application/worker/scheduler/volume identities before running persistence checks. Both native services remain active with their new runtime directory. Protected database permissions, durable worker receipts, scheduler checkpoints and exactly-once fixture grants passed again; actual gameplay schedules remain unconfigured.

The older test helper unexpectedly reconciled and recreated the two disposable Valkey containers during verification. This was observed after initial reboot identity checks; it must not be described as unchanged cache containers throughout validation. Verification helpers now use `--no-deps` to avoid starting or recreating database/cache dependencies. A successful `validate` refreshes the migration's private identity baseline after helper completion. Run it once after this correction before the next reboot check to record the already-recreated cache identities. No further reboot is needed for this baseline refresh, and no authoritative database restore or migration is involved.

The operator subsequently ran the corrected `validate` successfully. Durable receipts and scheduler checkpoints passed again, unrelated workloads were unchanged, and no running service was reported recreated. The successful validator refreshed the migration identity baseline after the earlier disposable-cache replacements. The post-correction baseline refresh is complete.
