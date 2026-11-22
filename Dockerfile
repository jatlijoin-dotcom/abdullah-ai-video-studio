# Abdullah AI Video Studio — backend image
# Node 22 (node:sqlite is built in; no native build step needed),
# FFmpeg + fonts for captions.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      fonts-noto-core \
      fonts-dejavu-core \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Storage (SQLite DB, uploads, generated videos) persists in a volume.
VOLUME ["/app/storage"]

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
