# Follybound identity and public pages

Follybound is the current game name. Realms and KoL 2.0 are historical working names. This reconciliation covers public browser titles, metadata, welcome and game wordmarks, login/device labels, policy copy, information pages, desktop tool titles, launcher display names and alert labels. It changes source, not installed launchers, protected monitor bundles or deployed images.

## Compatibility and provenance

| Identifier | Policy |
|---|---|
| GitHub `rdnovotni/realms`, `realms/`, package `realms-server` and health `service` | Retained for repository/build/monitor compatibility |
| `/srv/Realms`, backup paths, `kol-*`/`realms-*` services, database roles and environment names | Retained; a rename would require a reviewed operational migration |
| WebP asset filenames beginning `realms-` | Retained; no visible embedded title is in the concept art |
| Original art prompts, design source titles, source hashes/manifests and historical references | Preserved as provenance, not current branding |
| Existing saved device labels | Historical labels remain; new browser logins send `Follybound browser` |
| `playfollybound.com` | Chosen public domain; consult the [hosting runbook](../../infra/docs/playfollybound-hosting.md) for activation evidence and operator steps |

Do not globally replace legacy strings in SQL, paths, repository remotes, configuration, hashes, or original source material. The synced project references outside this checkout are read-only.

## Public pages

`client/landing.ts` owns the text and rendering; `src/client-assets.ts` explicitly allows these paths. `/` is the welcome/login screen. `/about`, `/announcements`, `/changelog`, `/guide`, `/community`, `/newsletter`, `/contact` contain factual development information. `/privacy` and `/monetization` retain the detailed policy layout. The guide is also linked in the footer. Information pages link to every other public page.

News and changelog entries describe source milestones, not live deployment dates. Public signup, newsletter collection/delivery, donations, token trading, supporter purchases, public forums and automated reset email remain closed. The old unverified privacy inbox is no longer presented as a public address. Development players contact their enrolling administrator; publish a verified monitored contact before public registration.

Use `npm run preview:welcome` from `realms/`, then open `http://127.0.0.1:3010/`. This serves public screens only and does not connect to PostgreSQL, register accounts or log users in. Check every route, keyboard focus, titles, links and overflow at desktop and 320px width. Serving `index.html` as a file cannot load its same-origin assets. Previewing source does not update the hosted website.
