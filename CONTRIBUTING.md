# Contributing to Follybound

Read [AGENTS.md](AGENTS.md), the [documentation map](realms/docs/README.md) and [current status](realms/docs/implementation-status.md) before changing a system. Keep source work separate from installed runtimes, private databases and unrelated applications.

## Development workflow

1. Inspect the working tree and create a focused branch from the verified source checkpoint. Preserve other changes. Keep secrets, dumps, logs and player data out of commits.
2. Find the owning design entry and approved corrections in [the registry](realms/design/README.md). Describe authority, scope/lifetime, costs/rewards, clocks, failure behavior and release compatibility before implementing a new feature.
3. Use the common Action pipeline and shared rules; clients submit intent. New content is a minimal test fixture until the feature and its workflow are complete. Preserve historical formulas, content revisions and migration checksums.
4. Run appropriate verification against disposable test data. Update the implementation document, status/roadmap if a gate changed, and registry evidence only for requirements actually demonstrated.
5. Review a pull request and its checks. Source merge, frozen release verification, test deployment approval and live activation are separate decisions. Use the [game update guide](infra/docs/game-update-guide.md) for an approved rollout.

## Verification

From `realms/`, using a supported Node runtime and installed lockfile dependencies:

```bash
npm run typecheck
npm run content:check
npm run features:check
npm test
npm run build
```

Database suites require a dedicated database named `realms_test`, supplied by `TEST_DATABASE_URL`, and a local `.env` file (the CI workflow uses a copy of `.env.example`). Never point them at a live store. From `realms/`, after configuring that disposable database:

```bash
npm run test:integration
npm run test:workers
npm run test:runtime
```

From the repository root:

```bash
python3 infra/scripts/documentation-check.py
python3 -m unittest discover -s infra/tests
```

GitHub [Server checks](.github/workflows/checks.yml) also verifies the exact frozen source checkpoint on isolated PostgreSQL. Infrastructure checks dependent on an installed host may skip outside that host; report skips, do not label them as verified deployment.

## Documentation rules

Use Follybound for current product names. Keep technical paths, environment variables, package names and database/service keys compatible; see [branding](realms/docs/branding-and-pages.md). Preserve dated audit evidence and original design/provenance text. State “implemented,” “fixture-verified,” “planned,” or “deployment-verified” with the evidence and its scope. Do not turn an old audit into a claim about current uptime or configuration.

Link every maintained guide from a documentation index. Update public announcements and policy descriptions when behavior changes; never invent public contact channels, payment services or community invitations. Verify changed pages on desktop and a narrow mobile viewport using the [public preview](realms/docs/game-client.md).
