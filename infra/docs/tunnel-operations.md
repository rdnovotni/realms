# INFRA-009 — Caddy and Cloudflare Tunnel

Implementation is prepared; public deployment is not activated. Actual domain, locally managed tunnel UUID and credentials must come from the operator. DNS creation and public tunnel startup require separate explicit approval. This ticket does not migrate the native authoritative database or configure gameplay awards.

## Design and boundaries

A pinned Caddy 2.11.7 container serves only reviewed production game paths on 127.0.0.1:19080 (local probes) and 127.0.0.1:19081 (connector). Pinned cloudflared 2026.10.0 establishes outbound connections; its metrics bind 127.0.0.1:19091. Both containers have 128 MiB memory limits, CPU limits, bounded local logs, read-only filesystems, dropped capabilities and automatic restart. Caddy's administrative API and automatic certificate issuance are disabled. Cloudflare terminates public HTTPS; local HTTP traverses only loopback. No ports 80/443 are opened, no firewall/router configuration is changed and no certificate verification is disabled.

Host networking deliberately allows the connector to reach loopback without attaching it to a game's private database network. It also grants these containers access to other host-local listeners: treat both as trusted infrastructure, keep images patched, never mount the Docker socket or expose their configuration files. Root and local host administrators are in the trust boundary. This is not network isolation against a compromised connector.

Only production port 13000 is proxied. Staging, the desktop control panel, administrative tools, metrics and detailed readiness remain local. Unknown hosts and paths return 404. Public paths are enumerated in `infra/compose/edge/public-api-paths.json`; adding new routes requires review. There is no wildcard API forwarding or generic TCP/SSH forwarding. Backend session authentication and server-side authorization still apply to every protected game action.

Caddy overwrites incoming proxy identity headers with a private 256-bit gateway credential. The backend distrusts standard Forwarded/X-Forwarded-* headers; it accepts the separate canonical rate-limit identity only with the matching gateway credential and a valid IP. The local probe listener derives identity from its socket and ignores CF-Connecting-IP. The tunnel listener relies on Cloudflare's canonical CF-Connecting-IP header through the trusted local connector. Never expose the tunnel listener to LAN/Internet traffic. Missing or invalid canonical identity falls back to the socket identity, keeping budgets conservative. The shared credential is separate from database/auth secrets and never grants gameplay authorization.

Caddy and Fastify cap request bodies at 16 KiB; header/body/dial/response timeouts bound slow requests. The backend's bounded in-memory API budget starts at 120 requests per peer per minute (10,000 buckets maximum), returning 429 with Retry-After. `API_REQUESTS_PER_MINUTE` may be adjusted after load testing. NAT users share a peer budget. This process-local budget resets on restart; durable PostgreSQL-backed login/recovery/password throttles remain authoritative. CDN caching should be bypassed for `/api/*`; responses already use no-store. Do not enable Cloudflare features that replace API JSON with interactive challenges without testing clients.

## WebSocket status

The inspected backend and browser client use HTTP, with no implemented WebSocket protocol or endpoint. Caddy reverse_proxy supports upgrades without special rewrites, but `/ws` is deliberately denied because no game endpoint exists. WebSocket gameplay/reconnect acceptance is **not applicable to the current backend and remains pending if introduced**. Do not report a generic echo test as proof that game WebSockets work. A later endpoint must authenticate sessions, re-fetch authoritative state after reconnect, and reuse request IDs for retrying mutations rather than blindly replaying rewards. Test an actual client through tunnel stop/start once that endpoint exists.

## Stage and deploy locally

From the repository's `infra` directory:

```bash
sudo python3 scripts/edge.py deploy-backend
```

This performs the existing staging-first release with backups, installs the gateway secret reader and API budgets, and preserves database/cache containers, existing data and unrelated projects. It updates prior acceptance baselines after verifying retained scheduler records. It briefly stops/recreates the game API/workers/schedulers; run during an appropriate maintenance window. It does not start a tunnel or change DNS.

Create a **locally managed** Cloudflare tunnel using the official operator-side procedure below. A remotely managed tunnel token is a different credential type and is intentionally rejected. Keep the UUID JSON file private; do not paste it into chat, commit it, or place it in an environment variable/command argument. Supply its path only:

```bash
sudo python3 scripts/edge.py prepare \
  --hostname game.example.com \
  --tunnel-id 00000000-0000-0000-0000-000000000000 \
  --credentials-file /private/operator-path/tunnel.json
sudo python3 scripts/edge.py deploy-local
sudo python3 scripts/edge.py validate
```

Replace example values with the agreed hostname/UUID. Private runtime files live under `/srv/kol-infra/projects/kol-edge` (root-only directory). Configuration contains the gateway secret, so never share generated Caddyfiles, Compose inspect/config output, or private files. Preparation refuses to overwrite an existing edge directory; later operations refuse customized managed files. If credentials are supplied later, use `edge.py credentials --credentials-file /private/operator-path/tunnel.json`; it imports credentials without starting the connector. Existing tunnel credentials must be rotated only after stopping the tunnel.

## Operator-side Cloudflare provisioning and approval

Use the official cloudflared installation instructions on an administration machine; do not install another server daemon. For a locally managed tunnel:

```text
cloudflared tunnel login
cloudflared tunnel create kol-game
```

Creating a tunnel does not require creating a public hostname route. The resulting `<UUID>.json` is the only credential required by the server. Keep the broader `cert.pem` account-management credential on the administration machine; never mount it in the server container. Do not create public DNS or start the tunnel yet.

Review the prepared hostname, production target, route allowlist, absence of staging/admin routes and current data authority. Get explicit operator approval for that exact exposure. Starting a connector can expose a previously created DNS record immediately, so approval is required even if no new DNS operation is planned.

Only after approval:

```bash
sudo python3 scripts/edge.py activate --approve-public-exposure
```

Separately, after explicit DNS approval, create **one proxied CNAME** `game.example.com` → `<UUID>.cfargotunnel.com` in Cloudflare DNS, or run `cloudflared tunnel route dns <UUID> game.example.com` on the administration machine. The server script does not possess account-management credentials and cannot publish DNS. Do not add wildcard, staging, administration, SSH, monitoring or database records. Confirm Cloudflare always redirects public HTTP to HTTPS. Avoid host-header overrides that change the approved hostname.

Private staging and admin remain unexposed, which denies all public access. If remote administration is later requested, use a separate approved hostname and Cloudflare Access application with default deny and explicit identities/MFA, plus per-ingress connector-side Access JWT validation; test missing/invalid/wrong-audience JWTs before activation. Merely having an Access-looking header is not authentication. These routes are not enabled by this ticket.

## External verification and recovery

From a different Internet connection (for example an administration laptop on a phone hotspot):

```bash
python3 scripts/verify-public.py game.example.com
```

This checks actual HTTPS, correct session-mode backend, denied protected game access without authentication, denied admin/metrics/readiness/secret paths and absent WebSocket routes. It does not mutate game state. Login with an explicitly provisioned test account separately, exercise one valid idempotent game request, and confirm repeat submission cannot double-award state. Keep credentials and session tokens out of shared output.

Restart only the approved connector with `sudo python3 scripts/edge.py restart-tunnel`; verify health and repeat external probes. During interruption the browser may receive a network error: reload/re-authenticate as required and query fresh state. Existing request-ID/revision guards protect mutation retries. Never assume a failed HTTP response means the transaction did not commit.

After a deliberate operator reboot, run `sudo python3 scripts/edge.py after-reboot`, then repeat the outside-network HTTPS checks. The local test checks actual new boot ID, retained container IDs, proxy routing and connector health when previously activated. No script reboots the host.

Inspect router IPv4 forwarding/UPnP mappings, global IPv6 ingress policy and any other Cloudflare tunnels. From outside, probe the home's actual public IPv4 and any globally routable host IPv6 for 22, 80, 443, 5432, 6379, 61208, 13000, 13001, 19080, 19081 and 19091. Probe the origin IP, not the Cloudflare hostname (Cloudflare's own 443 should be reachable). The configured tunnel cannot publish DB/cache/SSH/monitoring, but this alone does not establish that unrelated services or router mappings are safe. Acceptance requires observed external results; a local refusal is insufficient proof.

## Troubleshooting and rollback

- 1033/no connector: inspect tunnel container health and root-private logs locally; check outbound DNS and TCP/UDP 7844. No inbound forwarding is necessary. If QUIC is blocked, test a deliberate HTTP/2 transport configuration through the operator's managed-change procedure.
- 502: verify Caddy health and production readiness on localhost:13000; a live process can be unready while PostgreSQL reconnects.
- 404: check hostname, single ingress rule, catch-all, and reviewed path. Do not solve by adding wildcard routes.
- 429: respect Retry-After; inspect peer budgets and durable auth limits before adjusting load budgets.
- Caddy bind failure: ports 19080/19081/19091 must be unused. Do not stop unrelated services to obtain these ports.
- Never use debug connector logging publicly; it can log sensitive HTTP headers. Review/redact identifiers and all tokens before sharing output.

To immediately remove this exposure: `sudo python3 scripts/edge.py stop-public`. Then remove only the approved DNS record and revoke the specific tunnel credential if needed. Stop Caddy locally using the fixed project's Compose file if rolling back the entire edge deployment; never run `down -v` on game projects. Keep backups and native state intact. Backend rollback uses the private INFRA-007 release record; this ticket adds no schema migration, and rolling back the application/template should not restore old data over new transactions. Remove the optional ingress secret mount/env configuration only when restoring the matching older template/image.

## Evidence and remaining acceptance

Verified in the workspace: immutable image references resolved from registry manifests, checksum-verified upstream test binaries, actual Caddy configuration validation and proxy tests (host/path denial, forged-header replacement, body limits), 48 infrastructure tests and 122 backend unit tests (including proxy identity and rate budgets), TypeScript checks, application/client build and Compose model validation. Cloudflared offline ingress validation confirmed the single game hostname and catch-all denial. Test proxy used an isolated disposable backend, not the live game.

Host installation, root Docker deployment, actual public hostname/credentials, external HTTPS, tunnel reconnect/reboot and outside-network origin port probes remain pending operator execution. No public activation or DNS mutation was performed. Game WebSocket acceptance remains pending a real implementation; staging/admin are intentionally not published.

References: [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [Caddy request limits](https://caddyserver.com/docs/caddyfile/directives/request_body), [Cloudflare local tunnel configuration](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/configuration-file/), [Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/get-started/).
