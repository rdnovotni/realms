# Follybound

Follybound is a server-authoritative fantasy RPG in private development. Complete reusable features first, with small test fixtures; author the production world after its systems and workflows pass acceptance checks.

Start with the [documentation map](realms/docs/README.md), [current implementation status](realms/docs/implementation-status.md), and [feature-first roadmap](realms/docs/feature-roadmap.md). The [Core Bible and Systems 01–46 registry](realms/design/README.md) preserves design sources and tracks narrower implementation evidence; a partial system is not a completed feature.

| Area | Entry point |
|---|---|
| Game server, browser, persistence and local checks | [Game README](realms/README.md) |
| Server authority, ownership and versioning | [Architecture](realms/docs/architecture.md) |
| Supported HTTP surface | [API reference](realms/docs/api-reference.md) |
| Database changes through migration 031 | [Migration guide](realms/docs/migration-guide.md) |
| Feature fixtures and publication | [Content authoring](realms/docs/content-authoring.md) |
| Contributor workflow and verification | [Contributing](CONTRIBUTING.md) |
| Deployment, backups and operator tools | [Operations map](infra/docs/README.md) |
| Public pages and branding compatibility | [Follybound identity and pages](realms/docs/branding-and-pages.md) |
| Public launch gates | [Release readiness](realms/docs/release-readiness.md) |

`realms/` contains the TypeScript/Fastify game, PostgreSQL migrations, client, tests and authored test content. `infra/` contains environment templates, operator scripts, Server Console and Development Studio.

GitHub remains `rdnovotni/realms`, branch `main`; the Ubuntu canonical checkout remains `/srv/Realms/source`. These are compatibility identifiers, not the public game name. Credentials, data and backups stay outside Git. Deployed images and database versions are recorded independently: a source commit or passing test is not proof that it is running. This documentation pass does not deploy, migrate, enable flags, register accounts or activate public services.
