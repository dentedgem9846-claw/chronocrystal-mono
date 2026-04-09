FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install Node.js 22
RUN apt-get update \
    && apt-get install -y curl \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# simplex-chat binary — committed to repo, no download needed
COPY packages/simplex/bin/simplex-chat /usr/local/bin/simplex-chat
RUN chmod +x /usr/local/bin/simplex-chat

# Install deps — cached unless package.json changes
COPY packages/simplex/package.json packages/simplex/package-lock.json packages/simplex/
COPY packages/agent/package.json packages/agent/
RUN cd packages/simplex && npm ci --omit=dev
RUN cd packages/agent && npm install --omit=dev

# Source files
COPY packages/simplex/src packages/simplex/src
COPY packages/agent/src packages/agent/src
COPY packages/agent/agents packages/agent/agents

COPY packages/simplex/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# /data: simplex keys, grimoire, address file
# Note: Railway volumes are attached via the dashboard/CLI, not declared here.

ENTRYPOINT ["/entrypoint.sh"]
