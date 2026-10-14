# Publish a game update from testing to live

[Operations map](README.md) · [Current source status](../../realms/docs/implementation-status.md) · [Branding compatibility](../../realms/docs/branding-and-pages.md)

Open **Follybound Server Console → Game updates**. You can also read this guide inside **Help & guide**.

1. Save your game changes under `/srv/Realms/source/realms`. Open Development Studio and save a source checkpoint. The build uses that recorded Git commit; uncommitted edits are excluded.
2. Open **1 · Build for testing**. Name your update and choose **Build and install on test game**. Leave database updates unchecked unless the new migration files have been reviewed. A backup and automated checks run before the private test game is updated.
3. Select that build above the tabs. Open **2 · Test and approve → Open private test game**. Sign in with a test account and try the changed gameplay. Test accounts and progress are separate from live players. Check both boxes, then **Save test approval**.
4. Open **3 · Publish or recover → Review what will change**. When satisfied, choose **Publish this build to the live game** and confirm. The console saves a fresh backup and installs the exact tested build. Public players may briefly lose connection.
5. Choose **Check live website**, then visit https://playfollybound.com and try sign-in and gameplay yourself.

Ubuntu asks for your administrator password in its own dialog. Progress appears in **What is happening**. You can switch pages while an action finishes. Closing the console leaves the game running.

If publishing is disabled, read the explanation above the tabs. Status must be current, the selected build must still be running on the private test game, and approval must belong to that exact build. The administrator helper rechecks compatibility before making changes.

## If something fails

Read **What is happening**, **Logs**, and **History**. A failed operation may have applied some changes. The console can return to previous code only when it remains compatible with the current database. Database updates cannot be undone by selecting previous code. Prepare a corrected build when older code is unsafe; do not replace new player progress with an old backup.

**Backups → Test recovery safely** restores the selected backup into disposable test databases. It does not overwrite the live game. Keep the external drive connected and store its recovery password somewhere outside this computer.

The older **Original local tools** control the native game services. Use **Game updates** to publish the public container game. No full live promotion rehearsal has been performed by this UI polish task.
