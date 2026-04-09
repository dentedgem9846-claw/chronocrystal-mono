# Changelog

## [Unreleased]

### Added
- Initial SimpleX Chat transport (`src/index.ts`): connects to a self-hosted SimpleX CLI WebSocket server, routes messages to the Shirogane agent, one isolated session per contact.
- Per-contact agent session management with serialized message queue (no concurrent messages per contact).
- Auto-accept incoming contact requests; welcome message on first contact.
- Retry/reconnect loop on server disconnect.
- `ADDRESS_FILE` env var: bot writes its SimpleX contact address to a file on startup (defaults to `data/simplex-address.md` in Docker).
- Docker setup (`docker/Dockerfile`, `docker/entrypoint.sh`): single Ubuntu 22.04 container running simplex-chat CLI + bot. Data persists in `/data` volume so address stays stable across restarts.
- simplex-chat v6.4.11 binary committed to `bin/simplex-chat` — Docker copies it directly, no download at build time.
- `docker-compose.yml` at repo root: one-command deploy (`docker compose up`).
- `run.sh` at repo root: one-command local dev run without Docker.
- `railway.toml` for Railway deployment.
- `.env.example` documenting required and optional environment variables.
