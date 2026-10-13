# AGENTS.md — KoL 2.0 Self-Hosted Infrastructure

## Project
KoL 2.0 is an always-online, server-authoritative fantasy RPG with persistent accounts, characters, inventory, Guilds, trade, a player economy, daily rollover, and multiplayer functionality.

## Host Environment
- Existing Ubuntu installation, potentially Ubuntu Desktop
- 16 GB system RAM
- Approximately 500 GB local storage
- Dedicated 24/7 physical server
- Also hosts unrelated personal projects
- Administered remotely from a separate laptop

## Rules
1. **Never reinstall Ubuntu, repartition disks, erase data, or remove the desktop environment without explicit approval.**
2. Audit the existing machine before installing or modifying services.
3. Preserve existing applications, Docker resources, accounts, and configuration.
4. Use version-controlled infrastructure configuration wherever practical.
5. Never commit passwords, private keys, tokens, database contents, or production environment files.
6. Bind databases, caches, and private administration endpoints to internal networks only.
7. Never change SSH authentication or firewall settings until alternate access has been verified.
8. Require approval before rebooting, changing networking, exposing public services, deleting resources, migrating production databases, or modifying external accounts.
9. Maintain isolated environments for game production, staging, and other projects.
10. The game server owns all authoritative game state. Clients and AI services must not directly determine permanent rewards or economic transactions.
11. Ensure all critical jobs are idempotent, observable, and recoverable.
12. Every infrastructure change requires verification instructions and a rollback strategy.
13. Do not claim that anything has been installed or tested unless it has actually been executed and verified.
14. Prefer lightweight services suitable for a 16 GB single-server installation.
15. Do not introduce Kubernetes, distributed databases, or unnecessary microservices.
16. Prioritize recoverability, security, and maintainability over architectural complexity.

## Ticket Workflow
For each ticket:
1. Inspect the existing repository and relevant host configuration.
2. Identify dependencies and possible conflicts.
3. Describe the intended changes before high-risk execution.
4. Implement the smallest complete solution.
5. Run relevant tests and configuration validation.
6. Document how to operate the component.
7. Report completed changes, failed tests, manual requirements, and outstanding risks.

Infrastructure should remain portable to another Ubuntu server without substantial redesign.
