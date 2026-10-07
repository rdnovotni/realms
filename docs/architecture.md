# Initial server decisions

Status: private-development implementation baseline, October 7, 2026.

- TypeScript/Fastify and PostgreSQL implement the first authoritative Action boundary. This is a modular-monolith starting point, not a complete rules engine.
- Account, persistent character identity, and current run are separate records. Encounter/instance/world/Guild scopes will be added deliberately as their features arrive.
- Requests derive identity from a private single-user development token. Real account sessions and permission scopes are required before broader access.
- PostgreSQL transactions own costs, revisions, receipts, and ledgers. A per-account lock serializes current prototype mutations; more granular ordered locks can follow actual shared-state requirements.
- Request keys are account-scoped and checked against payload hashes. Replays return the original result; changed payloads under the same key are rejected.
- Database migrations are versioned/checksummed and applied under a transactional advisory lock. Existing migrations must not be edited after application.
- Local configuration and database data are ignored by Git. Private services listen on loopback only.
- Rootless Ubuntu package extraction is a workstation development convenience. It does not receive automatic system-package security updates; tool upgrades require rerunning a reviewed installer/update process. A managed service installation is later operational work.
- Node/PostgreSQL versions and package lock are explicit. The workstation's existing libraries remain prerequisites for extracted PostgreSQL binaries.
- No client renderer, AI provider, public deployment, payment service, or production authentication choice is committed by this bootstrap.

Next vertical slice: validated content definitions → seeded encounter creation → real Turn commitment and outcome → quest/check/effect integration → campaign completion → minimal Ascension reset with one persistent reward. Add rollover scope tests early rather than interpreting the initial seed as the final daily economy.
