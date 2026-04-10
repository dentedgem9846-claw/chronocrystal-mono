#!/usr/bin/env bash
# One-click local run — no Docker needed.
# Starts simplex-chat + the bot, writes address to data/simplex-address.md on startup.
#
# Usage:
#   cp .env.example .env        # fill in OPENROUTER_API_KEY
#   source .env && ./run.sh     # or: OPENROUTER_API_KEY=sk-or-... ./run.sh

set -e

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
SIMPLEX_BIN="$REPO_ROOT/packages/simplex/bin/simplex-chat"
SIMPLEX_DATA="$REPO_ROOT/data/simplex"
GRIMOIRE_DIR="$REPO_ROOT/data/grimoire"
ADDRESS_FILE="$REPO_ROOT/data/simplex-address.md"

# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

if [ -z "$OPENROUTER_API_KEY" ]; then
    echo "ERROR: OPENROUTER_API_KEY is not set."
    echo "  cp .env.example .env  # fill in your key, then:"
    echo "  source .env && ./run.sh"
    exit 1
fi

if [ ! -f "$SIMPLEX_BIN" ]; then
    echo "ERROR: simplex-chat binary not found at $SIMPLEX_BIN"
    exit 1
fi

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

mkdir -p "$SIMPLEX_DATA" "$GRIMOIRE_DIR"

# ---------------------------------------------------------------------------
# Start simplex-chat
# ---------------------------------------------------------------------------

echo "Starting simplex-chat..."
"$SIMPLEX_BIN" \
    -d "$SIMPLEX_DATA" \
    -p 5225 \
    --create-bot-display-name "${BOT_DISPLAY_NAME:-Shirogane}" \
    > "$REPO_ROOT/data/simplex-chat.log" 2>&1 &
SIMPLEX_PID=$!

# Wait for the WebSocket port to open (up to 30s)
for i in $(seq 1 30); do
    if (echo > /dev/tcp/127.0.0.1/5225) 2>/dev/null; then
        echo "simplex-chat is ready"
        break
    fi
    sleep 1
    if [ $i -eq 30 ]; then
        echo "ERROR: simplex-chat failed to start. Check data/simplex-chat.log"
        kill "$SIMPLEX_PID" 2>/dev/null || true
        exit 1
    fi
done

# ---------------------------------------------------------------------------
# Cleanup on exit
# ---------------------------------------------------------------------------

cleanup() {
    echo ""
    echo "Shutting down..."
    kill "$SIMPLEX_PID" 2>/dev/null || true
    wait "$SIMPLEX_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Start bot
# ---------------------------------------------------------------------------

echo "Starting bot..."
cd "$REPO_ROOT"
SIMPLEX_HOST=127.0.0.1 \
SIMPLEX_PORT=5225 \
AGENTS_DIR="$REPO_ROOT/packages/agent/agents" \
GRIMOIRE_DIR="$GRIMOIRE_DIR" \
ADDRESS_FILE="$ADDRESS_FILE" \
npx tsx packages/simplex/src/index.ts
