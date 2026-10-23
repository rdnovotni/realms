# Tactical combat expansion: player workflows and operating contract

[Documentation map](README.md) · [Engine](tactical-engine.md) · [Earlier expansion](tactical-first-pass-expansion.md) · [Status](implementation-status.md)

This source slice extends the server-owned tactical transition and the existing cooperative battle journal. System 04 in the supplied design bundle remains authoritative. KoL informs finite repeat plans and observed monster knowledge; BG3 informs readable initiative, terrain, resource clocks and telegraphed choices. Named zones and Main + Quick + Reaction remain the project's rules: there is no grid or movement-point economy. Synthetic acceptance content is not a production campaign or balance release.

## Implemented, partial and separate ownership

| Design area | Current behavior | Boundary |
|---|---|---|
| Saved combat | Server-authoritative initiative, costs, seeded rolls, immutable replay, retry receipts and atomic outcomes | Original BASIC_DUEL_V1 and unopted tactical evidence retain their historical contracts |
| Legal action UI | Target focus, hit previews for basic/named attacks, Main/Quick/Reaction budgets, Mana, resource clocks, disabled reasons, initiative | Attack techniques show exact hit chances and save techniques show the chance of a failed save for the focused target; immunity/mitigation can still prevent an effect. Predicted damage ranges remain future explanation work; option projection is capped at 256 |
| Positioning | Named adjacent zones, cover, elevation, soft Front/Back screening, authored opening presets and bounded custom placement | Opening formation is available at tactical revision zero on a controlled party turn; a preparation stage before enemy-first initiative remains open |
| Environmental play | Finite-use checked interactions, zone setup/consumption combos, entry and owner-end hazards, armor/type mitigation | No unrestricted simulation, chained explosions, terrain creation editor or arbitrary physics |
| Break | Damage-based Stagger, growing thresholds, bounded Break/recovery protection, suppressed reactions and lowered evasion | Distinct Boss Resolve catalogs and per-ability Stagger weights remain authoring work |
| Enemy behavior | Role-based legal healing, attacks, movement and support; provisional next-action hints | Personality packages, threat tuning and production AI catalogs remain open |
| Bosses | Health-threshold phases that advance once, bounded phase armor/accuracy/role; committed fixed-zone windups, cooldown, explicit warning, cancellation on Break/Stun/Silence/incapacitation | Windups are deterministic environmental damage after armor/resistance, not attack/save rolls. They have no homing retarget or extra Main action while charging. Summons, scripted objectives and full boss catalogs remain open |
| Resource clocks | ENCOUNTER, ROUND and REST/FULL_REST pools; immutable history preserves spent rest pools across fights and temporary source removal | Full class/Path resources and authored economy/balance are separate |
| Prepared gear | Only pinned A/B sets; Quick swaps, no HP/Mana refill, union resources retain spends; permanent equipment event/binding in the same action | Arbitrary gear editing during combat is unavailable |
| Items | Four preselected physical stacks; simple Quick restoratives and complex Main bombs; source-derived rules, targeting and journal draws, exact debit, protections and explicit favorite/rare consent | Food/booze use is the separate consumption system; full consumable catalogs and Studio controls remain open |
| Cooperative UI | Invitation terms, ready/create/start/cancel, own actor/party state, reconnect, waiting for another player and personal outcome claim | Polling is explicit refresh; matchmaking, social invitations, chat, guild/raid ownership and PvP remain separate |
| Combat recap | Owned paginated journal with observed checks, damage, restoration, field events and outcomes | Full visual replay player, damage-contribution dashboard and export remain open |
| Monster Manual | Account-wide observed creature encounters/victories and witnessed abilities, including cooperative history | Studied/Mastery research, purchasable lore and resistance discovery tiers remain open |
| Routine plans | Explicit finite action/Mana/health limits, known low-risk fights through the real action engine; stop on boss content, danger, hazards, environment choice, opportunity, low health or uncertainty | Browser-run execution pauses on navigation/sign-out/uncertain response; no offline simulator, resource-item use or automatic boss play |
| Reactions | Existing Guard and source-granted opportunity techniques use the real reaction budget | General interrupt/Counterspell prompt windows and Always/Ask/Never configuration remain open |
| World consequences | Existing failure/recovery/gear/XP and shared personal commitments remain authoritative | Capture narratives, PvP, Guild/Raid and world-state objectives need their own complete systems |

The feature registry remains `partial`. This change does not certify every uploaded rule, create production items/monsters or supply Studio authoring UI.

## Source and state contracts

`rules.battlefield.version=1` requires typed damage. It declares exactly the encounter's zone IDs, bounded cover/elevation/tags, unit rows/roles/thresholds, up to four formation presets, twelve finite-use interactions, sixteen combos and bounded Stagger protection. References, duplicates and damage types validate at publication. Optional `bosses` permits at most four enemy profiles, four ordered descending health phases and four windups each. Windups mark one existing zone within range, take one or two rounds, and require a cooldown longer than their windup. Their Main cost is paid at charge; while pending only End, Move and Guard remain legal. A later owner End releases once, affecting only opponents still in the marked zone. The same setup combo applies to every eligible area target and is consumed once.

Phase/windup state, rows, tag changes, use counters, Break and disengagement live in the INSTANCE checkpoint. They persist through reconnect/rollover and remain archived terminal evidence. No current definition replaces the pinned source. Custom formation commands contain one to six unique party placements and may not move another account's units. A later revision rejects them.

`mechanics.tacticalTechniques.version=2` adds explicit resource clocks; v1 keeps encounter-only semantics. ROUND renews at global round reset. REST requires `refresh=REST|FULL_REST` and `rules.recharge.version=1`. Run history identifies the last saved amount per source key, even when a later fight omitted that gear/companion. Only a later eligible sealed rest receipt restores it. Original encounter creation time bounds all historical reconstruction. Ascension archives old run pools; ordinary rollover does not refill them.

`rules.preparation.version=1` requires techniques and permits prepared gear/items. Both A/B capability profiles derive from one original immutable equipment event, selected builds, carried conditions and sealed definitions. Swap preserves resources/cooldowns and caps health/Mana. Each swap records `COMBAT_SWAP`; account binding is permanent even if the next round swaps back. Only four physical stack IDs can be prepared outside active encounters. Prepared slot events are ACCOUNT KEEP history across lives, but use still requires actual current carried custody, quantity and release compatibility.

`mechanics.combatItem.version=1` requires delivery, action, ally/enemy side, single/zone area, range, restoration, effect IDs and rare flag. Optional damage uses declared type, check attribute/skill, bounded modifier and magnitude. Zone/damage items require Main. Clients never choose magnitude, grants, area members or rolls. Effects use pinned definitions. `USE_COMBAT_ITEM` consumes exactly one physical item in the combat transaction; locks, collection protection, equipped/saved identities, wrong custody and missing explicit favorite/rare consent reject the entire action.

Plans are RUN ARCHIVE history. Creation/step/stop are owner actions with ordinary revisions and receipts. Each successful step calls the same saved combat action used by the UI. The client cannot bypass the plan's action/Mana/health bounds by repeating a request. Knowledge is derived from owned immutable encounters rather than copied hidden monster stats. Log/manual reads have bounded pagination and no gameplay costs.

## API and player flows

Authenticated reads are `GET /api/v1/monsters?offset=0`, `GET /api/v1/tactical/:id/log?after=0`, `GET /api/v1/tactical/preparation`, and `GET /api/v1/tactical/shared`. Existing owned solo/shared views include public budgets, options, field state and preparation metadata. Every read enforces ownership or a disclosed eligible invitation. No account IDs, seeds or hidden enemy formulas are returned.

`POST /api/v1/tactical/preparation` uses the ordinary envelope, `actionType=SET_COMBAT_QUICKSLOTS`, and `slots:[{slot:1..4,itemId}]` (max four distinct physical IDs). Prepare from Pack before entering combat; weapon sets use the existing Pack equipment workflow.

The existing solo/shared action routes additionally accept `FORMATION {formationId}`, `CUSTOM_FORMATION {positions:[{unitId,zone,row}]}`, `INTERACT {interactionId}`, `DISENGAGE`, `SWAP_SET {set:A|B}`, and `USE_COMBAT_ITEM {slot,targetId,allowFavorite?,confirmRare?}` alongside `actorId` and `kind`. Boss windup commands are internal enemy decisions and have no network command schema. The server regenerates every roll and source grant. Shared actions use the owner's run revision plus the expected shared revision; another player's turn is visibly read-only. Entry/cancellation terms are shown before consent. Each player claims their own outcome once.

`POST /api/v1/tactical/plans` uses `CREATE_COMBAT_PLAN` plus instanceId, maxActions (1–100), maxMana (0–1,000,000), minHealth (0–99) and healBelow (0–100). `POST /api/v1/tactical/plans/step` / `stop` use `STEP_COMBAT_PLAN` / `STOP_COMBAT_PLAN` and planId. The Combat panel exposes save/run/pause/stop and progress/stop reasons. Local pause is cosmetic; persistent stop is an Action. Ambiguous network results retain the original envelope for retry.

Read-only sessions may inspect their state and logs but cannot mutate preparation, plans, combat or claims. Dialogs close on account/run change; item reviews reject a changed combat revision. Favorite/rare checkboxes start unchecked. Browsing and refreshing spend no Turns.

## Validation and rollout

New tests: `tactical-battlefield.test.ts`, `tactical-battlefield-integration.test.ts`, `tactical-preparation-integration.test.ts`, `tactical-recharge-integration.test.ts`; existing solo/shared/replay, client and lifecycle suites remain required. Responsive synthetic scenes cover opening formation, boss warnings, cooperative lobby/waiting/claim, read-only state, item setup/review, Manual/log and routine controls. Browser geometry reports prove layout properties, not production balance or real screen-reader speech.

Migrations 043–047 add finite plans, resource-rest eligibility, immutable quickslots, proven equipment swaps and item-debit constraints. They refresh the existing runtime role grants without creating users or credentials. Apply only to an approved isolated staging/production procedure after backup/restore proof; source work does not migrate production or adopt content. Rehearse spent per-rest sources, inactive set swaps, protected stock, duplicate item requests and unclaimed shared outcomes with readiness/audit output.

For rollback, first stop new opted-in content/plan entry through reviewed controls and retain active pinned encounters and journals. Old binaries cannot independently replay new battlefield/preparation/recharge commands or evidence. A code-only rollback is valid only after proving there are no newly opted-in origins/steps. Otherwise fix forward with a compatible engine, or use an explicitly approved full recovery procedure that accounts for later player actions. Do not drop the history tables, rewrite old migration checksums or restore a stale database over current play.

## Disposable interactive playtest

With the dedicated `TEST_DATABASE_URL` pointing to `realms_test`, `npm run preview:combat` starts a loopback-only server at port 3015 with a fresh synthetic schema, one prepared character, a boss, terrain, two item stacks and a rest-limited technique. The log supplies a fixed **synthetic development token** for this isolated process. It is not a production credential. The process handles termination by closing HTTP and removing only its own test schema. The player can exercise the actual server UI and journals without touching live accounts/content. Do not bind this development bypass publicly.


## Combat polish pass

Combat uses a wider command folio with a compact initiative track, prominent committed warnings listing exposed active party members, zone-local terrain/hazards/adjacency and unit-local row, Stagger and concentration. Wide layouts place the battlefield beside turn controls; narrow/enlarged-text layouts stack them. The control panel shows Ready/Spent budgets, target health/location, per-ability Mana/resource/range/area/cooldown costs and explicit unavailable reasons. Unavailable choices stay inspectable in disclosures; retreat/surrender stay separate from ordinary actions and confirm the disclosed recovery costs.

Focusing a unit is cosmetic and does not submit an action. Focus is retained only for the same encounter and falls back when the target is defeated. Prepared-item reviews explain consent, protection, range, control and spent-budget restrictions, and invalidate promptly when the saved combat revision changes. Shared terminal text distinguishes a saved battle outcome from the player's outstanding personal claim.

Technique percentage previews enumerate the same d20 check rules used by resolution, without drawing randomness or changing state. Attack percentages are hit checks; save percentages are explicitly **failed save** probabilities for the focused target, not promises of damage or bypassing immunity. The regression test compares both projections against all twenty actual rolls and checks costs/cooldown metadata. This pass does not change historical combat formulas, migrations, action costs or reward rules.
