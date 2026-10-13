# Realms — one master source

`main` is the authoritative development source for the game and its home-server tools.

- `realms/`: TypeScript game server, browser client, migrations and content.
- `infra/`: private deployment templates, Server Console and Development Studio.

The Ubuntu checkout is `/srv/Realms/source`. Runtime data, credentials and backups stay outside Git. GitHub stores source code; deployed images are separately recorded, immutable application artifacts. Never infer the running version from the GitHub branch alone.

See `infra/docs/development-studio.md` for editing, GitHub synchronization and publishing tested updates. See `realms/README.md` for game architecture.
