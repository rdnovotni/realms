# Development Studio v0 — guided content production

[Operations map](README.md) · [Desktop Studio](development-studio.md) · [M02 evidence](../../realms/docs/m02-content-studio.md)

This is a **local authoring workspace**. It turns ordinary definitions into validated immutable candidates, proves publication in a new disposable database, and records local approval. It does not deploy a server, change player state, adopt a release or activate content. The existing separately authorized operator release workflow remains responsible for actual staging/live adoption. Local author/reviewer names are attribution, not a staff authentication system or proof of independent human approval.

## Open the workspace

In the desktop Studio choose **Content library → Guided production workspace**. It opens a loopback browser tool and stores drafts privately in `.development/studio-v0/workspace.json`. The desktop's existing source editor and live-promotion controls remain separate. Opening this new workspace does not install/refresh a launcher or protected operator bundle on the host.

From a checkout, with the existing Node dependencies installed:

```sh
python3 infra/development_client/studio_web.py --demo --open
```

The printed address uses `127.0.0.1` and a free port. To use a fixed local port, add `--port 3021`. To keep a separate experiment, add `--workspace /tmp/my-studio-workspace`. Stop this preview with Ctrl+C in its terminal. No service is installed. The browser must be reloaded after a preview restart because each process has a fresh session token. Saved drafts survive restart.

`--demo` starts a new workspace with explicitly synthetic fixtures from `realms/test/fixtures/studio-demo.json`; an existing workspace is never replaced. Without it, a new workspace imports the current `content/game.json`. The ordinary typed templates are drawn from the workspace's definitions. Start with the demo when the source library is empty; otherwise edit/duplicate valid definitions from the imported package. Neither demo nor exported proof data is a production catalog or an approved class/species roster.

## Author ordinary definitions

1. Use **Entity library** search and type/status filters. The browser includes permanent ID, type, definition revision, source package version, tags, dependencies, author, last change and revision status. An approved unchanged revision can exist within a newer draft package; the package itself still needs a new candidate review.
2. Select an item, ability/effect, monster, encounter, loot table or quest. Change names/descriptions and the typed numeric, boolean, choice, reference, list and repeated-entry controls. Definitions with unfamiliar/unsupported mechanical subtypes still require their owning backend contract; changing a form does not implement a new engine.
3. Expand rule groups where needed. Lists of IDs/tags are comma separated. Object collections have add/remove controls; quest nodes have explicit scene/objective/outcome controls. Version/ruleset fields are protected. Existing IDs and kinds cannot be reassigned.
4. Enter an author and save a draft. Drafts may retain errors so an author can repair them. The server owns revision increments and generates a new package version. Concurrent/stale saves are refused, not silently overwritten.
5. Choose **Validate package**. The real backend validators check references, types, mechanics, dependencies and quest graphs. Node diagnostics identify dead ends, missing edges, duplicate principal rewards and unreachable outcomes. An objective owns its reward key; alternate outcome nodes do not each own a duplicate reward.

A new definition duplicates the existing supported type's template into a **new ID**, preserving needed references for review. The supported typed surface covers the existing inventory, tactical unit, attack ability, round effect, encounter/rules/participants, loot-group and quest-objective contracts. It does not promise bespoke editors for every mechanic in all 23 content kinds.

## Inspect dependencies and quests

**Dependencies** shows entity→required-definition edges and package diagnostics. The visual graph caps display at 100 nodes; library search and validation still cover the complete package. **Quest graph** renders typed nodes/connections and highlights malformed or unreachable nodes and duplicate rewards, including collisions between quests. Every nonterminal route must be able to reach an outcome, and a success outcome must remain reachable.

This adds a versioned quest authoring schema, not a player quest execution/reward engine. Quests remain owning-domain implementation work. Reference IDs must both exist with the correct type and be declared dependencies. The rules apply before `publishContent`, not only to a Studio form.

**Rename safely** first previews inbound references. Confirmation creates a fresh identity, rewrites exact-ID references in the draft with new revisions, and tombstones the old identity locally. It never changes a released snapshot or reassigns an old ID. **Tombstone** refuses a referenced entity and retains the full retired definition, including an unreleased draft. Selecting its tombstone recovers those fields into a new-ID draft; the retired ID stays reserved. Tombstones are reserved in the local workspace; importing a package into another workspace is not a global identity-retirement operation. Actual database retirement/adoption needs its own reviewed operator contract. Historical snapshots containing tombstoned IDs cannot be resurrected through rollback.

## Test an encounter and client view

**Encounter sandbox** can launch any authored ENCOUNTER. Tactical encounters use the game's party construction and `startTactical`/`stepTactical`; legacy duels use the existing mitigation rule; noncombat encounters provide a disclosed encounter/loot preview because there is no generic owner to execute their narrative. No costs or rewards are committed to an account.

Choose a synthetic BALANCED, DURABLE, QUICK or ARCANE profile and a seed. These are bounded stat perturbations, not completed Fighter/Rogue/Wizard native class engines. The seed drives the existing HMAC RNG primitive on a separate Studio stream. The fixed basic-attack-nearest policy is recorded with a replay hash and bounded trace. It does not model all intelligent technique/boss strategies or certify production balance. Illegal automatic choices fall back to ending the actor's turn and are reported as warnings; an exhausted simulation budget is shown explicitly. Review outcomes and warnings before approving. This is deterministic author simulation, not a promise that a live battle uses the same draw sequence or policy.

**Client preview** uses the same pure projection whitelist as game content queries. Select synthetic discoveries, then novice or explicitly advanced knowledge. Unknown entities are absent. Advanced details require the synthetic ADVANCED state; mechanics, dependencies and secrets never enter the preview response. The surrounding Studio is a privileged author tool and intentionally holds full definitions; hiding a tab is not a player security boundary. Real player queries still require release/ownership/discovery checks in SQL.

## Candidate → disposable staging → approved export

1. Enter change notes in **Review & publication**, then **Create candidate**. Invalid packages are rejected. Each candidate is an immutable package snapshot identified by its canonical SHA-256; existing snapshot revisions are reserved against changed reuse.
2. **Review diff & pins** compares the candidate with the previous approved snapshot and lists its definition/revision manifest. Existing player pins are not queried or changed; the preview explains the unchanged-pin contract and proposed new release entries.
3. **Test & publish disposable candidate** creates a new private temporary PostgreSQL cluster, verifies its actual `data_directory`/marker identity, requires an empty `realms_test`, applies all checksummed migrations and calls the real content publisher. It checks idempotent sealing, rejects rewritten release/definition revisions and repeats seeded encounter simulations. Only that exact snapshot enters STAGING after a passing proof. The cluster is stopped and removed. A failure leaves the candidate and previous workspace file intact.
4. Review the proof, record approval notes, confirm the diff/pin review checkbox, then **Approve local package**. This records APPROVED locally; it grants no production authority.
5. **Export approved package** downloads the exact immutable ContentPackage JSON for source review. Do not copy it into production automatically. Use the existing reviewed source/build/adoption process to introduce ordinary content, after its owning gameplay systems and operational gates are ready.

The one-command publication path is also available without the UI:

```sh
python3 infra/scripts/studio-fixture.py \
  --package realms/test/fixtures/studio-authored.json \
  --receipt /tmp/new-studio-proof.json \
  --confirm-disposable
```

It accepts **no database URL**. It locates local PostgreSQL server/client binaries (override their directory with `--pg-bin`), runs as the ordinary development user, strips inherited database/auth settings, and creates its own loopback cluster. It verifies the connected server's actual data directory before migrations. An existing receipt is never overwritten. The checked-in local proof used PostgreSQL 18; the receipt records the actual server version in later runs. This publication path is not a production migration tool.

## Disable, rollback and recovery

**Disable new workspace publication**, with a note, blocks new candidates, disposable publication and approvals. Reading, draft editing and sandboxing remain available. This is not the production kill-switch API; use the operator runbook for that separate authorized action.

**Fork approved for rollback review** copies an approved snapshot into a new draft/version. It never unseals a release or rewinds a player's history. Later edits allocate revisions above all retained candidate revisions. Retest and export a new approved package. Binary rollback must still respect schema/history compatibility; source rollback does not undo SQL migrations or player transactions.

Workspace files are private, atomic and guarded by a file lock and digest. Keep a private backup of the workspace folder before removing it. There is no permanent-delete UI. Candidate hashes detect snapshot rewrites; this is local integrity checking, not cryptographic staff approval. The browser binds only to loopback and checks Host, Origin and a per-process token; it rejects cross-origin requests. Never expose it through public routing. No credentials belong in content definitions or approval notes.

## Verification

```sh
python3 -m unittest discover -s infra/tests -p test_content_workspace.py
python3 -m py_compile infra/development_client/*.py infra/scripts/studio-fixture.py
```

Game tests include quest graph/duplicate-reward rejection, discovery filtering and deterministic input-preserving simulation. CI additionally publishes the browser-authored fixture into a newly owned disposable database and retains its proof as `m02-studio-authoring`. The release-verification job waits for that gate along with server tests and the M00 historical recovery rehearsal.
