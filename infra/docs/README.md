# Follybound operations documentation

The game name is Follybound; repository, `/srv/Realms`, backup, database and service identifiers remain compatible. This index organizes the existing runbooks. Dated installation/audit results describe their recorded checkpoint; this documentation update does not reverify a host or deploy code. Use recorded image/source identity, migration readiness and fresh operational checks to establish current service state.

Start with [the development baseline](development-baseline.md), [game update guide](game-update-guide.md) and [operations console](operations-console.md). [Game implementation status](../../realms/docs/implementation-status.md) and [release readiness](../../realms/docs/release-readiness.md) distinguish source features from launch gates.

## Runbooks

- [INFRA-007 — Backend deployment and recovery](backend-deployment.md)
- [INFRA-006: disposable Valkey and durable workers](cache-worker-operations.md)
- [Authoritative development and verification baseline](development-baseline.md)
- [Follybound Development Studio](development-studio.md)
- [INFRA-004: Docker and multiple projects](docker-operations.md)
- [Publish a game update from testing to live](game-update-guide.md)
- [INFRA-001 — Hardware and configuration inventory](hardware-inventory.md)
- [INFRA-002 — Ubuntu 24/7 operation](headless-operation.md)
- [Encrypted external-drive backups](local-backups.md)
- [Follybound desktop operations](operations-console.md)
- [Follybound hosting — playfollybound.com](playfollybound-hosting.md)
- [INFRA-005: durable PostgreSQL stores](postgresql-operations.md)
- [Consolidate the server under /srv/Realms](realms-storage-layout.md)
- [INFRA-002 — Rollback](rollback.md)
- [INFRA-008 — Durable rollover and scheduled jobs](scheduling.md)
- [Follybound Server Console](server-console.md)
- [INFRA-001 — Server readiness and next ticket](server-readiness.md)
- [INFRA-002 — Startup validation checklist](startup-validation.md)
- [INFRA-009 — Caddy and Cloudflare Tunnel](tunnel-operations.md)

[Environment templates](../templates/README.md) · [Repository guide](../../README.md) · [Contributor checks](../../CONTRIBUTING.md)

Apply reviewed test builds before public promotion. Privileged installers, migrations, routing, credentials and restore operations require the owning runbook and operator approval. Closing a desktop app does not stop hosted services; editing source does not update installed launcher entries or protected administrator bundles.
