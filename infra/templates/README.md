# Another independent project

Copy `compose.yaml` and `project.env.example` to a new root-owned `/srv/kol-infra/projects/<unique-name>/` directory, renaming the env file to `.env` (mode 600). This starts as a non-root, read-only HTTP fixture with a dedicated volume; replace its image, command, health check, identity, mounts, and resource limits for the real application. Populate its volume deliberately before expecting useful content. Do not reuse KoL volume names or credentials.

Set `COMPOSE_PROJECT_NAME` and a free, unique `HTTP_PORT`. The project name prefixes network and volume names. For KoL, use `infra/compose/kol/compose.yaml` and `kol.env.example` with independently generated secrets in a root-only `secrets/` directory. Never copy a production secret file into staging or a future project.

Use explicit paths so commands cannot operate on the wrong project:

```bash
sudo docker --host unix:///var/run/docker.sock compose \
  --project-directory /srv/kol-infra/projects/example-project \
  --env-file /srv/kol-infra/projects/example-project/.env \
  -f /srv/kol-infra/projects/example-project/compose.yaml config --quiet
```

Replace the final `config --quiet` with `up -d --wait`, `ps`, `stop`, or `down` for the intended operation. `down` preserves volumes; `down --volumes` deletes data. Keep databases and administrative ports unpublished. See [Docker operations](../docs/docker-operations.md) for lifecycle, secrets, reboot, exposure checks, and recovery.

`worker.compose.yaml` is a reusable pattern for an unrelated Node worker. Supply its own pinned image, implementation, runtime UID and database secret. The implementation must read `/run/secrets/worker_database_url`, use that project's PostgreSQL database, and handle SIGTERM. Merge the fragment into that project's Compose file and add a health check appropriate to its process. It deliberately has no shared KoL network, volume or credentials. For KoL use the already integrated worker service; see [cache/worker operations](../docs/cache-worker-operations.md).
