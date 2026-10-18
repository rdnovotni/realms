# Follybound hosting — playfollybound.com

[Operations map](README.md) · [Current source status](../../realms/docs/implementation-status.md) · [Branding compatibility](../../realms/docs/branding-and-pages.md)

Chosen domain: `playfollybound.com`. Registrar: Porkbun. Default public hostname: the apex `playfollybound.com`, with browser assets and HTTP API on the same origin. Public DNS delegation to Cloudflare and HTTPS routing to the game were verified on 2026-10-11. Registrar account renewal/security settings and dashboard policy details remain unverified. The registrar checkout must confirm availability and the final registration/renewal prices. No purchase or public DNS change has been made by this agent.

## Service arrangement

| Component | Provider/location | Purpose |
|---|---|---|
| Domain registration | Porkbun | Own and renew the domain |
| Authoritative DNS | Operator's Cloudflare account | Domain records and delegation |
| HTTPS and outbound tunnel | Cloudflare + cloudflared | Public access without router port forwarding |
| Reverse proxy | Caddy on the Ubuntu server | Route reviewed requests to the production game |
| Backend, PostgreSQL, Valkey, workers, scheduler | Existing `/srv/Realms` infrastructure | Run the actual application and private durable storage |
| Disaster recovery | Encrypted external USB drive | Scheduled backups and isolated restore tests, including post-reboot acceptance |

Existing Ubuntu hardware is the application/database hosting. Separate Porkbun web hosting, WordPress hosting, a rented VPS, hosted PostgreSQL and a separately purchased TLS certificate are not required for this initial architecture. Domain renewals, home power/Internet and any chosen backup/email services are separate operating costs. Reassess paid infrastructure only when availability, performance or audience requirements justify it.

Only the apex game hostname is proposed for first activation. No wildcard, staging/admin hostname, public database/cache/SSH/monitoring service or direct home-IP A/AAAA record is planned. `www.playfollybound.com` can be added later as an explicitly approved HTTPS redirect with its own route/certificate coverage; it is not currently supported by the single-host proxy template. There is no game WebSocket endpoint yet.

## 1. Register the domain

Search for the exact spelling `playfollybound.com` at [Porkbun](https://porkbun.com/). Confirm availability, ordinary versus premium pricing, first-year price and renewal price in the actual checkout. Register it under the operator's account; complete the contact-email verification. Keep account recovery codes private, enable MFA, keep registrar lock enabled and configure renewal reminders/auto-renew with a valid payment method. Purchase only the domain initially. The human operator must handle login, contact details and payment; do not send those details to the assistant.

On October 11, 2026, a read-only Verisign RDAP lookup returned HTTP 404 (no registry record found). This is not a reservation or a guarantee of registrar availability. Recheck at checkout.

## 2. Create the Cloudflare DNS zone

Create the operator's Cloudflare account, enable MFA and add `playfollybound.com` using the Free website plan. Keep registration at Porkbun; this is a DNS delegation, not a registrar transfer. Review imported/parking records before changing anything. Record the exact two nameservers assigned by this zone; never use nameservers copied from examples or another account.

At Porkbun: Domain Management → domain Details → Nameservers → edit. Replace the existing nameservers with the assigned Cloudflare nameservers, then save/confirm. If DNSSEC was already enabled, follow Cloudflare's documented delegation procedure to remove the old DS configuration before switching and re-enable with Cloudflare's provided settings after activation. Existing email/web records must be preserved if the domain already has services. Wait for Cloudflare's zone to report Active.

Delegation alone does not publish this game: do not add an A/AAAA record pointing to the home IP or an application tunnel CNAME yet. A paid Cloudflare website/Zero Trust plan is not selected by this setup.

## 3. Prepare the origin and local proxy

Use the already prepared INFRA-009 scripts from `/srv/Realms/source/infra`. Deploy the existing backend's ingress protection first:

```bash
cd /srv/Realms/source/infra
sudo python3 scripts/edge.py deploy-backend
```

This is a staging-first release that briefly restarts game services, backs up the databases and preserves separate storage/credentials. It does not connect a tunnel or change public DNS. Root terminal authentication is required.

The current script intentionally uses **locally managed** Cloudflare tunnel credentials, not a dashboard-managed tunnel token. Follow [tunnel-operations.md](tunnel-operations.md) to create the named tunnel on an administration machine using official cloudflared tooling; do not start the connector or create public routes yet. Keep the broader account-management certificate on the administration machine. Supply only the matching UUID credential JSON in a private file on the server.

```bash
sudo python3 scripts/edge.py prepare \
  --hostname playfollybound.com \
  --tunnel-id REPLACE_WITH_ACTUAL_UUID \
  --credentials-file /private/path/to/tunnel.json
sudo python3 scripts/edge.py deploy-local
sudo python3 scripts/edge.py validate
```

Do not paste credentials/tokens into chat, command arguments, environment templates or source control. Only filenames and nonsecret status information are needed for coordination. Do not run placeholder commands without replacing the UUID/path.

## 4. Protect data and choose the authoritative deployment

Existing native PostgreSQL remains the source of existing game data. Container production/staging are separate stores; filesystem relocation did not migrate accounts or change game authority. Before a primary live-player cutover, define the chosen authoritative store, create a tested final backup, freeze native writers, rehearse restore into isolated storage, migrate/provision roles and validate player state, then route to exactly one authoritative backend. Retain the old native store for controlled rollback. Post-cutover rollback must reconcile newer writes rather than restore stale data.

Complete automated encrypted off-machine backup scheduling, retention, failure alerts and a full restore drill with explicit recovery-point/recovery-time objectives. A same-drive archive or readable pg_dump catalog does not prove disaster recovery. Identify an operator-owned external/offsite/object-storage destination before configuring uploads or purchasing storage.

External smoke testing may use an explicitly provisioned restricted test account in the separate container environment; public player-data cutover is a separate operation. Do not assume existing native accounts will work on the new public container backend.

## 5. Approve the exact public route

Before activation, review the hostname `playfollybound.com`, production target, current data authority, reviewed route allowlist, session authentication, private admin/staging boundary and backup status. INFRA-009 requires explicit operator approval of public exposure and public DNS activation. Registration/delegation does not substitute for that approval.

After that approval only, start the connector using the documented activation command and add a single proxied Cloudflare CNAME for `@` pointing to `<TUNNEL_UUID>.cfargotunnel.com`. The tunnel ingress must preserve Host `playfollybound.com`. No router forwarding, wildcard route, database record or origin-IP record is necessary. Confirm public HTTP redirects to HTTPS, active edge certificate coverage and API cache bypass.

From an outside Internet connection, run:

```bash
python3 scripts/verify-public.py playfollybound.com
```

Verify the correct backend, unauthorized game-state access denied, admin/metrics/readiness/secret routes denied, and no unintended origin ports reachable. Test a real approved account separately, using idempotency keys for mutation retries. Restart the tunnel and deliberately reboot the host in maintenance windows; repeat outside-network checks. Keep all credentials/session tokens out of shared output.

## 6. Finish unattended operations

Add actionable health, disk-space, database, durable-job and backup-failure alerts; configure an operator-controlled notification destination. Exercise recovery and representative load on staging, review resource budgets against the Home Assistant VM and other projects, document power-outage recovery/UPS behavior and maintain tested update/rollback procedures. Domain email is a separate decision: select outbound transactional mail only if required by the actual game's account/recovery workflow, and configure sender authentication for the selected provider rather than invent credentials or purchase email bundles by default.

Gameplay balance/content/release gates are separate from hosting readiness. Automatic daily award values remain unconfigured at the operator's request.

References: [Porkbun pricing](https://porkbun.com/products/domains), [Porkbun nameserver changes](https://kb.porkbun.com/article/22-how-to-change-nameservers), [Cloudflare full DNS setup](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/), [Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/get-started/), [Cloudflare plans](https://www.cloudflare.com/plans/zero-trust-services/).

## Observed live routing and proxy correction — 2026-10-11

The apex delegates to Cloudflare and resolves to Cloudflare edge addresses. The existing `cloudflared.service` is enabled and active, uses a dashboard-managed token, and its boot journal reports `playfollybound.com` routed to `http://127.0.0.1:13000`, with a 404 catch-all. The native and both container backends report ready locally. No Caddy listener is present on 19080/19081. Browser-style public HTTPS probes returned 200 for the landing page, liveness and session-auth configuration; unauthenticated state reads returned 401, and tested admin/metrics/secret/WebSocket routes returned 404. Readiness returned 200 publicly, so INFRA-009 route restrictions have not passed. Basic Python requests receive Cloudflare error 1010; the verification tool now sends an explicit browser-compatible user agent. This does not change Cloudflare security settings.

Adopt the existing connector rather than installing another one. Run from `/srv/Realms/source/infra`, during a brief game maintenance window:

```bash
sudo python3 scripts/edge.py deploy-backend &&
sudo python3 scripts/edge.py prepare --hostname playfollybound.com --dashboard-managed &&
sudo python3 scripts/edge.py deploy-local &&
sudo python3 scripts/edge.py validate
```

This mode prepares only the loopback Caddy service. It preserves the existing native Cloudflare connector/token and makes no public DNS or tunnel-account changes. Existing edge folders are not overwritten; investigate any refusal before retrying. The backend release briefly restarts game services, preserves databases and unrelated workloads, and sets up credentialed proxy-header handling.

After local acceptance passes, edit the existing tunnel's published route for `playfollybound.com` in Cloudflare: replace its service URL `http://127.0.0.1:13000` with `http://127.0.0.1:19081`. Retain the exact hostname, existing DNS/tunnel identity, Host handling and catch-all. This changes the already approved public game's origin to the restrictive proxy. Recheck the public landing page, assets, unauthenticated API reads and blocked private routes with `python3 scripts/verify-public.py playfollybound.com`, including an outside-network browser/device. A public production routing change does not migrate native accounts or designate a different database as authoritative.

Remaining verification: actual Caddy deployment and route change, dashboard Access/cache policies, per-client request handling, outside-LAN origin port exposure, connector interruption recovery through Caddy, and combined host-reboot recovery. Domain renewal/MFA/contact verification require registrar-account inspection; public DNS does not establish those settings. Account/browser control is unavailable in this chat; the assistant has not inspected those private dashboards.

The operator staging/production ingress release passed smoke, durable worker/scheduler receipt and preservation checks. Dashboard-managed proxy preparation completed, but Caddy validation/deployment failed before activation. The existing public origin remains unchanged. Edge command failures now retain root-private diagnostics and report common sanitized parser/daemon errors; retry only `edge.py deploy-local`, without rebuilding the backend or re-preparing the existing folder, to obtain the failure detail.

### Caddy executable capability correction

The captured error was `exec /usr/bin/caddy: operation not permitted`. The [official Alpine image](https://github.com/caddyserver/caddy-docker/blob/master/2.11/alpine/Dockerfile) sets `cap_net_bind_service=+ep` on its executable. Removing that capability from the container bounding set can prevent execution. Only Caddy now adds `NET_BIND_SERVICE` back while retaining `cap_drop: ALL`, its nonroot user, read-only filesystem and `no-new-privileges`. Both listeners remain bound to localhost/high ports; no firewall or router changes are made. The connector inherits no extra capability.

For the already staged configuration run `sudo python3 scripts/edge.py refresh-proxy` then `sudo python3 scripts/edge.py deploy-local`. Refresh verifies existing managed-file checksums, changes only the Caddy capability stanza and its tracking hash, validates Compose and starts/restarts nothing. It preserves credentials and the existing dashboard connector. Actual container startup and local route acceptance require the operator commands.

## Public proxy acceptance — 2026-10-11

The operator deployed healthy Caddy and passed local route, Host rejection, request-size, loopback binding, private DB/cache/worker/scheduler, resource/restart and unrelated-workload preservation checks. The operator then changed the existing dashboard-managed tunnel origin to `http://127.0.0.1:19081`.

Subsequent public HTTPS verification passed: liveness and session-auth configuration returned 200, unauthenticated game state returned 401, and admin/API-admin/readiness/metrics/environment/WebSocket paths returned 404. The landing page and its referenced application JavaScript, stylesheets and tavern image returned 200. This confirms the approved public path restrictions now apply. No credentials or account identifiers are recorded here.

Still unverified: representative authenticated player actions, independent mobile/outside-LAN client access, router IPv4/IPv6 origin-port exposure, connector restart and combined proxy/tunnel host-reboot recovery, dashboard cache/Access settings and registrar renewal/security settings. Public HTTPS success does not establish those separate checks or native-to-container player-data migration.

The operator reported the requested phone/mobile-data site, login and game-action check as successful. This is operator-reported outside-network acceptance; no session credentials or player data were inspected by the assistant. Connector restart and combined Caddy/tunnel reboot recovery remain pending.

After the operator restarted `cloudflared.service`, the connector was verified active and enabled at boot. The public landing page returned HTTP 200, and every public route/authentication-boundary probe passed again. Tunnel service interruption recovery is verified. Combined Caddy/tunnel host-reboot recovery and independent origin-port exposure checks remain pending.

## Combined host reboot recovery — 2026-10-11

Following the operator reboot, the host boot time advanced beyond the connector restart test. Native game/database, Docker and the existing Cloudflare connector were active; the connector and Docker were boot-enabled. Native, production and staging readiness returned HTTP 200, with production/staging reporting ready database and cache dependencies. Both Caddy loopback listeners returned healthy responses. The public landing page and every HTTPS route/authentication-boundary probe passed again, including blocked readiness/admin/metrics/environment routes. The USB filesystem mounted and both backup timers remained enabled and active. Combined public proxy/tunnel and backend reboot recovery passed.

Remaining separate checks include independent IPv4/IPv6 origin-port exposure, dashboard cache/Access policy inspection, actionable operational alerts and a reviewed release/rollback workflow. Native player-data authority/cutover and finalized gameplay schedule values remain separate decisions.

The expanded [desktop operations console](operations-console.md) now supplies a gated staging/production release workflow, USB backup/restore controls, project/service logs and monitoring. Its unattended timer was installed and verified active; local monitoring reports no active issues after Glances was restricted to localhost. Email delivery and the independent outside-origin scan remain pending operator configuration/execution.

## Updating reviewed client assets

A release with a new client stylesheet or module must also update
`infra/compose/edge/public-client-assets.json`. This explicit catalog includes
Folio styles, Character/Pack modules and local item illustrations; arbitrary
files and development routes remain denied. Authored raster art uses the same
bounded filename rule as the public backend asset route. Regression tests compare
the client entry styles/modules/art against the proxy catalog.

For an existing managed edge, staging a game image alone does not update its
Caddyfile. After reviewing the release, an operator can stage the updated reviewed
public API/static catalogs with:

```sh
cd /srv/Realms/source/infra
sudo python3 scripts/edge.py refresh-client-assets
```

This verifies managed-file hashes, retains a protected Caddyfile rollback copy,
changes only the two route expressions, validates the staged configuration using
the existing Caddy image without starting listeners, and updates its tracking
hash. Failed validation restores the previous file and manifest. Repeating it is
a no-op. It refuses customized files. Listeners, hostname, ingress credential,
Compose settings and dashboard/local connector configuration are preserved.

**This command does not restart services or claim deployment.** Caddy has its
admin interface disabled, so a running proxy requires a separately approved
restart of only the managed Caddy service to read the staged file. For the current
`/srv/Realms/projects` layout:

```sh
sudo docker --host unix:///var/run/docker.sock compose \
  --project-directory /srv/Realms/projects/kol-edge \
  --env-file /srv/Realms/projects/kol-edge/.env \
  -f /srv/Realms/projects/kol-edge/compose.yaml restart caddy
sudo python3 scripts/edge.py validate
```

On a legacy installation use the existing managed project's actual directory
(the script also supports `/srv/kol-infra/projects`). Verify stylesheet/module
requests through the public edge and repeat outside-network checks after the
restart. Do not restart the tunnel, game services or unrelated containers.

Rollback: restore the protected `Caddyfile.before-client-assets-*` copy to the
managed Caddyfile, update only its SHA-256 entry in `managed.json`, validate it,
and separately approve the same Caddy-only restart. Retain the matching prior
game image when rolling back client assets. No live refresh or restart was
performed as part of VIS-04 verification.
