# ── Stage 1: build the React client ──────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Root package.json is required — server has a "file:.." workspace dep on it
COPY package.json package-lock.json* ./

COPY client/package.json client/package-lock.json* ./client/
RUN npm ci --prefix client

COPY client/ ./client/

# Optional: override the WebSocket URL baked into the client bundle.
# Defaults to window.location.hostname:8080 at runtime (no arg needed for standard setups).
ARG VITE_WS_URL
ENV VITE_WS_URL=$VITE_WS_URL

RUN npm run build --prefix client

# ── Stage 2: production server ────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

COPY package.json ./
COPY server/package.json server/package-lock.json* ./server/
RUN npm install --prefix server --omit=dev

COPY server/ ./server/
COPY --from=builder /app/client/dist ./client/dist

ENV NODE_ENV=production \
    WS_PORT=8080 \
    WS_HOST=0.0.0.0

# Run with: -p 5004:5004/udp -p 5005:5005/udp so the X-Touch can reach us
EXPOSE 8080
EXPOSE 5004/udp
EXPOSE 5005/udp

CMD ["node", "server/index.js"]
