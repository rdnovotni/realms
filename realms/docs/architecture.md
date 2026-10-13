# Server architecture

Private-development foundation, October 7, 2026.

The server is an authoritative modular monolith: strict TypeScript, Fastify, explicit SQL, and PostgreSQL. SQL remains visible where ownership, lock ordering, transactions, and constraints matter. No ORM or additional service is required for the initial implementation.

`foundation/action.ts` serializes each account's mutations, checks a stable request envelope and expected revision, and commits state, immutable receipt, audit and outbox together. Retries return the recorded result. Database work may retry deadlocks or serialization conflicts up to three attempts; external side effects must use the outbox.

Domain modules own content, scoped state, economy, inventory, instances, lifecycle and jobs. Shared persistence does not imply shared permission: future Guild, trade, combat and admin modules must check their own authority and eligibility before calling these internal services. Clients never connect to the database or write arbitrary state keys.

Queries use projections tailored to the account's knowledge. Content views require both discovery and a run containing the requested release. Instance views require participation. Seeds, mechanics and hidden definitions do not enter those response objects.

Content identities remain stable and cannot be recycled. Definitions and release entries are immutable; publication validates dependencies and seals the exact manifest. Runs and instances pin their rules. Content updates affect new snapshots, never silently rewrite existing ones.

Seven explicit state scopes distinguish account, character, run, instance, Guild, event and world. Each has a real foreign key. Versioned state contracts declare the owning module, scope, schema, default and reset policy. Larger relational domain models should use dedicated tables rather than an untyped flag store.

Migrations are append-only and checksummed. Readiness verifies exact compatibility. The development server has a restricted SQL role; administration is separate. Local credentials and persistent data are ignored by Git, and both services bind to loopback.

The protocol is independent of the client presentation technology. Native OS clients, browser clients and later mobile clients can all use the same authenticated queries and Actions. No renderer, AI provider, payment provider or public deployment is chosen by this foundation.

See [database foundation](database-foundation.md) for contracts, coverage and operations. The next vertical slice is a real seeded encounter with committed Turn cost and outcome, a quest reward, and campaign completion through a visible Ascension transition.
