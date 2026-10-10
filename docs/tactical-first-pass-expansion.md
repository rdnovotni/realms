# First-pass combat expansion

This extends the existing tactical transition, action transaction and immutable replay. Historical BASIC_DUEL_V1, unopted tactical rules and migrations 001–023 remain unchanged. The design basis is Systems 04, 09, 24, 25, 29, 35 and 36 from the supplied design bundle. Values in tests are acceptance fixtures, not release balance.

## Authored techniques

Encounters opt into `rules.techniques: {version: 1}`. Selected classes, subclasses, feats, active equipment and NPC/monster templates may grant `mechanics.tacticalTechniques`. A pack contains bounded encounter resources and several named abilities. Local ability/resource keys are namespaced by the source entity, preventing duplicate equipped copies from creating extra actions or pools. Native-level gates are applied per ability; items and selected abilities use level zero.

Each technique declares Main, Quick or Reaction, ally/enemy targeting, single-target or one-zone area, range, Mana and named resource costs, cooldown, and an explicit effect. Effects support damage, healing, stabilization, resurrection and published effect references. Area targets are selected by the server, sorted deterministically, and affected once. Costs are paid once per action. Resurrection must have a finite Mana/resource cost. Stabilization absorbs the next Downed escalation; that strike removes stabilization without restoring HP. Later strikes can still defeat the character.

Attack and save checks use the existing D20_CHECK_V1 formula with pinned attributes and earned proficiency. Migration 024 independently verifies the hero's initial attributes and ranks against the character snapshot and run proficiency state. Replay reconstructs those ranks from immutable choices before encounter creation. A caller supplies only ability and target IDs; each check and magnitude draw comes from the encounter journal. Save checks use the target's attributes/proficiency. A successful save prevents the authored support/control effect.

Cooldowns record the first eligible round. A value of zero allows use again next round, not again in the same round. Resources with `clock: ENCOUNTER` refill on a new encounter; retained Mana does not. These are not Adventure Turns or implicit per-rest resources.

## Controls, conditions and resistance

`roundEffects.version: 4` adds Root, Disarm, Silence, reaction suppression, Stun and Dazed. Existing effect versions retain their old contracts. Stun blocks active actions but always permits End, which expires durations and advances the turn. Root prevents ordinary movement. Disarm prevents basic/legacy weapon attacks and explicitly Martial techniques; Silence prevents explicitly Magical techniques. Reaction suppression and Stun prevent Guard and opportunity reactions. Dazed permits only one Main/Quick action in the round. Repeated Stun in one family converts to Dazed, including Refresh families, preventing an indefinitely refreshed hard lock.

An authored control can declare incoming buildup, threshold, owner-end decay and a repeated-break threshold increase. Overflow is discarded when the threshold converts to the actual condition. Immunity blocks buildup. Partial status defense modifies incoming buildup for such effects, or duration for ordinary effects, rather than applying both reductions.

`statusDefense.version: 2` enables bounded duration reduction by explicit status tag. Full status immunity remains separate from damage defense. Selected effect techniques can explicitly bypass status immunity; they preserve the target's pinned defense and still respect save checks and partial reduction.

`typedDamage.version: 3` preserves concrete/family resistance and adds explicit conditional owner tags. Version-two traits supply conditional per-type contributions. Matching current effects activate them for attacks and periodic damage. Contributions are summed before capping; pinned defense is never mutated. No tag ancestry, elemental interactions or hidden immunity conversion is inferred.

## Concentration and reactions

A concentration technique owns one channel. Starting another releases the old concentration effects. Incapacitation, expiry, cleansing and explicit Drop Concentration release the channel. Nonconcentration actions do not inherently release it. Concentration is limited to round-clock effects in this contract. Party capability cards disclose concentration and delivery requirements.

Surprise declares individual initiative penalties and lost first-round action budgets. It neither changes base stats nor repeats those losses next round.

Only a source-granted Reaction damage technique can threaten an opportunity strike. It must have single-target, enemy, engagement-range targeting. Leaving that opponent's zone triggers the affordable eligible reaction in stable actor order, sharing the normal typed attack/Guard pipeline and spending the threatening actor's Reaction. The journal pins all declared opportunity draws; later reactions are cancelled without spending if an earlier strike incapacitates the mover. Movement then stops. If the reaction incapacitates the mover, that turn ends and control advances to the next active participant; allies can still revive the mover. Proactive player use of a Reaction technique is rejected.

## Persistent combat effects and failure

Version-four effects declare Round, Encounter, Adventure Turn, Until Cleansed or Run clocks with matching tick policies. Combat settlement advances Encounter clocks once and Adventure Turn clocks by the encounter commitment plus recovery Turns. Until Cleansed and Run effects remain until authorized removal or the run boundary. This contract does not fabricate elapsed World Time or implement scheduled/rest clocks.

Migration 024 seals per-encounter effect carryovers. The next origin must exactly match its predecessor. Remove Curse is a distinct version-two cleansing method; it cannot silently substitute Cleanse, Dispel or Cure. A disclosed persistent injury may be applied after failure. Injuries enter the next encounter with their full declared duration, rather than expiring in the settlement that created them. Replay independently derives each carryover from the terminal state and pinned injury source.

Version-two failure contracts disclose contextual destination, 0–3 recovery Turns, recovery HP, allowed surrender, Gold rate/hard cap and active equipment wear. HOME, CHECKPOINT, CAPTURED, NPC_RESCUE, EJECTED and FAILED_FORWARD are journaled recovery destinations. Destination-specific quest, prison and relocation interactions belong to the world/quest pass; no free escape or rewritten quest state is invented here.

Gold loss is limited to the run's eligible PLAYER Gold wallet; account legacy, escrow, guild and institution funds are excluded. Rates are bounded at 1% and a hard cap is required. SQL pins the eligible balance and exact amount, and recovery verifies the existing currency ledger transfer. Wear applies only to explicitly authored durable active equipment, at most 10% of maximum per failure, preserving a minimum of one condition point. Each immutable item wear event reconciles its predecessor. Ordinary failure does not destroy gear or reduce XP/native levels.

## Owned companion foundation

A recruitable NPC explicitly declares `companion: {version: 1, access: DISCOVERED}`. Recruitment is an owner action outside an active instance and creates an immutable account unlock. Mere discovery does not deploy a companion. Encounters with `partyOwnership: {version: 1}` may designate owned allies, reject duplicate deployments, and limit the party to six members. Narrative NPC allies retain the previous convention.

Owned companions default to server AI; `manual: true` opts into player control. AI uses the same targeting, costs, checks, controls, reaction and budget legality. The origin seals those controller IDs. A companion's spent health/Mana and Downed/Defeated recovery are journaled per run and pinned on the next deployment. Winning normally rescues incapacitated companions. The player receives the full existing authored XP award, without a companion split. No ordinary permanent companion death is added.

Companion persistent conditions now follow the same encounter/recovery clocks as the player, including disclosed injuries, rather than disappearing when an NPC leaves a fight. Companion class progression, equipment customization, recruitment quests and broader AI policies remain in the later progression/shared-system passes.

## Shared human combat

An encounter may explicitly enable `sharedCombat: {version: 1, maximumPlayers: 2, loot: "PERSONAL"}` with party ownership enabled. The cap is two to six human players; humans plus authored allies cannot exceed six. These optional cooperative encounters remain separate from the solo campaign finale contract. Guild/raid contribution state, shared loot voting and broader multiplayer economies remain later passes.

The host creates a ready lobby and shares its ID. An authenticated, eligible discovered invitation discloses entry cost, cancellation, personal loot and the failure contract before another player joins. Each owner independently spends one entry Turn, commits their own loot/XP plan and immutable character snapshot, and locks their run through its own active encounter. Releases must match. The host can start only after two players consent. Party composition is frozen at start. Readiness preflights the bounded shared checkpoint so an oversized party is rejected atomically before its entry commitment succeeds.

One shared tactical journal orders all turns. Each human controls their own hero; the host controls authored manual NPCs. Owned AI companions and enemies use the same authoritative transition engine. Server-seeded draws, immutable steps, individual run revisions and a shared expected revision prevent rerolls, stale advances and foreign control. A coordinator lock precedes account/run locks. Reconnect and invitation reads consume no Turns and reveal no account IDs or hidden source records. The current actor may attempt ordinary retreat or an explicitly enabled surrender for the whole party, as disclosed in the invitation. Cooperative consent permits ordinary healing/support; cross-account ally damage, harmful/mixed condition application and stripping another caster’s beneficial effects are rejected atomically. Dropping the caster’s own sustained effects remains legal. PvP requires its separate later opt-in.

After the shared outcome, each owner claims their personal encounter once. That claim settles the owner's existing item/XP commitments, health/Mana, persistent conditions, disclosed recovery Turns and eligible Gold/equipment costs. NPCs do not split XP or compete for personal loot. A player does not need to be online for the last hit; their committed claim remains available, and another player's claim does not spend their resources or authorize their account. Pending claims keep that player's run locked until resolved. The host settles owned NPC pools/conditions as well. Lobby cancellation is a disclosed retreat without an entry-Turn refund or victory rewards; each owner can close their own commitment afterward.

Migration 027 extends the existing retention/recovery journals to these personal cooperative encounters while preserving the old solo origins and replay formulas. SQL verifies owner consent, source snapshots, frozen roster, consecutive shared transitions and the exact personal projection of terminal state. The independent audit rebuilds player sources, NPC templates and previous pools, verifies seeded draws and controller authorization, replays all transitions, and reconciles every personal claim. Returning to solo combat pins the cooperative recovery as the previous immutable encounter.

## Validation

The new unit and database scenarios exercise area/resource spends, attack/save contributions, control expiry and diminishing control, partial/immunity behavior, conditional defense, buildup, concentration, surprise, opportunity strikes, stabilization/resurrection, persistent cleansing, injuries, contextual failure, Gold/wear, owned companions and AI, retries, reconnect, rollback, API forgery/read-only denial and immutable replay. Shared scenarios additionally cover consent, invitation preview, foreign control, disconnected personal claims, concurrent retries, stale actions, late rollback, surrender wear, cancellation and audit tampering. Pass 1 acceptance is verified on PR #31: 103 unit tests, 319 isolated database integration tests, typecheck and production build pass in both GitHub push and pull-request server checks. Local full regression and final focused scenarios also pass. Passes 2–8 remain open; these fixtures verify the executed foundations rather than production catalog balance.
