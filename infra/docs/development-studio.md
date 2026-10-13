# Realms Development Studio

Development Studio is the desktop authoring app. Server Console remains the operations app. Launch **Realms Development Studio** from the Ubuntu application menu, or run `bash /srv/Realms/source/infra/scripts/development-studio.sh` as your desktop user.

## One master source

The canonical checkout is `/srv/Realms/source`, with GitHub repository `rdnovotni/realms`, branch `main`. “Master” refers to this authoritative branch; a second `master` branch is not introduced. `realms/` contains the game and `infra/` contains the development and deployment tools. Existing GitHub history is retained, with its former game-root layout moved under `realms/`; its infrastructure guidelines and CI are retained at repository root.

The live production application was captured without environment variables or database contents. A fresh build of the current game matched all 180 captured application artifacts before Studio additions. The added content-check npm command intentionally changes package metadata; existing deployed JavaScript and browser artifacts remain byte-identical. Captured recovery artifacts stay private under `.development/live-artifacts`, not in Git. Existing encrypted backups retain the exact deployed images.

GitHub `main` stores source. A production container is an immutable deployed artifact; it changes only after an approved deployment. The initial live image predates Git provenance. New releases record `source_commit`, repository and immutable image; the image includes its source revision label. A tested build is exported from the recorded Git commit into a temporary build context. Uncommitted edits cannot silently enter it. Symlinks, tracked secrets and archive attribute transformations are refused.

## Add and edit definitions

1. Open **Content library → New definition**. Choose a type, permanent ID and display name. Use IDs such as `item.iron_sword`; existing IDs and types cannot be reassigned.
2. Item category/storage use guided controls. Player-visible information, server rules, discovered details and hidden lore use the backend's existing JSON object format. Dependencies are comma-separated content IDs. **Duplicate selected** creates a new ID instead of reusing an existing one.
3. Choose **Save & validate definition**. The actual TypeScript backend validators check the complete package, including references, dependency cycles, inventory rules and implemented mechanics. Validation accesses no database. Invalid saves leave the previous file intact.
4. Saved content is `realms/content/game.json`. Changed definitions receive new revisions; saves generate a new package version to avoid changing an already sealed version. Prior saved files are retained privately in `.development/content-history`.

All 23 existing shared content kinds are available. This is a definition editor, not a completed bespoke designer for every gameplay subsystem. **QUEST** definitions can be authored; a quest execution engine does not yet exist. Advanced mechanics require valid backend definitions and, where missing, implementation and tests. No combat values or reward policies are invented by Studio.

The GitHub repository is public. Hidden gameplay definitions are still visible in public source; “hidden” describes runtime discovery, not GitHub confidentiality. Never put credentials in content fields.

## Test and publish

1. Review **Source & GitHub → Review source status**. Save a **source checkpoint** with a meaningful name. It commits approved game/infrastructure changes, excluding private/generated files. Checkpoints remain local until publication.
2. Choose **Build checkpoint on test game**. Only allow reviewed database updates. Ubuntu authenticates the fixed administrator helper; the existing release pipeline backs up, builds, validates content, runs automated checks and installs staging.
3. Open the private test game. Test sign-in and changed gameplay using separate test accounts. Complete both checkboxes and **Save test approval**. Backend checks associate approval with the exact image and schema.
4. Review the live change plan. **Publish tested build + GitHub** validates the actual staging approval and source commit before pushing. It fast-forwards GitHub `main` to that commit, then promotes the same immutable image. No rebuild or force push occurs.
5. Visit `https://playfollybound.com` and verify sign-in/gameplay after publication. Server Console supplies logs, health checks, backup tests and safe code recovery.

GitHub and Docker cannot participate in one atomic transaction. If GitHub succeeds and deployment fails or the client is interrupted, GitHub can be ahead of live. Publication phases are retained privately in `.development/publications.json`. Inspect the recorded commit and Server Console before retrying. Correct forward or use compatible previous code; never rewind player data to make source history look successful.

The app uses ordinary Git SSH/credential-helper authentication. **GitHub sign-in** can alternatively load a fine-grained token restricted to this repository with Contents read/write for the app session. It is held in memory, passed only to Git's askpass helper and not written to disk or passed to game builds. This chat's GitHub connector does not automatically authenticate desktop Git. Branch protection can reject direct publishing; a rejected push stops before live deployment.

**Download GitHub main** fetches and fast-forwards only. Dirty source and divergent history are refused. It does not download or overwrite production databases or treat GitHub's newest commit as proof of what is currently deployed.

## Content deployment and player-version boundaries

Images include `content/game.json`; release builds validate it before installation. The existing setup service imports nonempty packages through `publishContent` with the migration role, preserving existing immutable definition/release checks. Application credentials do not gain content publication privileges. An empty package does nothing. Reused versions/revisions with changed definitions are rejected.

Existing player runs remain pinned to their content release. Sealing new definitions does not automatically change all players' rules, spawn items or give rewards. Selecting a new content release for new/existing runs requires a separately reviewed server-side rollout/enrollment policy. There is no player-state editor or automatic gameplay activation switch in Studio.

## Recovery and verification

Git source commits preserve checkpoints; draft-history copies preserve earlier saved packages. Server Console supplies encrypted USB backups and isolated recovery tests. Revert source changes using a new reviewed Git commit; do not force-push `main`. Old code must be checked for current database compatibility before deployment. Source rollback does not undo migrations, sealed content or player transactions.

Tests cover backend content validation, revision/identity protection, private-file exclusion, Git push gates, in-memory credential scope and exact Git snapshots. Desktop launch/layout checks exercise both apps. The initial source reconciliation does not deploy a new game build, migrate a production database or change networking. The combined authenticated Git-push/live-promote workflow still requires an operator rehearsal with a new approved test build.

Initial verification: 135 infrastructure tests ran (134 passed, one optional test skipped), all 122 existing game unit tests passed, TypeScript checks/build passed, content validation passed, and both desktop applications launched. Studio layouts fit at 1250×950 and 1100×820. These checks do not claim an actual GitHub-plus-live promotion or new-content player rollout.

Synchronization safety: downloading GitHub source refuses unsaved editor drafts and reloads the authoring library after a successful fast-forward. Definition saves use a source-edit lock and compare the saved-file digest, refusing to overwrite content changed by another window or external tool. The GitHub workflow now runs the development client’s core source tests and compiles Python tools in addition to game checks.

The [development baseline](development-baseline.md) defines exact-checkpoint database checks before staging and the remaining live rehearsal. Publication failure regression coverage preserves the exact commit when GitHub succeeds but deployment fails; a failed/uncertain Git push never starts promotion.
