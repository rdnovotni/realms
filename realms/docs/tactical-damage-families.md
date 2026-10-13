# Tactical damage-family resistance

An encounter may now opt into typed-damage version 2, granting one resistance to several concrete damage types. This closes the damage-family inheritance gap inside release Pass 1. It uses existing immutable content revisions, character snapshots, tactical origins and steps; migrations 001–023 and runtime permissions are unchanged.

The uploaded core bible §12 and System 04 §11 group Slashing/Piercing/Bludgeoning as Physical and Fire/Cold/Lightning/Acid/Poison as Elemental. System 24 §15 keeps damage resistance separate from status resistance. These are the design basis for families, not a mandate for a fixed catalog. Family membership and additive stacking are explicit implementation policies; the design materials defer final numbers. Values in tests are execution examples, not launch balance.

```json
{
  "version": 2,
  "types": ["slashing", "piercing", "fire"],
  "defaultType": "slashing",
  "resistanceStacking": "SUM_CAPPED",
  "families": {
    "physical": ["slashing", "piercing"],
    "elemental": ["fire"]
  }
}
```

Families are scoped to the pinned encounter rules. Each profile declares 1–32 unique concrete types and 1–32 families, with 1–32 unique concrete members per family. A family name cannot also name a concrete type. Unknown members, empty definitions, duplicate members and nested families reject. Overlapping families are allowed and deliberate: each authored resistance entry contributes once to each of its members. Families cannot be attack/default/periodic damage types.

Existing `tacticalDamageTraits.resistances` and creature `tacticalUnit.damageTraits.resistances` may use concrete or declared family keys under version 2. For example, `{"physical": 5000, "slashing": -2000}` resolves to 3000 slashing and 5000 piercing resistance. All eligible direct and family contributions sum before one final clamp to −10000 through 10000 basis points. Overlap is additive, not strongest-wins or override. Immunity is the final resolved 10000 value; vulnerability can offset a contribution before the cap, just as in version 1.

Only owned native levels, selected feats/subclasses, active equipment and pinned creature templates contribute. Locked owned traits still validate their vocabulary before encounter initialization; unknown keys roll back the start. Source revision/instance provenance remains in the existing independently verified character snapshot. The saved concrete damage profile contains only expanded concrete values. This keeps the execution pipeline unchanged: armor/penetration first, then matching resistance and existing rounding/chip rules. Both basic and selected attacks and periodic damage consume the same profile. Damage immunity does not block Burning or other status application.

Later publications cannot change an ongoing encounter's memberships, source traits or profiles. Independent replay rebuilds defenses from the original release and source revisions and reconciles damage, steps and retained pools. Existing party views show resolved party defenses while keeping enemy defenses and private source data hidden. Version 1 rejects the new family field and continues to accept concrete resistance keys only; untyped fights retain their original state/evidence shape.

Validation includes strict authoring bounds, order-independent sums/caps, overlap, native gates, immunity/vulnerability, guard/penetration, periodic damage, real owned/template sources, pinned newer publication, concurrent retry/reconnect, invalid start rollback, late action rollback and forged profile detection. Full regression and GitHub checks accompany the PR.

Remaining Pass 1 work includes conditional defenses, resistance reduction/immunity bypass, support/AoE abilities, distinct resources and attribute/proficiency checks/saves, buildup/control, stabilization/resurrection, full injury/recovery and owned/shared participants. Final balanced catalogs and the later seven release passes remain incomplete. This batch does not deploy to the live database or certify release readiness.
