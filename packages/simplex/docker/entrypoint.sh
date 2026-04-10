#!/bin/bash
set -e

DISPLAY_NAME="${BOT_DISPLAY_NAME:-Shirogane}"

mkdir -p /data/simplex /data/grimoire

simplex-chat -d /data/simplex -p 5225 --create-bot-display-name "$DISPLAY_NAME" &
SIMPLEX_PID=$!

echo "Waiting for simplex-chat to start..."
for i in $(seq 1 30); do
    if (echo > /dev/tcp/127.0.0.1/5225) 2>/dev/null; then
        echo "simplex-chat is ready"
        break
    fi
    sleep 1
done

export SIMPLEX_HOST=127.0.0.1
export SIMPLEX_PORT=5225
export AGENTS_DIR=/app/packages/agent/agents
export GRIMOIRE_DIR=/data/grimoire
export ADDRESS_FILE=/data/simplex-address.md

exec node --import /app/packages/simplex/node_modules/tsx/dist/esm/index.mjs \
    /app/packages/simplex/src/index.ts
