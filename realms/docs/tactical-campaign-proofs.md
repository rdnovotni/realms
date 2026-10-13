# Tactical campaign completion proofs

An authored tactical finale can now settle victory, enter Aftercore and make the existing voluntary Ascension transition eligible. Earlier tactical victories alone award their normal loot/XP without finishing the campaign. Basic-duel completion keeps its original mechanics and evidence.

## Design basis

System 10 §7 makes normal campaign victory the ordinary Ascension requirement and leaves Aftercore/Ascension voluntary. System 44 §32–34 requires an authored conclusion for the run, recognizes that ending in Aftercore and preserves its legitimacy. These uploaded design materials govern this boundary; exact campaign nodes, endings and rewards remain authored content work.

This contract supports an explicitly declared tactical final encounter with conjunctive prerequisite victories. It does not invent an ending catalog, narrative consequences, alternate/secret victory rules, quest graphs, Mastery or Legacy rewards.

## Publication and authority

A TUNING entity declares `mechanics.tacticalCampaign`:

```json
{
  "version": 1,
  "ruleset": "TACTICAL_CAMPAIGN_V1",
  "finalEncounterId": "encounter.finale",
  "requiresEncounterIds": ["encounter.checkpoint"]
}
```

The final encounter declares `tacticalCombat.campaignId` and depends on this tuning entity. The campaign depends on its prerequisites, which must be ordinary managed tactical encounters using the same character profile. Prerequisites are unique, bounded to 32 and cannot include the finale or another campaign finale. An empty prerequisite list is an explicit authoring choice. Reference validation follows the existing reverse-final-reference convention to avoid dependency cycles.

Start and settlement independently check the owner's ACTIVE run and pinned release. Foreign accounts, previous lives, ordinary generic encounter victories, basic-duel victories and different character profiles cannot satisfy the tactical campaign. Discovery of the final encounter remains required.

Starting a new tactical fight on an ACTIVE run adopts the existing CAMPAIGN completion policy, so an editable status flag cannot replace a completion proof. This matches basic-combat starts. Existing historical runs and encounters are not rewritten.

## Atomic settlement and evidence

A final victory appends the existing `run_completions` proof with an explicit tactical ruleset and the exact sealed campaign revision. New `tactical_campaign_prerequisites` records pin each qualifying definition, instance and immutable finish Action. The server chooses an earlier qualifying victory deterministically. The final encounter's stored start receipt and each prerequisite's finish receipt provide committed run revisions; every prerequisite must finish before that start revision. Transaction-start timestamps do not determine ordering.

Loot, XP, tactical steps/draws, recovery, prerequisite evidence, the completion proof, AFTERCORE status and the request receipt commit or roll back together. Duplicate requests replay their original receipt, including after Ascension. Retreat, defeat and failed-forward outcomes never create a completion proof. Once completed, the finale cannot be restarted for another completion reward; ordinary Aftercore encounters remain available.

The existing owner-scoped tactical start/action/read API adds `campaignCompleted` for authored finales. Internal prerequisite identities, campaign mechanics and raw source evidence are not added to the public view. Ascension remains the existing explicit authenticated action; winning never forces it.

## Database and migration

Migration 023 adds one append-only prerequisite-evidence table and a ruleset discriminator to the existing completion table. It broadens the final-instance foreign key to the common encounter journal, then independently verifies the appropriate engine. Old basic completions receive their known basic-duel discriminator; every original field stays unchanged. No historical tactical proofs or prerequisite evidence are fabricated. Migrations 001–022 are untouched.

Deferred SQL checks verify final/run/release ownership, managed tactical origin, actual victory, owner receipt, exact campaign identity/revision, matching final settlement Action/time, earlier prerequisite Action revisions, profile agreement and exact prerequisite coverage. A basic proof cannot point at a tactical/generic encounter or carry tactical evidence. Audit and restore checks use the combined completion-integrity view and the existing tactical replay audit.

The restricted runtime can append evidence but cannot update/delete it or completion history. Indexed foreign keys cover all new provenance references. This migration is being validated on disposable test schemas; private development deployment is a separate operation.

## Validation and remaining work

Focused tactical-campaign and legacy-combat tests passed. The complete regression suite verifies migration preservation of existing basic completion fields, runtime permissions, malformed publication, foreign/old-life qualification, pinned revisions, concurrent replay, late rollback, failed endings, forged SQL completion, corruption detection and voluntary Ascension. The PR records final counts and GitHub results.

Pass 1 remains open for conditions, broader abilities/check integration, surprise/opportunity reactions, complete recovery/injury contracts and owned/shared participants. Broader campaign branching, narrative/quest consequences, alternate victory types, final content/balance, Ascension previews and Mastery/Legacy rewards remain later work. This closes the tactical completion boundary without declaring the game release-ready.
