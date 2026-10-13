# Tactical resistance reduction and immunity bypass

Typed attack abilities can now opt into explicit per-attack resistance counterplay. The design basis is uploaded System 24 §15: specialist abilities may bypass specific immunities, and resistance reduction may create bounded vulnerability. Core §12 and System 04 §10–11 retain armor before typed resistance. Exact formulas and fixture values are implementation policy, not final launch tuning.

An encounter must declare `tacticalCombat.rules.abilities: {"version": 2}`. Its `typedDamage` contract can remain version 1 or use version 2 damage families. Version-one abilities remain legal and retain their existing formulas. A version-two ability requires both new fields:

```json
{
  "version": 2,
  "minimumNativeLevel": 1,
  "range": 1,
  "manaCost": 2,
  "accuracyModifier": 0,
  "damage": {
    "type": "fire",
    "min": 10,
    "max": 12,
    "penetration": 0,
    "resistanceReductionBps": 4000,
    "bypassImmunity": false
  }
}
```

Reduction is an integer 0–10000 basis points; bypass is an explicit boolean. Missing/fractional/out-of-bounds fields, version-one definitions carrying them, and version-one encounters granting active version-two abilities reject. The existing native/selected/equipment/template gates, Main and mana costs, range, server hit/damage draws and strict request schema remain authoritative. Duplicate equipped sources still grant one choice with all instance provenance and no power stacking.

For the ability's concrete damage type, resolve the target's pinned concrete/family defense first. If it is full immunity (10000) and bypass is false, preserve immunity regardless of reduction. If it is full immunity and bypass is true, treat it as neutral (0) for this attack, then subtract reduction. Otherwise subtract reduction from the existing resistance. Clamp vulnerability at −10000. Thus 6000 resistance with 4000 reduction becomes 2000; immunity with reduction alone remains immunity; explicit bypass plus 2500 reduction becomes −2500. Bypass does not neutralize partial resistance. Armor/penetration, guard, criticals, rounding, miss behavior and the existing connected-damage minimum retain their order.

These values affect only the selected attack. The saved defense never changes; basic attacks, other abilities and periodic damage retain their own calculations. Damage counterplay never bypasses status immunity or grants additional conditions. Existing on-hit rules may still apply a condition on a connected zero-damage attack, and any later pulse uses the original defense.

Version-two encounter evidence includes `resistanceEvents`, empty on other actions. Selected version-two attacks record actor/target/ability/type, original defense, authored reduction, matching bypass decision and effective defense. Existing ability usage evidence provides immutable source revision/instance provenance. The independent audit reconstructs pinned abilities and profiles, verifies the journaled draws and replays mitigation/events/state. Later publication cannot rewrite ongoing fights. Party choice views expose their authored damage contract; enemy profiles and internal evidence remain private. Old version-one and unopted evidence retain their original shape.

No migration or new runtime grant is needed. Existing immutable content, encounter origins/steps, receipts and recovery tables retain the new contract; migrations 001–023 remain unchanged. No live database deployment is included.

Validation covers reduction/bypass/immunity/vulnerability, guard/critical/miss behavior, version gates, owned/template execution, source selection, publication pins, concurrent retry/reconnect, periodic isolation, server costs/recovery, strict authenticated requests, late rollback and forged mitigation evidence. Remaining release gaps include conditional defenses and status-immunity bypass, support/AoE, distinct resources/checks/saves, buildup/control, stabilization/resurrection, complete injury/recovery, owned/shared participants, final catalogs/balance and later release passes. Pass 1 remains open.
