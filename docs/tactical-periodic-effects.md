# Tactical periodic effects

## Design grounding and scope

The uploaded design materials remain authoritative. System 24 in **Design Documents.zip**, §11, places damage-over-time at the affected creature's turn end, healing-over-time at turn start, preserves the source, and snapshots application strength by default. §§5–8 specify authored definitions, source-bearing instances, explicit clocks and stacking. System 04 §§9–11 and §21 define attack/mitigation and Downed/Defeated behavior. This batch implements those periodic hooks inside the existing saved tactical loop.

Existing numeric round effects and all earlier encounter histories retain their version-one semantics. Periodic effects require **`tacticalCombat.rules.roundEffects: {version: 2}`**; the encounter also needs a declared typed-damage vocabulary when it has damage pulses. Version two includes the existing numeric conditions. This does not certify the full universal effect engine or a final balanced content catalog.

## Authoring

An `EFFECT` entity uses `mechanics.tacticalRoundEffect` version two. It retains the existing family, Replace/Refresh, rounds, polarity, tags, clock and duration tick. `modifiers` is required but can be empty; supported accuracy/evasion/armor modifiers can accompany a pulse. A periodic definition has exactly one declared pulse hook:

```json
{
  "version": 2,
  "clock": "ROUNDS",
  "tick": "OWNER_END",
  "family": "burning",
  "stacking": "REFRESH",
  "rounds": 2,
  "polarity": "HARMFUL",
  "tags": ["condition", "fire"],
  "modifiers": [],
  "periodic": {
    "kind": "DAMAGE", "timing": "OWNER_END", "amount": 6,
    "damageType": "fire", "armor": "BYPASS", "penetration": 0
  }
}
```

A healing pulse instead uses:

```json
{"kind": "HEAL", "timing": "OWNER_START", "amount": 5}
```

Amounts are integers from 1 to 1000000. Damage explicitly declares `APPLY` or `BYPASS` armor and penetration (0–1000000); bypass requires zero penetration. Damage types must belong to the encounter's typed vocabulary. No universal armor treatment for all poisons/burns is assumed. Other timings, revival, implicit mitigation, unsupported properties and version-one periodic definitions reject.

Damage pulses are granted through the existing `mechanics.tacticalOnHitEffects`; healing pulses through new **`mechanics.tacticalOnHealEffects`**, with the same version-one grant shape (`version`, `minimumNativeLevel`, `effectIds`) and source/dependency rules. Healing grants may also contain numeric version-one effects. A periodic heal in an on-hit grant or a periodic damage effect in an on-heal grant rejects publication. Within a release, a family cannot mix numeric, periodic damage and periodic healing definitions, and its stacking policy must agree.

Only pinned native classes, selected feats/subclasses, active equipment and authored creature templates contribute. Each trigger's eligible grants normalize independently, with duplicate families rejected and at most 32 grants. Native gates and immutable equipment identities remain in force. NPC/monster template grants are checked against their encounter's rules at publication; eligible owned-source combinations are checked atomically at start. Version-one encounters do not load on-heal grants and reject eligible periodic on-hit grants. Encounters without the round-effect opt-in ignore these grants as before.

## Timing, mitigation and lifetime

A connected attack applies damage effects to an opposing target that remains active after direct damage. Ordinary legal healing applies on-heal effects after its direct heal and mana cost; this can follow the existing direct revival of a Downed ally. Periodic healing itself cannot revive a Downed or Defeated creature.

An accepted `END` in a version-two fight first pulses the ending active creature's DoTs, then decrements its effect durations and removes expired instances. Thus a one-round DoT gets its final pulse before expiration. A lethal pulse uses the existing states: enemies become Defeated, party creatures become Downed. Outcome evaluation happens before advancing initiative; a final enemy's DoT death settles victory inside that same action. Remaining pulses on a newly incapacitated owner stop. Duration still ticks for the turn that just ended.

If the fight continues, initiative advances across inactive creatures and respects the existing round limit. The newly selected active creature then receives its HoT pulses before it acts. No pulse occurs at a nonexistent turn beyond the round limit. A self-applied HoT does not retroactively pulse at the start of the turn already in progress; its first pulse requires a later actual turn start while it is still active. Author duration must account for that response window. Incapacitated creatures' skipped turns do not pulse or advance their clocks. Source death does not erase an already applied, independently snapshotted effect.

Within a timing hook, instances resolve in stable family order. Application amount/type/armor/penetration are retained from the pinned definition. Current target armor (including active numeric modifiers) applies when declared, then penetration, then matching typed resistance/vulnerability using integer flooring. Damage has no attack/critical roll, defensive reaction, or implicit minimum chip; immunity yields zero. Guard's triggered armor bonus does not apply. Healing caps at the owner's pinned maximum health. Pulse evidence records the resolved amount and actual before/after health, so over-healing and overkill remain explicit.

Replace installs the incoming definition/strength/source/duration. Refresh retains the original definition, strength and source while increasing remaining duration to the larger of current and incoming authored rounds. It does not silently strengthen a DoT or HoT. One active instance per family and the existing 32-instance limit remain; Independent/Intensity/Strongest-Wins policies are still unsupported.

## Database, replay and API

No migration or expanded runtime permissions are needed. Existing `EFFECT` content versions, release entries, immutable origins/steps, action receipts and encounter/recovery journals persist the source grants, active instances and `periodicEvents`. Each pulse retains owner, effect/source revisions, source unit, original application transition revision, timing, mitigation and health changes. The owning step/receipt identifies the processing action; original application history retains the applying action. Kill-source evidence is available for later quest/PvP hooks, but this batch does not invent those systems or alter the existing encounter reward ownership.

Independent replay reconstructs both trigger sets from pinned character/template sources, reproduces pulses and compares every state/event. SQL continues to enforce immutable consecutive journal entries and coherent settlement; replay reconciles periodic semantics. Victory, loot, XP, campaign proofs/Aftercore, failure recovery, pool updates and receipts remain one transaction. A late failure rolls back enemy draws, pulses, duration, settlement and rewards together. Retries replay the original receipt; stale/illegal intents, reconnect and free reads cannot tick, heal or damage.

Owner views disclose applied pulse timing/strength/mitigation and party on-heal capabilities. Enemy grant lists, private source revisions/equipment identities and internal pulse journals remain hidden. Public commands remain ordinary attack/heal/end choices; clients cannot request pulses or supply strength, sources or rolls. New encounters begin with no active effects and only the existing retained health/mana pools.

## Validation and remaining release work

Rule tests cover end/start timing, final pulse before expiry, healing caps/no passive revival, armor/penetration/resistance/vulnerability/immunity, zero damage, lethal state transitions, stopping subsequent pulses, Refresh/Replace strength, rejected-action immutability, and strict version/type contracts. Database scenarios exercise actual owned effects, pinned publications, reconnect/free reads, concurrent retries, defeat/recovery/fresh encounters, late settlement rollback and corrupted-journal detection, periodic campaign completion, authoring/API boundaries and restricted runtime settlement. The complete existing regression remains required.

Pass 1 remains open for broader authored abilities/checks, condition resistance, buildup/hard control, Remove Curse/persistent cleansing, other stacking policies, auras/persistent clocks, damage-family inheritance/conditional resistance, surprise/opportunity reactions, stabilization/resurrection, complete injury/recovery and owned/shared participants. Progression, quests, items, scheduled/shared systems, operational gates and release verification remain in their later passes.

Version-three [cleansing counterplay](tactical-cleansing.md) extends these hooks with explicit removal metadata and owned Cleanse/Dispel/Cure actions. Removing an eligible periodic instance stops its future pulses; existing version-two histories retain their original behavior.
