# @dentedgemclaw9846/chronocrystal-simplex

SimpleX Chat transport for the ChronoCrystal agent. Connects to a self-hosted SimpleX Chat CLI server and routes messages to the Shirogane agent.

## How it works

1. The SimpleX Chat CLI binary runs as a WebSocket server (port 5225).
2. This package connects to it, sets up a contact address, and enables auto-accept.
3. When a user contacts the bot on SimpleX, an independent agent session is created for them.
4. Their messages are routed to Shirogane, and replies are sent back.
5. Each contact gets their own isolated conversation session.

## Requirements

- `OPENROUTER_API_KEY` — for the agent
- SimpleX Chat CLI running on WebSocket (either locally or via Docker)

## Running locally (development)

Start the SimpleX server:

```bash
simplex-chat -p 5225
```

In another terminal, from the repo root:

```bash
OPENROUTER_API_KEY=sk-or-... npx tsx packages/simplex/src/index.ts
```

Environment variables:

| Variable            | Default         | Description                                 |
|---------------------|-----------------|---------------------------------------------|
| `OPENROUTER_API_KEY`| —               | Required. OpenRouter API key.               |
| `SIMPLEX_HOST`      | `localhost`     | SimpleX CLI WebSocket host.                 |
| `SIMPLEX_PORT`      | `5225`          | SimpleX CLI WebSocket port.                 |
| `BOT_DISPLAY_NAME`  | `Shirogane`     | Bot display name (used on first run only).  |
| `DEFAULT_MODEL`     | from agent pkg  | Override the OpenRouter model ID.           |
| `HONCHO_API_KEY`    | —               | Optional. Enables persistent memory.        |
| `AGENTS_DIR`        | `../../agent/agents` | Path to agent markdown definitions.    |
| `GRIMOIRE_DIR`      | `../../agent/grimoire` | Path to grimoire workspace.          |

## Docker (self-hosted)

The Docker setup runs both the SimpleX Chat CLI and the bot in a single container.

### Build

From the repo root:

```bash
./packages/simplex/docker.sh build
```

### Create and start

```bash
export OPENROUTER_API_KEY="sk-or-..."
./packages/simplex/docker.sh create
```

This starts the container with `--restart unless-stopped`. Logs (including the bot's SimpleX address) are available with:

```bash
./packages/simplex/docker.sh logs
```

### Other commands

```bash
./packages/simplex/docker.sh status   # is the container running?
./packages/simplex/docker.sh stop     # stop it
./packages/simplex/docker.sh start    # restart it
./packages/simplex/docker.sh shell    # exec into the container
./packages/simplex/docker.sh remove   # remove the container
```

### Data persistence

Bot data (SimpleX keys, contacts, conversation history) is stored at `/home/chrono/data` inside the container. To persist across container recreations, mount a host volume:

```bash
docker run -d \
  --name chronocrystal-simplex \
  -v /path/to/data:/home/chrono/data \
  -e OPENROUTER_API_KEY="sk-or-..." \
  chronocrystal-simplex
```
