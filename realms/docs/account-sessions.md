# Accounts and sessions

Migration 005 implements password credentials, scoped device sessions, offline recovery, throttling and immutable security events. Existing accounts and game data are preserved; passwords are not automatically enrolled and public registration is not enabled.

## Authority and storage

Login handles are case-insensitive ASCII identifiers, separate from stable account/character IDs and future display names. Enrollment is administration-only; the runtime SQL role cannot insert credentials, change handles or suspend players.

Password verifiers use asynchronous Node scrypt with independent 16-byte salts and versioned parameters N=131072, r=8, p=1. Only the salt and 32-byte verifier are stored. New passwords contain 15–128 Unicode code points, without trimming or truncation; malformed UTF-8 input is refused. The process permits two simultaneous derivations, returning AUTH_BUSY rather than growing an unbounded queue. Parameters follow [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), implemented through [Node crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html).

Session and recovery secrets contain 32 random bytes and are returned only at issuance. PostgreSQL stores SHA-256 digests, never bearer secrets. Tokens use distinct rs1_ and rc1_ prefixes. Unknown handles, wrong passwords and suspended accounts share a login failure response; unknown handles still perform password derivation.

Sessions have immutable ownership, scopes and 12-hour absolute expiration. Thirty minutes of inactivity also invalidates them. Requests update last-seen time. The ten-device limit revokes the oldest active session when necessary and retains a security event. Session IDs alone are not credentials. Session listing returns owner-visible labels, timestamps and scopes, never verifiers or digests.

Scopes are GAME_READ, GAME_WRITE and ACCOUNT_MANAGE. Login issues all three player scopes or GAME_READ alone when explicitly requested. None grants staff administration. Routes derive account identity from the session; clients cannot supply an actor or session principal in an Action body.

An Action locks its account and rechecks session ownership, scope, expiration, revocation and security epoch **before receipt replay or mutation**. Authentication performed by the HTTP hook cannot bypass a revocation committed while the Action waits for a lock. Suspended accounts also fail trusted internal Actions. Password verification runs outside the mutation transaction; login/password change recheck the credential revision after locking and reject obsolete verification results.

## Recovery and security history

Enrollment returns eight one-use recovery codes valid for 365 days. Codes belong to the password revision, independently of the session epoch. Logout-all preserves recovery. Password change and recovery invalidate old codes and sessions and return a fresh set of codes. Recovery does not automatically log in.

Account locks and terminal use markers prevent simultaneous recovery requests from spending a code twice. Suspension blocks login and recovery; reactivation increments the epoch again so earlier sessions remain invalid. SQL password updates automatically advance the epoch. SQL suspension/reactivation and individual revocations create immutable events. Safe history retention/redaction remains administration work.

Before expensive password work, HTTP requests reserve persistent PostgreSQL throttle buckets: 30 attempts per peer per minute and 10 per handle per ten minutes. Buckets use a private HMAC key without raw peer addresses or handles, survive restart and serialize concurrent requests. Login/recovery share the handle budget; password change also uses the peer budget. `pruneAuthThrottle` removes up to 1,000 expired buckets per call; a supervised maintenance worker must invoke it before public operation. Fastify uses the direct socket peer; a future reverse proxy needs an explicit trusted-proxy and edge-rate policy.

## HTTP contracts in session mode

API responses use Cache-Control: no-store. Authorization headers and request bodies are redacted from logs. Tokens are accepted through Authorization: Bearer, never query strings or cookies.

| Endpoint | Input/authority | Result |
|---|---|---|
| POST /api/v1/auth/login | handle, password, deviceLabel, optional readOnly | One-time token, session/account ID, expiration |
| POST /api/v1/auth/recover | handle, recoveryCode, newPassword | Replacement recovery codes; login required afterward |
| GET /api/v1/auth/sessions | ACCOUNT_MANAGE | Own session history, up to 100 latest rows |
| POST /api/v1/auth/logout | Any current session | Revoke that session |
| DELETE /api/v1/auth/sessions/:id | Owned session; ACCOUNT_MANAGE for another device | Revoke the selected session |
| POST /api/v1/auth/logout-all | ACCOUNT_MANAGE | Invalidate all current sessions |
| POST /api/v1/auth/password | ACCOUNT_MANAGE plus currentPassword and newPassword | Change password, invalidate sessions, return replacement recovery codes |

State/content/instance/Action endpoints resolve the account from the session. Development mode retains the original single-user credential and exposes no authentication endpoints. Modes cannot fall back to one another.

## Private workstation setup

The workstation continues in development mode until a password is deliberately enrolled. Create an owner-only JSON file under .state with accountId, handle and password for an existing account. Keep passwords out of command arguments, source and logs. Run:

```bash
bash scripts/runtime.sh npm run db:auth-enroll -- .state/enroll.json
```

The command accepts only the local development administration connection, refuses broadly readable/symlink inputs and writes codes to an exclusive owner-only file under .state/recovery. Move the codes to independent private storage and remove the plaintext enrollment input after verifying the result. If file writing fails after enrollment commits, authenticate with the known password and change it to obtain new codes; do not assume enrollment rolled back.

Set AUTH_MODE=sessions in the private administration .env and restart the private server. Startup generates AUTH_THROTTLE_KEY when missing. The owner-only .state/runtime.env contains allowed runtime settings; session mode excludes both development credential fields. The child server clears inherited configuration overrides and starts with that file. `serverConfig` rejects administration/test/enrollment secrets, and startup checks exact migrations and restricted SQL privileges. Administration scripts continue using the separate administration configuration.

This excludes administration credentials from the HTTP process environment. Both files remain readable by the same workstation OS user; production still needs separate OS identities and managed secrets for stronger isolation. The server binds only to loopback.

## Evidence and remaining release work

Tests cover salts, Unicode, work limits, restart persistence, cross-account denial, read-only scopes, replay after revocation, idle/absolute expiry, suspension/reactivation, password changes, concurrent recovery, device limits, persistent throttles, SQL privileges and runtime configuration filtering. Restore verification checks all new migrations, constraints and foreign-key index coverage.

Public launch still requires account creation/onboarding, compromised-password filtering, verified recovery/contact policy, stronger staff authentication (MFA/passkeys), granular staff roles and approval workflows, secure client token handling, HTTPS deployment, trusted-proxy/edge abuse controls, throttle maintenance, session-history pagination and privacy/retention procedures. [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) informs transport and lifecycle requirements. Credential/session persistence is implemented; the complete public identity product remains a release gate.
