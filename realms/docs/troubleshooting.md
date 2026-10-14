# Development and playtest troubleshooting

Use the [operations map](../../infra/docs/README.md) for installed-service incidents. The checks here are for local source/preview work and private test players; never paste secrets or private logs into GitHub or chat.

| Symptom | Safe next step |
|---|---|
| Loading message remains after opening HTML directly | Build and serve through the game server or `npm run preview:welcome`; same-origin asset routes cannot load from a file |
| Preview login is disabled or login returns unavailable | The public preview deliberately has no authentication/gameplay backend; use an enrolled account on the actual game server |
| Public signup/newsletter/contact/payment form is absent | Those services are closed; do not invent an account/mail/payment integration to bypass the notice |
| Session expires or access is revoked | Sign in again or ask the enrolling administrator; do not share a token/password/recovery code |
| Response is lost after an action | Use the client’s exact pending retry; do not generate another spend or change the envelope |
| Stale revision or refresh required | Refresh current state before choosing again; a successful action followed by a failed read is not an uncommitted action |
| Shared action is unavailable | Check discovered authored content and reviewed controls; `shared.rules` starts disabled. Source implementation is not activation |
| Ascension cannot confirm | Obtain a current eligible preview after leaving encounters; any revision/release change requires a fresh token |
| Readiness fails after a source update | Compare the recorded image/source and database migration checksums with the reviewed rollout; do not rewrite migration history |
| Integration tests refuse the database | Supply a disposable database named `realms_test`; never repoint tests at live data |
| Infrastructure tests skip a host-dependent check | Report the skip and verify on the required host; a skip is not operational evidence |

For a bug report, include the source/build identity if known, screen and steps, expected/actual result and public error code. Leave out credentials, private account details, RNG seeds and unpublished content. Preserve the pending request privately when diagnosing ambiguous commits. Only the owning service may reconcile/repair history; direct SQL projection edits are not a support workflow.
