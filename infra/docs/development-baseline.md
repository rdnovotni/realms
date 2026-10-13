# Authoritative development and verification baseline

`/srv/Realms/source` and GitHub `rdnovotni/realms`, branch `main`, own source. A source commit is not evidence that its code is running. Production and staging run immutable images recorded separately; each database retains its own migration and content versions.

| Surface | Location / identity | Authority |
|---|---|---|
| Master source | `/srv/Realms/source` | Game, infrastructure, Studio and Console source |
| GitHub | `https://github.com/rdnovotni/realms`, `main` | Published source history; CI does not deploy |
| Public game | `kol-production`, localhost API port 13000 | Public container player database |
| Private staging | `kol-staging`, localhost API port 13001 | Separate test accounts, credentials and database |
| Native runtime | `/srv/Realms/native/realms`, port 3000 | Separate legacy/local game database; not the canonical editing checkout |
| Synced design mirror | ChatGPT project `sources/` | Read-only design references |

The managed Caddy ingress forwards public traffic to production port 13000. A fresh live baseline verifies that routing; cached health alone cannot prove it. Source reconciliation did not merge native players into production. Preserve all three databases until a separate reviewed custody/cutover decision.

## Observe identity

From `/srv/Realms/source`:

```bash
python3 infra/scripts/development-baseline.py
sudo python3 infra/scripts/development-baseline.py --live
```

The default reports source commit/tree, last-fetched main, local migration hashes and content package, plus timestamped sanitized monitoring observations. The live mode inspects container image revision labels, applied migration names/checksums, sealed content-release metadata and aggregate current-run counts, using read-only SQL. It separately reads native migration/content metadata through the native runtime’s private configuration. It prints no credentials or player payloads. Unknown legacy image provenance stays unknown.

Compare source migration hashes with applied hashes, and image labels with recorded release commits. Different databases/content releases are allowed; differences must be explained rather than silently synchronized. Runs remain pinned to content. Importing a package is not an enrollment or rollout policy.

## Recorded initial evidence — October 12, 2026

Before this ticket, canonical HEAD and last-fetched main were `7006b27d56373b0a5e8e102daacb4f9d7a2fe878`; [Server checks run 38327683075](https://github.com/rdnovotni/realms/actions/runs/38327683075) passed for that commit. Both monitored container environments used image `sha256:5b7719e7f334b031c3554867296287a2c5aaa767aeb4b20f449312f663e75516`. The historical reconciliation record reports 180 initial matching artifacts, then 179 with an intentional package.json metadata change. This is historical artifact evidence, not a revision label on that legacy image.

Monitoring reported native/production/staging ready, enabled supervision, mounted USB storage, successful encrypted backup and restore checks. Email delivery, external origin scanning and gated production release rehearsal remained pending. Re-run observations before operating; do not use this paragraph as current health certification.

The master authored package was empty. Fixtures may exist in separate databases; use the live release inventory to identify them. This ticket changes verification and operating tools, not production content or player migration.

## Exact-checkpoint verification

GitHub CI runs type checking, unit tests, content validation, all database integrations, worker/runtime integrations, infrastructure regressions and build. A second job exercises the actual release Docker verification path for its exact Git checkpoint. Database tests only accept `realms_test` and use disposable schemas. Optional desktop/Caddy/Compose/restore checks state their skips explicitly; CI success is not a live infrastructure acceptance claim.

The release path freezes a recorded Git commit. Its verification image runs database integration, worker and runtime suites against a uniquely named PostgreSQL container on a new internal network, without published ports, live credentials, host database mounts or live network membership. PostgreSQL uses disposable tmpfs storage. Cleanup targets only the UUID resources created by that verification. The exact commit's typecheck/unit/content/build checks run during its image build.

The same path can be exercised without staging or deployment on a machine with authorized Docker access:

```bash
python3 infra/scripts/verify-checkpoint.py --source-commit FULL_REVIEWED_COMMIT_SHA
```

Only after verification passes does staging deployment begin. The release receipt binds successful checks to source commit, runtime image and exact migration manifest. Promotion requires that receipt and manual staging approval for the same image/schema. Missing or mismatched verification requires a new build; historical release records are not retroactively certified.

Refresh the protected Console runtime after updating its source because it imports the release verification helper:

```bash
sudo python3 /srv/Realms/source/infra/scripts/console-admin.py install
```

This is an operator action; source publication alone does not update the protected bundle.

## Controlled rehearsal

1. Synchronize a clean canonical checkout with the reviewed GitHub commit. Record the full SHA and live baseline. Confirm no pending migrations for this verification-only ticket.
2. Refresh protected operator tools and create a staging build:

```bash
cd /srv/Realms/source
SOURCE_COMMIT=$(git rev-parse HEAD)
sudo python3 infra/scripts/releases.py stage --source-commit "$SOURCE_COMMIT" --label 'P1 verification rehearsal'
sudo python3 infra/scripts/releases.py history
```

3. Use a separate enrolled staging account. Verify login, state loading, a representative saved Action, reconnect and retry behavior. Do not use live player credentials or invent a passed manual receipt. An empty content database requires a separately prepared test fixture; it does not prove gameplay.
4. Record approval, inspect the plan and promote only the selected exact release:

```bash
sudo python3 infra/scripts/releases.py verify-staging --release ACTUAL_RELEASE_ID --confirm-manual-test
sudo python3 infra/scripts/releases.py plan --release ACTUAL_RELEASE_ID --project kol-production
sudo python3 infra/scripts/releases.py promote --release ACTUAL_RELEASE_ID --approve-production
sudo python3 infra/scripts/development-baseline.py --live
```

5. Verify public login/game behavior and retained player state. Record source/image/schema, backups, approval, final health and any failed phase. Keep manual acceptance open until it happened.

The CLI flow assumes source is already published. Studio's combined flow checks staging, pushes the exact commit, then promotes. Its publication ledger distinguishes push-started, uncertain push, GitHub-updated/live-pending, deployment failure and completion. Regression tests simulate failed push and failed deployment; they are not an actual live deployment drill.

If deployment fails after GitHub succeeds, inspect the image and release record before retrying. Keep GitHub history intact. Use compatible code rollback or a forward fix; never restore old player data merely to align source history. For this migration-free rehearsal, the retained prior image is eligible only if its migration manifest still matches. Rollback remains explicit and backed up.

## Completion record

Close P1 only after the expanded checks pass for the published source and the controlled staging/manual approval/production rehearsal has live evidence. Root authentication, staging credentials and manual gameplay observations cannot be inferred from unit tests. Remaining email/exposure/disaster-recovery work belongs to the separate operations gates.
