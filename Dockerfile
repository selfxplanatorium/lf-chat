# ---- Build frontend ----
FROM node:22-alpine AS frontend-builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Build server ----
FROM node:22-alpine AS server-builder

WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN npm ci

COPY server/ .
RUN npx tsc

# ---- Production ----
FROM node:22-alpine

RUN apk add --no-cache tini

WORKDIR /app

COPY --from=frontend-builder /app/dist ./dist
COPY --from=server-builder /app/server/dist ./server/dist
COPY --from=server-builder /app/server/node_modules ./server/node_modules

ENV HOST=0.0.0.0
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/dist/index.js"]