# Adventure, combat and the Journey Journal (VIS-05)

These views reuse [Folio tokens](adventurers-folio.md) and the
[authenticated shell](application-shell.md). This is a presentation pass, not a
combat-system or content expansion. `campaign.ts` owns rendering and the existing
combat callbacks, `campaign-model.ts` owns public presentation helpers, and
`campaign-folio.css` replaces their old styling in `styles.css`. The rest of the
application continues to use its existing components.

## Campaign entries

Known adventures use ruled parchment entries, an original decorative road mark,
prominent server-provided names and descriptions, exact entry Turn costs and an
explicit availability label/explanation. A keyboard-operable disclosure contains
the same known defeat/recovery terms. Missing descriptions are identified honestly.
No difficulty rating, destination illustration, predicted loot or new reward is
invented. Existing build, carrying, Turn, write-access and pending-action gates
remain in place; an active encounter offers its existing resume workflow.

## Tabletop encounter

The combat header displays the saved round, current actor, manual/world turn and
read-only state. A native anchor moves focus directly to the turn controls or
result, keeping long mobile encounters practical without moving zones or changing
their graph. Zone names and unit positions come from the tactical projection.
Party and opponents have labelled groups, different border treatments and exact
Health/Mana meters. Current actor and selected target have both text and frame
cues. Unit states and existing effects retain their public families and clocks.
No portraits or private enemy derivations are introduced.

Main, Quick and movement actions are grouped for scanning. The existing target
selector, range/resource/cooldown checks, commands, costs, concentration, retreat,
surrender confirmation and saved server-turn continuation remain authoritative.
Known technique resource costs and recorded ready-round facts are visible rather
than available only in a tooltip. Reaction budgets are shown; unsupported manual
reaction buttons are not invented. A missing budget receives an unavailable
explanation rather than fabricated zeros.

Victory and defeat have distinct result surfaces. Recovery uses the actual saved
destination, pools, Turn cost and any returned loss/wear evidence. No unsupported
reward amounts or historical events are added.

## Journey Journal

The existing sidebar shows only the latest recorded encounter and any active
encounter. It uses a small chronicle with record markers, names and outcomes.
There is no standalone Journal destination and no invented quest/archive history.
A record link appears only when the loaded encounter matches that record; an old
outcome cannot silently link to a different active fight.

## Assets, accessibility and rollout

The new stylesheet and modules are in the backend asset allowlist, production
image COPY list and explicit public-edge catalog. An existing managed proxy also
needs the [reviewed asset refresh procedure](../../infra/docs/playfollybound-hosting.md#updating-reviewed-client-assets).
That procedure stages and validates configuration with rollback, preserves
credentials/listeners/connectors and does not restart services. A subsequent
Caddy-only restart requires separate operator approval. No live rollout is
claimed by this ticket.

All decoration is small original inline SVG or simple CSS. No remote fonts,
portraits, textures, continuously animated effects or new dependencies are used.
Shared focus, reduced-motion and forced-color behavior remain supported. Cards,
labels and controls wrap at narrow widths. Combat information takes precedence
over decoration.

## Reproduce verification

From `realms/`:

```sh
npm run typecheck
npm run build
npm run styles:check
npm test
TEST_DATABASE_URL=postgres://localhost/realms_test node --import tsx --test --test-concurrency=2 \
  test/client-integration.test.ts test/tactical-combat.test.ts \
  test/tactical-campaign.test.ts test/tactical-effects-integration.test.ts \
  test/tactical-techniques-integration.test.ts
```

From the repository root:

```sh
python3 infra/scripts/documentation-check.py
python3 infra/scripts/feature_registry.py
python3 -m unittest discover -s infra/tests -p test_edge.py
python3 -m unittest discover -s infra/tests -p test_release_verification.py
```

The style contract also rejects unbalanced parentheses, which can silently disable
a responsive grid even when CSS braces are balanced.

## Disposable preview

```sh
TEST_DATABASE_URL=postgres://localhost/realms_test node --import tsx scripts/campaign-preview.ts
```

Only loopback `realms_test` is accepted. The fixture serves
`http://127.0.0.1:3011`; passwords are the public synthetic phrase
`A road worth wandering 47!`. Accounts:

| Account | State |
| --- | --- |
| road | Available adventure; empty Journal |
| spent | Insufficient Turns |
| newcomer | Unconfigured build; use Adventure to see its entry restriction |
| player | Saved player turn, companions, long enemy identifier and a status effect |
| server | Saved enemy segment, awaiting Continue |
| exhausted | Main and Quick already spent |
| victory | Server-settled victory and Journal record |
| defeat | Server-settled defeat/recovery and Journal record |
| viewer | A saved encounter with read-only login forced through the existing auth option |
| dense | Six synthetic known techniques and authored resource costs |

The viewer hook exists only in this disposable script; production login is not
changed. Dense uses a separate pinned test release. Every combat state is created
through existing server domains and legal actions, never by editing combat JSON.
The fixture is not shipped as gameplay content. Stopping it closes its app and
removes its isolated schema.

[Before/after evidence and browser coverage](screenshots/vis-05/README.md).
