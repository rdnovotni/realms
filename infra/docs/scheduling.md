# INFRA-008 — Durable rollover and scheduled jobs

## Policy status

The operator requested that automatic awards remain **unconfigured until gameplay values are finalized**. Deployment creates no schedule in the actual game schema, seeds no production Turn grant/cap, and changes no native game data. A healthy scheduler with zero configured schedules is expected. Development seed values and acceptance-fixture rewards are not launch balance decisions.

The existing TypeScript lifecycle service owns Turn replenishment and daily resets. The scheduler reuses those effects: grant `min(baseline, max(0, cap - current Turns))`, preserve over-cap Turns, increment run revision, append the Turn ledger and account/epoch receipt, reset consumption and registered `RESET_AT_ROLLOVER` scoped state, expire run rollover effects, and append the existing audit event. Encounters defer refresh. Existing account-level receipts prevent replay across Ascension.

## Clock and persistent identity

Every schedule explicitly declares an IANA timezone, minute-resolution local rollover time and first eligible civil date. No host timezone is assumed. Civil dates, rather than elapsed 24-hour intervals, identify game days. The daily rollover ID is `game-daily:YYYY-MM-DD`; its existing lifecycle epoch is the integer `YYYYMMDD`. One daily-rollover definition is permitted per database, with immutable timezone/time/policy. Changing timezone or balance after enrollment requires a reviewed transition, rather than redefining already-issued entitlements.

During a daylight-saving fold, the earlier occurrence is used. During a forward gap, execution moves to the first valid local minute after the requested time on that date. Thus 02:30 becomes 03:00 for a 02:00–03:00 gap. Ordinary game days can be 23, 24 or 25 elapsed hours. Invalid zones/dates and unsupported whole-day or greater-than-three-hour clock gaps fail closed; planner failures disable that schedule and leave a persistent error report. The resolved instant is stored with each period, so restart does not reinterpret an existing period using a new timezone database.

Clock conversion uses Node's pinned runtime and [`Intl.DateTimeFormat.formatToParts`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/formatToParts). Keep time synchronization healthy. A backwards clock jump postpones future work; a forward jump creates bounded catch-up work from the configured start date. Never set a historical start date without reviewing the resulting entitlement.

## Execution, catch-up and failures

Migration 029 adds `game_schedules`, `scheduled_periods`, `rollover_subjects` and an immutable `scheduler_execution_log`. Configuration/cursors, periods, subject outcomes and domain receipts live in PostgreSQL and its existing durable volume, never Valkey. Backup all of them together.

The planner locks schedule rows and emits at most 14 missed periods per poll (the library supports a maximum of 32). It rotates its bounded definition scan using a persisted last-planned timestamp, so future schedules cannot starve other due schedules. It advances the persisted next date in the same transaction as period/epoch creation. Repeated or concurrent planners cannot issue another identity for the same day.

Execution locks one period with `FOR UPDATE SKIP LOCKED`. Each batch enrolls at most `SCHEDULER_BATCH` eligible accounts by UUID keyset and processes at most that many pending/deferred subjects. Default 50, valid range 1–200. Only accounts created by the period's effective instant are eligible. Accounts without a current run are acknowledged without a grant. A player with an open encounter waits; their later days wait for earlier eligible epochs. Other accounts can continue. Deferred subjects retry after five seconds, and period polling yields between batches.

The run lock serializes rollover against gameplay actions. Effects, immutable account/epoch receipts, subject outcomes, batch cursor and execution log commit together. Deferred domain constraints are checked inside the retry boundary. A crash or lost connection releases PostgreSQL locks and rolls back the unfinished batch; committed earlier batches resume from the stored cursor. There is no stale lock file or in-memory timer to reconstruct. [PostgreSQL row locks](https://www.postgresql.org/docs/current/explicit-locking.html) are held by transactions and released on completion/rollback.

Failures roll back batch effects, record a safe error classification and retry after 5, 10, 20 and 40 seconds. The fifth failure becomes `FAILED`; it requires investigation and explicit resume. Successful batches reset consecutive failure attempts. Completed periods/subjects and period identities cannot be rewritten. Resuming a failed period retains its cursor and domain receipts, so it does not repeat earlier committed rewards. Database unavailability is also reported as a structured runtime log; polling resumes after recovery.

## Deployment and resources

From the repository's `infra` directory:

```bash
sudo python3 scripts/scheduler.py deploy
```

This uses the staging-first backend release workflow: readable database archives first, immutable application image, migration 029 and dedicated role provisioning, then API/worker/scheduler updates within each game project. Database/cache containers, native services and unrelated projects remain intact. It validates each scheduler and creates acceptance fixtures only in the separate `infra_scheduler_acceptance` schema. That schema has its own fixture accounts, releases, epochs and receipts; its sample Turn policy is not in player tables. Retain its markers for restart/reboot validation.

Each scheduler has a separate `realms_scheduler` login/password, four-connection role budget, 256 MiB memory cap, half-CPU budget, internal network only, no host ports, read-only filesystem, rotated logs and `unless-stopped` restart policy. Its secret mount excludes application, worker, migration and administrator credentials. It has narrowly granted rollover/state columns and scheduling tables; it cannot manage wallets, account suspension, authentication credentials, schema migrations or schedule enrollment. Read access to integrity views and sealed-release metadata supports existing domain triggers.

SIGTERM stops new batches, waits for the current transaction and closes the pool; Compose allows 45 seconds. A heartbeat reports a live polling loop; domain failures are assessed in the database execution report, not hidden behind a healthy process badge. The scheduler starts through Docker independently of graphical login.

The local administrative helper uses migration credentials only for schedule enrollment, pause/enable and failed-period resume. It exposes no network listener and is invoked through the root-only Docker socket. Configuration and secrets remain under `/srv/kol-infra/projects/`, outside Git. There is deliberately no unauthenticated administrative HTTP endpoint.

## Administrative commands

Specify the environment explicitly for every administrative operation:

```bash
sudo python3 scripts/scheduler.py report --project kol-staging
sudo python3 scripts/scheduler.py dry-run --project kol-staging
sudo python3 scripts/scheduler.py run --project kol-staging
```

`report` returns definitions, latest 100 periods with completed/deferred counts, and latest 100 execution log records. `dry-run` reads up to 14 upcoming/missed periods and eligible-account counts without creating epochs or modifying cursors, receipts or Turns. Newly configured paused schedules are included in previews. `run` performs one normal bounded planning/execution pass; it cannot force an undued day or replay a completed day. The running scheduler already polls once per second.

When gameplay values are finalized, create a paused daily definition in staging using your reviewed values, then inspect it before enabling:

```bash
sudo python3 scripts/scheduler.py configure-daily --project kol-staging \
  --timezone "$GAME_TIMEZONE" --at "$ROLLOVER_TIME" --start-date "$FIRST_GAME_DATE" \
  --turn-grant "$FINAL_TURN_GRANT" --soft-cap "$FINAL_TURN_CAP"
sudo python3 scripts/scheduler.py dry-run --project kol-staging
sudo python3 scripts/scheduler.py enable --project kol-staging --id game-daily
```

The variables above are intentional placeholders; this document supplies no reward defaults. Enabling permits immediate catch-up for all due dates since the configured first date. Repeat enrollment separately for production only after staging verification. Creating an existing schedule fails rather than silently replacing its policy.

```bash
sudo python3 scripts/scheduler.py pause --project kol-production --id game-daily
sudo python3 scripts/scheduler.py resume --project kol-staging --id 'game-daily:YYYY-MM-DD'
```

Pause scheduling before maintenance or a policy review. Pausing prevents subsequent claims; a batch already holding its database lock can finish. `resume` accepts only a failed period; inspect the error and fix its cause first. It preserves earlier successful subjects. Already committed effects cannot be reversed by pausing or clearing cache.

## Guild and event integration hooks

`ScheduleHook` in `realms/src/scheduler.ts` receives the supplied PostgreSQL client, immutable period/configuration, bounded batch size and saved cursor. It returns `{done, cursor, report}`. An owning module must register its SQL-only handler in the scheduler runtime, validate configuration and implement domain authorization/receipts before enrolling `GUILD_ACTIVITY`, `TIMED_EVENT` or another named hook. Extend role grants only for reviewed module operations. A handler must use the supplied transaction, avoid network calls, process at most the batch bound, and keep reports free of secrets/personal data. External effects belong in the existing transactional outbox with provider idempotency.

`configure-hook` supports explicitly named daily or `--once` schedules, timezone/time/start date and non-secret `--config` JSON. One-shot definitions materialize one durable period and stop planning additional dates. Missing hook implementations produce `UNREGISTERED_SCHEDULE_HOOK` retries/dead letters; they do not invent Guild rewards, reset arbitrary state or report a false successful event. No Guild or timed-event handler is enabled by this ticket.

## Validation, rollback and remaining acceptance

```bash
sudo python3 scripts/scheduler.py validate
```

Validation uses a restricted-role, separately scoped three-day fixture: bounded dry-run, concurrent processing, exact-once grants/receipts and retained checkpoints. It checks scheduler isolation/limits, stops and restarts one project's scheduler, confirms clean exit and persisted fixture results, then verifies the other project's services and unrelated workloads did not restart. It does not enable real rollover awards.

After a planned host reboot:

```bash
sudo python3 scripts/scheduler.py after-reboot
```

This requires a changed boot identity, retained game containers/database volumes and scheduler containers, healthy components and unchanged durable acceptance markers. It does not reboot the host itself.

Rollback: pause configured daily schedules or stop only the affected scheduler. Keep PostgreSQL and immutable receipts/cursors/logs. Migration 029 changes schema checksums; an older image cannot be blindly started against it. Prefer a forward fix or an application image compatible with the retained schema. Preserve the private release record and database archives. Never delete volumes or restore a pre-rollover database over later authoritative transactions without a reviewed recovery plan. Full restore drills remain a separate backup ticket.

Verified locally on 2026-10-11: TypeScript type checking and server/browser build; 119 unit tests; the full isolated PostgreSQL integration suite with 340 passing tests and zero failures, including eight scheduler cases; and 42 infrastructure tests with real Compose configuration validation. Scheduler cases cover daylight-saving gaps/folds and 23/25-hour days, bounded catch-up with concurrent planners/workers, repeated execution, over-cap preservation, daily resets, rollback/retry/dead-letter/resume, connection interruption, encounter deferral, restricted-role execution, paused previews and fairness across definitions. Older restricted-role test wrappers were updated to forward actual client error listeners, retaining the existing permission-denial assertions.

Verified from the operator's successful deployment output on 2026-10-11: the application image built, migration/role setup and staging-first release passed, and both schedulers were healthy with private networking, dedicated credentials, memory caps and automatic restart policies. Each environment passed bounded dry-run verification, concurrent fixture processing, exactly-once three-day grants and durable receipts/checkpoints. Clean scheduler shutdown/restart retained the fixture outcomes without replay. The other environment's services and unrelated workloads remained intact. Both actual game schemas reported zero configured schedules, preserving the operator's decision to leave awards unconfigured. The run ended with `Scheduler initial acceptance passed`.

Independently checked afterward: native, production and staging readiness endpoints returned HTTP 200; both container APIs reported database and cache ready. INFRA-008 host-reboot acceptance passed in the operator's output on 2026-10-11. An actual reboot after scheduler acceptance was confirmed; both environments retained their game containers, database volumes and schedulers. Scheduler health, private networking, memory caps, restart policies and dedicated credentials passed again. Both environments retained three fixture-day grants exactly once, one account receipt per day and completed checkpoints; completed periods could not replay. Both actual game schemas still reported zero configured schedules. The run ended with `Scheduler reboot acceptance passed`. Initial deployment and reboot acceptance are now verified. Actual gameplay policy enrollment remains intentionally unconfigured until values are finalized. Native-data cutover, Guild/event handler authoring and a full off-machine backup/restore drill remain separate work. Raw host identifiers and credentials are excluded from this report.
