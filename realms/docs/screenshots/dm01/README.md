# DM01 browser and interaction evidence

All scenes use synthetic, disposable data. No screenshot or report contains a real account credential. The [interface contract](../../dm-interface.md) separates implemented shell behavior from future NPC, voice and multiplayer providers.

## Repeat the browser matrix

Build the client and run the loopback frozen visual preview as documented in the interface contract. Open `/dev/matrix` on that preview, then choose **Run browser matrix**. The harness uses a real browser iframe at each requested width. It accepts only same-origin reports from its own child frame and displays progress and the collected JSON in the page. The child calculates the existing visual audit from its actual rendered DOM after loading/resizing; the parent never manufactures passing metrics.

The expected matrix covers 62 scenes at 320, 375, 768, 1024, 1440 and 1920 pixels, plus 17 representative scenes at 320/1440 with reduced motion, high contrast, forced colors, 200% text and coarse-pointer branches: 542 cases total. Frame height is 1000 pixels. The original manual scene/mode controls and audit/export controls remain available. The harness supports wide fixtures even if the host app cannot honor a window viewport override.

Save the page's Browser matrix results as `browser-contracts.json`, then run `npm run visual:check`. The source manifest must match the exact captured client/fixtures. These are layout/semantics/contrast checks, not automated pixel approval. They do not attest real NVDA/VoiceOver speech, microphone transcription, physical touch devices, or a production deployment.

## Play workflow proof

The disposable `scripts/dm-preview.ts` provides a returning player at 3033 and an unconfigured newcomer at 3034. The proof exercised:

1. Newcomer signs in, sees only the discovered starting build, chooses it by click, and receives the shared saved-action receipt.
2. Returning player types `go noncombat`, opens the old sluice, types an ambiguous `attempt`, and receives numbered clarification without spending. Choosing the magic approach resolves the real server action once; the receipt displays 1 Turn, 2 world minutes, disclosed check total/difficulty/chance and the saved outcome.
3. Newcomer switches from the clicked build to `go journal`, `fields`, `set 1 Inspect the sluice in a later life.`, and `Save note`. The Journal displays the persisted note; its receipt records the journal change.
4. The player expands the saved note receipt, leaves `look` as an unsent draft and clicks Refresh. The draft stays intact, the last receipt stays expanded, and there is one main landmark.
5. Synthetic `dm-shell` fixtures distinguish DM, attributed NPC claims, party chat, facts and warnings. This tests their presentation, not a live conversation service.

[Command-created Journal note and expanded receipt](journal-command-receipt.jpg).

The command field, contextual choices and transcript use public filtered projections and the same GameSession action workflow. The server owns checks, resources and state; UI text never establishes quest truth. The session transcript is not a durable audit substitute. Live NPC conversation, party-message transport, integrated voice transcription, and account-synced presentation settings remain separate integrations.

Final local result: **542/542 browser cases passed**, matched to 94 current source/fixture files by `npm run visual:check`. The [verification record](verification.json) records the other executed checks and boundaries. The final screenshot also shows a second command-created note after reconnect, confirming the first note remained saved.
