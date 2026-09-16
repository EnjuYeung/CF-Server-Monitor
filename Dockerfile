FROM --platform=$BUILDPLATFORM golang:1.26.8-bookworm AS agent-build
WORKDIR /agent
COPY agent/go.mod agent/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY agent/ ./
RUN --mount=type=cache,target=/root/.cache/go-build --mount=type=cache,target=/go/pkg/mod go run ./tools/build -out=/agent-dist

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG GEOIP_MONTH
RUN npm run build:frontend && GEOIP_MONTH=${GEOIP_MONTH} npm run geoip:download && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=8080 DATA_DIR=/app/data GEOIP_PATH=/app/geoip/dbip-country-lite.mmdb
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/dist ./dist
COPY --from=build /app/geoip ./geoip
COPY --from=agent-build /agent-dist ./agent-dist
COPY agent/LICENSE agent/UPSTREAM.md ./agent-licenses/
COPY scripts/container-entrypoint.js ./scripts/container-entrypoint.js
RUN mkdir /app/data && chown node:node /app/data
VOLUME ["/app/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "scripts/container-entrypoint.js"]
