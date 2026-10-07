# Local Podman services

`scripts/local-lib.ts` is the executable infrastructure definition (native Podman commands; no Compose provider needed). `.env.example` pins PostgreSQL and Mailpit images and documents the configurable names/ports. Node runs on the host.

- PostgreSQL 18.6: `${PROJECT_NAME}-postgres`, named volume `${PROJECT_NAME}-postgres18-data` mounted at `/var/lib/postgresql`, data at `/var/lib/postgresql/18/docker`, loopback `${DB_PORT}:5432`.
- Mailpit: `${PROJECT_NAME}-mailpit`, loopback SMTP `${MAILPIT_SMTP_PORT}:1025` and inbox `${MAILPIT_UI_PORT}:8025`.
- All resources carry `io.keycade.workspace` and `io.keycade.project` ownership labels. Existing containers must match both labels, port mappings and database identity/storage. Existing unrelated names/ports cause errors.
- Database credentials reach Podman over stdin, never command arguments. Private env/storage are ignored by Git. Initialization preserves nonempty env values and persistent data.
- `pnpm infra:stop` stops these containers without removing either containers or volume. There is deliberately no reset command.

The user explicitly authorized deleting the initial PostgreSQL 17 local data and starting fresh on 18. That one-time reset is separate from ordinary initialization. Explicit legacy 17 configuration still selects the original `${PROJECT_NAME}-postgres-data` volume at `/var/lib/postgresql/data`; changing an existing container's configured image without replacing it is refused. Do not mount a 17 data directory into an 18 server.
