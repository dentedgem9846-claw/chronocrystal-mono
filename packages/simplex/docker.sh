#!/usr/bin/env bash
# ChronoCrystal SimpleX bot container management
# Usage:
#   ./docker.sh build             - Build the image
#   ./docker.sh create            - Create and start the container
#   ./docker.sh start             - Start a stopped container
#   ./docker.sh stop              - Stop the container
#   ./docker.sh remove            - Remove the container
#   ./docker.sh status            - Check container status
#   ./docker.sh shell             - Open a shell in the container
#   ./docker.sh logs              - Tail container logs

CONTAINER_NAME="chronocrystal-simplex"
IMAGE_NAME="chronocrystal-simplex"
# Dockerfile is at packages/simplex/docker/Dockerfile but uses paths relative
# to the repo root, so we build from the repo root.
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

case "$1" in
  build)
    echo "Building image '${IMAGE_NAME}' from repo root..."
    docker build \
      -f "${REPO_ROOT}/packages/simplex/docker/Dockerfile" \
      -t "$IMAGE_NAME" \
      "$REPO_ROOT"
    echo "Image built: ${IMAGE_NAME}"
    ;;

  create)
    if [ -z "$OPENROUTER_API_KEY" ]; then
      echo "ERROR: OPENROUTER_API_KEY is not set."
      exit 1
    fi

    if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
      echo "Container '${CONTAINER_NAME}' already exists. Remove it first with: $0 remove"
      exit 1
    fi

    echo "Creating container '${CONTAINER_NAME}'..."
    docker run -d \
      --name "$CONTAINER_NAME" \
      --restart unless-stopped \
      -e "OPENROUTER_API_KEY=${OPENROUTER_API_KEY}" \
      -e "BOT_DISPLAY_NAME=${BOT_DISPLAY_NAME:-Shirogane}" \
      -e "DEFAULT_MODEL=${DEFAULT_MODEL:-}" \
      -e "HONCHO_API_KEY=${HONCHO_API_KEY:-}" \
      "$IMAGE_NAME"

    if [ $? -eq 0 ]; then
      echo "Container '${CONTAINER_NAME}' created and running."
      echo "Run '$0 logs' to see the bot address."
    else
      echo "Failed to create container."
      exit 1
    fi
    ;;

  start)
    echo "Starting container '${CONTAINER_NAME}'..."
    docker start "$CONTAINER_NAME"
    ;;

  stop)
    echo "Stopping container '${CONTAINER_NAME}'..."
    docker stop "$CONTAINER_NAME"
    ;;

  remove)
    echo "Removing container '${CONTAINER_NAME}'..."
    docker rm -f "$CONTAINER_NAME"
    ;;

  status)
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
      echo "Container '${CONTAINER_NAME}' is running."
      docker ps --filter "name=${CONTAINER_NAME}" --format "table {{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
    elif docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
      echo "Container '${CONTAINER_NAME}' exists but is not running."
      echo "Start it with: $0 start"
    else
      echo "Container '${CONTAINER_NAME}' does not exist."
      echo "Build and create it with: $0 build && $0 create"
    fi
    ;;

  shell)
    echo "Opening shell in '${CONTAINER_NAME}'..."
    docker exec -it "$CONTAINER_NAME" /bin/bash
    ;;

  logs)
    docker logs -f "$CONTAINER_NAME"
    ;;

  *)
    echo "ChronoCrystal SimpleX Bot"
    echo ""
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  build    - Build the Docker image"
    echo "  create   - Create and start the container (requires OPENROUTER_API_KEY)"
    echo "  start    - Start a stopped container"
    echo "  stop     - Stop the container"
    echo "  remove   - Remove the container"
    echo "  status   - Check container status"
    echo "  shell    - Open a shell in the container"
    echo "  logs     - Tail container logs"
    echo ""
    echo "Environment variables (set before running 'create'):"
    echo "  OPENROUTER_API_KEY  (required)"
    echo "  BOT_DISPLAY_NAME    (default: Shirogane)"
    echo "  DEFAULT_MODEL       (default: from agent package)"
    echo "  HONCHO_API_KEY      (optional, for persistent memory)"
    ;;
esac
