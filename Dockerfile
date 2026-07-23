FROM node:20-bookworm-slim AS base

WORKDIR /app

# better-sqlite3 needs to compile a native addon
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=3000

VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "src/server.js"]
