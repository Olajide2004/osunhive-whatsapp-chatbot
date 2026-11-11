# syntax=docker/dockerfile:1

# ---------- build stage ----------
FROM node:22-bookworm AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# Native build tools for any dependency without a prebuilt binary.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

# Install dependencies first so the layer is cached across source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# ---------- runtime stage ----------
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    TZ=Africa/Lagos \
    SESSION_DIR=/data/session \
    PORT=10000

# ffmpeg: voice notes, stickers, audio/video conversion.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app /app

# WhatsApp auth keys live here. Mount a volume (or Render disk) at /data,
# otherwise every restart needs a fresh QR / pairing code.
RUN mkdir -p /data/session
VOLUME ["/data"]

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||10000)+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Runs as root so a freshly mounted volume at /data is writable without
# a chown step (Render mounts disks as root). Nothing else needs root.
CMD ["node", "index.js"]